import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../app/session-utils.ts", import.meta.url), "utf8");
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const JavaScript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const session = await import(`data:text/javascript;base64,${Buffer.from(JavaScript).toString("base64")}`);

test("rotating spread sessions cover candidates that one fixed spread would starve", () => {
  const thirty = Array.from({ length: 30 }, (_, index) => index + 1);
  const groups = [0, 1, 2].map((rotation) => session.takeRotatedSpread(thirty, 10, rotation));
  assert.ok(groups.every((group) => group.length === 10 && new Set(group).size === 10));
  assert.equal(new Set(groups.flat()).size, 30);

  const twenty = Array.from({ length: 20 }, (_, index) => index + 1);
  const first = session.takeRotatedSpread(twenty, 10, 0);
  const second = session.takeRotatedSpread(twenty, 10, 1);
  assert.equal(new Set([...first, ...second]).size, 20);
  assert.match(page, /practiceRotation: "wordflow-practice-rotation-v1"/);
  assert.match(page, /writeJson\(STORAGE\.practiceRotation, practiceRotationRef\.current\)/);
});

test("completed rating maps are rejected while partial sessions remain resumable", () => {
  assert.equal(session.hasUnfinishedRatings([1, 2], { 1: "known" }), true);
  assert.equal(session.hasUnfinishedRatings([1, 2], { 1: "known", 2: "difficult" }), false);
  assert.equal(session.hasUnfinishedRatings(["p1", "p2"], { p1: "known", p2: "known" }), false);
});

test("resume chooses the newest valid in-memory or stored snapshot", () => {
  const stored = { updatedAt: 10, index: 1 };
  const memory = { updatedAt: 20, index: 2 };
  assert.equal(session.newestSnapshot(stored, memory), memory);
  assert.equal(session.newestSnapshot(memory, stored), memory);
  assert.equal(session.newestSnapshot(null, memory), memory);
  assert.equal(session.newestSnapshot(stored, null), stored);
});

test("mastering a word never rolls back a mature review schedule", () => {
  const day = 86_400_000;
  const now = 1_000_000;
  assert.deepEqual(session.scheduleMasteredWord(undefined, now, day), { due: now + day, stage: 1 });
  assert.deepEqual(session.scheduleMasteredWord({ due: now, stage: 0 }, now, day), { due: now + day, stage: 1 });
  assert.deepEqual(session.scheduleMasteredWord({ due: now + 60 * day, stage: 5 }, now, day), { due: now + 60 * day, stage: 5 });
  assert.deepEqual(session.scheduleMasteredWord({ due: now - day, stage: 5 }, now, day), { due: now + day, stage: 5 });
});

test("hard reviews delay a word without inflating its memory stage", () => {
  assert.equal(session.nextReviewStage(0, "again"), 0);
  assert.equal(session.nextReviewStage(0, "hard"), 0);
  assert.equal(session.nextReviewStage(3, "hard"), 3);
  assert.equal(session.nextReviewStage(3, "good"), 4);
  assert.equal(session.nextReviewStage(3, "easy"), 5);
  assert.equal(session.nextReviewStage(5, "easy"), 5);
});

test("quiz normalization preserves meaningful apostrophes", () => {
  assert.equal(session.normalizeQuizAnswer(" We’ll! "), "we'll");
  assert.equal(session.normalizeQuizAnswer("we'll"), "we'll");
  assert.notEqual(session.normalizeQuizAnswer("well"), session.normalizeQuizAnswer("we'll"));
  assert.notEqual(session.normalizeQuizAnswer("ill"), session.normalizeQuizAnswer("I'll"));
});

test("phone keyboard punctuation and adjacent whitespace do not make correct answers wrong", () => {
  for (const value of ["word .", " word ! ", "word。", "ｗｏｒｄ　。", "word . !  "]) {
    assert.equal(session.normalizeQuizAnswer(value), "word", value);
  }
  assert.equal(session.normalizeQuizAnswer(" ＴＲＹ　ＯＮ 。 "), "try on");
  assert.equal(session.normalizeQuizAnswer(" We’ll 。 "), "we'll");
  assert.notEqual(session.normalizeQuizAnswer("check-in 。"), session.normalizeQuizAnswer("check in"));
  assert.notEqual(session.normalizeQuizAnswer("some.thing"), session.normalizeQuizAnswer("something"));
});

test("listening prompts hide every whole target occurrence", () => {
  assert.equal(session.blankAnswerInSentence("Do what you can do.", "do"), "______ what you can ______.");
  assert.equal(session.blankAnswerInSentence("I can redo it.", "do"), null);
  assert.equal(session.blankAnswerInSentence("Can I try on this coat?", "try on"), "Can I ______ this coat?");
});
