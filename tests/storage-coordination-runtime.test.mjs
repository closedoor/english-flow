import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const compile = (source) => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const source = await readFile(new URL("../app/storage-coordination.ts", import.meta.url), "utf8");
const api = await import(`data:text/javascript;base64,${Buffer.from(compile(source)).toString("base64")}`);
const backupSource = await readFile(new URL("../app/backup-data.ts", import.meta.url), "utf8");
const backupApi = await import(`data:text/javascript;base64,${Buffer.from(compile(backupSource)).toString("base64")}`);

class Locks {
  constructor() { this.tail = Promise.resolve(); this.requests = []; this.blocked = false; }
  request(name, options, callback) {
    assert.equal(name, api.LEARNING_STORAGE_LOCK);
    assert.equal(options.mode, "exclusive");
    this.requests.push({ name, options });
    const task = this.tail.then(async () => {
      if (this.blocked) await this.blocker;
      if (options.signal.aborted) throw new DOMException("Request aborted", "AbortError");
      return callback({ name, mode: "exclusive" });
    });
    this.tail = task.catch(() => {});
    return new Promise((resolve, reject) => {
      const abort = () => reject(new DOMException("Request aborted", "AbortError"));
      options.signal.addEventListener("abort", abort, { once: true });
      task.then(resolve, reject).finally(() => options.signal.removeEventListener("abort", abort));
    });
  }
  hold() { this.blocked = true; this.blocker = new Promise((resolve) => { this.release = () => { this.blocked = false; resolve(); }; }); }
}
function storage(initial = { mastered: "[]", difficult: "[]", schedule: "{}", sentence: "[]" }) {
  const values = new Map(Object.entries(initial));
  const writes = [];
  return {
    values, writes,
    getItem: (key) => values.get(key) ?? null,
    setItem(key, value) { writes.push([key, String(value)]); values.set(key, String(value)); },
    removeItem(key) { writes.push([key, null]); values.delete(key); },
  };
}
function writer(disk, locks, extra = {}) {
  const initial = new Map(disk.values);
  const observations = { conflicts: 0, errors: 0 };
  const coordinator = api.createLearningStorageCoordinator({
    keys: [...initial.keys()], initial: { getItem: (key) => initial.get(key) ?? null },
    storage: () => disk, locks,
    onConflict() { observations.conflicts += 1; }, onError() { observations.errors += 1; },
    ...extra,
  });
  return { coordinator, observations, initial };
}

test("two simultaneous independent writers serialize; the stale window retains its rescue memory and writes nothing", async () => {
  const disk = storage(), locks = new Locks(); locks.hold();
  const a = writer(disk, locks), b = writer(disk, locks);
  const memoryA = { mastered: [1] }, memoryB = { mastered: [2] };
  a.coordinator.write("mastered", JSON.stringify(memoryA.mastered));
  a.coordinator.write("schedule", '{"1":{"due":100,"stage":1}}');
  b.coordinator.write("mastered", JSON.stringify(memoryB.mastered));
  b.coordinator.write("schedule", '{"2":{"due":100,"stage":1}}');
  assert.equal(a.coordinator.isIdle(), false);
  locks.release(); await Promise.all([a.coordinator.flush(), b.coordinator.flush()]);
  assert.equal(disk.getItem("mastered"), "[1]");
  assert.equal(disk.getItem("schedule"), '{"1":{"due":100,"stage":1}}');
  assert.deepEqual(memoryB.mastered, [2], "do not merge, reload, or erase the stale page's exportable work");
  assert.deepEqual(b.observations, { conflicts: 1, errors: 0 });
  assert.equal(b.coordinator.write("sentence", "[2]"), false, "later stale writes stop immediately");
  assert.equal(b.coordinator.isIdle(), false, "a paused page cannot authorize version reload");
});

test("a change in another learning key also stops a stale writer before its own key mutates", async () => {
  const disk = storage(), locks = new Locks(), a = writer(disk, locks), b = writer(disk, locks);
  a.coordinator.write("sentence", "[7]"); await a.coordinator.flush();
  const before = new Map(disk.values);
  b.coordinator.write("mastered", "[2]"); await b.coordinator.flush();
  assert.deepEqual(disk.values, before);
  assert.equal(b.observations.conflicts, 1);
});

