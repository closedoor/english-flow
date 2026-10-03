import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const compile = (source) => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const backupSource = await readFile(new URL("../app/backup-data.ts", import.meta.url), "utf8");
const { readLearningStorage } = await import(`data:text/javascript;base64,${Buffer.from(compile(backupSource)).toString("base64")}`);
const sessionSource = await readFile(new URL("../app/session-utils.ts", import.meta.url), "utf8");
const sessionUtils = await import(`data:text/javascript;base64,${Buffer.from(compile(sessionSource)).toString("base64")}`);
const coordinatorSource = await readFile(new URL("../app/storage-coordination.ts", import.meta.url), "utf8");
const { createLearningStorageCoordinator } = await import(`data:text/javascript;base64,${Buffer.from(compile(coordinatorSource)).toString("base64")}`);
const extract = (start, end) => {
  const from = page.indexOf(start);
  const to = page.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `source exists: ${start}`);
  return page.slice(from, to);
};
const parsed = ts.createSourceFile("page.tsx", page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let hydrationSource;
let retrySource;
const persistenceHelpers = [];
function findHydration(node) {
  if (ts.isFunctionDeclaration(node) && ["writeJson", "removeStoredValue"].includes(node.name?.text)) persistenceHelpers.push(node.getText(parsed));
  if (ts.isCallExpression(node) && node.expression.getText(parsed) === "useEffect") {
    const callback = node.arguments[0];
    if (callback?.getText(parsed).includes("Client-only local progress is hydrated")) hydrationSource = callback.getText(parsed);
  }
  if (ts.isJsxAttribute(node) && node.name.getText(parsed) === "onClick" && ts.isJsxExpression(node.initializer)) {
    const callback = node.initializer.expression;
    if (callback?.getText(parsed).includes("setStorageReadAttempt")) retrySource = callback.getText(parsed);
  }
  ts.forEachChild(node, findHydration);
}
findHydration(parsed);
assert.ok(hydrationSource, "exercise the real initial learning-record hydration effect");
assert.ok(retrySource, "exercise the same-document record-read retry button");
const constants = extract("const DAY =", "function cacheLoadedPageAssets");
const helpers = extract("function readJson", "function blankSentence");
const STORAGE = vm.runInNewContext(compile(`${extract("const STORAGE =", "const tabItems:")}\nSTORAGE;`));
const keys = Object.values(STORAGE);
const optionalKeys = [STORAGE.readingCompleted, STORAGE.readingLast, STORAGE.readingAnswers, STORAGE.practiceRotation];
assert.equal(persistenceHelpers.length, 2, "use the actual component persistence handlers");
const source = compile(`${constants}\n${helpers}\n${persistenceHelpers.join("\n")}\nSTUDY_WORD_IDS = new Set(words.map(word => word.id));\nSTUDY_WORD_BY_ID = new Map(words.map(word => [word.id, word]));\nglobalThis.hydrateRecords = ${hydrationSource};\nglobalThis.retryRecordRead = ${retrySource};`);

function originalRecords() {
  const now = Date.now();
  const data = {
    mastered: [1, 2], difficult: [3], schedule: { 3: { due: now + 86_400_000, stage: 1 } },
    days: ["2026-09-30"], session: { mode: "free", count: 10, path: "frequency" },
    activeSession: { version: 1, kind: "group", updatedAt: now, path: "frequency", mode: "free", stage: "cards", wordIds: [1, 2, 3], index: 1, ratings: { 1: "known" }, quizIndex: 0, quizAnswer: "", quizFeedback: null, quizResults: [] },
    readingCompleted: ["r1"], readingLast: { id: "r2", updatedAt: now }, readingAnswers: { r1: 0, r2: 2 },
    sentenceSaved: [4], sentenceSeen: [1, 2], sentenceMastered: [1], sentenceDifficult: [2],
    sentencePreferences: { band: "short", category: "all", count: 10, mode: "bilingual" },
    sentenceActiveSession: { version: 1, updatedAt: now - 1, band: "short", category: "all", count: 10, mode: "bilingual", sentenceIds: [1, 2], index: 1, ratings: { 1: "known" } },
    patternMastered: ["p01"], patternDifficult: ["p02"],
    patternActiveSession: { version: 1, updatedAt: now - 2, category: "all", patternIds: ["p01", "p02"], index: 1, drillIndex: 2, ratings: { p01: "known" } },
    practiceRotation: { word: 2, sentence: 3, pattern: 4 },
  };
  return new Map(Object.entries(data).map(([name, value]) => [STORAGE[name], JSON.stringify(value)]));
}

function app({ failedKey, blockedStorage = false, missingOptional = false, failAfterFirstRead = false } = {}) {
  const records = originalRecords();
  if (missingOptional) optionalKeys.forEach((key) => records.delete(key));
  const original = new Map(records);
  const reads = new Map();
  const writes = [];
  const calls = [];
  const state = { StorageReadError: false, StorageReadAttempt: 0 };
  let failReads = Boolean(failedKey || blockedStorage);
  let timers = 0;
  const storage = {
    getItem(key) {
      reads.set(key, (reads.get(key) ?? 0) + 1);
      if (failReads && key === failedKey) throw new Error("Transient record read failure");
      if (failAfterFirstRead && reads.get(key) > 1) throw new Error("Record read twice instead of using its verified snapshot");
      return records.get(key) ?? null;
    },
    setItem(key, value) { writes.push([key, value]); records.set(key, value); },
    removeItem(key) { writes.push([key, null]); records.delete(key); },
  };
  const window = {
    matchMedia: () => ({ matches: false }), dispatchEvent() {},
    setInterval() { timers += 1; return timers; }, clearInterval() {},
  };
  Object.defineProperty(window, "localStorage", { get() {
    if (failReads && blockedStorage) throw new Error("Storage access denied");
    return storage;
  } });
  const setters = Object.fromEntries([...new Set((hydrationSource + retrySource).match(/\bset[A-Z]\w+(?=\()/g))]
    .map((name) => [name, (value) => {
      const next = typeof value === "function" ? value(state[name.slice(3)]) : value;
      calls.push([name, next]);
      state[name.slice(3)] = next;
    }]));
  const refs = Object.fromEntries([...new Set([...hydrationSource.matchAll(/\b(\w+Ref)\.current/g)].map((match) => match[1]))]
    .map((name) => [name, { current: null }]));
  const context = vm.createContext({
    ...setters, ...refs, ...sessionUtils, window, Event, readLearningStorage, createLearningStorageCoordinator,
    navigator: { userAgent: "isolated Chromium", platform: "Linux", maxTouchPoints: 0 },
    document: { hidden: false, addEventListener() {}, removeEventListener() {} },
    corePatterns: [{ id: "p01" }, { id: "p02" }],
    patternCategories: ["all", "daily", "request", "social", "travel", "food", "shopping", "work"].map((id) => ({ id })),
    scenes: ["daily", "restaurant", "airport", "hotel", "shopping"].map((id) => ({ id })),
    words: [{ id: 1 }, { id: 2 }, { id: 3 }], wordData: {}, stopSpeech() {},
  });
  vm.runInContext(source, context);
  const hydrate = () => context.hydrateRecords();
  const retry = () => { failReads = false; context.retryRecordRead(); return hydrate(); };
  return { hydrate, retry, records, original, reads, writes, calls, state, refs, timerCount: () => timers };
}

for (const key of keys) {
  test(`an initial read failure at ${key} preserves all records until a safe retry`, () => {
    const a = app({ failedKey: key });
    a.hydrate();
    assert.deepEqual(a.records, a.original);
    assert.deepEqual(a.writes, [], "do not normalize or persist an incomplete startup snapshot");
    assert.equal(a.state.StorageReadError, true);
    assert.notEqual(a.state.Hydrated, true);
    assert.equal(a.timerCount(), 0);
    assert.deepEqual(a.calls.map(([name]) => name), ["setStorageReadError"], "failed hydration must not restore partial learning state");

    a.retry();
    assert.equal(a.state.StorageReadError, false);
    assert.equal(a.state.Hydrated, true);
    assert.deepEqual(JSON.parse(JSON.stringify(a.state.Mastered)), [1, 2]);
    assert.deepEqual(JSON.parse(JSON.stringify(a.state.Difficult)), [3]);
    assert.equal(a.refs.activeSessionResumeSnapshotRef.current.index, 1);
    assert.equal(a.refs.sentenceResumeSnapshotRef.current.index, 1);
    assert.equal(a.refs.patternResumeSnapshotRef.current.drillIndex, 2);
    assert.deepEqual(a.records, a.original);
  });
}

test("blocked storage access stops all hydration and retries in the same context without clearing data", () => {
  const a = app({ blockedStorage: true });
  a.hydrate();
  assert.deepEqual(a.writes, []);
  assert.equal(a.state.StorageReadError, true);
  assert.notEqual(a.state.Hydrated, true);
  a.retry();
  assert.equal(a.state.Hydrated, true);
  assert.deepEqual(a.records, a.original);
});

test("a successful startup snapshot is the only disk read used by the complete hydration effect", () => {
  const a = app({ failAfterFirstRead: true });
  a.hydrate();
  assert.equal(a.state.Hydrated, true);
  assert.equal(a.state.StorageReadError, false);
  assert.equal(a.reads.size, 19);
  assert.ok([...a.reads.values()].every((count) => count === 1));
  assert.deepEqual(a.records, a.original);
});

test("a previous backup missing optional records hydrates preserved progress and safe current defaults", () => {
  const a = app({ missingOptional: true });
  a.hydrate();
  assert.equal(a.state.Hydrated, true);
  assert.deepEqual(JSON.parse(JSON.stringify(a.state.Mastered)), [1, 2]);
  assert.deepEqual(JSON.parse(JSON.stringify(a.state.ReadingCompleted)), []);
  assert.deepEqual(JSON.parse(JSON.stringify(a.state.ReadingAnswers)), {});
  assert.equal(a.state.ReadingLast, null);
  assert.deepEqual(JSON.parse(a.records.get(STORAGE.practiceRotation)), { word: 0, sentence: 0, pattern: 0 });
  for (const [key, value] of a.original) assert.equal(a.records.get(key), value, `preserved original record: ${key}`);
});
