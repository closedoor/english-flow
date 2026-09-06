import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const helpers = await readFile(new URL("../app/session-utils.ts", import.meta.url), "utf8");
const compile = (source) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  fileName: "test.tsx",
}).outputText;
const session = await import(`data:text/javascript;base64,${Buffer.from(compile(helpers)).toString("base64")}`);
const extract = (start, end) => page.slice(page.indexOf(start), page.indexOf(end, page.indexOf(start)));
const dates = extract("function localDateKey", "function isValidStudyDate");
const renderCode = compile(`${dates}\n${extract("const renderReview =", "const renderProgress =")}\nrenderReview();`);
const ratingCode = compile(`${extract("const rateReview =", "const markWordbookMastered =")}\nrateReview;`);
const day = 86_400_000;
const now = new Date(2026, 8, 5, 12, 0).getTime();
const textOf = (node) => node == null || typeof node === "boolean" ? "" : typeof node !== "object" ? String(node) : (Array.isArray(node) ? node : node.children).map(textOf).join("");
function find(node, predicate) {
  if (!node || typeof node !== "object") return undefined;
  if (!Array.isArray(node) && predicate(node)) return node;
  for (const child of Array.isArray(node) ? node : node.children) {
    const match = find(child, predicate);
    if (match) return match;
  }
}
function render({ schedule = {}, stage, history = true } = {}) {
  const word = { id: 1, word: "example", phonetic: "/example/", meaning: "例子", translation: "例句" };
  const visibleWords = stage === undefined ? [] : [word];
  const writes = [];
  const context = vm.createContext({
    ...session, schedule, dueWords: visibleWords, wordbookWords: visibleWords, reviewView: "due",
    reviewIndex: 0, reviewRevealedWordId: 1, reviewUndo: null, hasWordStudyHistory: history,
    nextReviewDue: session.nextScheduledReview(schedule, now), todayKey: "2026-09-05",
    reviewHeadingRef: {}, reviewAnswerRef: {}, commonHeader: () => null,
    highlightedExample: () => "An example sentence.", reviewActionLock: { current: false },
    noteStudyDay() {}, rememberReviewAction() {}, saveMastered() {}, saveDifficult() {}, setReviewIndex() {}, setReviewRevealedWordId() {},
    saveSchedule(update) { writes.push(update(schedule)); },
    DAY: day, REVIEW_AGAIN_DELAY: 600_000, window: { setTimeout() {} },
    Date: class extends Date { static now() { return now; } },
    React: { createElement: (tag, props, ...children) => ({ tag, props: props ?? {}, children }) },
  });
  context.rateReview = vm.runInContext(ratingCode, context);
  return { tree: vm.runInContext(renderCode, context), writes };
}

test("a ten-minute retry shows the next review time instead of claiming the day is complete", () => {
  const { tree } = render({ schedule: { 1: { due: now + 600_000, stage: 0 } } });
  const empty = find(tree, (node) => node.props.className === "empty-state");
  assert.equal(textOf(find(empty, (node) => node.tag === "h2")), "暂时没有到期的词");
  assert.match(textOf(empty), /下次复习今天 12:10/);
  assert.doesNotMatch(textOf(empty), /今天已经复习完/);
});

test("the next review chooses the earliest future record and updates after time passes", () => {
  const schedule = { 1: { due: now - 1 }, 2: { due: now }, 3: { due: now + day }, 4: { due: now + 600_000 } };
  assert.equal(session.nextScheduledReview(schedule, now), now + 600_000);
  assert.equal(session.nextScheduledReview(schedule, now + 600_000), now + day);
  assert.equal(session.nextScheduledReview(schedule, now + day), null);
  assert.equal(session.nextScheduledReview({}, now), null);
});

test("review dates distinguish today from later dates across a year boundary", () => {
  const format = vm.runInNewContext(compile(`${dates}\nformatReviewDue;`));
  const sameDay = new Date(2026, 11, 31, 23, 55).getTime();
  const nextYear = new Date(2027, 0, 1, 0, 5).getTime();
  assert.equal(format(sameDay, "2026-12-31"), "今天 23:55");
  assert.match(format(nextYear, "2026-12-31"), /2027/);
  assert.doesNotMatch(format(nextYear, "2026-12-31"), /今天/);
  assert.equal(format(nextYear, "2027-01-01"), "今天 00:05");
});

test("new learners and learners without a schedule get truthful empty states", () => {
  const fresh = find(render({ history: false }).tree, (node) => node.props.className === "empty-state");
  assert.match(textOf(fresh), /还没有需要复习的词/);
  assert.match(textOf(fresh), /先完成一组学习/);
  const existing = find(render().tree, (node) => node.props.className === "empty-state");
  assert.match(textOf(existing), /当前没有待复习的词/);
  assert.doesNotMatch(textOf(existing), /下次复习|今天已经复习完/);
});

test("each displayed rating interval matches the actual schedule at every memory stage", () => {
  const intervals = { again: [0, 0, 0, 0, 0, 0], hard: [1, 1, 1, 1, 1, 1], good: [1, 3, 7, 14, 30, 30], easy: [3, 7, 14, 30, 60, 60] };
  for (let stage = 0; stage <= 5; stage++) {
    for (const [buttonIndex, rating] of ["again", "hard", "good", "easy"].entries()) {
      const { tree, writes } = render({ schedule: { 1: { due: now, stage } }, stage });
      const buttons = find(tree, (node) => node.props["aria-label"] === "评价记忆程度").children;
      assert.match(textOf(buttons[buttonIndex]), new RegExp(rating === "again" ? "10 分钟后" : `${intervals[rating][stage]} 天后`));
      buttons[buttonIndex].props.onClick();
      assert.equal(writes[0][1].due - now, rating === "again" ? 600_000 : intervals[rating][stage] * day);
    }
  }
});