test("rapid same-page rating, correction and delayed effects stay ordered without false conflict", async () => {
  const disk = storage(), locks = new Locks(); locks.hold();
  const a = writer(disk, locks);
  for (const value of ["[1]", "[1,2]", "[1,2,3]", "[1]", "[]", "[4]"]) assert.equal(a.coordinator.write("mastered", value), true);
  locks.release(); await a.coordinator.flush();
  assert.equal(disk.getItem("mastered"), "[4]");
  assert.deepEqual(disk.writes.map(([, value]) => value), ["[1]", "[1,2]", "[1,2,3]", "[1]", "[]", "[4]"]);
  assert.deepEqual(a.observations, { conflicts: 0, errors: 0 });
  assert.equal(a.coordinator.isIdle(), true);
  assert.equal(locks.requests.length, 1, "queued same-page effects complete in one lock grant rather than extending the unsaved window per key");
});

test("unchanged values create no writes and missing records remain missing", async () => {
  const disk = storage({ mastered: "[]", absent: null }), a = writer(disk, new Locks());
  a.coordinator.write("mastered", "[]"); a.coordinator.write("absent", null); await a.coordinator.flush();
  assert.deepEqual(disk.writes, []);
  assert.deepEqual(a.observations, { conflicts: 0, errors: 0 });
});

test("a full pre-write read failure preserves every key and permits a later safe retry", async () => {
  const disk = storage(), a = writer(disk, new Locks());
  const get = disk.getItem; let blocked = true;
  disk.getItem = (key) => { if (blocked && key === "sentence") throw new Error("blocked read"); return get(key); };
  a.coordinator.write("mastered", "[1]"); await a.coordinator.flush();
  assert.deepEqual(disk.writes, []);
  assert.deepEqual(a.observations, { conflicts: 0, errors: 1 });
  blocked = false; a.coordinator.write("mastered", "[1]"); await a.coordinator.flush();
  assert.equal(disk.getItem("mastered"), "[1]");
  assert.equal(a.observations.conflicts, 0);
});

test("quota refusal never advances expected values and later same-page saves can recover", async () => {
  const disk = storage(), a = writer(disk, new Locks()), set = disk.setItem.bind(disk); let blocked = true;
  disk.setItem = (key, value) => { if (blocked && key === "mastered") throw new Error("quota"); set(key, value); };
  a.coordinator.write("mastered", "[1]"); a.coordinator.write("sentence", "[2]"); await a.coordinator.flush();
  assert.equal(disk.getItem("mastered"), "[]"); assert.equal(disk.getItem("sentence"), "[2]");
  assert.deepEqual(a.observations, { conflicts: 0, errors: 1 });
  blocked = false; a.coordinator.write("mastered", "[1,3]"); await a.coordinator.flush();
  assert.equal(disk.getItem("mastered"), "[1,3]"); assert.equal(a.observations.conflicts, 0);
});

test("supported-lock rejection preserves memory/disk and never performs an unlocked fallback write", async () => {
  const disk = storage(), locks = { request() { return Promise.reject(new DOMException("denied", "SecurityError")); } };
  const a = writer(disk, locks); a.coordinator.write("mastered", "[1]"); await a.coordinator.flush();
  assert.deepEqual(disk.writes, []); assert.deepEqual(a.observations, { conflicts: 0, errors: 1 });
});

test("a short lock timeout reports unsaved work and the late grant cannot mutate it", async () => {
  const disk = storage(), locks = new Locks(); locks.hold();
  const a = writer(disk, locks, { lockTimeoutMs: 20 });
  a.coordinator.write("mastered", "[1]"); await a.coordinator.flush();
  assert.deepEqual(disk.writes, []); assert.equal(a.observations.errors, 1);
  locks.release(); await locks.tail; assert.deepEqual(disk.writes, []);
  a.coordinator.write("mastered", "[1]"); await a.coordinator.flush(); assert.equal(disk.getItem("mastered"), "[1]");
});

for (const action of ["pause", "dispose"]) {
  test(`${action} cancels pending locks without writes or stale component callbacks`, async () => {
    const disk = storage(), locks = new Locks(); locks.hold();
    const a = writer(disk, locks); a.coordinator.write("mastered", "[1]");
    await Promise.resolve(); a.coordinator[action](); await a.coordinator.flush();
    locks.release(); await locks.tail;
    assert.deepEqual(disk.writes, []); assert.deepEqual(a.observations, { conflicts: 0, errors: 0 });
  });
}

