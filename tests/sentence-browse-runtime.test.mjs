import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

import ts from "typescript";

const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("page.tsx", page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const initializers = new Map();
let normalizedSource;
let scrollEffect;
function visit(node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
    initializers.set(node.name.text, node.initializer);
  }
  if (ts.isFunctionDeclaration(node) && node.name?.text === "normalized") normalizedSource = node.getText(ast);
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect") {
    const [callback, dependencies] = node.arguments;
    if (callback.getText(ast).includes("sentenceBrowserOriginRef.current")) {
      assert.equal(scrollEffect, undefined, "exactly one effect restores sentence browsing");
      scrollEffect = { callback: callback.getText(ast), dependencies: dependencies.getText(ast) };
    }
  }
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(scrollEffect, "missing the real sentence browsing scroll effect");
assert.ok(normalizedSource);
const functions = ["beginSentenceSession", "restoreSentenceSetupPreferences", "openSentenceBrowser", "startSingleWord", "returnToWordLibrary", "startSession", "finishOpeningLearningSetup"];
for (const name of functions) assert.ok(initializers.has(name), `missing ${name}`);
const filteredCallback = initializers.get("filteredSentences").arguments[0].getText(ast);
const wordFilterCallback = initializers.get("bandWords").arguments[0].getText(ast);
const compilerOptions = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext };
const javascript = (source) => ts.transpileModule(source, { compilerOptions }).outputText;
const utilities = javascript(readFileSync(new URL("../app/session-utils.ts", import.meta.url), "utf8"));
const { takeRotatedSpread } = await import(`data:text/javascript;base64,${Buffer.from(utilities).toString("base64")}`);

