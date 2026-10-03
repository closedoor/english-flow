import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const backupSource = await readFile(new URL("../app/backup-data.ts", import.meta.url), "utf8");
const versionSource = await readFile(new URL("../app/version-utils.ts", import.meta.url), "utf8");
const compile = (source) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const backup = await import(`data:text/javascript;base64,${Buffer.from(compile(backupSource)).toString("base64")}`);
const version = await import(`data:text/javascript;base64,${Buffer.from(compile(versionSource)).toString("base64")}`);
const extract = (start, end) => {
  const from = page.indexOf(start);
  const to = page.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `handler exists: ${start}`);
  return page.slice(from, to);
};
const constants = extract("const STORAGE =", "const tabItems:");
const STORAGE = vm.runInNewContext(compile(`${constants}\nSTORAGE;`));
const keys = Object.values(STORAGE);
const exportCode = compile(`${constants}\n${extract("const exportLearningBackup =", "const chooseBackupFile =")}\nexportLearningBackup();`);
const resetSource = extract("const resetLearningProgress =", "const addDifficult =");
const resetCode = compile(`${constants}\n${resetSource}\nresetLearningProgress();`);
const reloadCode = compile(`${constants}\n${extract("const canReloadForUpdate =", "const exportLearningBackup =")}\ncanReloadForUpdate();`);
const restoreCode = compile(`${constants}\n${extract("const restoreLearningBackup =", "const resetLearningProgress =")}\nrestoreLearningBackup();`);

function currentSession() {
  return {
    mastered: [2, 4], difficult: [7], schedule: { 7: { due: 1234, stage: 0 } },
    studyDays: ["2026-09-05"], preferences: { mode: "free", count: 20, path: "frequency" },
    readingCompleted: ["r1"], readingLast: { id: "r2", updatedAt: 2000 }, readingAnswers: { r1: 0, r2: 2 },
    readingPositionRef: { current: new Map([["r2", 900]]) },
    sentenceSaved: [123], sentenceSeen: [123, 124], sentenceMastered: [123], sentenceDifficult: [124],
    patternMastered: ["p01"], patternDifficult: ["p02"],
    activeSessionResumeSnapshotRef: { current: { version: 1, path: "frequency", mode: "free", stage: "cards", wordIds: [2, 7], index: 1, ratings: { 2: "known" }, updatedAt: 2001 } },
    sentenceSetupPreferencesRef: { current: { band: "short", category: "all", count: 10, mode: "bilingual" } },
    sentenceResumeSnapshotRef: { current: { version: 1, band: "short", category: "all", count: 10, mode: "bilingual", sentenceIds: [123, 124], index: 1, ratings: { 123: "known" }, updatedAt: 2002 } },
    patternResumeSnapshotRef: { current: { version: 1, category: "daily", patternIds: ["p01", "p02"], index: 1, drillIndex: 2, ratings: { p01: "known" }, updatedAt: 2003 } },
    practiceRotationRef: { current: { word: 3, sentence: 4, pattern: 5 } },
  };
}

test("export includes unsaved learning and paused sessions even when storage is stale or blocked", async () => {
  for (const blocked of [false, true]) {
    const current = currentSession();
    const busy = [];
    let file;
    let notice;
    let reads = 0;
    const browserWindow = {};
    Object.defineProperty(browserWindow, "localStorage", { get() {
      reads += 1;
      if (blocked) throw new Error("Storage access denied");
      return { getItem: () => "null" };
    } });
    const lock = { current: false };
    await vm.runInNewContext(exportCode, {
      ...current, ...backup, window: browserWindow, File,
      navigator: { canShare: () => true, share: async (payload) => { file = payload.files[0]; } },
      backupActionLock: lock, setBackupBusy: (value) => busy.push(value),
      setBackupNotice: (value) => { notice = value; },
    });
    const exported = JSON.parse(await file.text());
    assert.equal(backup.isLearningBackup(exported, keys), true);
    const expected = {
      mastered: current.mastered, difficult: current.difficult, schedule: current.schedule,
      days: current.studyDays, session: current.preferences,
      activeSession: current.activeSessionResumeSnapshotRef.current,
      readingCompleted: current.readingCompleted, readingLast: current.readingLast, readingAnswers: current.readingAnswers,
      sentenceSaved: current.sentenceSaved, sentenceSeen: current.sentenceSeen,
      sentenceMastered: current.sentenceMastered, sentenceDifficult: current.sentenceDifficult,
      sentencePreferences: current.sentenceSetupPreferencesRef.current,
      sentenceActiveSession: current.sentenceResumeSnapshotRef.current,
      patternMastered: current.patternMastered, patternDifficult: current.patternDifficult,
      patternActiveSession: current.patternResumeSnapshotRef.current,
      practiceRotation: current.practiceRotationRef.current,
    };
    assert.deepEqual(exported.data, Object.fromEntries(Object.entries(expected).map(([key, value]) => [STORAGE[key], value])));
    assert.equal(Object.keys(exported.data).length, 19);
    assert.equal(reads, 0, "backup must not depend on failed persistent writes");
    assert.equal(notice.kind, "success");
    assert.deepEqual(busy, ["export", null]);
    assert.equal(lock.current, false);
  }
});