test("confirmed reset/restore drains earlier saves, rejects old pending effects, and accepts new state afterward", async () => {
  const disk = storage(), locks = new Locks(); locks.hold();
  const a = writer(disk, locks);
  a.coordinator.write("mastered", "[1]");
  const restored = a.coordinator.transaction((current) => { current.setItem("mastered", "[9]"); current.removeItem("sentence"); return true; });
  assert.equal(a.coordinator.write("mastered", "[1,2]"), false, "old effects must not resurrect a replaced snapshot");
  assert.equal(a.coordinator.isIdle(), false);
  locks.release(); assert.equal(await restored, true);
  assert.equal(disk.getItem("mastered"), "[9]"); assert.equal(disk.getItem("sentence"), null);
  a.coordinator.write("mastered", "[9,10]"); await a.coordinator.flush();
  assert.equal(disk.getItem("mastered"), "[9,10]"); assert.equal(a.observations.conflicts, 0);
});

test("a stale confirmed transaction refuses replacement before touching another window's records", async () => {
  const disk = storage(), locks = new Locks(), a = writer(disk, locks), b = writer(disk, locks);
  a.coordinator.write("mastered", "[1]"); await a.coordinator.flush();
  let touched = false;
  assert.equal(await b.coordinator.transaction((current) => { touched = true; current.removeItem("mastered"); return true; }), false);
  assert.equal(touched, false); assert.equal(disk.getItem("mastered"), "[1]"); assert.equal(b.observations.conflicts, 1);
});

test("actual failed backup rollback is tracked and can safely retry without false foreign-change detection", async () => {
  const disk = storage({ a: '"aaaaaa"', b: '"bbbbbb"', c: '"c"' }), a = writer(disk, new Locks());
  const original = new Map(disk.values), set = disk.setItem.bind(disk); let failed = false;
  disk.setItem = (key, value) => { if (!failed && key === "c") { failed = true; throw new Error("one-shot quota"); } set(key, value); };
  assert.equal(await a.coordinator.transaction((current) => backupApi.restoreLearningBackupData(current, ["a", "b", "c"], { data: { a: "a", b: "b", c: "new" } })), false);
  assert.deepEqual(disk.values, original); assert.deepEqual(a.observations, { conflicts: 0, errors: 1 });
  a.coordinator.write("a", '"safe retry"'); await a.coordinator.flush(); assert.equal(disk.getItem("a"), '"safe retry"'); assert.equal(a.observations.conflicts, 0);
});

test("persistent rollback refusal tracks only successful disk changes while rescue memory is untouched", async () => {
  const disk = storage({ a: '"aaaaaa"', b: '"bbbbbb"', c: '"c"' }), a = writer(disk, new Locks());
  const memory = { a: "aaaaaa", b: "bbbbbb", c: "c" }, set = disk.setItem.bind(disk);
  disk.setItem = (key, value) => { if (key === "c" || (key === "b" && value === '"bbbbbb"')) throw new Error("persistent quota"); set(key, value); };
  assert.equal(await a.coordinator.transaction((current) => backupApi.restoreLearningBackupData(current, ["a", "b", "c"], { data: { a: "a", b: "b", c: "new" } })), false);
  assert.equal(disk.getItem("a"), '"aaaaaa"'); assert.equal(disk.getItem("b"), '"b"');
  assert.deepEqual(memory, { a: "aaaaaa", b: "bbbbbb", c: "c" });
  a.coordinator.write("a", '"still safe"'); await a.coordinator.flush(); assert.equal(disk.getItem("a"), '"still safe"'); assert.equal(a.observations.conflicts, 0);
});

test("no-lock fallback keeps ordinary saving and stale-snapshot checks without claiming atomic isolation", async () => {
  const disk = storage(), a = writer(disk), b = writer(disk);
  a.coordinator.write("mastered", "[1]"); await a.coordinator.flush();
  b.coordinator.write("sentence", "[2]"); await b.coordinator.flush();
  assert.equal(disk.getItem("mastered"), "[1]"); assert.equal(disk.getItem("sentence"), "[]"); assert.equal(b.observations.conflicts, 1);
});

