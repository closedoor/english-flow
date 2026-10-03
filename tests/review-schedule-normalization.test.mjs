import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("page.tsx", page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const initializers = new Map();
let cleaner;
function visit(node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) initializers.set(node.name.text, node.initializer);
  if (ts.isFunctionDeclaration(node) && node.name?.text === "cleanStoredSchedule") cleaner = node.getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(cleaner, "extract the production schedule cleaner");
const queue = initializers.get("dueWords");
assert.ok(queue && ts.isCallExpression(queue), "extract the production due queue calculation");
const actions = ["releaseReviewActionLock", "lockReviewAction", "rememberReviewAction", "rateReview"];
for (const name of actions) assert.ok(initializers.has(name), `extract the production ${name} action`);
const compile = (source) => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const helpers = await import(`data:text/javascript;base64,${Buffer.from(compile(await readFile(new URL("../app/session-utils.ts", import.meta.url), "utf8"))).toString("base64")}`);
const cleanerCode = compile(`${cleaner}\ncleanStoredSchedule;`);
const actionsCode = compile(`${actions.map((name) => `const ${name} = ${initializers.get(name).getText(ast)};`).join("\n")}\n({ ${actions.join(", ")} });`);
const queueCode = compile(`(${queue.arguments[0].getText(ast)})();`);
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 3, 12);
const plain = (value) => JSON.parse(JSON.stringify(value));

function runtime(rawSchedule = {}) {
  let clock = NOW, timerId = 0;
  const timers = new Map();
  const state = { schedule: {}, mastered: [], difficult: [1], reviewIndex: 0, reviewRevealedWordId: 1, reviewUndo: null };
  const context = vm.createContext({
    ...helpers, DAY, REVIEW_AGAIN_DELAY: 600_000,
    Date: class extends Date { static now() { return clock; } },
    STUDY_WORD_IDS: new Set([1, 2, 3]), allStudyWords: [{ id: 1, word: "the" }, { id: 2, word: "of" }, { id: 3, word: "and" }],
    reviewClock: clock, ...state,
    reviewActionLock: { current: false }, reviewActionReleaseRef: { current: null },
    window: { setTimeout(callback) { timers.set(++timerId, callback); return timerId; }, clearTimeout(id) { timers.delete(id); } },
    noteStudyDay() {},
    saveSchedule(update) { state.schedule = update(state.schedule); },
    saveMastered(update) { state.mastered = update(state.mastered); },
    saveDifficult(update) { state.difficult = update(state.difficult); },
    setReviewIndex(value) { state.reviewIndex = value; },
    setReviewRevealedWordId(value) { state.reviewRevealedWordId = value; },
    setReviewUndo(value) { state.reviewUndo = value; },
  });
  const clean = vm.runInContext(cleanerCode, context);
  state.schedule = clean(rawSchedule);
  const action = vm.runInContext(actionsCode, context);
  const dueIds = () => {
    Object.assign(context, state, { reviewClock: clock });
    context.dueWords = vm.runInContext(queueCode, context);
    return Array.from(context.dueWords, (word) => word.id);
  };
  const rate = (rating) => { dueIds(); action.rateReview(rating); dueIds(); };
  return { state, clean, dueIds, rate, advance: (timestamp) => { clock = timestamp; } };
}

function permutations(entries) {
  if (!entries.length) return [[]];
  return entries.flatMap((entry, index) => permutations(entries.filter((_, other) => other !== index)).map((rest) => [entry, ...rest]));
}

test("normal schedule entries retain their dates and stages while invalid IDs and records are excluded", () => {
  const input = {
    1: { due: NOW - DAY, stage: 0 }, 2: { due: NOW + 60 * DAY, stage: 5 },
    99: { due: NOW, stage: 1 }, negative: { due: NOW, stage: 1 },
    "03": { due: -1, stage: 1 }, "003": { due: NOW, stage: 6 },
    "3.0": { due: NOW + 366 * DAY, stage: 1 }, "3e0": { due: "123", stage: 1 },
  };
  const before = JSON.stringify(input);
  const app = runtime(input);
  assert.deepEqual(plain(app.state.schedule), { 1: input[1], 2: input[2] });
  assert.equal(JSON.stringify(input), before, "normalizing storage does not mutate the supplied data");
  for (const invalid of [null, [], "invalid"]) assert.deepEqual(plain(app.clean(invalid)), {});
});

