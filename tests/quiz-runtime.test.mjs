import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const sessionSource = await readFile(new URL("../app/session-utils.ts", import.meta.url), "utf8");
const sessionJavaScript = ts.transpileModule(sessionSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { normalizeQuizAnswer } = await import(`data:text/javascript;base64,${Buffer.from(sessionJavaScript).toString("base64")}`);
const extract = (start, end) => page.slice(page.indexOf(start), page.indexOf(end, page.indexOf(start)));
const handlers = ts.transpileModule([
  extract("function localDateKey", "function isValidStudyDate"),
  extract("const noteStudyDay =", "const openReading ="),
  extract("const checkQuiz =", "const nextQuiz ="),
  "checkQuiz();",
].join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function submit({ answer = "word", feedback = null, locked = false, date = "2026-09-05T12:00:00Z", days = ["2026-09-04"] } = {}) {
  const result = { days: [...days], feedback: null, scores: [], mastered: [], difficult: [] };
  const context = {
    Date: class extends Date { constructor(...args) { super(...(args.length ? args : [date])); } },
    quizAnswer: answer, quizFeedback: feedback, quizIndex: 0,
    quizActionLock: { current: { submitted: locked ? 0 : -1, advanced: -1 } },
    window: { setTimeout() {} }, quizWord: { id: 1, word: "word" }, quizResults: [],
    normalizeQuizAnswer,
    setStudyDays: (update) => { result.days = [...update(result.days)]; },
    setQuizFeedback: (value) => { result.feedback = value; },
    setQuizResults: (value) => { result.scores = [...value]; },
    quizInputRef: { current: { blur() {} } },
    markMastered: (id) => result.mastered.push(id), addDifficult: (id) => result.difficult.push(id),
  };
  vm.runInNewContext(handlers, context);
  return result;
}

test("a next-day resumed quiz records today's learning for correct and wrong answers", () => {
  for (const answer of ["word", "wrong"]) {
    const result = submit({ answer });
    assert.deepEqual(result.days, ["2026-09-04", "2026-09-05"]);
    assert.equal(result.feedback, answer === "word" ? "correct" : "wrong");
    assert.deepEqual(result.scores, [answer === "word"]);
  }
});

test("quiz submission keeps one study-day entry and ignores blank or duplicate submissions", () => {
  assert.deepEqual(submit({ days: ["2026-09-05"] }).days, ["2026-09-05"]);
  for (const options of [{ answer: "  " }, { feedback: "correct" }, { locked: true }]) {
    const result = submit(options);
    assert.deepEqual(result.days, ["2026-09-04"]);
    assert.equal(result.feedback, null);
    assert.deepEqual(result.scores, []);
  }
});

test("correct mobile input with trailing punctuation never enters the difficult-word list", () => {
  for (const answer of ["word .", "word 。", " ｗｏｒｄ　！ "]) {
    const result = submit({ answer });
    assert.equal(result.feedback, "correct");
    assert.deepEqual(result.scores, [true]);
    assert.deepEqual(result.mastered, [1]);
    assert.deepEqual(result.difficult, []);
  }
});

const quizHandlers = ts.transpileModule([
  extract("const checkQuiz =", "const rateReview ="),
  "({ checkQuiz, nextQuiz });",
].join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

test("immediate submit, next and paste-submit work while duplicate or stale clicks cannot skip questions", () => {
  const state = { quizIndex: 0, quizAnswer: "word", quizFeedback: null, quizResults: [] };
  const lock = { current: { submitted: -1, advanced: -1 } };
  let studyCount = 0;
  let completed = 0;
  const render = () => vm.runInNewContext(quizHandlers, {
    ...state, quizActionLock: lock, sessionWords: [{ id: 1 }, { id: 2 }],
    quizWord: { id: state.quizIndex + 1, word: "word" },
    normalizeQuizAnswer,
    setQuizFeedback: (value) => { state.quizFeedback = value; },
    setQuizResults: (value) => { state.quizResults = [...value]; },
    setQuizIndex: (value) => { state.quizIndex = value; },
    setQuizAnswer: (value) => { state.quizAnswer = value; },
    setLearnStage: () => { completed += 1; },
    noteStudyDay: () => { studyCount += 1; },
    quizInputRef: { current: { blur() {} } }, markMastered() {}, addDifficult() {},
    window: { setTimeout() {} },
  });
  const first = render();
  first.nextQuiz();
  assert.equal(state.quizIndex, 0, "unanswered questions cannot be skipped");
  first.checkQuiz();
  first.checkQuiz();
  assert.deepEqual(state.quizResults, [true]);
  const firstFeedback = render();
  firstFeedback.nextQuiz();
  firstFeedback.nextQuiz();
  assert.equal(state.quizIndex, 1);
  assert.equal(state.quizAnswer, "");
  state.quizAnswer = "wrong"; // Paste and submit immediately after advancing.
  const second = render();
  second.checkQuiz();
  first.checkQuiz(); // Old handlers must not change the current score or question.
  firstFeedback.nextQuiz();
  second.checkQuiz();
  assert.equal(state.quizIndex, 1);
  assert.equal(state.quizFeedback, "wrong");
  assert.deepEqual(state.quizResults, [true, false]);
  assert.equal(studyCount, 2);
  const finalFeedback = render();
  finalFeedback.nextQuiz();
  finalFeedback.nextQuiz();
  assert.equal(completed, 1);
});
