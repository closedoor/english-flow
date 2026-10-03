type LearningStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type StorageCoordinatorOptions = {
  keys: readonly string[];
  initial: Pick<Storage, "getItem">;
  storage: () => LearningStorage;
  locks?: Pick<LockManager, "request">;
  onConflict: () => void;
  onError: () => void;
  lockTimeoutMs?: number;
};

export const LEARNING_STORAGE_LOCK = "english-flow-learning-storage-v1";

// All current windows use the same origin-scoped exclusive lock. Compare the
// complete verified startup/last-write snapshot while holding it; a stale
// window stops before replacing any newer record. No records are merged.
export function createLearningStorageCoordinator(options: StorageCoordinatorOptions) {
  const keys = [...options.keys];
  const keySet = new Set(keys);
  const expected = new Map(keys.map((key) => [key, options.initial.getItem(key)]));
  // Desired values belong to this page's rescuable memory. A dismissed warning
  // cannot make a failed save durable; unrelated successful writes cannot clear
  // it either. Track the latest queued value separately from successful disk.
  const desired = new Map(expected);
  let active = true;
  let paused = false;
  let pending = 0;
  let transactionPending = false;
  let draining = false;
  const queue: { operation: (storage: LearningStorage) => boolean; resolve: (result: boolean) => void }[] = [];
  const idleWaiters: (() => void)[] = [];
  const controllers = new Set<AbortController>();
  const cancelPendingLocks = () => controllers.forEach((controller) => controller.abort());

  const conflict = () => {
    if (paused || !active) return;
    paused = true;
    cancelPendingLocks();
    options.onConflict();
  };
  const failure = () => {
    if (active && !paused) options.onError();
    return false;
  };
  const checkKey = (key: string) => {
    if (!keySet.has(key)) throw new Error("Unknown learning storage key");
  };
  const perform = (operation: (storage: LearningStorage) => boolean) => {
    if (!active || paused) return false;
    try {
      const storage = options.storage();
      // Finish the full read before making any mutation. Compare at execution
      // time against our own last successful writes, not an older queued effect.
      const current = keys.map((key) => [key, storage.getItem(key)] as const);
      if (current.some(([key, value]) => value !== expected.get(key))) {
        conflict();
        return false;
      }
      const tracked: LearningStorage = {
        getItem: (key) => storage.getItem(key),
        setItem: (key, value) => {
          checkKey(key);
          const next = String(value);
          if (next === expected.get(key)) return;
          storage.setItem(key, next);
          expected.set(key, next);
        },
        removeItem: (key) => {
          checkKey(key);
          if (expected.get(key) === null) return;
          storage.removeItem(key);
          expected.set(key, null);
        },
      };
      // Tracking each successful write also tracks successful rollback writes.
      // A persistent platform refusal may prevent rollback; do not invent an
      // expected snapshot or throw away the page's rescuable memory in that case.
      return operation(tracked) || failure();
    } catch {
      return failure();
    }
  };
  const withLock = async (operation: () => boolean) => {
    if (!active || paused) return false;
    if (!options.locks) {
      // Older/nonsecure environments retain the synchronous snapshot precheck.
      // It is useful protection, but is not an atomic cross-process substitute
      // for Web Locks. Do not claim simultaneous writes are serialized there.
      return operation();
    }
    const controller = new AbortController();
    controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), options.lockTimeoutMs ?? 2_000);
    try {
      return await options.locks.request(LEARNING_STORAGE_LOCK, { mode: "exclusive", signal: controller.signal }, operation);
    } catch {
      // A denied/timed-out supported lock must not silently become an unlocked
      // write. Keep current in-memory work for the existing export action.
      return failure();
    } finally {
      clearTimeout(timer);
      controllers.delete(controller);
    }
  };
  const drain = async () => {
    if (draining) return;
    draining = true;
    try {
      const completed = await withLock(() => {
        // Save all effects already queued in this tick in one synchronous lock
        // callback. Each still checks the full snapshot and keeps its FIFO order;
        // dozens of keys do not need dozens of asynchronous lock grants.
        while (queue.length) {
          const item = queue.shift()!;
          const result = perform(item.operation);
          pending -= 1;
          item.resolve(result);
        }
        return true;
      });
      if (!completed) {
        while (queue.length) {
          const item = queue.shift()!;
          pending -= 1;
          item.resolve(false);
        }
      }
    } finally {
      draining = false;
      if (queue.length) void drain();
      else idleWaiters.splice(0).forEach((resolve) => resolve());
    }
  };
  const enqueue = (operation: (storage: LearningStorage) => boolean) => {
    pending += 1;
    const task = new Promise<boolean>((resolve) => queue.push({ operation, resolve }));
    void drain();
    return task;
  };
  const flush = async () => {
    if (pending || draining) await new Promise<void>((resolve) => idleWaiters.push(resolve));
  };

  return {
    // The return value means queued, not persisted. Callers keep their existing
    // memory state immediately; update/reload must also check isIdle and disk.
    write(key: string, serialized: string | null) {
      if (!active || paused || transactionPending) return false;
      if (!keySet.has(key) || (serialized !== null && typeof serialized !== "string")) return failure();
      desired.set(key, serialized);
      void enqueue((storage) => {
        if (serialized === null) storage.removeItem(key);
        else storage.setItem(key, serialized);
        return true;
      });
      return true;
    },
    async transaction(operation: (storage: LearningStorage) => boolean, replacementKeys: readonly string[] = keys) {
      if (!active || paused || transactionPending) return false;
      if (!Array.isArray(replacementKeys) || new Set(replacementKeys).size !== replacementKeys.length
        || replacementKeys.some((key) => !keySet.has(key))) return failure();
      transactionPending = true;
      try {
        // Existing queued saves finish first. Ignore delayed old save effects
        // while restore/reset is pending; the confirmed operation replaces
        // these values, then subsequent new UI state can save normally again.
        const completed = await enqueue((storage) => {
          const completed = operation(storage);
          // Reset preserves some fields. A successful replacement can clear
          // dirty memory only for its explicit target keys, including targets
          // whose desired reset value already equals disk and needs no write.
          if (completed) replacementKeys.forEach((key) => desired.set(key, expected.get(key)!));
          return completed;
        });
        await flush();
        return completed;
      } finally {
        transactionPending = false;
      }
    },
    pause() { paused = true; cancelPendingLocks(); },
    dispose() { active = false; paused = true; cancelPendingLocks(); },
    isIdle() { return active && !paused && !draining && pending === 0 && !transactionPending; },
    hasUnsavedChanges() {
      return pending > 0 || draining || transactionPending
        || keys.some((key) => desired.get(key) !== expected.get(key));
    },
    flush,
  };
}

export type LearningStorageCoordinator = ReturnType<typeof createLearningStorageCoordinator>;
