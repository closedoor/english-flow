import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const compile = (source) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const utilities = compile(await readFile(new URL("../app/session-utils.ts", import.meta.url), "utf8"));
const sessions = await import(`data:text/javascript;base64,${Buffer.from(utilities).toString("base64")}`);
const ast = ts.createSourceFile("page.tsx", page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const initializers = new Map();
const declarations = new Map();
let wordEffect, sentenceEffect;
function visit(node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) initializers.set(node.name.text, node.initializer.getText(ast));
  if (ts.isFunctionDeclaration(node) && node.name) declarations.set(node.name.text, node.getText(ast));
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect") {
    const callback = node.arguments[0].getText(ast);
    if (callback.includes("kind: wordSessionKind")) wordEffect = callback;
    if (callback.includes("sentenceIds: sentenceSessionIds")) sentenceEffect = callback;
  }
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(wordEffect);
assert.ok(sentenceEffect);
const actions = [
  "saveMastered", "saveDifficult", "saveSchedule", "saveSessionPreferences", "selectPath", "noteStudyDay", "markMastered", "addDifficult",
  "playAutomaticWordExample", "resumeWordSession", "startSession", "startSingleWord", "finishCard", "moveCard", "retryDifficultWords",
  "finishOpeningLearningSetup", "openLearningSetup", "returnToWordLibrary", "confirmDiscardSession",
  "markSentenceSeen", "playAutomaticSentenceExample", "beginSentenceSession", "startSentenceSession", "resumeSentenceSession",
  "restoreSentenceSetupPreferences", "moveSentence", "finishSentenceCard", "retryDifficultSentences",
];
const helpers = ["sessionPayloadMatches", "localDateKey", "cleanSentenceIds", "isSentenceBand", "isSentenceCategory", "isSentenceLearningMode", "cleanSentenceSession", "isLearnPath", "cleanActiveSession"];
const source = compile(`${helpers.map((name) => {
  assert.ok(declarations.has(name), `missing real helper ${name}`);
  return declarations.get(name);
}).join("\n")}\n${actions.map((name) => {
  assert.ok(initializers.has(name), `missing real action ${name}`);
  return `const ${name} = ${initializers.get(name)};`;
}).join("\n")}\n({ ${actions.join(",")}, persistWord: ${wordEffect}, persistSentence: ${sentenceEffect} });`);
const plain = (value) => JSON.parse(JSON.stringify(value));