function harness(patch = {}) {
  const items = Array.from({ length: 95 }, (_, index) => ({
    id: index + 1, text: `Train sentence ${index + 1}.`, translation: `火车句子 ${index + 1}`,
    length: index < 50 ? "short" : "long", category: "travel",
  }));
  const words = items.map(({ id }) => ({ id, rank: id, word: `word${id}`, meaning: `词义 ${id}` }));
  const state = {
    hydrated: true, tab: "sentences", sentenceSection: "library", sentenceStage: "setup",
    sentenceBand: "short", sentenceCategory: "all", sentenceCount: 10, sentenceMode: "bilingual",
    sentenceSearch: "train", sentenceSavedOnly: false, sentenceReviewOnly: false, sentenceResultLimit: 90,
    sentenceMastered: [], sentenceDifficult: [], sentenceSaved: items.map((item) => item.id),
    sentenceIndex: 0, sentenceSessionIds: [], sentenceRatings: {}, sentenceTranslationOpen: false,
    index: 0, learnStage: "setup", patternDrillIndex: 0, patternIndex: 0, patternStage: "setup",
    quizIndex: 0, readingId: null, readingLevel: "A1", reviewIndex: 0, reviewView: "due",
    librarySearch: "word", libraryBand: 1, libraryLimit: 72, sessionWords: [], sessionMode: "test", sessionPath: "frequency",
    cardRatings: {}, quizAnswer: "", quizFeedback: null, quizResults: [], path: "frequency", mode: "test", count: 10, wordSessionKind: "group",
    mastered: [], difficult: [],
    ...patch,
  };
  const frames = new Map();
  const scrollCalls = [];
  const focusCalls = [];
  const writes = [];
  let nextFrame = 0;
  const window = {
    scrollY: 0,
    requestAnimationFrame(callback) { frames.set(++nextFrame, callback); return nextFrame; },
    cancelAnimationFrame(id) { frames.delete(id); },
    scrollTo(options) { window.scrollY = options.top; scrollCalls.push({ ...options }); },
  };
  const buttons = new Map(items.map((item) => [item.id, {
    focus(options) { focusCalls.push({ target: item.id, ...options }); },
  }]));
  let visibleIds = new Set();
  const sentenceList = { scrollTop: 0 };
  const browser = {
    querySelector(selector) {
      if (selector === ".sentence-result-list") return sentenceList;
      const id = Number(selector.match(/data-sentence-id="(\d+)"/)?.[1]);
      return visibleIds.has(id) ? buttons.get(id) : null;
    },
    focus(options) { focusCalls.push({ target: "browser", ...options }); },
    scrollIntoView(options) { window.scrollY = 1100; scrollCalls.push({ target: "browser", ...options }); },
  };
  let visibleWordIds = new Set();
  const wordList = { scrollTop: 0 };
  const wordBrowser = {
    querySelector(selector) {
      if (selector === ".library-list") return wordList;
      const id = Number(selector.match(/data-word-id="(\d+)"/)?.[1]);
      return visibleWordIds.has(id) ? buttons.get(id) : null;
    },
    focus(options) { focusCalls.push({ target: "words", ...options }); },
    scrollIntoView(options) { window.scrollY = 1250; scrollCalls.push({ target: "words", ...options }); },
  };
  const wordBrowserRef = { current: wordBrowser };
  const wordBrowserOriginRef = { current: null };
  const wordBrowserReturnRef = { current: false };
  const sentenceBrowserRef = { current: browser };
  const sentenceBrowserOriginRef = { current: null };
  const sentenceSetupPreferencesRef = { current: {
    band: state.sentenceBand, category: state.sentenceCategory, count: state.sentenceCount, mode: state.sentenceMode,
  } };
  const context = vm.createContext({
    window, sentenceBrowserRef, sentenceBrowserOriginRef, sentenceSetupPreferencesRef,
    words, wordBrowserRef, wordBrowserOriginRef, wordBrowserReturnRef,
    saveSessionPreferences(value) { writes.push(["wordPreferences", { ...value }]); },
    selectPath(value) { state.path = value; },
    sentencePacks: { 1: items.slice(0, 50), 2: [], 3: items.slice(50) },
    SENTENCE_PACK_BY_BAND: { short: 1, medium: 2, long: 3 },
    practiceRotationRef: { current: { word: 0, sentence: 0, pattern: 0 } },
    STORAGE: { practiceRotation: "rotation", sentencePreferences: "preferences" },
    writeJson(key, value) { writes.push([key, JSON.parse(JSON.stringify(value))]); },
    takeRotatedSpread,
  });
  for (const key of Object.keys(state)) {
    context[`set${key[0].toUpperCase()}${key.slice(1)}`] = (value) => {
      state[key] = typeof value === "function" ? value(state[key]) : value;
    };
  }
  vm.runInContext(javascript(normalizedSource), context);
  let previousDependencies;
  let cleanup;
  function render(patch = {}) {
    Object.assign(state, patch);
    Object.assign(context, state);
    const filtered = vm.runInContext(javascript(`(${filteredCallback})()`), context);
    visibleIds = new Set(filtered.slice(0, state.sentenceResultLimit).map((item) => item.id));
    const sentenceMounted = state.tab === "sentences" && state.sentenceStage === "setup";
    if (sentenceMounted && !sentenceBrowserRef.current) sentenceList.scrollTop = 0;
    sentenceBrowserRef.current = sentenceMounted ? browser : null;
    const filteredWords = vm.runInContext(javascript(`(${wordFilterCallback})()`), context);
    visibleWordIds = new Set(filteredWords.slice(0, state.libraryLimit).map((word) => word.id));
    const wordsMounted = state.tab === "learn" && state.learnStage === "setup";
    if (wordsMounted && !wordBrowserRef.current) wordList.scrollTop = 0;
    wordBrowserRef.current = wordsMounted ? wordBrowser : null;
    const dependencies = [...vm.runInContext(javascript(`(${scrollEffect.dependencies})`), context)];
    if (!previousDependencies || dependencies.some((value, index) => value !== previousDependencies[index])) {
      cleanup?.();
      previousDependencies = dependencies;
      const keys = Object.keys(state);
      const callback = vm.runInContext(javascript(
        `(function(${keys.join(",")}) { return (${scrollEffect.callback}); })(${keys.join(",")})`,
      ), context);
      cleanup = callback();
    }
  }
  function flushFrames() {
    for (const [id, callback] of [...frames]) { frames.delete(id); callback(); }
  }
  function invoke(name, ...args) {
    Object.assign(context, state);
    vm.runInContext(javascript(`(${initializers.get(name).getText(ast)})`), context)(...args);
    render();
    flushFrames();
  }
  render();
  flushFrames();
  scrollCalls.length = 0;
  return {
    state, items, words, window, focusCalls, scrollCalls, writes, sentenceBrowserOriginRef, sentenceList,
    wordList, wordBrowserOriginRef, wordBrowserReturnRef,
    get visibleSentenceIds() { return [...visibleIds]; },
    get requiredPacks() { return [...vm.runInContext(javascript(`(${initializers.get("requiredSentencePacks").getText(ast)})`), context)]; },
    get requestedPacks() { return [...vm.runInContext(javascript(`(${initializers.get("packs").getText(ast)})`), context)]; },
    render, flushFrames, invoke,
  };
}