test("unknown keys cannot add records outside the nineteen-key contract", async () => {
  const disk = storage(), a = writer(disk, new Locks());
  assert.equal(a.coordinator.write("unrelated", "[1]"), false);
  assert.equal(await a.coordinator.transaction((current) => { current.setItem("unrelated", "[1]"); return true; }), false);
  assert.equal(disk.getItem("unrelated"), null); assert.deepEqual(disk.writes, []);
});

test("failed saving stays dirty after an error notice is dismissed and an unrelated key succeeds", async () => {
  const disk = storage(), set = disk.setItem.bind(disk);
  let showWarning = false;
  disk.setItem = (key, value) => { if (key === "mastered") throw new Error("quota"); set(key, value); };
  const a = writer(disk, new Locks(), { onError() { showWarning = true; } });
  assert.equal(a.coordinator.hasUnsavedChanges(), false);
  a.coordinator.write("mastered", "[1]"); await a.coordinator.flush();
  assert.equal(a.coordinator.isIdle(), true);
  assert.equal(a.coordinator.hasUnsavedChanges(), true);
  assert.equal(showWarning, true);
  showWarning = false; // The page's dismissible presentation is not save state.
  a.coordinator.write("sentence", "[7]"); await a.coordinator.flush();
  assert.equal(showWarning, false);
  assert.equal(disk.getItem("mastered"), "[]"); assert.equal(disk.getItem("sentence"), "[7]");
  assert.equal(a.coordinator.hasUnsavedChanges(), true);
  disk.setItem = set;
  a.coordinator.write("mastered", "[1]"); await a.coordinator.flush();
  assert.equal(a.coordinator.hasUnsavedChanges(), false);
});

test("latest desired value remains dirty until the whole pending batch reaches disk", async () => {
  const disk = storage(), locks = new Locks(); locks.hold();
  const a = writer(disk, locks), set = disk.setItem.bind(disk), observed = [];
  disk.setItem = (key, value) => { set(key, value); observed.push(a.coordinator.hasUnsavedChanges()); };
  a.coordinator.write("mastered", "[1]"); a.coordinator.write("mastered", "[2]"); a.coordinator.write("mastered", "[]");
  assert.equal(a.coordinator.hasUnsavedChanges(), true, "returning to the original value still has queued intermediate saves");
  locks.release(); await a.coordinator.flush();
  assert.deepEqual(observed, [true, true, true]);
  assert.equal(disk.getItem("mastered"), "[]"); assert.equal(a.coordinator.hasUnsavedChanges(), false);
});

test("a paused stale page keeps dirty rescue state after its queue has stopped", async () => {
  const disk = storage(), locks = new Locks(); locks.hold();
  const a = writer(disk, locks), b = writer(disk, locks);
  a.coordinator.write("mastered", "[1]"); b.coordinator.write("mastered", "[2]");
  locks.release(); await Promise.all([a.coordinator.flush(), b.coordinator.flush()]);
  assert.equal(a.coordinator.hasUnsavedChanges(), false);
  assert.equal(b.coordinator.hasUnsavedChanges(), true);
  assert.equal(b.observations.conflicts, 1); assert.equal(disk.getItem("mastered"), "[1]");
});

test("a successful confirmed replacement updates all desired fields and clears a prior failed save", async () => {
  const disk = storage(), set = disk.setItem.bind(disk), a = writer(disk, new Locks());
  disk.setItem = () => { throw new Error("quota"); };
  a.coordinator.write("mastered", "[1]"); await a.coordinator.flush();
  assert.equal(a.coordinator.hasUnsavedChanges(), true);
  disk.setItem = set;
  assert.equal(await a.coordinator.transaction((current) => { current.setItem("mastered", "[9]"); current.removeItem("sentence"); return true; }), true);
  assert.equal(a.coordinator.hasUnsavedChanges(), false);
  assert.equal(disk.getItem("mastered"), "[9]"); assert.equal(disk.getItem("sentence"), null);
});

test("failed replacement with successful rollback preserves preexisting desired memory", async () => {
  const disk = storage({ a: '"aaaaaa"', b: '"bbbbbb"', c: '"c"' }), a = writer(disk, new Locks());
  const original = new Map(disk.values), set = disk.setItem.bind(disk);
  disk.setItem = () => { throw new Error("initial quota"); };
  a.coordinator.write("a", '"unsaved memory"'); await a.coordinator.flush();
  let failed = false;
  disk.setItem = (key, value) => { if (!failed && key === "c") { failed = true; throw new Error("one-shot quota"); } set(key, value); };
  assert.equal(await a.coordinator.transaction((current) => backupApi.restoreLearningBackupData(current, ["a", "b", "c"], { data: { a: "a", b: "b", c: "new" } })), false);
  assert.deepEqual(disk.values, original); assert.equal(a.coordinator.hasUnsavedChanges(), true);
  a.coordinator.write("a", '"unsaved memory"'); await a.coordinator.flush();
  assert.equal(a.coordinator.hasUnsavedChanges(), false);
});

