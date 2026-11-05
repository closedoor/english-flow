import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const compile = (source) => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const backupSource = await readFile(new URL("../app/backup-data.ts", import.meta.url), "utf8");
const backupApi = await import(`data:text/javascript;base64,${Buffer.from(compile(backupSource)).toString("base64")}`);
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const keys = [...page.slice(page.indexOf("const STORAGE ="), page.indexOf("type StorageKey")).matchAll(/:\s*"(wordflow-[^"]+)"/g)].map((match) => match[1]);
const optional = ["wordflow-reading-completed-v1", "wordflow-reading-last-v1", "wordflow-reading-answers-v1", "wordflow-practice-rotation-v1"];
const patternSource = await readFile(new URL("../app/pattern-data.ts", import.meta.url), "utf8");
const { corePatterns } = await import(`data:text/javascript;base64,${Buffer.from(compile(patternSource)).toString("base64")}`);
const patternIds = new Set(corePatterns.map((item) => item.id));
const readingIds = new Set(Array.from({ length: 15 }, (_, index) => `r${index + 1}`));
const validators = {
  word: (id) => (id >= 1 && id <= 2809) || (id >= 10001 && id <= 10050),
  sentence: (id) => id >= 1 && id <= 3000,
  pattern: (id) => patternIds.has(id),
  reading: (id) => readingIds.has(id),
};
const backup = (patch = {}) => ({ app: "english-flow", formatVersion: 1, exportedAt: "2026-10-03T07:00:00Z", data: { ...Object.fromEntries(keys.map((key) => [key, null])), ...patch } });
const compatible = (value, context = validators) => backupApi.isLearningBackup(value, keys, optional) && backupApi.isBackupContentCompatible(value, context);

for (const [key, validId, invalidId] of [
  ["wordflow-ngsl-mastered-v1", 1, 999999],
  ["wordflow-ngsl-difficult-v1", 10001, 10051],
  ["wordflow-sentence-saved-v1", 1, 3001],
  ["wordflow-sentence-seen-v1", 3000, 3001],
  ["wordflow-sentence-mastered-v1", 1, 999999],
  ["wordflow-sentence-difficult-v1", 2001, 3001],
  ["wordflow-pattern-mastered-v1", corePatterns[0].id, "unknown-pattern"],
  ["wordflow-pattern-difficult-v1", corePatterns.at(-1).id, "unknown-pattern"],
  ["wordflow-reading-completed-v1", "r15", "r16"],
]) {
  test(`an incompatible ${key} cannot reach record replacement`, () => {
    const value = backup({ [key]: [validId, invalidId] });
    assert.equal(backupApi.isLearningBackup(value, keys, optional), true, "the damaged file passed the previous shape-only import gate");
    assert.equal(compatible(value), false);
    assert.equal(compatible(backup({ [key]: [validId, validId] })), true, "duplicate IDs in old backups remain supported");
  });
}

test("unknown schedule IDs and noncanonical aliases cannot create permanently due review words", () => {
  const due = Date.now() - 1;
  for (const id of ["999999", "01", "001", "1.0", "1e0", " 1", "+1"]) {
    const value = backup({ "wordflow-ngsl-schedule-v1": { [id]: { due, stage: 1 } } });
    assert.equal(compatible(value), false, id);
  }
  assert.equal(compatible(backup({ "wordflow-ngsl-schedule-v1": { 1: { due, stage: 1 }, 10050: { due: 1, stage: 5 } } })), true);
  assert.equal(compatible(backup({ "wordflow-ngsl-schedule-v1": { 1: { due: Date.now() + 86400000, stage: 2 }, "01": { due, stage: 1 } } })), false, "a canonical entry cannot conceal an old expired alias");
});

for (const [key, idField, validId, invalidId, preferences] of [
  ["wordflow-active-session-v1", "wordIds", 1, 999999, { path: "frequency", mode: "free", stage: "cards" }],
  ["wordflow-sentence-active-session-v1", "sentenceIds", 1, 3001, { band: "short", category: "all", count: 10 }],
  ["wordflow-pattern-active-session-v1", "patternIds", corePatterns[0].id, "unknown-pattern", { category: "all" }],
]) {
  test(`unknown IDs in ${key} and its ratings are rejected without rejecting expired sessions`, () => {
    const session = { version: 1, updatedAt: 1, index: 0, ...preferences, [idField]: [validId], ratings: {} };
    assert.equal(compatible(backup({ [key]: session })), true, "expired sessions may accompany valuable old progress");
    for (const patch of [{ [idField]: [validId, invalidId] }, { ratings: { [invalidId]: "known" } }]) {
      const value = backup({ [key]: { ...session, ...patch } });
      assert.equal(backupApi.isLearningBackup(value, keys, optional), true);
      assert.equal(compatible(value), false);
    }
  });
}