function runtime(patch = {}, stored = {}) {
  const words = Array.from({ length: 90 }, (_, index) => ({ id: index + 1, word: `word${index + 1}`, example: `Example ${index + 1}.` }));
  const sentences = Array.from({ length: 90 }, (_, index) => ({ id: index + 1, text: `Sentence ${index + 1}.`, translation: `句子 ${index + 1}`, length: "short", category: index < 45 ? "daily" : "travel" }));
  const saved = new Map(Object.entries(stored));
  const timers = [];
  const speech = [];
  const state = {
    hydrated: true, externalUpdateDetected: false, tab: "learn", learnStage: "setup", sessionWords: [], sessionPath: "frequency", sessionMode: "free",
    wordSessionKind: "group", wordContinuous: false, pausedWordSession: null, index: 0, cardRatings: {}, quizIndex: 0, quizAnswer: "", quizFeedback: null, quizResults: [],
    mastered: [], difficult: [], schedule: {}, studyDays: [], path: "frequency", mode: "free", count: 10, discardRequest: null,
    wordBrowserOpen: false, librarySearch: "", libraryLimit: 24, speechNotice: null,
    sentenceBand: "short", sentenceCategory: "all", sentenceCount: 10, sentenceMode: "bilingual", sentenceStage: "setup", sentenceSection: "library",
    sentenceContinuous: false, sentenceSessionReview: false, sentenceSessionKind: undefined, sentenceSessionIds: [], sentenceIndex: 0, sentenceRatings: {}, sentenceTranslationOpen: false,
    sentenceSearch: "", sentenceSavedOnly: false, sentenceReviewOnly: false, sentenceSeen: [], sentenceMastered: [], sentenceDifficult: [],
    ...patch,
  };
  state.preferences = { path: state.path, mode: state.mode, count: state.count };
  const wordResume = { current: saved.has("word") ? JSON.parse(saved.get("word")) : null };
  const sentenceResume = { current: saved.has("sentence") ? JSON.parse(saved.get("sentence")) : null };
  const context = vm.createContext({
    ...sessions, Date, DAY: 86_400_000, ACTIVE_SESSION_TTL: 30 * 86_400_000,
    words, scenePacks: { airport: words.slice(45, 75) }, STUDY_WORD_IDS: new Set(words.map((word) => word.id)), STUDY_WORD_BY_ID: new Map(words.map((word) => [word.id, word])),
    scenes: ["daily", "restaurant", "airport", "hotel", "shopping"].map((id) => ({ id })),
    sentenceCategories: ["all", "daily", "social", "food", "travel", "shopping", "work", "help"].map((id) => ({ id })),
    sentencePacks: { 1: sentences }, SENTENCE_PACK_BY_BAND: { short: 1, medium: 2, long: 3 }, sentenceItemById: new Map(sentences.map((item) => [item.id, item])),
    STORAGE: { activeSession: "word", sentenceActiveSession: "sentence", practiceRotation: "rotation", sentencePreferences: "sentencePreferences" },
    readJson: (key, fallback) => saved.has(key) ? JSON.parse(saved.get(key)) : fallback,
    writeJson: (key, value) => saved.set(key, JSON.stringify(value)), removeStoredValue: (key) => saved.delete(key),
    activeSessionResumeSnapshotRef: wordResume, sentenceResumeSnapshotRef: sentenceResume,
    practiceRotationRef: { current: { word: 0, sentence: 0, pattern: 0 } },
    sentenceSetupPreferencesRef: { current: { band: state.sentenceBand, category: state.sentenceCategory, count: state.sentenceCount, mode: state.sentenceMode } },
    wordBrowserOriginRef: { current: null }, wordBrowserReturnRef: { current: false }, wordBrowserRef: { current: { querySelector: () => ({ scrollTop: 0 }) } },
    sentenceBrowserOriginRef: { current: null }, sentenceBrowserRef: { current: { querySelector: () => ({ scrollTop: 0 }) } },
    cardActionLock: { current: false }, sentenceActionLock: { current: false }, quizActionLock: { current: { submitted: -1, advanced: -1 } },
    autoWordExamples: true, autoSentenceExamples: true, wordExampleStartedRef: { current: null }, sentenceExampleStartedRef: { current: null },
    document: { hidden: false }, window: { scrollY: 0, setTimeout: (callback) => timers.push(callback) },
    stopSpeech: () => speech.push({ kind: "cancel" }),
    startRepeatedSpeech: (text, times) => { speech.push({ kind: "word", text, times }); return true; },
    startBilingualSentenceSpeech: (text, translation) => { speech.push({ kind: "sentence", text, translation }); return true; },
  });
  for (const key of Object.keys(state)) context[`set${key[0].toUpperCase()}${key.slice(1)}`] = (value) => { state[key] = typeof value === "function" ? value(state[key]) : value; };
  const handlers = vm.runInContext(source, context);
  function sync() {
    Object.assign(state, { path: state.preferences.path, mode: state.preferences.mode, count: state.preferences.count });
    Object.assign(context, state);
    context.current = state.sessionWords[state.index];
    context.difficultSet = new Set(state.difficult);
    context.sentenceSessionItems = state.sentenceSessionIds.map((id) => context.sentenceItemById.get(id)).filter(Boolean);
    context.safeSentenceIndex = Math.min(state.sentenceIndex, Math.max(context.sentenceSessionItems.length - 1, 0));
    context.currentSentence = context.sentenceSessionItems[context.safeSentenceIndex];
  }
  function persist() { sync(); handlers.persistWord(); sync(); handlers.persistSentence(); sync(); }
  function invoke(name, ...args) { sync(); handlers[name](...args); persist(); timers.splice(0).forEach((callback) => callback()); }
  persist();
  return { state, words, sentences, saved, speech, invoke, snapshot: (key) => JSON.parse(saved.get(key)), patch: (value) => { Object.assign(state, value); sync(); }, cancel: () => { state.discardRequest = null; persist(); } };
}

