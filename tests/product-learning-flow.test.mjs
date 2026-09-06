import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const compile = (source) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React }, fileName: "flow.tsx",
}).outputText;
const extract = (start, end) => {
  const from = page.indexOf(start), to = page.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `${start} exists`);
  return page.slice(from, to);
};
const helpers = await import(`data:text/javascript;base64,${Buffer.from(compile(await readFile(new URL("../app/session-utils.ts", import.meta.url), "utf8"))).toString("base64")}`);
const plain = (value) => JSON.parse(JSON.stringify(value));
const React = { createElement: (tag, props, ...children) => ({ tag, props: props ?? {}, children }) };
const textOf = (node) => node == null || typeof node === "boolean" ? "" : typeof node !== "object" ? String(node) : (Array.isArray(node) ? node : node.children).map(textOf).join("");
function find(node, predicate) {
  if (!node || typeof node !== "object") return undefined;
  if (!Array.isArray(node) && predicate(node)) return node;
  for (const child of Array.isArray(node) ? node : node.children) {
    const match = find(child, predicate);
    if (match) return match;
  }
}
const words = ["one", "two", "three"].map((word, index) => ({ id: index + 1, word, meaning: `释义 ${index + 1}`, example: `An example of ${word}.` }));
const quizCode = compile(`${extract("const checkQuiz =", "const rememberReviewAction =")}\n({ checkQuiz, nextQuiz, retryMissedWords, retryDifficultWords });`);
function quiz() {
  const state = { quizIndex: 0, quizAnswer: "", quizFeedback: null, quizResults: [], sessionWords: words, sessionMode: "test", wordSessionKind: "group", learnStage: "quiz", tab: "learn", index: 0, cardRatings: { 1: "known", 2: "known", 3: "known" } };
  const marks = { correct: [], wrong: [] };
  const lock = { current: { submitted: -1, advanced: -1 } };
  const render = () => {
    const setters = Object.fromEntries(Object.keys(state).map((key) => [`set${key[0].toUpperCase()}${key.slice(1)}`, (value) => { state[key] = value; }]));
    const context = vm.createContext({ ...helpers, ...state, ...setters, React, quizActionLock: lock, quizWord: state.sessionWords[state.quizIndex], quizInputRef: {}, quizNextRef: {}, resultPrimaryRef: {}, mastered: [], difficultSet: new Set([2, 3]),
      noteStudyDay() {}, markMastered(id) { marks.correct.push(id); }, addDifficult(id) { marks.wrong.push(id); }, blankSentence: () => "____", playSpeech() {},
    });
    const handlers = vm.runInContext(quizCode, context);
    Object.assign(context, handlers);
    return { ...handlers,
      quizTree: () => vm.runInContext(compile(`${extract("const renderQuiz =", "const renderResult =")}\nrenderQuiz();`), context),
      resultTree: () => vm.runInContext(compile(`${extract("const renderResult =", "const renderLearn =")}\nrenderResult();`), context),
    };
  };
  return { state, marks, render };
}

test("revealing an unknown quiz answer records one mistake and leaves Next usable with empty input", () => {
  const app = quiz();
  const initial = app.render();
  const tree = initial.quizTree();
  const reveal = find(tree, (node) => node.tag === "button" && textOf(node) === "想不起来，查看答案");
  reveal.props.onClick();
  reveal.props.onClick();
  assert.equal(app.state.quizAnswer, "", "no fake answer is inserted");
  assert.equal(app.state.quizFeedback, "wrong");
  assert.deepEqual(plain(app.state.quizResults), [false]);
  assert.deepEqual(app.marks.wrong, [1]);
  const feedback = app.render();
  const next = find(feedback.quizTree(), (node) => node.tag === "button" && textOf(node) === "下一题");
  assert.equal(next.props.disabled, false);
  next.props.onClick();
  assert.equal(app.state.quizIndex, 1);
  assert.equal(app.state.quizFeedback, null);
  app.state.quizAnswer = "two";
  app.render().checkQuiz(true);
  assert.deepEqual(plain(app.state.quizResults), [false, false], "asking for the answer never awards a correct score");
});