function reset({ failRemoval = false, failRotationWrite = false, blocked = false } = {}) {
  const current = currentSession();
  const saved = {
    mastered: current.mastered, difficult: current.difficult, schedule: current.schedule,
    days: current.studyDays, session: current.preferences,
    activeSession: current.activeSessionResumeSnapshotRef.current,
    readingCompleted: current.readingCompleted, readingLast: current.readingLast, readingAnswers: current.readingAnswers,
    sentenceSaved: current.sentenceSaved, sentenceSeen: current.sentenceSeen,
    sentenceMastered: current.sentenceMastered, sentenceDifficult: current.sentenceDifficult,
    sentencePreferences: current.sentenceSetupPreferencesRef.current,
    sentenceActiveSession: current.sentenceResumeSnapshotRef.current,
    patternMastered: current.patternMastered, patternDifficult: current.patternDifficult,
    patternActiveSession: current.patternResumeSnapshotRef.current,
    practiceRotation: current.practiceRotationRef.current,
  };
  const stored = new Map(Object.entries(saved).map(([key, value]) => [STORAGE[key], JSON.stringify(value)]));
  const original = new Map(stored);
  let removalCount = 0;
  const storage = {
    getItem: (key) => stored.get(key) ?? null,
    setItem: (key, value) => {
      if (failRotationWrite && key === STORAGE.practiceRotation) throw new Error("Rotation save failed");
      stored.set(key, value);
    },
    removeItem: (key) => {
      removalCount += 1;
      if (failRemoval && removalCount === 3) throw new Error("Storage access lost");
      stored.delete(key);
    },
  };
  const browserWindow = {};
  Object.defineProperty(browserWindow, "localStorage", { get() {
    if (blocked) throw new Error("Storage access denied");
    return storage;
  } });
  const calls = [];
  const setters = Object.fromEntries([...new Set(resetSource.match(/\bset[A-Z]\w+(?=\()/g))]
    .map((name) => [name, (value) => {
      calls.push([name, value]);
      const state = name[3].toLowerCase() + name.slice(4);
      current[state] = value;
    }]));
  vm.runInNewContext(resetCode, {
    ...current, ...backup, ...setters, window: browserWindow,
    words: [{ id: 1 }], count: 10,
    restoreSentenceSetupPreferences: () => calls.push(["restoreSentenceSetupPreferences"]),
    removeStoredValue: (key) => { try { storage.removeItem(key); } catch { /* old handler swallowed failures */ } },
  });
  const reloadAllowed = () => vm.runInNewContext(reloadCode, {
    hydrated: true, tab: "progress", hasOpenDialog: false, backupBusy: null,
    externalUpdateDetected: false, storageWriteError: false,
    ...current, ...version, window: browserWindow,
  });
  return { stored, original, calls, current, reloadAllowed };
}

test("a failed or blocked reset keeps current progress and rolls back partial removals", () => {
  for (const options of [{ failRemoval: true }, { failRotationWrite: true }, { blocked: true }]) {
    const { stored, original, calls, current } = reset(options);
    assert.deepEqual(stored, original);
    assert.ok(calls.some(([name, value]) => name === "setStorageWriteError" && value === true));
    const notice = calls.find(([name]) => name === "setBackupNotice")?.[1];
    assert.equal(notice.kind, "error");
    assert.match(notice.message, /导出备份/);
    assert.ok(calls.every(([name]) => ["setStorageWriteError", "setBackupNotice", "setResetProgressOpen"].includes(name)));
    assert.equal(current.activeSessionResumeSnapshotRef.current.index, 1);
    assert.equal(current.sentenceResumeSnapshotRef.current.index, 1);
    assert.deepEqual(current.practiceRotationRef.current, { word: 3, sentence: 4, pattern: 5 });
    assert.equal(stored.get(STORAGE.practiceRotation), original.get(STORAGE.practiceRotation));
  }
});

test("successful reset clears progress and reports completion while retaining bookmarks and preferences", () => {
  const { stored, original, calls, current } = reset();
  const retained = [STORAGE.session, STORAGE.sentenceSaved, STORAGE.sentencePreferences];
  assert.deepEqual(stored, new Map([
    ...retained.map((key) => [key, original.get(key)]),
    [STORAGE.practiceRotation, JSON.stringify({ word: 0, sentence: 0, pattern: 0 })],
  ]));
  assert.ok(calls.some(([name, value]) => name === "setMastered" && value.length === 0));
  assert.ok(calls.some(([name, value]) => name === "setStudyDays" && value.length === 0));
  assert.equal(calls.find(([name]) => name === "setBackupNotice")?.[1].kind, "success");
  assert.equal(current.activeSessionResumeSnapshotRef.current, null);
  assert.equal(current.sentenceResumeSnapshotRef.current, null);
  assert.equal(current.patternResumeSnapshotRef.current, null);
  assert.equal(current.practiceRotationRef.current.word, 0);
});

test("successful reset persists the zero rotation and permits a safe version update without another study group", () => {
  const { stored, current, reloadAllowed } = reset();
  const rotation = JSON.parse(JSON.stringify(current.practiceRotationRef.current));
  assert.deepEqual(rotation, { word: 0, sentence: 0, pattern: 0 });
  assert.deepEqual(JSON.parse(stored.get(STORAGE.practiceRotation)), rotation);
  assert.equal(version.isSnapshotPersisted({ getItem: (key) => stored.get(key) ?? null }, {
    [STORAGE.practiceRotation]: current.practiceRotationRef.current,
  }), true);
  assert.equal(reloadAllowed(), true, "the full record guard must accept the completed reset");
});

test("persistent restore and rollback failures retain the full in-memory rescue backup and block an unsafe reload", async () => {
  const current = currentSession();
  const originalMemory = structuredClone(current);
  const lock = { current: false };
  let exported;
  let notice;
  let busy;
  const capture = async () => {
    await vm.runInNewContext(exportCode, {
      ...current, ...backup, File, window: {},
      navigator: { canShare: () => true, share: async ({ files }) => { exported = JSON.parse(await files[0].text()); } },
      backupActionLock: lock, setBackupBusy: (value) => { busy = value; },
      setBackupNotice: (value) => { notice = value; },
    });
    return structuredClone(exported);
  };
  const original = await capture();
  const stored = new Map(Object.entries(original.data).map(([key, value]) => [key, JSON.stringify(value)]));
  const incoming = structuredClone(original);
  incoming.data[STORAGE.mastered] = [];
  incoming.data[STORAGE.difficult] = [7, 999];
  let writes = 0;
  let pending = incoming;
  let warning = false;
  const storage = {
    getItem: (key) => stored.get(key) ?? null,
    setItem: (key, value) => {
      writes += 1;
      if (writes > 1) throw new Error("Simulated persistent storage refusal, including rollback");
      stored.set(key, value);
    },
    removeItem: () => { throw new Error("Unexpected deletion"); },
  };
  vm.runInNewContext(restoreCode, {
    ...backup, pendingBackup: pending, backupActionLock: lock,
    window: { localStorage: storage, location: { reload() { assert.fail("A failed restore must not reload"); } } },
    setStorageWriteError: (value) => { warning = value; },
    setBackupNotice: (value) => { notice = value; },
    setBackupBusy: (value) => { busy = value; },
    setPendingBackup: (value) => { pending = value; },
  });
  assert.equal(warning, true);
  assert.equal(pending, null);
  assert.equal(busy, null);
  assert.equal(lock.current, false);
  assert.equal(notice.kind, "error");
  assert.match(notice.message, /当前页面.*仍保留.*先导出备份/);
  assert.deepEqual(JSON.parse(stored.get(STORAGE.mastered)), [], "Persistent disk refusal can prevent complete rollback");
  assert.deepEqual(current, originalMemory, "Restore failure leaves every original in-memory field and paused position untouched");
  assert.equal(vm.runInNewContext(reloadCode, {
    ...current, ...version, hydrated: true, tab: "progress", hasOpenDialog: false,
    backupBusy: null, externalUpdateDetected: false, storageWriteError: false,
    window: { localStorage: storage },
  }), false, "Dismissing the warning cannot permit losing the rescue snapshot");
  const rescue = await capture();
  assert.deepEqual(rescue.data, original.data);
  assert.equal(Object.keys(rescue.data).length, 19);
  assert.equal(backup.isLearningBackup(rescue, keys), true);
});
