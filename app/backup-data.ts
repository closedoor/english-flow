export const BACKUP_MAX_BYTES = 2_000_000;
const BACKUP_VALUE_MAX_LENGTH = 500_000;

type ReadableStorage = Pick<Storage, "getItem">;
type WritableStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type LearningBackup<Key extends string = string> = {
  app: "english-flow";
  formatVersion: 1;
  exportedAt: string;
  data: Record<Key, unknown>;
};

export function createLearningBackup<Key extends string>(storage: ReadableStorage, keys: readonly Key[], exportedAt = new Date().toISOString()) {
  const data = Object.fromEntries(keys.map((key) => {
    const raw = storage.getItem(key);
    if (!raw) return [key, null];
    try { return [key, JSON.parse(raw) as unknown]; } catch { return [key, null]; }
  })) as Record<Key, unknown>;
  return { app: "english-flow", formatVersion: 1, exportedAt, data } satisfies LearningBackup<Key>;
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const nonnegative = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0;
const integer = (value: unknown) => nonnegative(value) && Number.isSafeInteger(value);
const positiveId = (value: unknown) => integer(value) && Number(value) > 0;
const textId = (value: unknown) => typeof value === "string" && value.trim().length > 0;
const oneOf = (value: unknown, choices: readonly unknown[]) => choices.includes(value);
const listOf = (value: unknown, valid: (item: unknown) => boolean) => Array.isArray(value) && value.every(valid);
const optional = (value: Record<string, unknown>, key: string, valid: (item: unknown) => boolean) => !Object.hasOwn(value, key) || valid(value[key]);
const wordMode = (value: unknown) => oneOf(value, ["free", "test"]);
const wordPath = (value: unknown) => oneOf(value, ["frequency", "daily", "restaurant", "airport", "hotel", "shopping"]);
const sentenceBand = (value: unknown) => oneOf(value, ["short", "medium", "long"]);
const sentenceCategory = (value: unknown) => oneOf(value, ["all", "daily", "social", "food", "travel", "shopping", "work", "help"]);
const sentenceMode = (value: unknown) => oneOf(value, ["bilingual", "speak"]);
const patternCategory = (value: unknown) => oneOf(value, ["all", "daily", "request", "social", "travel", "food", "shopping", "work"]);
const sessionCount = (value: unknown) => value === 10 || value === 20;
const ratings = (value: unknown) => isRecord(value) && Object.values(value).every((rating) => rating === "known" || rating === "difficult");

function studyDate(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

// Validate stored shapes before the user can replace their records. Do not use
// hydration's time limits here: an old backup may contain an expired session
// alongside valuable progress, and time-zone changes may put a date in tomorrow.
function validBackupRecord(key: string, value: unknown): boolean {
  if (value === null) return true;
  switch (key) {
    case "wordflow-ngsl-mastered-v1":
    case "wordflow-ngsl-difficult-v1":
    case "wordflow-sentence-saved-v1":
    case "wordflow-sentence-seen-v1":
    case "wordflow-sentence-mastered-v1":
    case "wordflow-sentence-difficult-v1": return listOf(value, positiveId);
    case "wordflow-pattern-mastered-v1":
    case "wordflow-pattern-difficult-v1":
    case "wordflow-reading-completed-v1": return listOf(value, textId);
    case "wordflow-days": return listOf(value, studyDate);
    case "wordflow-ngsl-schedule-v1":
      return isRecord(value) && Object.entries(value).every(([id, entry]) => /^\d+$/.test(id) && positiveId(Number(id)) && isRecord(entry) && nonnegative(entry.due) && integer(entry.stage) && Number(entry.stage) <= 5);
    case "wordflow-session-preferences-v1":
      return isRecord(value) && optional(value, "mode", wordMode) && optional(value, "count", sessionCount) && optional(value, "path", wordPath);
    case "wordflow-sentence-preferences-v1":
      return isRecord(value) && optional(value, "band", sentenceBand) && optional(value, "category", sentenceCategory) && optional(value, "count", sessionCount) && optional(value, "mode", sentenceMode);
    case "wordflow-practice-rotation-v1":
      return isRecord(value) && ["word", "sentence", "pattern"].every((field) => optional(value, field, integer));
    case "wordflow-reading-last-v1":
      return isRecord(value) && textId(value.id) && nonnegative(value.updatedAt);
    case "wordflow-reading-answers-v1":
      return isRecord(value) && Object.entries(value).every(([id, answer]) => /^r(?:[1-9]|1[0-5])$/.test(id) && integer(answer) && Number(answer) < 3);
    case "wordflow-active-session-v1":
    case "wordflow-sentence-active-session-v1":
    case "wordflow-pattern-active-session-v1": {
      if (!isRecord(value) || value.version !== 1 || !nonnegative(value.updatedAt) || !optional(value, "index", integer) || !optional(value, "ratings", ratings)) return false;
      if (key === "wordflow-sentence-active-session-v1") {
        return sentenceBand(value.band) && sentenceCategory(value.category) && sessionCount(value.count) && optional(value, "mode", sentenceMode)
          && Array.isArray(value.sentenceIds) && value.sentenceIds.length > 0 && value.sentenceIds.every(positiveId);
      }
      if (key === "wordflow-pattern-active-session-v1") {
        return patternCategory(value.category) && optional(value, "drillIndex", (item) => integer(item) && Number(item) <= 2)
          && Array.isArray(value.patternIds) && value.patternIds.length > 0 && value.patternIds.every(textId);
      }
      return wordPath(value.path) && wordMode(value.mode) && oneOf(value.stage, ["cards", "quiz"])
        && optional(value, "kind", (kind) => kind === "group" || (kind === "lookup" && value.mode === "free" && Array.isArray(value.wordIds) && value.wordIds.length === 1))
        && (value.stage !== "quiz" || value.mode === "test")
        && Array.isArray(value.wordIds) && value.wordIds.length > 0 && value.wordIds.every(positiveId)
        && optional(value, "quizIndex", integer) && optional(value, "quizAnswer", (item) => typeof item === "string")
        && optional(value, "quizFeedback", (item) => oneOf(item, [null, "correct", "wrong"]))
        && optional(value, "quizResults", (item) => listOf(item, (result) => typeof result === "boolean"));
    }
    default: return true;
  }
}

export function isLearningBackup<Key extends string>(value: unknown, keys: readonly Key[], optionalKeys: readonly Key[] = []): value is LearningBackup<Key> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const backup = value as Partial<LearningBackup<Key>>;
  if (backup.app !== "english-flow" || backup.formatVersion !== 1 || typeof backup.exportedAt !== "string" || !Number.isFinite(Date.parse(backup.exportedAt))) return false;
  if (!backup.data || typeof backup.data !== "object" || Array.isArray(backup.data)) return false;
  const data = backup.data as Record<string, unknown>;
  const keySet = new Set<string>(keys);
  const optionalKeySet = new Set<string>(optionalKeys);
  if (Object.keys(data).some((key) => !keySet.has(key))) return false;
  if (!keys.every((key) => optionalKeySet.has(key) || Object.prototype.hasOwnProperty.call(data, key))) return false;
  return Object.keys(data).every((key) => {
    try {
      const serialized = JSON.stringify(data[key]);
      return serialized !== undefined && serialized.length <= BACKUP_VALUE_MAX_LENGTH && validBackupRecord(key, data[key]);
    } catch {
      return false;
    }
  });
}

export function restoreLearningBackupData<Key extends string>(storage: WritableStorage, keys: readonly Key[], backup: LearningBackup<Key>) {
  const previous = new Map<Key, string | null>();
  const applied: Key[] = [];
  try {
    keys.forEach((key) => previous.set(key, storage.getItem(key)));
    // Serialize everything before touching storage. Free space before growing
    // other records so a backup that fits does not need a second copy's quota.
    const replacements = keys.map((key) => {
      const value = Object.prototype.hasOwnProperty.call(backup.data, key) ? backup.data[key] : null;
      const next = value === null ? null : JSON.stringify(value);
      if (next === undefined) throw new Error("Invalid backup value");
      return { key, next, delta: (next?.length ?? 0) - (previous.get(key)?.length ?? 0) };
    }).sort((left, right) => left.delta - right.delta);
    replacements.forEach(({ key, next }) => {
      if (next === previous.get(key)) return;
      if (next === null) storage.removeItem(key);
      else storage.setItem(key, next);
      applied.push(key);
    });
    return true;
  } catch {
    // Undo in reverse order: every intermediate size already fitted during the
    // forward writes. One blocked key must not prevent restoring the others.
    for (const key of applied.reverse()) {
      try {
        const value = previous.get(key) ?? null;
        if (value === null) storage.removeItem(key);
        else storage.setItem(key, value);
      } catch {
        // The caller surfaces a persistent-storage warning if access fails.
      }
    }
    return false;
  }
}