test("word learning passes card twenty and pauses, looks up a word, then resumes the identical range", () => {
  const app = runtime({ count: 20, mode: "test" });
  app.invoke("startSession");
  assert.equal(app.state.sessionWords.length, 90);
  assert.equal(app.state.sessionMode, "free");
  assert.equal(app.state.wordContinuous, true);
  for (let index = 0; index < 24; index++) app.invoke("moveCard", 1);
  app.invoke("finishCard", false);
  assert.equal(app.state.index, 25);
  const before = app.saved.get("word");
  app.invoke("openLearningSetup");
  assert.equal(app.state.discardRequest, null);
  assert.equal(app.state.learnStage, "setup");
  assert.equal(app.saved.get("word"), before);
  app.invoke("startSingleWord", app.words[80]);
  app.invoke("finishCard", true);
  assert.equal(app.state.learnStage, "result");
  assert.equal(app.saved.get("word"), before, "a completed lookup cannot erase the paused continuous range");
  app.invoke("returnToWordLibrary");
  app.invoke("startSession");
  assert.equal(app.state.index, 25);
  assert.deepEqual(plain(app.state.cardRatings), { 25: "difficult" });
  assert.equal(app.state.sessionWords.length, 90);
  assert.equal(app.saved.get("word"), before);
  assert.ok(app.state.mastered.includes(81), "the lookup's real learning mark remains separate from the range position");
  assert.ok(app.speech.some((event) => event.kind === "word" && event.text === "Example 26." && event.times === 3));
});

test("exiting a searched sentence and using normal start begins the full range instead of the lookup", () => {
  const app = runtime({ tab: "sentences" });
  app.invoke("beginSentenceSession", false, app.sentences[12]);
  const lookup = app.snapshot("sentence");
  assert.equal(lookup.kind, "lookup");
  assert.deepEqual(lookup.sentenceIds, [13]);
  app.invoke("restoreSentenceSetupPreferences");
  app.invoke("startSentenceSession");
  assert.equal(app.state.discardRequest, null);
  assert.equal(app.state.sentenceContinuous, true);
  assert.equal(app.snapshot("sentence").kind, "group");
  assert.equal(app.state.sentenceSessionIds.length, 90);
  assert.deepEqual(app.state.sentenceMastered, []);
  assert.deepEqual(app.state.studyDays, [], "looking up and starting practice do not fabricate learning");
});

test("a searched sentence retains its identity on explicit resume and after recreating memory", () => {
  const app = runtime({ tab: "sentences", sentenceMode: "speak" });
  app.invoke("beginSentenceSession", false, app.sentences[12]);
  const snapshot = app.snapshot("sentence");
  const before = app.saved.get("sentence");
  const reopened = runtime({
    tab: "sentences", sentenceSessionIds: snapshot.sentenceIds, sentenceMode: "speak",
  }, Object.fromEntries(app.saved));
  reopened.invoke("resumeSentenceSession");
  assert.equal(reopened.state.sentenceSessionKind, "lookup");
  assert.equal(reopened.state.sentenceTranslationOpen, false);
  assert.deepEqual(plain(reopened.state.sentenceSessionIds), [13]);
  assert.equal(reopened.saved.get("sentence"), before, "explicit lookup continuation preserves the saved position and timestamp");
  reopened.invoke("restoreSentenceSetupPreferences");
  reopened.invoke("startSentenceSession");
  assert.equal(reopened.state.sentenceSessionIds.length, 90);
  assert.equal(reopened.snapshot("sentence").kind, "group");
  assert.deepEqual(reopened.speech, [], "speaking-first lookup and normal practice must keep answers silent");
});

test("changing a progressed word range requires confirmation, cancel preserves bytes and confirm starts the requested range", () => {
  const app = runtime();
  app.invoke("startSession");
  app.invoke("moveCard", 1);
  app.invoke("finishCard", true);
  const before = app.saved.get("word");
  app.invoke("openLearningSetup", "airport");
  app.invoke("startSession");
  assert.deepEqual(plain(app.state.discardRequest), { wordStart: { path: "airport" } });
  assert.equal(app.saved.get("word"), before);
  app.cancel();
  assert.equal(app.saved.get("word"), before);
  app.invoke("startSession");
  app.invoke("confirmDiscardSession");
  assert.equal(app.state.discardRequest, null);
  assert.equal(app.state.sessionPath, "airport");
  assert.deepEqual(app.state.sessionWords.map((word) => word.id), app.words.slice(45, 75).map((word) => word.id));
  assert.ok(app.state.mastered.includes(2));
  assert.equal(app.snapshot("word").continuous, true);
});