test("normal button submission stays correct and pausing retains the draft, scores and current question", () => {
  const app = quiz();
  app.state.quizAnswer = "one";
  const first = app.render().quizTree();
  find(first, (node) => node.tag === "button" && textOf(node) === "提交答案").props.onClick({ type: "click" });
  assert.deepEqual(plain(app.state.quizResults), [true], "the click event is not mistaken for a reveal request");
  app.render().nextQuiz();
  app.state.quizAnswer = "tw";
  const before = plain(app.state);
  find(app.render().quizTree(), (node) => node.props["aria-label"] === "暂停考试并保留进度").props.onClick();
  assert.deepEqual(plain(app.state), { ...before, tab: "home" });
});

test("a revealed blank answer survives session cleaning while impossible success records are rejected", () => {
  const clean = vm.runInNewContext(compile(`${extract("function cleanActiveSession", "function localDateKey")}\ncleanActiveSession;`), {
    ...helpers, isLearnPath: (path) => path === "frequency", STUDY_WORD_IDS: new Set([1, 2, 3]), DAY: 86_400_000, ACTIVE_SESSION_TTL: 30 * 86_400_000,
  });
  const snapshot = { version: 1, updatedAt: Date.now(), path: "frequency", mode: "test", stage: "quiz", wordIds: [1, 2, 3], index: 2, ratings: { 1: "known", 2: "known", 3: "known" }, quizIndex: 1, quizAnswer: "", quizFeedback: "wrong", quizResults: [true, false] };
  assert.deepEqual(plain(clean(snapshot)), snapshot);
  assert.equal(clean({ ...snapshot, quizFeedback: "correct", quizResults: [true, true] }), null);
  assert.equal(clean({ ...snapshot, quizResults: [true] }), null);
});

test("the result lists actual wrong words and retries only them with fresh scores", () => {
  const app = quiz();
  Object.assign(app.state, { learnStage: "result", quizIndex: 2, quizResults: [true, false, false], quizFeedback: "wrong", quizAnswer: "other" });
  const result = app.render().resultTree();
  const mistakes = find(result, (node) => node.props.className === "result-mistakes");
  assert.match(textOf(mistakes), /two.*three/);
  assert.doesNotMatch(textOf(mistakes), /one/);
  find(result, (node) => node.tag === "button" && textOf(node) === "再练这 2 个错词").props.onClick();
  assert.deepEqual(plain(app.state.sessionWords.map((word) => word.id)), [2, 3]);
  assert.deepEqual(plain(app.state.quizResults), []);
  assert.deepEqual(plain(app.state.cardRatings), {});
  assert.equal(app.state.learnStage, "cards");
  assert.equal(app.state.quizIndex, 0);
  assert.equal(app.state.quizAnswer, "");
  assert.equal(app.state.quizFeedback, null);
  assert.deepEqual(app.marks, { correct: [], wrong: [] }, "starting a retry does not award any progress");
});

test("free study retries only the unfinished words and keeps a one-word retry in its original group", () => {
  for (const selected of [words, words.slice(0, 2)]) {
    const app = quiz();
    Object.assign(app.state, { sessionWords: selected, learnStage: "result", sessionMode: "free", wordSessionKind: "group", quizIndex: 2, quizFeedback: "wrong", quizAnswer: "old" });
    const expectedIds = selected.filter((word) => [2, 3].includes(word.id)).map((word) => word.id);
    const tree = app.render().resultTree();
    find(tree, (node) => node.tag === "button" && textOf(node) === `再练这 ${expectedIds.length} 个待加强单词`).props.onClick();
    assert.deepEqual(plain(app.state.sessionWords.map((word) => word.id)), expectedIds);
    assert.equal(app.state.sessionMode, "free");
    assert.equal(app.state.wordSessionKind, "group");
    assert.equal(app.state.learnStage, "cards");
    assert.equal(app.state.index, 0);
    assert.deepEqual(plain(app.state.cardRatings), {});
    assert.deepEqual(plain(app.state.quizResults), []);
    assert.equal(app.state.quizAnswer, "");
    assert.equal(app.state.quizFeedback, null);
    const lookup = extract("const renderCards =", "const renderQuiz =").match(/const singleWordLookup = ([^;]+);/)[1];
    assert.equal(vm.runInNewContext(lookup, app.state), false, "a one-word retry must not offer an unrelated return to the word library");
    assert.deepEqual(app.marks, { correct: [], wrong: [] });
  }
});