test("failed replacement with partial rollback stays dirty until each changed field is repaired", async () => {
  const disk = storage({ a: '"aaaaaa"', b: '"bbbbbb"', c: '"c"' }), a = writer(disk, new Locks());
  const set = disk.setItem.bind(disk);
  disk.setItem = (key, value) => { if (key === "c" || (key === "b" && value === '"bbbbbb"')) throw new Error("persistent quota"); set(key, value); };
  assert.equal(await a.coordinator.transaction((current) => backupApi.restoreLearningBackupData(current, ["a", "b", "c"], { data: { a: "a", b: "b", c: "new" } })), false);
  assert.equal(a.coordinator.hasUnsavedChanges(), true); assert.equal(disk.getItem("b"), '"b"');
  a.coordinator.write("a", '"aaaaaa"'); await a.coordinator.flush();
  assert.equal(a.coordinator.hasUnsavedChanges(), true, "an unrelated repaired field must not clear the partial rollback loss");
  disk.setItem = set; a.coordinator.write("b", '"bbbbbb"'); await a.coordinator.flush();
  assert.equal(a.coordinator.hasUnsavedChanges(), false);
});

test("partial reset preserves an untouched failed save until its own successful retry", async () => {
  const disk = storage(), set = disk.setItem.bind(disk), a = writer(disk, new Locks());
  disk.setItem = (key, value) => { if (key === "sentence") throw new Error("quota"); set(key, value); };
  a.coordinator.write("sentence", "[123]"); await a.coordinator.flush();
  assert.equal(a.coordinator.hasUnsavedChanges(), true); assert.equal(disk.getItem("sentence"), "[]");
  assert.equal(await a.coordinator.transaction((current) => backupApi.restoreLearningBackupData(current, ["mastered", "difficult", "schedule"], { data: { mastered: null, difficult: null, schedule: null } }), ["mastered", "difficult", "schedule"]), true);
  assert.equal(a.coordinator.hasUnsavedChanges(), true, "a preserved collection remains in memory and still needs rescue");
  assert.equal(disk.getItem("sentence"), "[]");
  disk.setItem = set; a.coordinator.write("sentence", "[123]"); await a.coordinator.flush();
  assert.equal(a.coordinator.hasUnsavedChanges(), false); assert.equal(disk.getItem("sentence"), "[123]");
});

test("an explicitly replaced same-value target clears its dirty memory even when the actual backup helper skips writing", async () => {
  const disk = storage(), set = disk.setItem.bind(disk), a = writer(disk, new Locks());
  disk.setItem = () => { throw new Error("quota"); };
  a.coordinator.write("mastered", "[1]"); a.coordinator.write("sentence", "[123]"); await a.coordinator.flush();
  disk.setItem = set;
  const before = disk.writes.length;
  assert.equal(await a.coordinator.transaction((current) => backupApi.restoreLearningBackupData(current, ["mastered"], { data: { mastered: [] } }), ["mastered"]), true);
  assert.equal(disk.writes.length, before, "a reset target already on disk requires no physical mutation");
  assert.equal(a.coordinator.hasUnsavedChanges(), true, "the untouched failed collection is not cleared");
  a.coordinator.write("sentence", "[123]"); await a.coordinator.flush();
  assert.equal(a.coordinator.hasUnsavedChanges(), false, "the no-op reset did clear only its explicit dirty target");
});

test("invalid replacement keys are refused before invoking a transaction or changing desired state", async () => {
  const disk = storage(), a = writer(disk, new Locks());
  for (const targets of [["mastered", "mastered"], ["unrelated"], null, "mastered"]) {
    let called = false;
    assert.equal(await a.coordinator.transaction(() => { called = true; return true; }, targets), false);
    assert.equal(called, false);
  }
  assert.deepEqual(disk.writes, []); assert.equal(a.coordinator.hasUnsavedChanges(), false);
});
