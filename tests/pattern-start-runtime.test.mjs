import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const region = page.slice(page.indexOf("  const startPatternSession ="), page.indexOf("  const resumePatternSession ="));
const javascript = ts.transpileModule(`${region}\nstartPatternSession;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const base = {
  version: 1, updatedAt: 100, category: "daily", patternIds: ["p01", "p02", "p03"],
  index: 0, drillIndex: 0, ratings: {},
};

function invoke({ snapshot = base, memory = snapshot, category = "daily", args = [] } = {}) {
  const calls = [];
  const before = JSON.stringify({ snapshot, memory });
  const start = vm.runInNewContext(javascript, {
    patternStage: "setup", patternSessionIds: memory?.patternIds ?? snapshot?.patternIds ?? [],
    patternCategory: category, patternResumeSnapshotRef: { current: memory },
    STORAGE: { patternActiveSession: "saved" }, readJson: () => snapshot,
    cleanPatternSession: value => value,
    newestSnapshot: (stored, current) => !stored ? current : !current ? stored : current.updatedAt >= stored.updatedAt ? current : stored,
    resumePatternSession() { calls.push("resume"); },
    beginPatternSession(reviewOnly) { calls.push({ start: Boolean(reviewOnly) }); },
    setDiscardRequest(value) { calls.push({ confirm: value }); },
  });
  start(...args);
  assert.equal(JSON.stringify({ snapshot, memory }), before, "dispatch cannot alter stored or in-memory progress");
  return JSON.parse(JSON.stringify(calls));
}

test("starting the same pattern practice resumes an untouched first substitution without a discard dialog", () => {
  assert.deepEqual(invoke(), ["resume"]);
});

test("starting the same scene resumes substitution position, later patterns and completed ratings", () => {
  for (const patch of [{ drillIndex: 1 }, { drillIndex: 2 }, { index: 1 }, { ratings: { p01: "known" } }]) {
    assert.deepEqual(invoke({ snapshot: { ...base, ...patch } }), ["resume"]);
  }
});

test("changing scene can replace only an untouched first substitution silently", () => {
  assert.deepEqual(invoke({ category: "travel" }), [{ start: false }]);
  for (const patch of [{ drillIndex: 1 }, { index: 1 }, { ratings: { p01: "difficult" } }]) {
    assert.deepEqual(invoke({ category: "travel", snapshot: { ...base, ...patch } }), [
      { confirm: { pattern: true, patternStart: { reviewOnly: false } } },
    ]);
  }
});

test("an explicit new group remains distinguishable from same-scene continuation", () => {
  assert.deepEqual(invoke({ args: [false, true] }), [{ start: false }]);
  assert.deepEqual(invoke({ args: [false, true], snapshot: { ...base, drillIndex: 1 } }), [
    { confirm: { pattern: true, patternStart: { reviewOnly: false } } },
  ]);
});

test("reinforcement cannot silently replace a partly completed pattern practice", () => {
  assert.deepEqual(invoke({ args: [true] }), [{ start: true }]);
  assert.deepEqual(invoke({ args: [true], snapshot: { ...base, ratings: { p01: "known" } } }), [
    { confirm: { pattern: true, patternStart: { reviewOnly: true } } },
  ]);
});

test("starting with no saved practice does not invent a resume target or confirmation", () => {
  assert.deepEqual(invoke({ snapshot: null }), [{ start: false }]);
});

test("the newer stored or in-memory pattern snapshot controls continuation and replacement protection", () => {
  const newer = { ...base, category: "travel", updatedAt: 200, drillIndex: 2 };
  assert.deepEqual(invoke({ snapshot: newer, memory: base, category: "travel" }), ["resume"]);
  assert.deepEqual(invoke({ snapshot: base, memory: newer, category: "travel" }), ["resume"]);
  assert.deepEqual(invoke({ snapshot: newer, memory: base }), [
    { confirm: { pattern: true, patternStart: { reviewOnly: false } } },
  ]);
});
