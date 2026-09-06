import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const extract = (start, end) => {
  const from = page.indexOf(start);
  const to = page.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `source exists: ${start}`);
  return page.slice(from, to);
};
const compile = (source) => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const dateHelpers = extract("function localDateKey", "function blankSentence");
const hydrateDays = compile(`${dateHelpers}\n${extract("const storedDays =", "const storedMastered =")}\nvalidDays;`);
const displayDays = compile([
  dateHelpers,
  page.match(/const visibleStudyDays =[^\n]+/)?.[0] ?? "",
  extract("const streak =", "const dueWords ="),
  `({ count: ${page.match(/<b>\{([^{}]+)\}<\/b><small>学习天数/)?.[1]}, weekly: weeklyStudyCount, streak,
      calendar: weekKeys.map(key => ${page.match(/const done = (Boolean\(key && [^)]+\)\))/)?.[1]}) });`,
].join("\n"));

function cleanDays(stored, currentKey) {
  return [...vm.runInNewContext(hydrateDays, { currentKey, STORAGE: { days: "days" }, readJson: () => stored })];
}

function stats(studyDays, todayKey) {
  return JSON.parse(JSON.stringify(vm.runInNewContext(displayDays, {
    studyDays, todayKey, useMemo: (calculate) => calculate(),
    weekKeys: ["2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05", "2026-09-06"],
  })));
}

test("a westward timezone change preserves the recorded next day without counting it early", () => {
  const original = ["2026-09-03", "2026-09-04", "2026-09-05"];
  const afterTravel = cleanDays(original, "2026-09-04");
  assert.deepEqual(afterTravel, original, "hydration must not erase a real date because the local clock moved back");
  assert.deepEqual(stats(afterTravel, "2026-09-04"), {
    count: 2, weekly: 2, streak: 2, calendar: [false, false, false, true, true, false, false],
  });
  const afterMidnight = cleanDays(afterTravel, "2026-09-05");
  assert.deepEqual(stats(afterMidnight, "2026-09-05"), {
    count: 3, weekly: 3, streak: 3, calendar: [false, false, false, true, true, true, false],
  });
});

test("stored dates still reject impossible days and duplicates while preserving valid leap days", () => {
  assert.deepEqual(cleanDays([
    "2024-02-29", "2024-02-29", "2026-02-29", "2026-02-30", "2026-13-01",
    "2026-00-10", "2026-9-5", "invalid", null, 20260905, "2026-09-05",
  ], "2026-09-04"), ["2024-02-29", "2026-09-05"]);
});

test("streaks remain continuous over year and leap-day boundaries", () => {
  const streakFor = (studyDays, todayKey) => vm.runInNewContext(compile(`${dateHelpers}\ncalculateStreak(studyDays, todayKey);`), { studyDays, todayKey });
  assert.equal(streakFor(["2025-12-30", "2025-12-31", "2026-01-01"], "2026-01-01"), 3);
  assert.equal(streakFor(["2024-02-28", "2024-02-29", "2024-03-01"], "2024-03-02"), 3);
});

const readingHandler = compile([
  dateHelpers,
  extract("const noteStudyDay =", "const openReading ="),
  extract("const toggleReadingCompleted =", "const retryReadingQuestion ="),
  "toggleReadingCompleted({ id: 'r1' });",
].join("\n"));

function markReading(completed, days = []) {
  const result = { completed: [...completed], days: [...days] };
  vm.runInNewContext(readingHandler, {
    readingCompleted: completed,
    Date: class extends Date { constructor(...args) { super(...(args.length ? args : ["2026-09-05T12:00:00"])); } },
    setReadingCompleted: (update) => { result.completed = [...update(result.completed)]; },
    setReadingLast() {},
    setStudyDays: (update) => { result.days = [...update(result.days)]; },
  });
  return result;
}

test("adding a reading completion records study, but undoing an old mark does not", () => {
  assert.deepEqual(markReading([]), { completed: ["r1"], days: ["2026-09-05"] });
  assert.deepEqual(markReading(["r1"]), { completed: [], days: [] });
  assert.deepEqual(markReading([], ["2026-09-05"]), { completed: ["r1"], days: ["2026-09-05"] });
});

const mastery = compile(`${extract("const masteredNgslCount =", "const streak =")}\nprogress;`);
function percent(count) {
  return vm.runInNewContext(mastery, {
    mastered: Array.from({ length: count }, (_, index) => index + 1),
    words: { length: 2809 }, ngslMeta: { count: 2809 },
    studyDays: [], todayKey: "2026-09-05", useMemo: (calculate) => calculate(),
  });
}

test("mastery reaches 100 percent only after the final NGSL word", () => {
  assert.equal(percent(0), 0);
  assert.equal(percent(1), 0.04);
  for (const count of [2794, 2795, 2808]) assert.ok(percent(count) < 100, `${count}/2809 is unfinished`);
  assert.ok(percent(2794) <= percent(2795));
  assert.ok(percent(2795) <= percent(2808));
  assert.equal(percent(2809), 100);
});