test("single-word group and lookup sessions retain their navigation identity through reload", () => {
  const clean = vm.runInNewContext(compile(`${extract("function cleanActiveSession", "function localDateKey")}\ncleanActiveSession;`), {
    ...helpers, isLearnPath: (path) => path === "frequency", STUDY_WORD_IDS: new Set([1]), DAY: 86_400_000, ACTIVE_SESSION_TTL: 30 * 86_400_000,
  });
  const snapshot = { version: 1, updatedAt: Date.now(), path: "frequency", mode: "free", stage: "cards", wordIds: [1], index: 0, ratings: {}, quizIndex: 0, quizAnswer: "", quizFeedback: null, quizResults: [] };
  for (const kind of ["group", "lookup"]) assert.deepEqual(plain(clean({ ...snapshot, kind })), { ...snapshot, kind });
  assert.deepEqual(plain(clean(snapshot)), snapshot, "old backup snapshots remain valid without the new optional field");
  assert.equal(clean({ ...snapshot, kind: "invalid" }).kind, undefined);
});

const reviewCode = compile([
  extract("const markMastered =", "const startSession ="),
  extract("const rememberReviewAction =", "const markWordbookMastered ="),
  extract("const markWordbookMastered =", "const commonHeader ="),
  "({ rateReview, markWordbookMastered, undoReviewAction });",
].join("\n"));
function review({ scheduled = true, known = false } = {}) {
  const original = { due: Date.now() - 60_000, stage: 3 };
  const state = { mastered: known ? [1, 3] : [3], difficult: known ? [2] : [1, 2], schedule: { ...(scheduled ? { 1: original } : {}), 2: { due: 1, stage: 1 } }, reviewIndex: 1, reviewRevealedWordId: 1, reviewUndo: null };
  const lock = { current: false };
  const render = () => vm.runInNewContext(reviewCode, {
    ...helpers, ...state, dueWords: [words[1], words[0]], wordbookWords: words.filter((word) => state.difficult.includes(word.id)),
    reviewActionLock: lock, window: { setTimeout() {} }, DAY: 86_400_000, REVIEW_AGAIN_DELAY: 600_000, noteStudyDay() {},
    saveMastered: (update) => { state.mastered = update(state.mastered); }, saveDifficult: (update) => { state.difficult = update(state.difficult); }, saveSchedule: (update) => { state.schedule = update(state.schedule); },
    setReviewIndex: (value) => { state.reviewIndex = value; }, setReviewRevealedWordId: (value) => { state.reviewRevealedWordId = value; }, setReviewUndo: (value) => { state.reviewUndo = value; },
  });
  return { state, render, original };
}

test("undoing every review rating restores its schedule and membership without overwriting other words", () => {
  for (const known of [false, true]) for (const rating of ["again", "hard", "good", "easy"]) {
    const app = review({ known });
    const original = plain(app.state);
    app.render().rateReview(rating);
    assert.equal(app.state.reviewUndo.id, 1);
    app.state.schedule[3] = { due: Date.now() + 999_999, stage: 4 };
    const unrelated = plain(app.state.schedule[3]);
    app.render().undoReviewAction();
    assert.deepEqual(plain(app.state.schedule[1]), original.schedule[1]);
    assert.deepEqual(plain(app.state.schedule[3]), unrelated);
    assert.deepEqual([...app.state.mastered].sort(), original.mastered.sort());
    assert.deepEqual([...app.state.difficult].sort(), original.difficult.sort());
    assert.equal(app.state.reviewIndex, 1);
    assert.equal(app.state.reviewRevealedWordId, 1);
    assert.equal(app.state.reviewUndo, null);
  }
});

