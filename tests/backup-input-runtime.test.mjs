import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const source = await readFile(new URL("../app/backup-data.ts", import.meta.url), "utf8");
const compile = (source) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const backupApi = await import(`data:text/javascript;base64,${Buffer.from(compile(source)).toString("base64")}`);
const storage = Object.fromEntries([...page.slice(page.indexOf("const STORAGE ="), page.indexOf("type StorageKey")).matchAll(/(\w+): "(wordflow-[^"]+)"/g)].map((match) => [match[1], match[2]]));
const keys = Object.values(storage);
const optional = [storage.readingCompleted, storage.readingLast, storage.practiceRotation, storage.readingAnswers];
const backup = (patch = {}) => ({ app: "english-flow", formatVersion: 1, exportedAt: "2026-09-05T12:00:00Z", data: { ...Object.fromEntries(keys.map((key) => [key, null])), ...patch } });
const valid = (data) => backupApi.isLearningBackup(data, keys, optional);

test("damaged record types, calendar dates, schedules and ratings cannot reach restore confirmation", () => {
  for (const [key, value] of [
    [storage.mastered, "invalid array type"], [storage.difficult, [1, "2"]],
    [storage.schedule, [1, 2]], [storage.schedule, { 1: { due: "123", stage: 1 } }],
    [storage.schedule, { 1: { due: 123, stage: 6 } }], [storage.days, ["2026-02-30"]],
    [storage.patternMastered, [1]], [storage.readingCompleted, [null]],
    [storage.session, { count: 0 }], [storage.sentencePreferences, { mode: "wrong" }],
    [storage.readingLast, []], [storage.practiceRotation, { word: -1 }],
    [storage.readingAnswers, { r1: 3 }], [storage.readingAnswers, { r2: -1 }], [storage.readingAnswers, { r16: 0 }],
    [storage.sentenceActiveSession, { version: 1, updatedAt: 1, band: "short", category: "all", count: 10, sentenceIds: [1], ratings: { 1: "wrong" } }],
  ]) assert.equal(valid(backup({ [key]: value })), false, `${key}: ${JSON.stringify(value)}`);
});

test("backup validation retains old optional fields, duplicate IDs, old sessions and future study dates", () => {
  const old = backup({
    [storage.mastered]: [1, 1, 2], [storage.days]: ["2024-02-29", "2099-09-05"],
    [storage.session]: { count: 20 },
    [storage.sentencePreferences]: { band: "short", category: "all", count: 10 },
    [storage.sentenceActiveSession]: { version: 1, updatedAt: 1, band: "short", category: "all", count: 10, sentenceIds: [1], ratings: {} },
  });
  optional.forEach((key) => delete old.data[key]);
  assert.equal(valid(old), true);
  assert.equal(valid(backup()), true);
});

test("a full current backup with all three paused modules round-trips through validation", () => {
  const current = backup({
    [storage.mastered]: [1, 2], [storage.difficult]: [3], [storage.schedule]: { 3: { due: 1, stage: 5 } },
    [storage.days]: ["2026-09-05"], [storage.session]: { mode: "test", count: 10, path: "airport" },
    [storage.activeSession]: { version: 1, updatedAt: 1, path: "airport", mode: "test", stage: "quiz", wordIds: [3], index: 0, ratings: { 3: "known" }, quizIndex: 0, quizAnswer: "", quizFeedback: null, quizResults: [] },
    [storage.readingCompleted]: ["r1"], [storage.readingLast]: { id: "r1", updatedAt: 1 },
    [storage.sentenceSaved]: [1], [storage.sentenceSeen]: [1], [storage.sentenceMastered]: [2], [storage.sentenceDifficult]: [3],
    [storage.sentencePreferences]: { band: "long", category: "travel", count: 20, mode: "speak" },
    [storage.sentenceActiveSession]: { version: 1, updatedAt: 1, band: "short", category: "all", count: 10, mode: "speak", sentenceIds: [1, 2], index: 1, ratings: { 1: "known" } },
    [storage.patternMastered]: ["p01"], [storage.patternDifficult]: ["p02"],
    [storage.patternActiveSession]: { version: 1, updatedAt: 1, category: "request", patternIds: ["p06"], index: 0, drillIndex: 2, ratings: {} },
    [storage.practiceRotation]: { word: 2, sentence: 3, pattern: 4 },
  });
  const exported = backupApi.createLearningBackup({ getItem: (key) => JSON.stringify(current.data[key]) }, keys);
  assert.equal(valid(JSON.parse(JSON.stringify(exported))), true);
});

const chooseSource = compile(page.slice(page.indexOf("const chooseBackupFile ="), page.indexOf("const restoreLearningBackup =")) + "\n({ chooseBackupFile, cancelBackupRead });");
function chooser() {
  const state = { pending: null, notice: null, busy: null, reset: false, discard: null, install: false };
  const handlers = vm.runInNewContext(chooseSource, {
    backupReadRequestRef: { current: 0 }, BACKUP_MAX_BYTES: backupApi.BACKUP_MAX_BYTES,
    STORAGE_KEYS: keys, BACKUP_OPTIONAL_KEYS: optional, isLearningBackup: backupApi.isLearningBackup,
    setPendingBackup: (value) => { state.pending = value; },
    setResetProgressOpen: (value) => { state.reset = value; },
    setDiscardRequest: (value) => { state.discard = value; },
    setInstallOpen: (value) => { state.install = value; },
    setBackupNotice: (value) => { state.notice = value; }, setBackupBusy: (value) => { state.busy = value; },
  });
  return { state, cancel: handlers.cancelBackupRead, choose: (file) => handlers.chooseBackupFile({ target: { files: file ? [file] : [], value: "backup.json" } }) };
}
function delayedFile() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { file: { size: 100, text: () => promise }, resolve: (data) => resolve(JSON.stringify(data)), reject };
}