for (const [key, idField, ids, otherId, preferences] of [
  ["wordflow-active-session-v1", "wordIds", [1, 2], 3, { path: "frequency", mode: "free", stage: "cards", continuous: true }],
  ["wordflow-sentence-active-session-v1", "sentenceIds", [1, 2], 3, { band: "short", category: "all", count: 10, continuous: true }],
  ["wordflow-pattern-active-session-v1", "patternIds", [corePatterns[0].id, corePatterns[1].id], corePatterns[2].id, { category: "all" }],
]) {
  test(`${key} refuses invalid positions and another course's ratings before record replacement`, () => {
    const session = { version: 1, updatedAt: 1, index: ids.length - 1, ...preferences, [idField]: ids, ratings: { [ids[0]]: "known" } };
    assert.equal(compatible(backup({ [key]: session })), true, "the final card of an expired course remains compatible");
    for (const patch of [{ index: ids.length }, { index: 900 }, { ratings: { [otherId]: "known" } }]) {
      const value = backup({ [key]: { ...session, ...patch } });
      const before = structuredClone(value);
      assert.equal(backupApi.isLearningBackup(value, keys, optional), true, "shape and vocabulary membership alone do not detect the broken relationship");
      assert.equal(compatible(value), false);
      assert.deepEqual(value, before, "validation must not repair or alter a backup before the learner decides");
    }
    const omitted = { ...session };
    delete omitted.index;
    delete omitted.ratings;
    assert.equal(compatible(backup({ [key]: omitted })), true, "old optional positions and ratings stay optional");
    assert.equal(compatible(backup({ [key]: { ...session, [idField]: [ids[0], ids[0], ids[1]], index: 2 } })), true, "duplicate IDs in old courses remain supported");
  });
}

test("quiz position bounds preserve a valid final question, completed feedback and omitted old fields", () => {
  const key = "wordflow-active-session-v1";
  const session = { version: 1, updatedAt: 1, path: "frequency", mode: "test", stage: "quiz", wordIds: [1, 2], index: 1,
    ratings: { 1: "known", 2: "difficult" }, quizIndex: 1, quizAnswer: "", quizFeedback: "wrong", quizResults: [true, false] };
  assert.equal(compatible(backup({ [key]: session })), true, "a final question with its feedback is a valid unfinished quiz");
  assert.equal(compatible(backup({ [key]: { ...session, quizIndex: 2 } })), false, "an index beyond the last question cannot silently discard a quiz");
  const omitted = { ...session };
  delete omitted.quizIndex;
  assert.equal(compatible(backup({ [key]: omitted })), true, "old optional quiz fields remain accepted");
});

test("the actual backup file chooser rejects damaged course relationships before restore confirmation", async () => {
  const source = compile(page.slice(page.indexOf("const chooseBackupFile ="), page.indexOf("const restoreLearningBackup =")) + "\nchooseBackupFile;");
  for (const session of [
    { wordIds: [1, 2], index: 2, ratings: { 1: "known" } },
    { wordIds: [1, 2], index: 1, ratings: { 3: "known" } },
  ]) {
    const value = backup({ "wordflow-active-session-v1": { version: 1, updatedAt: 1, path: "frequency", mode: "free", stage: "cards", ...session } });
    const state = { pending: null, notice: null, busy: null };
    const choose = vm.runInNewContext(source, {
      backupReadRequestRef: { current: 0 }, BACKUP_MAX_BYTES: backupApi.BACKUP_MAX_BYTES,
      STORAGE_KEYS: keys, BACKUP_OPTIONAL_KEYS: optional, isLearningBackup: backupApi.isLearningBackup,
      isBackupContentCompatible: backupApi.isBackupContentCompatible,
      STUDY_WORD_IDS: new Set([1, 2, 3]), PATTERN_IDS: patternIds, READING_IDS: readingIds,
      setPendingBackup: (value) => { state.pending = value; },
      setBackupNotice: (value) => { state.notice = value; },
      setBackupBusy: (value) => { state.busy = value; },
      setResetProgressOpen() { assert.fail("invalid courses must not open restore confirmation or alter other dialogs"); },
      setDiscardRequest() { assert.fail("invalid courses must not open restore confirmation or alter other dialogs"); },
      setInstallOpen() { assert.fail("invalid courses must not open restore confirmation or alter other dialogs"); },
    });
    await choose({ target: { value: "damaged.json", files: [{ size: 500, text: async () => JSON.stringify(value) }] } });
    assert.equal(state.pending, null);
    assert.equal(state.busy, null);
    assert.equal(state.notice.kind, "error");
    assert.match(state.notice.message, /未导入/);
  }
});

test("reading recency and answers use the caller's actual known reading IDs", () => {
  assert.equal(compatible(backup({ "wordflow-reading-last-v1": { id: "r16", updatedAt: 1 } })), false);
  const fewerReadings = { ...validators, reading: (id) => id === "r1" };
  assert.equal(compatible(backup({ "wordflow-reading-answers-v1": { r2: 0 } }), fewerReadings), false);
  assert.equal(compatible(backup({ "wordflow-reading-last-v1": { id: "r1", updatedAt: 1 }, "wordflow-reading-answers-v1": { r1: 2 } }), fewerReadings), true);
});

test("current content boundaries, missing old optional fields and future study dates retain format-1 compatibility", () => {
  const value = backup({
    "wordflow-ngsl-mastered-v1": [1, 2809, 10001, 10050], "wordflow-sentence-saved-v1": [1, 1000, 1001, 2000, 2001, 3000],
    "wordflow-pattern-mastered-v1": [...patternIds], "wordflow-reading-completed-v1": [...readingIds],
    "wordflow-days": ["2024-02-29", "2099-09-05"],
  });
  assert.equal(compatible(value), true);
  optional.forEach((key) => delete value.data[key]);
  assert.equal(compatible(value), true);
  assert.equal(compatible(backup()), true);
});

test("content compatibility is read-only and safely refuses a failed content validator", () => {
  const value = backup({ "wordflow-ngsl-mastered-v1": [1, 1, 2] });
  const before = structuredClone(value);
  assert.equal(compatible(value), true);
  assert.deepEqual(value, before);
  assert.equal(compatible(value, { ...validators, word() { throw new Error("unavailable content index"); } }), false);
  assert.deepEqual(value, before);
});