test("undoing an accidental wordbook removal restores the word and removes an invented schedule", () => {
  const app = review({ scheduled: false });
  app.render().markWordbookMastered(1);
  assert.equal(app.state.difficult.includes(1), false);
  assert.ok(app.state.schedule[1]);
  app.render().undoReviewAction();
  assert.equal(app.state.difficult.includes(1), true);
  assert.equal(app.state.mastered.includes(1), false);
  assert.equal(app.state.schedule[1], undefined);
  assert.equal(app.state.reviewIndex, 0);
});

test("home practice shortcuts resume unfinished work and only offer setup when nothing is pending", () => {
  const code = compile(`${extract("const openSentencePracticeFromHome =", "const renderSentenceSetup =")}\n({ openSentencePracticeFromHome, openPatternPracticeFromHome });`);
  for (const unfinished of [false, true]) {
    const calls = [];
    const handlers = vm.runInNewContext(code, {
      hasUnfinishedSentence: unfinished, hasUnfinishedPattern: unfinished,
      resumeSentenceSession: () => calls.push("resume sentence"), resumePatternSession: () => calls.push("resume pattern"),
      restoreSentenceSetupPreferences: () => calls.push("sentence setup"), restorePatternSetupPreferences: () => calls.push("pattern setup"),
      setSentenceMode: (mode) => calls.push(mode), setSentenceSection: (section) => calls.push(section), setTab: (tab) => calls.push(tab),
    });
    handlers.openSentencePracticeFromHome();
    handlers.openPatternPracticeFromHome();
    assert.deepEqual(calls, unfinished ? ["resume sentence", "sentences", "resume pattern", "sentences"] : ["sentence setup", "speak", "library", "sentences", "patterns", "pattern setup", "sentences"]);
  }
});