test("recreating memory and resuming a continuous word snapshot retains cards after the old cap", () => {
  const app = runtime();
  app.invoke("startSession");
  for (let index = 0; index < 35; index++) app.invoke("moveCard", 1);
  app.invoke("finishCard", true);
  const stored = Object.fromEntries(app.saved);
  const reopened = runtime({}, stored);
  reopened.invoke("resumeWordSession");
  assert.equal(reopened.state.index, 36);
  assert.equal(reopened.state.sessionWords.length, 90);
  assert.deepEqual(plain(reopened.state.cardRatings), { 36: "known" });
  assert.equal(reopened.saved.get("word"), app.saved.get("word"));
});

for (const mode of ["bilingual", "speak"]) test(`${mode} sentence learning passes twenty cards, pauses and resumes its exact range without revealing recall answers`, () => {
  const app = runtime({ sentenceMode: mode, sentenceCount: 20, tab: "sentences" });
  app.invoke("startSentenceSession");
  assert.equal(app.state.sentenceSessionIds.length, 90);
  assert.equal(app.state.sentenceContinuous, true);
  for (let index = 0; index < 24; index++) app.invoke("moveSentence", 1);
  app.invoke("finishSentenceCard", false);
  const before = app.saved.get("sentence");
  app.invoke("restoreSentenceSetupPreferences");
  assert.equal(app.state.sentenceStage, "setup");
  assert.equal(app.saved.get("sentence"), before);
  app.invoke("startSentenceSession");
  assert.equal(app.state.sentenceIndex, 25);
  assert.deepEqual(plain(app.state.sentenceRatings), { 25: "difficult" });
  assert.equal(app.saved.get("sentence"), before);
  assert.equal(app.state.discardRequest, null);
  assert.equal(app.state.sentenceTranslationOpen, false);
  assert.equal(app.speech.filter((event) => event.kind === "sentence").length > 0, mode === "bilingual");
});

test("unchanged legacy free groups resume their original ten or twenty IDs and ratings", () => {
  for (const count of [10, 20]) {
    const app = runtime();
    app.invoke("startSession", "frequency", "free", count);
    app.invoke("moveCard", 1);
    app.invoke("finishCard", false);
    const before = app.saved.get("word");
    app.invoke("openLearningSetup");
    app.invoke("startSession");
    assert.equal(app.state.sessionWords.length, count);
    assert.equal(app.state.wordContinuous, false);
    assert.equal(app.state.index, 2);
    assert.deepEqual(plain(app.state.cardRatings), { 2: "difficult" });
    assert.equal(app.saved.get("word"), before);
  }
});

test("legacy sentence groups keep their original IDs, mode and ratings after count controls disappear", () => {
  for (const count of [10, 20]) for (const mode of ["bilingual", "speak"]) {
    const snapshot = { version: 1, updatedAt: Date.now(), band: "short", category: "all", count, mode,
      sentenceIds: Array.from({ length: count }, (_, index) => index + 1), index: 3, ratings: { 1: "known", 2: "difficult" } };
    const app = runtime({ tab: "sentences", sentenceMode: mode, sentenceCount: count === 10 ? 20 : 10,
      sentenceSessionIds: snapshot.sentenceIds, sentenceIndex: snapshot.index, sentenceRatings: snapshot.ratings }, { sentence: JSON.stringify(snapshot) });
    app.invoke("startSentenceSession");
    assert.equal(app.state.sentenceSessionIds.length, count);
    assert.equal(app.state.sentenceContinuous, false);
    assert.equal(app.state.sentenceIndex, 3);
    assert.equal(app.state.sentenceMode, mode);
    assert.deepEqual(plain(app.state.sentenceRatings), snapshot.ratings);
    assert.deepEqual(app.snapshot("sentence"), snapshot);
  }
});