test("a valid canonical entry wins over earlier or less advanced aliases in every input order", () => {
  const canonical = { due: NOW + 14 * DAY, stage: 4 };
  const entries = [["1", canonical], ["01", { due: NOW - DAY, stage: 0 }], ["001", { due: NOW, stage: 2 }]];
  for (const order of permutations(entries)) {
    assert.deepEqual(plain(runtime(Object.fromEntries(order)).state.schedule), { 1: canonical });
  }
});

test("an invalid canonical entry cannot erase a usable legacy alias", () => {
  const rescued = { due: NOW - 60_000, stage: 3 };
  for (const invalid of [null, { due: -1, stage: 1 }, { due: NOW + 366 * DAY, stage: 1 }, { due: NOW, stage: 6 }, { due: "123", stage: 1 }]) {
    for (const order of permutations([["1", invalid], ["01", rescued]])) {
      assert.deepEqual(plain(runtime(Object.fromEntries(order)).state.schedule), { 1: rescued });
    }
  }
});

test("multiple legacy aliases preserve the earliest due date and the lower stage on equal dates independently of order", () => {
  const earliest = NOW - 60_000;
  const entries = [["01", { due: NOW + DAY, stage: 0 }], ["001", { due: earliest, stage: 5 }], ["1.0", { due: earliest, stage: 2 }]];
  for (const order of permutations(entries)) {
    const app = runtime(Object.fromEntries(order));
    assert.deepEqual(plain(app.state.schedule), { 1: { due: earliest, stage: 2 } });
    assert.deepEqual(Object.keys(app.state.schedule), ["1"], "only the scheduler's writable key survives");
    assert.deepEqual(plain(app.clean(app.state.schedule)), plain(app.state.schedule), "normalization is stable on a later reload");
  }
});

test("a recovered alias uses the previous memory stage and leaves today's queue after every production review rating", () => {
  const outcomes = {
    again: { delay: 600_000, stage: 0 }, hard: { delay: DAY, stage: 3 },
    good: { delay: 14 * DAY, stage: 4 }, easy: { delay: 30 * DAY, stage: 5 },
  };
  for (const [rating, expected] of Object.entries(outcomes)) {
    const app = runtime({ "01": { due: NOW - 60_000, stage: 3 } });
    assert.deepEqual(app.dueIds(), [1]);
    app.rate(rating);
    assert.deepEqual(plain(app.state.schedule), { 1: { due: NOW + expected.delay, stage: expected.stage } });
    assert.deepEqual(app.dueIds(), [], "an expired alias cannot keep the rated word due");
    assert.equal(Object.hasOwn(app.state.schedule, "01"), false);
    assert.equal(app.state.reviewRevealedWordId, null);
    assert.deepEqual(plain(app.state.reviewUndo.schedule), { due: NOW - 60_000, stage: 3 });
    if (rating === "good" || rating === "easy") {
      assert.deepEqual(plain(app.state.mastered), [1]);
      assert.deepEqual(plain(app.state.difficult), []);
    }
    const reopened = runtime(plain(app.state.schedule));
    assert.deepEqual(reopened.dueIds(), [], "reopening does not reintroduce the old alias");
    reopened.advance(NOW + expected.delay - 1);
    assert.deepEqual(reopened.dueIds(), []);
    reopened.advance(NOW + expected.delay);
    assert.deepEqual(reopened.dueIds(), [1], "the word returns when the new interval actually expires");
  }
});

test("a successfully reviewed legacy word advances again at its next interval without remaining repeatedly due", () => {
  const app = runtime({ "01": { due: NOW - DAY, stage: 3 } });
  app.rate("good");
  const reopened = runtime(plain(app.state.schedule));
  reopened.advance(NOW + 14 * DAY);
  assert.deepEqual(reopened.dueIds(), [1]);
  reopened.rate("good");
  assert.deepEqual(plain(reopened.state.schedule), { 1: { due: NOW + 44 * DAY, stage: 5 } });
  assert.deepEqual(reopened.dueIds(), []);
});