test("entering word cards focuses the word rather than a reused rating button, and leaving cancels that focus", () => {
  const ast = ts.createSourceFile("page.tsx", page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback, dependencies;
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect" && node.arguments[0]?.getText(ast).includes("wordHeadingRef")) {
      callback = node.arguments[0].getText(ast);
      dependencies = node.arguments[1].getText(ast);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(callback);
  assert.match(dependencies, /current\?\.id/);
  const frames = new Map();
  let focused = "rating", frameId = 0;
  const run = (patch = {}) => vm.runInNewContext(compile(`(${callback})`), {
    hydrated: true, tab: "learn", learnStage: "cards", hasOpenDialog: false, ...patch,
    window: { requestAnimationFrame(fn) { frames.set(++frameId, fn); return frameId; }, cancelAnimationFrame(id) { frames.delete(id); } },
    wordHeadingRef: { current: { focus() { focused = "word"; } } },
  })();
  const cancel = run();
  cancel();
  assert.equal(frames.size, 0);
  assert.equal(focused, "rating");
  for (const patch of [{ tab: "home" }, { learnStage: "quiz" }, { hasOpenDialog: true }]) run(patch);
  assert.equal(frames.size, 0);
  run();
  for (const fn of frames.values()) fn();
  assert.equal(focused, "word");
});

const speakingCode = compile([
  extract("const retryDifficultSentences =", "const beginPatternSession ="),
  extract("const retryDifficultPatterns =", "const openSentencePracticeFromHome ="),
  extract("const renderPatternResult =", "const renderSentences ="),
  "({ retryDifficultSentences, retryDifficultPatterns, renderSentenceResult, renderPatternResult });",
].join("\n"));
function speakingResult(patch = {}) {
  const state = {
    tab: "sentences", sentenceSection: "library", sentenceStage: "result", patternStage: "result",
    sentenceSessionIds: [1001, 1002, 1003], sentenceRatings: { 1001: "known", 1002: "difficult", 1003: "difficult" },
    sentenceIndex: 2, sentenceTranslationOpen: true, sentenceMode: "speak", sentenceBand: "medium", sentenceCategory: "travel", sentenceCount: 20,
    sentenceSavedOnly: false, sentenceReviewOnly: false,
    patternSessionIds: ["p01", "p02", "p03"], patternRatings: { p01: "known", p02: "difficult", p03: "difficult" },
    patternIndex: 2, patternDrillIndex: 2, patternAnswerOpen: true, patternCategory: "all",
    ...patch,
  };
  const render = () => vm.runInNewContext(speakingCode, {
    React, ...state, resultPrimaryRef: {},
    restoreSentenceSetupPreferences() { state.sentenceStage = "setup"; },
    restorePatternSetupPreferences() { state.patternStage = "setup"; },
    ...Object.fromEntries(Object.keys(state).map((key) => [`set${key[0].toUpperCase()}${key.slice(1)}`, (value) => { state[key] = value; }])),
  });
  return { state, render };
}

test("sentence results restart only this group's difficult items with the same speaking mode and band", () => {
  const app = speakingResult();
  const before = plain(app.state);
  const tree = app.render().renderSentenceResult();
  find(tree, (node) => node.tag === "button" && textOf(node) === "再练这 2 个待加强句子").props.onClick();
  assert.deepEqual(plain(app.state), {
    ...before, sentenceSessionIds: [1002, 1003], sentenceRatings: {}, sentenceIndex: 0,
    sentenceTranslationOpen: false, sentenceStage: "cards",
  });
});

test("pattern results restart only the difficult patterns from their first substitution without answers", () => {
  const app = speakingResult({ sentenceSection: "patterns" });
  const before = plain(app.state);
  const tree = app.render().renderPatternResult();
  find(tree, (node) => node.tag === "button" && textOf(node) === "再练这 2 个待加强句型").props.onClick();
  assert.deepEqual(plain(app.state), {
    ...before, patternSessionIds: ["p02", "p03"], patternRatings: {}, patternIndex: 0,
    patternDrillIndex: 0, patternAnswerOpen: false, patternStage: "cards",
  });
});

test("completed speaking practice does not offer an empty retry and returns to the relevant sentence view", () => {
  for (const [view, label] of [[{}, "返回句库"], [{ sentenceReviewOnly: true }, "返回待加强列表"], [{ sentenceSavedOnly: true }, "返回收藏句子"]]) {
    const app = speakingResult({ sentenceSessionIds: [1001], sentenceRatings: { 1001: "known" }, patternRatings: { p01: "known", p02: "known", p03: "known" }, ...view });
    const before = plain(app.state);
    const actions = app.render();
    assert.doesNotMatch(textOf(actions.renderSentenceResult()), /再练这/);
    assert.doesNotMatch(textOf(actions.renderPatternResult()), /再练这/);
    actions.retryDifficultSentences();
    actions.retryDifficultPatterns();
    assert.deepEqual(plain(app.state), before, "an empty retry cannot replace a completed session");
    find(actions.renderSentenceResult(), (node) => node.tag === "button" && textOf(node) === label).props.onClick();
    assert.equal(app.state.sentenceStage, "setup");
    assert.deepEqual(plain(app.state.sentenceSessionIds), []);
  }
});

test("both retry snapshots remain compatible with the existing reload and backup session format", () => {
  const cleaners = vm.runInNewContext(compile(`${extract("function cleanSentenceIds", "function cleanStoredSchedule")}\n({ cleanSentenceSession, cleanPatternSession });`), {
    ...helpers, DAY: 86_400_000, ACTIVE_SESSION_TTL: 30 * 86_400_000,
    sentenceCategories: [{ id: "travel" }], patternCategories: [{ id: "all" }], PATTERN_IDS: new Set(["p01", "p02", "p03"]),
  });
  const app = speakingResult();
  app.render().retryDifficultSentences();
  app.render().retryDifficultPatterns();
  const s = app.state;
  const sentence = { version: 1, updatedAt: Date.now(), band: s.sentenceBand, category: s.sentenceCategory, count: s.sentenceCount, mode: s.sentenceMode, sentenceIds: s.sentenceSessionIds, index: s.sentenceIndex, ratings: s.sentenceRatings };
  const pattern = { version: 1, updatedAt: Date.now(), category: s.patternCategory, patternIds: s.patternSessionIds, index: s.patternIndex, drillIndex: s.patternDrillIndex, ratings: s.patternRatings };
  assert.deepEqual(plain(cleaners.cleanSentenceSession(sentence)), plain(sentence));
  assert.deepEqual(plain(cleaners.cleanPatternSession(pattern)), plain(pattern));
});
