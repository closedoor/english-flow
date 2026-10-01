import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const compile = (source) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const load = async (path) => import(`data:text/javascript;base64,${Buffer.from(compile(await readFile(new URL(path, import.meta.url), "utf8"))).toString("base64")}`);
const [sessions, backups, page] = await Promise.all([
  load("../app/session-utils.ts"), load("../app/backup-data.ts"), readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
]);
const storage = Object.fromEntries([...page.slice(page.indexOf("const STORAGE ="), page.indexOf("type StorageKey")).matchAll(/(\w+): "(wordflow-[^"]+)"/g)].map((match) => [match[1], match[2]]));
const keys = Object.values(storage);
const optionalKeys = [storage.readingCompleted, storage.readingLast, storage.practiceRotation, storage.readingAnswers];
const empty = () => Object.fromEntries(keys.map((key) => [key, null]));
const backup = (patch = {}) => ({ app: "english-flow", formatVersion: 1, exportedAt: "2026-10-01T10:00:00Z", data: { ...empty(), ...patch } });
const valid = (value) => backups.isLearningBackup(value, keys, optionalKeys);
const wordSnapshot = (patch = {}) => ({
  version: 1, kind: "group", continuous: true, updatedAt: 1, path: "frequency", mode: "free", stage: "cards",
  wordIds: Array.from({ length: 2809 }, (_, index) => index + 1), index: 2021,
  ratings: { 1: "known", 2: "difficult" }, quizIndex: 0, quizAnswer: "", quizFeedback: null, quizResults: [], ...patch,
});
const sentenceSnapshot = (patch = {}) => ({
  version: 1, continuous: true, updatedAt: 1, band: "short", category: "all", count: 10, mode: "bilingual",
  sentenceIds: Array.from({ length: 1000 }, (_, index) => index + 1), index: 999, ratings: { 1: "known", 2: "difficult" }, ...patch,
});

const ast = ts.createSourceFile("page.tsx", page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = new Map(ast.statements.filter(ts.isFunctionDeclaration).map((node) => [node.name?.text, node.getText(ast)]));
const helpers = ["cleanSentenceIds", "isSentenceBand", "isSentenceCategory", "isSentenceLearningMode", "cleanSentenceSession", "isLearnPath", "cleanActiveSession"];
const cleaners = vm.runInNewContext(compile(`${helpers.map((name) => {
  assert.ok(declarations.has(name), `missing real session helper ${name}`);
  return declarations.get(name);
}).join("\n")}\n({ cleanSentenceSession, cleanActiveSession });`), {
  hasUnfinishedRatings: sessions.hasUnfinishedRatings, STUDY_WORD_IDS: new Set([...Array.from({ length: 2809 }, (_, index) => index + 1), 10003, 10049]),
  DAY: 86_400_000, ACTIVE_SESSION_TTL: 30 * 86_400_000, Date,
  scenes: ["daily", "restaurant", "airport", "hotel", "shopping"].map((id) => ({ id })),
  sentenceCategories: ["all", "daily", "social", "food", "travel", "shopping", "work", "help"].map((id) => ({ id })),
});
const plain = (value) => JSON.parse(JSON.stringify(value));

test("continuous learning includes the complete range and prioritizes genuinely unseen items", () => {
  const items = Array.from({ length: 45 }, (_, index) => ({ id: index + 1 }));
  const selected = sessions.selectContinuousSession(items, new Set([1, 2, 3, 4]), new Set([2]), new Set([1]));
  assert.equal(selected.length, 45);
  assert.deepEqual(selected.map((item) => item.id), [...Array.from({ length: 41 }, (_, index) => index + 5), 2, 3, 4, 1]);
  assert.deepEqual(items.map((item) => item.id), Array.from({ length: 45 }, (_, index) => index + 1));
});

test("continuous selection retains source order and deduplicates without changing content", () => {
  const first = { id: "a", text: "Original sentence" };
  const duplicate = { id: "a", text: "Duplicate sentence" };
  const items = [first, { id: "b" }, { id: "c" }, duplicate, { id: "d" }, { id: "e" }];
  const selected = sessions.selectContinuousSession(items, new Set(["a", "b", "c"]), new Set(["a", "c"]), new Set(["a", "b"]));
  assert.deepEqual(selected.map((item) => item.id), ["d", "e", "a", "c", "b"]);
  assert.equal(selected[2], first, "a difficult rating takes priority over a contradictory mastered record");
  assert.equal(items[3], duplicate);
  assert.deepEqual(sessions.selectContinuousSession([], new Set(), new Set(), new Set()), []);
});

test("complete continuous word and sentence snapshots remain within format one backup limits", () => {
  const data = backup({ [storage.activeSession]: wordSnapshot(), [storage.sentenceActiveSession]: sentenceSnapshot() });
  assert.equal(valid(data), true);
  assert.equal(data.formatVersion, 1);
  assert.equal(keys.length, 19);
  assert.ok(JSON.stringify(data).length < backups.BACKUP_MAX_BYTES);
});

test("export and restore preserve continuous positions, IDs and ratings alongside legacy records", () => {
  const oldPattern = { version: 1, updatedAt: 1, category: "all", patternIds: ["p01", "p02"], index: 1, drillIndex: 2, ratings: { p01: "known" } };
  const initial = backup({
    [storage.activeSession]: wordSnapshot(), [storage.sentenceActiveSession]: sentenceSnapshot({ reviewOnly: true }), [storage.patternActiveSession]: oldPattern,
    [storage.session]: { mode: "test", count: 20, path: "airport" }, [storage.sentenceSaved]: [2001, 1], [storage.mastered]: [8, 9],
  });
  const source = { getItem: (key) => initial.data[key] === null ? null : JSON.stringify(initial.data[key]) };
  const exported = JSON.parse(JSON.stringify(backups.createLearningBackup(source, keys)));
  assert.equal(valid(exported), true);
  const restored = new Map([[storage.mastered, "[999]"]]);
  const target = { getItem: (key) => restored.get(key) ?? null, setItem: (key, value) => restored.set(key, value), removeItem: (key) => restored.delete(key) };
  assert.equal(backups.restoreLearningBackupData(target, keys, exported), true);
  for (const key of [storage.activeSession, storage.sentenceActiveSession, storage.patternActiveSession, storage.session, storage.sentenceSaved, storage.mastered]) {
    assert.deepEqual(JSON.parse(restored.get(key)), initial.data[key]);
  }
});

test("continuous backups reject unsupported flags, quiz or lookup sessions and out-of-range IDs", () => {
  for (const patch of [
    { continuous: false }, { continuous: "true" }, { mode: "test" }, { stage: "quiz", mode: "test" },
    { kind: "lookup", wordIds: [1] }, { wordIds: [0] }, { wordIds: [2810] }, { wordIds: [10003] },
    { path: "daily", wordIds: [10051] }, { wordIds: Array(2860).fill(1) },
  ]) assert.equal(valid(backup({ [storage.activeSession]: wordSnapshot(patch) })), false, JSON.stringify(patch).slice(0, 200));
  for (const patch of [
    { continuous: false }, { continuous: 1 }, { reviewOnly: false }, { reviewOnly: "true" }, { sentenceIds: [0] }, { sentenceIds: [1001] },
    { band: "medium", sentenceIds: [1] }, { band: "long", sentenceIds: [3001] }, { sentenceIds: Array(1001).fill(1) },
  ]) assert.equal(valid(backup({ [storage.sentenceActiveSession]: sentenceSnapshot(patch) })), false, JSON.stringify(patch).slice(0, 200));
  assert.equal(valid(backup({ [storage.activeSession]: wordSnapshot({ path: "daily", wordIds: [1, 10003, 10049] }) })), true);
  assert.equal(valid(backup({ [storage.sentenceActiveSession]: sentenceSnapshot({ band: "long", sentenceIds: [2001, 3000], mode: "speak" }) })), true);
});

test("legacy grouped cards, quizzes, lookup cards and sentence backups remain valid", () => {
  const group = wordSnapshot({ wordIds: [1, 2], index: 1 });
  delete group.continuous;
  const sentence = sentenceSnapshot({ sentenceIds: [1, 2], index: 1, count: 20 });
  delete sentence.continuous;
  for (const word of [group, { ...group, mode: "test", stage: "quiz", ratings: { 1: "known", 2: "known" } }, { ...group, kind: "lookup", wordIds: [1], index: 0, ratings: {} }]) {
    assert.equal(valid(backup({ [storage.activeSession]: word, [storage.sentenceActiveSession]: sentence })), true);
  }
});

test("real hydration retains full continuous ranges, distant positions and reinforcement markers", () => {
  const words = wordSnapshot();
  const sentences = sentenceSnapshot({ reviewOnly: true, mode: "speak" });
  assert.deepEqual(plain(cleaners.cleanActiveSession(words)), words);
  assert.deepEqual(plain(cleaners.cleanSentenceSession(sentences)), sentences);
  const restored = JSON.parse(JSON.stringify(backup({ [storage.activeSession]: words, [storage.sentenceActiveSession]: sentences })));
  assert.deepEqual(plain(cleaners.cleanActiveSession(restored.data[storage.activeSession])), words);
  assert.deepEqual(plain(cleaners.cleanSentenceSession(restored.data[storage.sentenceActiveSession])), sentences);
});

test("continuous progress survives a long break while legacy expiry and timestamp protection remain", () => {
  const longAgo = Date.now() - 90 * 86_400_000;
  assert.ok(cleaners.cleanActiveSession(wordSnapshot({ updatedAt: longAgo })));
  assert.ok(cleaners.cleanSentenceSession(sentenceSnapshot({ updatedAt: longAgo })));
  const words = wordSnapshot({ updatedAt: longAgo, wordIds: [1, 2, 3], index: 1 });
  const sentences = sentenceSnapshot({ updatedAt: longAgo, sentenceIds: [1, 2, 3], index: 1 });
  delete words.continuous;
  delete sentences.continuous;
  assert.equal(cleaners.cleanActiveSession(words), null);
  assert.equal(cleaners.cleanSentenceSession(sentences), null);
  for (const updatedAt of [-1, NaN, Date.now() + 2 * 86_400_000]) {
    assert.equal(cleaners.cleanActiveSession(wordSnapshot({ updatedAt })), null);
    assert.equal(cleaners.cleanSentenceSession(sentenceSnapshot({ updatedAt })), null);
  }
});

test("legacy hydration still enforces its old group bounds and continuous cards never restore as quizzes", () => {
  const words = wordSnapshot({ updatedAt: Date.now(), wordIds: Array.from({ length: 30 }, (_, index) => index + 1), index: 25 });
  const sentences = sentenceSnapshot({ updatedAt: Date.now(), sentenceIds: Array.from({ length: 30 }, (_, index) => index + 1), index: 25 });
  delete words.continuous;
  delete sentences.continuous;
  const oldWords = cleaners.cleanActiveSession(words);
  const oldSentences = cleaners.cleanSentenceSession(sentences);
  assert.equal(oldWords.wordIds.length, 20);
  assert.equal(oldWords.index, 19);
  assert.equal(oldSentences.sentenceIds.length, 10);
  assert.equal(oldSentences.index, 9);
  assert.deepEqual(plain(oldWords.ratings), words.ratings);
  assert.deepEqual(plain(oldSentences.ratings), sentences.ratings);
  assert.equal(cleaners.cleanActiveSession(wordSnapshot({ mode: "test", stage: "quiz" })), null);
  assert.equal(cleaners.cleanActiveSession(wordSnapshot({ mode: "test" })), null);
  assert.equal(cleaners.cleanActiveSession(wordSnapshot({ kind: "lookup", wordIds: [3] })), null);
});