test("home speaking shortcut resumes the interrupted sentence and returning to setup preserves chosen settings", () => {
  assert.match(page, /className="quick-practice-grid"><button onClick=\{openSentencePracticeFromHome\}/);
  const code = compile(`${extract("const restoreSentenceSetupPreferences =", "const confirmDiscardSession =")}\n${extract("const resumeSentenceSession =", "const finishSentenceCard =")}\n${extract("const openSentencePracticeFromHome =", "const openPatternPracticeFromHome =")}\n({ openSentencePracticeFromHome, restoreSentenceSetupPreferences });`);
  const state = { band: "short", category: "all", count: 10, mode: "bilingual", stage: "cards" };
  const saved = { band: "long", category: "travel", count: 20, mode: "bilingual" };
  const snapshot = { band: "short", category: "daily", count: 10, mode: "bilingual", sentenceIds: [1, 2, 3], index: 1, ratings: { 1: "known" } };
  const resume = { current: snapshot };
  const actions = vm.runInNewContext(code, {
    hasUnfinishedSentence: true, STORAGE: { sentenceActiveSession: "session" },
    readJson: () => snapshot, cleanSentenceSession: (value) => value, newestSnapshot: (stored) => stored,
    sentenceSetupPreferencesRef: { current: saved }, sentenceResumeSnapshotRef: resume,
    sentenceSessionIds: snapshot.sentenceIds,
    setSentenceBand: (value) => { state.band = value; },
    setSentenceCategory: (value) => { state.category = value; },
    setSentenceCount: (value) => { state.count = value; },
    setSentenceMode: (value) => { state.mode = value; },
    setSentenceStage: (value) => { state.stage = value; },
    setSentenceSessionIds: (value) => { state.ids = value; },
    setSentenceIndex: (value) => { state.index = value; },
    setSentenceRatings: (value) => { state.ratings = value; },
    setSentenceTranslationOpen() {},
    setSentenceSection: (value) => { state.section = value; },
    setTab: (value) => { state.tab = value; },
  });
  actions.openSentencePracticeFromHome();
  assert.deepEqual(state, { band: "short", category: "daily", count: 10, mode: "bilingual", stage: "cards", ids: snapshot.sentenceIds, index: 1, ratings: snapshot.ratings, section: "library", tab: "sentences" });
  actions.restoreSentenceSetupPreferences();
  assert.deepEqual(state, { ...saved, stage: "setup", ids: snapshot.sentenceIds, index: 1, ratings: snapshot.ratings, section: "library", tab: "sentences" });
  assert.equal(resume.current, snapshot);
  assert.deepEqual(snapshot.sentenceIds, [1, 2, 3]);
});

test("returning from an older pattern session keeps the newly selected setup category", () => {
  const state = { category: "daily", stage: "setup" };
  const snapshot = { version: 1, category: "daily", patternIds: ["p01", "p04"], index: 1, drillIndex: 2, ratings: { p01: "known" } };
  const resume = { current: snapshot };
  const ctx = {
    patternSetupCategoryRef: { current: "daily" }, patternResumeSnapshotRef: resume,
    STORAGE: { patternActiveSession: "session" }, readJson: () => snapshot,
    cleanPatternSession: (value) => value, newestSnapshot: (stored) => stored,
    setPatternCategory: (value) => { state.category = value; },
    setPatternStage: (value) => { state.stage = value; },
    setPatternSessionIds: (value) => { state.ids = value; },
    setPatternIndex: (value) => { state.index = value; },
    setPatternDrillIndex: (value) => { state.drill = value; },
    setPatternRatings: (value) => { state.ratings = value; },
    setPatternAnswerOpen() {}, setSentenceSection() {}, setTab() {},
  };
  const code = compile(`${extract("const restorePatternSetupPreferences =", "const confirmDiscardSession =")}\n${extract("const resumePatternSession =", "const movePatternDrill =")}\nselectPatternCategory('work'); resumePatternSession(); restorePatternSetupPreferences();`);
  vm.runInNewContext(code, ctx);
  assert.equal(state.category, "work");
  assert.equal(state.stage, "setup");
  assert.equal(state.index, 1);
  assert.equal(state.drill, 2);
  assert.deepEqual(state.ratings, { p01: "known" });
  assert.equal(resume.current, snapshot);
  assert.match(page, /onClick=\{restorePatternSetupPreferences\} aria-label="返回句型设置并保留进度"/);
  assert.match(page, /onClick=\{openPatternPracticeFromHome\}/);
  assert.match(extract("const openPatternPracticeFromHome =", "const renderSentenceSetup ="), /setSentenceSection\("patterns"\);\s+restorePatternSetupPreferences\(\);/);
});