test("searching a single sentence preserves expanded results and returns to the original result", () => {
  const app = harness();
  app.window.scrollY = 2480;
  app.sentenceList.scrollTop = 5160;
  app.invoke("beginSentenceSession", false, app.items[74]);
  assert.equal(app.state.sentenceStage, "cards");
  assert.equal(app.state.sentenceSearch, "train");
  assert.equal(app.state.sentenceResultLimit, 90);
  assert.equal(app.window.scrollY, 0, "the sentence card starts at the top");
  assert.equal(app.sentenceBrowserOriginRef.current.id, 75);
  app.invoke("restoreSentenceSetupPreferences");
  assert.equal(app.state.sentenceSearch, "train");
  assert.equal(app.state.sentenceResultLimit, 90);
  assert.equal(app.state.sentenceBand, "short", "browsing can return after opening another sentence band");
  assert.equal(app.window.scrollY, 2480);
  assert.equal(app.sentenceList.scrollTop, 5160, "restore the nested list before focusing an offscreen result");
  assert.deepEqual(app.focusCalls.at(-1), { target: 75, preventScroll: true });
  assert.equal(app.sentenceBrowserOriginRef.current, null, "the origin is consumed once");
});

test("returning from an unsaved favorite preserves the favorites view and focuses its container", () => {
  const app = harness({ sentenceSearch: "", sentenceSavedOnly: true });
  app.window.scrollY = 1810;
  app.sentenceList.scrollTop = 4090;
  app.invoke("beginSentenceSession", false, app.items[61]);
  assert.equal(app.state.sentenceSavedOnly, true);
  app.render({ sentenceSaved: app.state.sentenceSaved.filter((id) => id !== 62) });
  app.invoke("restoreSentenceSetupPreferences");
  assert.equal(app.state.sentenceSavedOnly, true);
  assert.equal(app.state.sentenceResultLimit, 90);
  assert.equal(app.window.scrollY, 1810);
  assert.equal(app.sentenceList.scrollTop, 4090);
  assert.deepEqual(app.focusCalls.at(-1), { target: "browser", preventScroll: true });
  assert.equal(app.sentenceBrowserOriginRef.current, null);
});

test("normal grouped study clears search or favorites and never reuses an old browsing origin", () => {
  for (const patch of [
    { sentenceSearch: "train", sentenceSavedOnly: false },
    { sentenceSearch: "", sentenceSavedOnly: true },
    { sentenceSearch: "", sentenceReviewOnly: true },
  ]) {
    const app = harness(patch);
    app.sentenceBrowserOriginRef.current = { id: 75, scrollY: 9999 };
    app.window.scrollY = 1880;
    app.invoke("beginSentenceSession");
    assert.equal(app.state.sentenceSearch, "");
    assert.equal(app.state.sentenceSavedOnly, false);
    assert.equal(app.state.sentenceReviewOnly, false);
    assert.equal(app.sentenceBrowserOriginRef.current, null);
    assert.equal(app.state.sentenceSessionIds.length, 10);
    app.invoke("restoreSentenceSetupPreferences");
    assert.equal(app.window.scrollY, 0);
    assert.equal(app.focusCalls.length, 0, "an ordinary group has no browser-result focus target");
    assert.ok(app.writes.some(([key]) => key === "preferences"));
  }
});

test("single-word lookup returns from both an unmarked card and a completed result to the same list position", () => {
  for (const complete of [false, true]) {
    const app = harness({ tab: "learn" });
    app.window.scrollY = 900;
    app.wordList.scrollTop = 3120;
    app.invoke("startSingleWord", app.words[60]);
    assert.equal(app.state.sessionMode, "free");
    assert.equal(app.state.learnStage, "cards");
    assert.equal(app.window.scrollY, 0);
    if (complete) app.render({ learnStage: "result", cardRatings: { 61: "known" } });
    app.flushFrames();
    app.invoke("returnToWordLibrary");
    assert.equal(app.state.learnStage, "setup");
    assert.equal(app.state.librarySearch, "word");
    assert.equal(app.state.libraryLimit, 72);
    assert.equal(app.window.scrollY, 900);
    assert.equal(app.wordList.scrollTop, 3120);
    assert.deepEqual(app.focusCalls.at(-1), { target: 61, preventScroll: true });
    assert.equal(app.wordBrowserOriginRef.current, null);
    assert.equal(app.wordBrowserReturnRef.current, false);
    assert.equal(app.writes.length, 0, "lookup navigation never changes learning preferences or progress");
  }
});

