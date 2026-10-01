import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("page.tsx", page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ["markMastered", "releaseReviewActionLock", "lockReviewAction", "rememberReviewAction", "undoReviewAction", "rateReview", "markWordbookMastered"];
const declarations = new Map();
function visit(node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && names.includes(node.name.text)) declarations.set(node.name.text, node.getText(ast));
  ts.forEachChild(node, visit);
}
visit(ast);
for (const name of names) assert.ok(declarations.has(name), `Actual ${name} handler exists`);
const compile = source => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const handlerCode = compile(`${names.map(name => `const ${declarations.get(name)};`).join("\n")}\n({ ${names.join(", ")} });`);
const helpers = await import(`data:text/javascript;base64,${Buffer.from(compile(await readFile(new URL("../app/session-utils.ts", import.meta.url), "utf8"))).toString("base64")}`);
const plain = value => JSON.parse(JSON.stringify(value));
const DAY = 86_400_000;
const words = ["one", "two", "three"].map((word, index) => ({ id: index + 1, word }));

function review({ scheduled = true } = {}) {
  let now = 1_000_000;
  let nextTimer = 0;
  let studied = 0;
  const timers = new Map();
  const cleared = [];
  const original = { due: now - 60_000, stage: 3 };
  const state = {
    mastered: [3], difficult: [1, 2],
    schedule: { ...(scheduled ? { 1: original } : {}), 2: { due: now - 30_000, stage: 1 } },
    reviewIndex: 0, reviewRevealedWordId: 1, reviewUndo: null,
  };
  const lock = { current: false };
  const release = { current: null };
  const render = () => vm.runInNewContext(handlerCode, {
    ...helpers, ...state, DAY, REVIEW_AGAIN_DELAY: 600_000,
    Date: { now: () => now }, reviewActionLock: lock, reviewActionReleaseRef: release,
    dueWords: words.filter(word => state.schedule[word.id]?.due <= now || (state.difficult.includes(word.id) && !state.schedule[word.id])),
    wordbookWords: words.filter(word => state.difficult.includes(word.id)),
    window: {
      setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, due: now + delay }); return id; },
      clearTimeout(id) { cleared.push(id); timers.delete(id); },
    },
    noteStudyDay() { studied += 1; },
    saveMastered(update) { state.mastered = update(state.mastered); },
    saveDifficult(update) { state.difficult = update(state.difficult); },
    saveSchedule(update) { state.schedule = update(state.schedule); },
    setReviewIndex(value) { state.reviewIndex = value; },
    setReviewRevealedWordId(value) { state.reviewRevealedWordId = value; },
    setReviewUndo(value) { state.reviewUndo = value; },
  });
  function advance(milliseconds) {
    now += milliseconds;
    for (const [id, timer] of [...timers].sort((left, right) => left[1].due - right[1].due)) {
      if (timer.due > now || !timers.has(id)) continue;
      timers.delete(id);
      timer.callback();
    }
  }
  return { state, original, lock, release, timers, cleared, render, advance, now: () => now, studied: () => studied };
}

test("undo allows an immediate corrected rating and preserves unrelated records", () => {
  const app = review();
  const unrelated = plain(app.state.schedule[2]);
  app.render().rateReview("again");
  app.advance(80);
  app.render().undoReviewAction();
  app.render().rateReview("good");
  assert.equal(app.state.schedule[1].due, app.now() + 14 * DAY);
  assert.equal(app.state.schedule[1].stage, 4);
  assert.ok(app.state.mastered.includes(1));
  assert.ok(!app.state.difficult.includes(1));
  assert.equal(app.state.reviewUndo.id, 1);
  assert.match(app.state.reviewUndo.label, /记得/);
  assert.deepEqual(plain(app.state.schedule[2]), unrelated);
  assert.ok(app.state.mastered.includes(3));
});

test("undoing a wordbook removal allows immediate removal again without inventing an earlier schedule", () => {
  const app = review({ scheduled: false });
  app.render().markWordbookMastered(1);
  app.advance(80);
  app.render().undoReviewAction();
  assert.equal(app.state.schedule[1], undefined);
  assert.equal(app.state.reviewRevealedWordId, 1);
  app.render().markWordbookMastered(1);
  assert.ok(app.state.mastered.includes(1));
  assert.ok(!app.state.difficult.includes(1));
  assert.equal(app.state.schedule[1].due, app.now() + DAY);
  assert.equal(app.state.schedule[1].stage, 1);
  assert.match(app.state.reviewUndo.label, /移出生词本/);
});

test("the cancelled old timeout cannot release the corrected action's newer lock", () => {
  const app = review();
  app.render().rateReview("again");
  const firstTimer = app.release.current;
  app.advance(100);
  app.render().undoReviewAction();
  app.render().rateReview("good");
  const correctedTimer = app.release.current;
  assert.ok(app.cleared.includes(firstTimer));
  assert.notEqual(correctedTimer, firstTimer);
  assert.equal(app.timers.size, 1);
  app.state.reviewRevealedWordId = 2;
  const before = plain(app.state.schedule[2]);
  app.advance(250);
  app.render().rateReview("easy");
  assert.deepEqual(plain(app.state.schedule[2]), before, "The old 350 ms deadline must not unlock a newer action");
  assert.equal(app.lock.current, true);
  app.advance(100);
  app.render().rateReview("easy");
  assert.equal(app.state.schedule[2].due, app.now() + 7 * DAY);
  assert.equal(app.state.schedule[2].stage, 3);
});

test("repeated rating clicks still apply only once until the debounce ends", () => {
  const app = review();
  const handlers = app.render();
  handlers.rateReview("again");
  const recorded = plain(app.state);
  handlers.rateReview("good");
  assert.deepEqual(plain(app.state), recorded);
  assert.equal(app.studied(), 1);
  assert.equal(app.timers.size, 1);
});

test("a no-op undo cannot bypass the repeated-action guard", () => {
  const app = review();
  const handlers = app.render();
  handlers.rateReview("again");
  handlers.undoReviewAction();
  assert.equal(app.lock.current, true);
  assert.equal(app.timers.size, 1);
});
