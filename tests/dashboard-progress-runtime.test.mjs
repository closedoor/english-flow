import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const start = page.indexOf("  const renderHome =");
const end = page.indexOf("  const renderLearnSetup =", start);
assert.ok(start >= 0 && end > start, "the actual home renderer exists");
const homeCode = ts.transpileModule(page.slice(start, end) + "\nrenderHome();", {
  compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
}).outputText;

function renderHome(records = {}) {
  const changes = {};
  const context = {
    React: { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }) },
    words: Array.from({ length: 2809 }, (_, index) => ({ id: index + 1 })),
    studiedSet: new Set([...(records.mastered ?? []), ...(records.difficult ?? [])]),
    schedule: records.schedule ?? {},
    sentenceSeen: records.sentenceSeen ?? [],
    sentenceMastered: records.sentenceMastered ?? [],
    sentenceDifficult: records.sentenceDifficult ?? [],
    readingCompleted: records.readingCompleted ?? [],
    READING_TOTAL: 15,
    weeklyStudyCount: 0, streak: 0,
    weekKeys: ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"],
    visibleStudyDays: [], todayKey: "2026-10-01", dueWords: [], wordbookWords: [],
    setTab: (value) => { changes.tab = value; },
    setSentenceSection: (value) => { changes.section = value; },
    setReviewView: (value) => { changes.review = value; },
    setReviewIndex: (value) => { changes.index = value; },
    setReviewRevealedWordId: (value) => { changes.revealed = value; },
  };
  const tree = vm.runInNewContext(homeCode, context);
  const find = (className, node = tree) => {
    if (!node || typeof node !== "object") return null;
    if (node.props.className?.split(" ").includes(className)) return node;
    for (const child of node.children) {
      const found = find(className, child);
      if (found) return found;
    }
    return null;
  };
  return { find, changes };
}

test("home distinguishes an empty history from completion", () => {
  const home = renderHome();
  assert.equal(home.find("home-word-progress").props["aria-label"], "单词，已学习 0 / 2809 个，0%");
  assert.equal(home.find("home-sentence-progress").props["aria-label"], "句子，已学习 0 / 3000 句，0%");
});

test("word progress includes older schedule-only practice without counting extra scene words", () => {
  const home = renderHome({
    mastered: [1, 3001], difficult: [1, 2, 3002],
    schedule: { 1: { stage: 1 }, 3: { stage: 2 }, 3003: { stage: 0 } },
  });
  assert.equal(home.find("home-word-progress").props["aria-label"], "单词，已学习 3 / 2809 个，0.11%");
});

test("legacy reading records do not add a reading module to home", () => {
  const home = renderHome({ readingCompleted: ["r1", "r15"] });
  assert.equal(home.find("home-reading-progress"), null);
  assert.equal(home.find("home-word-progress").props["aria-label"], "单词，已学习 0 / 2809 个，0%");
  assert.equal(home.find("home-sentence-progress").props["aria-label"], "句子，已学习 0 / 3000 句，0%");
});

test("sentence progress preserves seen history and merges older rating records once per sentence", () => {
  const home = renderHome({ sentenceSeen: [1, 2], sentenceMastered: [2, 3], sentenceDifficult: [3, 4] });
  assert.equal(home.find("home-sentence-progress").props["aria-label"], "句子，已学习 4 / 3000 句，0.13%");
});

test("moving a learned word to needs-work leaves studied progress intact", () => {
  const mastered = renderHome({ mastered: [1] });
  const difficult = renderHome({ difficult: [1] });
  assert.equal(mastered.find("home-word-progress").props["aria-label"], "单词，已学习 1 / 2809 个，0.04%");
  assert.equal(difficult.find("home-word-progress").props["aria-label"], mastered.find("home-word-progress").props["aria-label"]);
});

test("no module rounds an unfinished course up to 100 percent", () => {
  const home = renderHome({
    mastered: Array.from({ length: 2808 }, (_, index) => index + 1),
    sentenceSeen: Array.from({ length: 2999 }, (_, index) => index + 1),
  });
  assert.equal(home.find("home-word-progress").props["aria-label"], "单词，已学习 2808 / 2809 个，99.9%");
  assert.equal(home.find("home-sentence-progress").props["aria-label"], "句子，已学习 2999 / 3000 句，99.9%");
});

test("only the final recorded item makes each module complete", () => {
  const home = renderHome({
    mastered: Array.from({ length: 2809 }, (_, index) => index + 1),
    sentenceSeen: Array.from({ length: 3000 }, (_, index) => index + 1),
  });
  assert.equal(home.find("home-word-progress").props["aria-label"], "单词，已学习 2809 / 2809 个，100%");
  assert.equal(home.find("home-sentence-progress").props["aria-label"], "句子，已学习 3000 / 3000 句，100%");
});

test("home review and wordbook entries clear a stale revealed answer and open their own list", () => {
  const review = renderHome();
  review.find("home-review-entry").props.onClick();
  assert.deepEqual(review.changes, { review: "due", index: 0, revealed: null, tab: "review" });
  const wordbook = renderHome();
  wordbook.find("home-wordbook-entry").props.onClick();
  assert.deepEqual(wordbook.changes, { review: "wordbook", index: 0, revealed: null, tab: "review" });
  const settings = renderHome();
  settings.find("home-settings-entry").props.onClick();
  assert.deepEqual(settings.changes, { tab: "progress" });
});