test("a reloaded single-word card returns to a useful search without a remembered browsing position", () => {
  const app = harness({ tab: "learn", learnStage: "cards", sessionMode: "free", sessionWords: [{ id: 61, word: "word61" }] });
  app.invoke("returnToWordLibrary");
  assert.equal(app.state.librarySearch, "word61");
  assert.equal(app.wordList.scrollTop, 0);
  assert.equal(app.window.scrollY, 1250);
  assert.deepEqual(app.focusCalls.at(-1), { target: "words", preventScroll: true });
});

test("starting an ordinary word group or changing its setup clears stale lookup destinations", () => {
  for (const action of ["startSession", "finishOpeningLearningSetup"]) {
    const app = harness({ tab: "learn" });
    app.wordBrowserOriginRef.current = { id: 61, scrollY: 900, listScrollTop: 3120 };
    app.wordBrowserReturnRef.current = true;
    app.invoke(action);
    assert.equal(app.wordBrowserOriginRef.current, null);
    assert.equal(app.wordBrowserReturnRef.current, false);
    app.render({ learnStage: "setup" });
    app.flushFrames();
    assert.equal(app.window.scrollY, 0);
    assert.equal(app.focusCalls.length, 0);
  }
});

test("favorites and the return-to-search action focus their content and reset obsolete result positions", () => {
  const app = harness();
  app.sentenceBrowserOriginRef.current = { id: 75, scrollY: 2400, listScrollTop: 4000 };
  app.sentenceList.scrollTop = 4000;
  app.invoke("openSentenceBrowser", true);
  assert.equal(app.state.sentenceSavedOnly, true);
  assert.equal(app.state.sentenceSearch, "");
  assert.equal(app.state.sentenceResultLimit, 30);
  assert.equal(app.sentenceList.scrollTop, 0);
  assert.equal(app.window.scrollY, 1100);
  assert.deepEqual(app.focusCalls.at(-1), { target: "browser", preventScroll: true });
  assert.equal(app.sentenceBrowserOriginRef.current, null);
  app.invoke("openSentenceBrowser", false);
  assert.equal(app.state.sentenceSavedOnly, false);
  assert.equal(app.window.scrollY, 1100);
  assert.deepEqual(app.focusCalls.at(-1), { target: "browser", preventScroll: true });
});

test("the difficult-sentence browser includes other bands and returns correctly after mastering an item", () => {
  const app = harness({ sentenceBand: "short", sentenceCategory: "daily", sentenceDifficult: [5, 75] });
  app.invoke("openSentenceBrowser", false, true);
  assert.equal(app.state.sentenceCategory, "all");
  assert.equal(app.state.sentenceReviewOnly, true);
  assert.deepEqual(app.visibleSentenceIds, [5, 75], "the long sentence cannot be hidden by the setup's short band");
  assert.deepEqual(app.requiredPacks, [1, 2, 3]);
  assert.deepEqual(app.requestedPacks, [1, 2, 3], "the loading effect fetches every band needed by this view");
  app.window.scrollY = 1800;
  app.invoke("beginSentenceSession", false, app.items[74]);
  assert.equal(app.state.sentenceReviewOnly, true);
  assert.deepEqual(app.requiredPacks, [3], "a single-card review still loads only its own band");
  app.render({ sentenceDifficult: [5], sentenceMastered: [75] });
  app.invoke("restoreSentenceSetupPreferences");
  assert.deepEqual(app.visibleSentenceIds, [5]);
  assert.equal(app.window.scrollY, 1800);
  assert.deepEqual(app.focusCalls.at(-1), { target: "browser", preventScroll: true });
});

test("switching between difficult, saved and search views cannot leave intersecting filters", () => {
  const app = harness({ sentenceDifficult: [5], sentenceSaved: [75] });
  app.invoke("openSentenceBrowser", false, true);
  assert.deepEqual(app.visibleSentenceIds, [5]);
  app.invoke("openSentenceBrowser", true);
  assert.equal(app.state.sentenceReviewOnly, false);
  assert.deepEqual(app.visibleSentenceIds, [75]);
  app.invoke("openSentenceBrowser", false, true);
  assert.equal(app.state.sentenceSavedOnly, false);
  assert.deepEqual(app.visibleSentenceIds, [5]);
  app.invoke("openSentenceBrowser", false);
  assert.equal(app.state.sentenceSavedOnly, false);
  assert.equal(app.state.sentenceReviewOnly, false);
  assert.equal(app.state.sentenceSearch, "");
});