test("a resumed legacy single-word lookup without kind can finish and clear its own snapshot", () => {
  const legacy = { version: 1, updatedAt: Date.now() - 60_000, path: "frequency", mode: "free", stage: "cards",
    wordIds: [7], index: 0, ratings: {}, quizIndex: 0, quizAnswer: "", quizFeedback: null, quizResults: [] };
  const app = runtime({}, { word: JSON.stringify(legacy) });
  app.invoke("resumeWordSession");
  assert.equal(app.state.wordSessionKind, "lookup");
  assert.equal(app.state.sessionWords.length, 1);
  app.invoke("finishCard", true);
  assert.equal(app.state.learnStage, "result");
  assert.equal(app.saved.has("word"), false, "finishing a lookup must not leave its unrated legacy snapshot resumable forever");
  assert.equal(app.state.pausedWordSession, null);
  assert.ok(app.state.mastered.includes(7));
  app.invoke("returnToWordLibrary");
  assert.equal(app.state.librarySearch, "word7");
});

test("legacy groups with missing kind, explicit one-word groups and quizzes remain protected during lookup", () => {
  for (const patch of [{ wordIds: [1, 2, 3] }, { kind: "group", wordIds: [1] }, { wordIds: [1], mode: "test" }]) {
    const legacy = { version: 1, updatedAt: Date.now() - 60_000, path: "frequency", mode: "free", stage: "cards",
      wordIds: [1, 2], index: 0, ratings: {}, quizIndex: 0, quizAnswer: "", quizFeedback: null, quizResults: [], ...patch };
    const before = JSON.stringify(legacy);
    const app = runtime({}, { word: before });
    app.invoke("startSingleWord", app.words[80]);
    app.invoke("finishCard", true);
    assert.equal(app.state.learnStage, "result");
    assert.equal(app.saved.get("word"), before);
    assert.ok(app.state.mastered.includes(81));
  }
});

test("a continuous word course corrects an earlier rating, completes its final card, and resumes its exact reinforcement range", () => {
  const wordIds = Array.from({ length: 90 }, (_, index) => index + 1);
  const snapshot = { version: 1, continuous: true, kind: "group", updatedAt: Date.now() - 45 * 86_400_000,
    path: "frequency", mode: "free", wordIds, index: 89,
    ratings: { ...Object.fromEntries(wordIds.slice(0, -2).map(id => [id, "known"])), 89: "difficult" },
    stage: "cards", quizIndex: 0, quizAnswer: "", quizFeedback: null, quizResults: [] };
  const app = runtime({ mastered: wordIds.slice(0, -2), difficult: [89] }, { word: JSON.stringify(snapshot) });
  app.invoke("resumeWordSession");
  assert.deepEqual(app.snapshot("word"), snapshot, "continuous courses retain their full range and original timestamp beyond the old TTL");
  app.invoke("moveCard", -1);
  app.invoke("finishCard", true);
  assert.equal(app.state.index, 89);
  assert.equal(app.state.cardRatings[89], "known");
  assert.ok(app.state.mastered.includes(89));
  assert.deepEqual(plain(app.state.difficult), []);
  app.invoke("finishCard", false);
  assert.equal(app.state.learnStage, "result");
  assert.equal(app.saved.has("word"), false);
  assert.deepEqual(plain(app.state.difficult), [90]);
  assert.equal(app.state.schedule[90].stage, 0);
  assert.ok(app.state.schedule[90].due <= Date.now());
  app.invoke("retryDifficultWords");
  const retry = app.saved.get("word");
  assert.deepEqual(app.state.sessionWords.map(word => word.id), [90]);
  assert.equal(app.state.wordSessionKind, "group");
  assert.deepEqual(plain(app.state.cardRatings), {});
  app.invoke("openLearningSetup");app.invoke("startSession");
  assert.equal(app.saved.get("word"), retry, "normal start preserves the reinforcement IDs and timestamp");
  assert.equal(app.state.discardRequest, null);
  app.invoke("finishCard", true);
  assert.equal(app.saved.has("word"), false);
  assert.deepEqual([...app.state.mastered].sort((a, b) => a - b), wordIds);
  assert.deepEqual(plain(app.state.difficult), []);
});