test("a slow older file cannot replace the most recently selected backup", async () => {
  const { state, choose } = chooser();
  const a = delayedFile(), b = delayedFile();
  const oldRead = choose(a.file), newRead = choose(b.file);
  assert.equal(state.busy, "read");
  b.resolve(backup({ [storage.mastered]: [2] })); await newRead;
  a.resolve(backup({ [storage.mastered]: [1] })); await oldRead;
  assert.deepEqual([...state.pending.data[storage.mastered]], [2]);
  assert.equal(state.busy, null);
  assert.equal(state.notice, null);
});

test("a valid backup supersedes earlier management dialogs", async () => {
  const { state, choose } = chooser();
  const file = delayedFile();
  const reading = choose(file.file);
  state.reset = true;
  state.discard = { sentence: true };
  state.install = true;
  file.resolve(backup());
  await reading;
  assert.ok(state.pending);
  assert.equal(state.reset, false);
  assert.equal(state.discard, null);
  assert.equal(state.install, false);
});

test("an old read failure cannot obscure a newer valid backup", async () => {
  const { state, choose } = chooser();
  const a = delayedFile(), b = delayedFile();
  const first = choose(a.file), second = choose(b.file);
  b.resolve(backup()); await second;
  a.reject(new Error("old cloud download failed")); await first;
  assert.ok(state.pending);
  assert.equal(state.notice, null);
});

test("canceling or selecting an oversized file invalidates an outstanding read", async () => {
  for (const replacement of [null, { size: backupApi.BACKUP_MAX_BYTES + 1 }]) {
    const { state, choose } = chooser();
    const a = delayedFile(); const first = choose(a.file);
    await choose(replacement); a.resolve(backup()); await first;
    assert.equal(state.pending, null);
    assert.equal(state.busy, null);
    if (replacement) assert.equal(state.notice.kind, "error");
  }
});

test("a damaged file only shows an error and leaves restore unavailable", async () => {
  const { state, choose } = chooser();
  await choose({ size: 100, text: async () => JSON.stringify(backup({ [storage.mastered]: "broken" })) });
  assert.equal(state.pending, null);
  assert.equal(state.notice.kind, "error");
  assert.equal(state.busy, null);
});

test("canceling a slow backup unlocks the controls and stale completion cannot interrupt a new read", async () => {
  for (const fails of [false, true]) {
    const { state, choose, cancel } = chooser();
    const oldFile = delayedFile();
    const oldRead = choose(oldFile.file);
    assert.equal(state.busy, "read");
    cancel();
    assert.equal(state.busy, null);
    assert.equal(state.pending, null);
    const newFile = delayedFile();
    const newRead = choose(newFile.file);
    if (fails) oldFile.reject(new Error("canceled cloud read failed"));
    else oldFile.resolve(backup({ [storage.mastered]: [1] }));
    await oldRead;
    assert.equal(state.busy, "read");
    assert.equal(state.pending, null);
    assert.equal(state.notice, null);
    newFile.resolve(backup({ [storage.mastered]: [2] }));
    await newRead;
    assert.equal(state.busy, null);
    assert.deepEqual([...state.pending.data[storage.mastered]], [2]);
  }
});