for (const mode of ["bilingual", "speak"]) test(`the final ${mode} sentence rating completes and reinforcement preserves its group identity`, () => {
  const sentenceIds = Array.from({ length: 90 }, (_, index) => index + 1);
  const snapshot = { version: 1, continuous: true, kind: "group", updatedAt: Date.now() - 45 * 86_400_000,
    band: "short", category: "all", count: 10, mode, sentenceIds, index: 89,
    ratings: { ...Object.fromEntries(sentenceIds.slice(0, -2).map(id => [id, "known"])), 89: "difficult" } };
  const app = runtime({ tab: "sentences", sentenceMode: mode, sentenceSessionIds: sentenceIds,
    sentenceMastered: sentenceIds.slice(0, -2), sentenceDifficult: [89], sentenceSeen: sentenceIds.slice(0, -1) }, { sentence: JSON.stringify(snapshot) });
  app.invoke("resumeSentenceSession");assert.deepEqual(app.snapshot("sentence"), snapshot);
  app.invoke("moveSentence", -1);app.invoke("finishSentenceCard", true);
  assert.equal(app.state.sentenceIndex, 89);assert.equal(app.state.sentenceRatings[89], "known");
  assert.deepEqual(plain(app.state.sentenceDifficult), []);
  assert.equal(app.state.sentenceTranslationOpen, false);
  app.invoke("finishSentenceCard", false);
  assert.equal(app.state.sentenceStage, "result");assert.equal(app.saved.has("sentence"), false);
  assert.deepEqual(plain(app.state.sentenceDifficult), [90]);
  app.invoke("retryDifficultSentences");
  const retry = app.saved.get("sentence");
  assert.deepEqual(plain(app.state.sentenceSessionIds), [90]);assert.equal(app.state.sentenceSessionKind, "group");
  assert.deepEqual(plain(app.state.sentenceRatings), {});assert.equal(app.state.sentenceTranslationOpen, false);
  app.invoke("restoreSentenceSetupPreferences");app.invoke("startSentenceSession");
  assert.equal(app.saved.get("sentence"), retry);assert.equal(app.state.discardRequest, null);
  app.invoke("finishSentenceCard", true);
  assert.equal(app.saved.has("sentence"), false);assert.deepEqual(plain(app.state.sentenceDifficult), []);
  assert.deepEqual([...app.state.sentenceMastered].sort((a, b) => a - b), sentenceIds);
  assert.deepEqual([...app.state.sentenceSeen].sort((a, b) => a - b), sentenceIds);
});

test("rating the last card wraps to a skipped earlier word or sentence before a result can clear its course", () => {
  const ids = Array.from({ length: 90 }, (_, index) => index + 1);
  const ratings = Object.fromEntries(ids.slice(1, -1).map(id => [id, "known"]));
  const words = runtime();words.invoke("startSession");words.patch({ index: 89, cardRatings: ratings });
  words.invoke("finishCard", true);
  assert.equal(words.state.learnStage, "cards");assert.equal(words.state.index, 0);
  assert.equal(Object.keys(words.state.cardRatings).length, 89);assert.deepEqual(words.snapshot("word").wordIds, ids);
  words.invoke("finishCard", false);assert.equal(words.state.learnStage, "result");assert.equal(words.saved.has("word"), false);
  const sentences = runtime({ tab: "sentences", sentenceMode: "speak" });
  sentences.invoke("startSentenceSession");sentences.patch({ sentenceIndex: 89, sentenceRatings: ratings, sentenceTranslationOpen: true });
  sentences.invoke("finishSentenceCard", true);
  assert.equal(sentences.state.sentenceStage, "cards");assert.equal(sentences.state.sentenceIndex, 0);
  assert.equal(sentences.state.sentenceTranslationOpen, false);assert.equal(Object.keys(sentences.state.sentenceRatings).length, 89);
  assert.deepEqual(sentences.snapshot("sentence").sentenceIds, ids);
  sentences.invoke("finishSentenceCard", false);assert.equal(sentences.state.sentenceStage, "result");assert.equal(sentences.saved.has("sentence"), false);
});
