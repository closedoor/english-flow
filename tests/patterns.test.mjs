import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const data = await readFile(new URL("../app/pattern-data.ts", import.meta.url), "utf8");
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

test("core pattern library contains 30 unique patterns and 90 substitution drills", () => {
  const ids = [...data.matchAll(/id: "(p\d+)"/g)].map((match) => match[1]);
  const prompts = [...data.matchAll(/prompt: "([^"]+)"/g)].map((match) => match[1]);
  const answers = [...data.matchAll(/answer: "([^"]+)"/g)].map((match) => match[1]);
  const slots = [...data.matchAll(/slot: "([^"]+)"/g)].map((match) => match[1]);
  assert.equal(ids.length, 30);
  assert.equal(new Set(ids).size, 30);
  assert.equal(prompts.length, 90);
  assert.equal(answers.length, 90);
  assert.equal(slots.length, 90);
  assert.equal(new Set(answers).size, 90);
  assert.ok(prompts.every((prompt) => /[。？]$/.test(prompt)));
  assert.ok(answers.every((answer) => /[.?]$/.test(answer)));
});

test("every core pattern has a replaceable template and three drills", () => {
  const blocks = data.split(/\n  \{ id: "p\d+"/).slice(1);
  assert.equal(blocks.length, 30);
  for (const block of blocks) {
    assert.match(block, /template: "[^"]*___[^"]*"/);
    assert.equal([...block.matchAll(/prompt: "/g)].length, 3);
    assert.equal([...block.matchAll(/answer: "/g)].length, 3);
    assert.equal([...block.matchAll(/slot: "/g)].length, 3);
  }
});

test("every displayed pattern produces its reference answers without changing the blank", () => {
  const blocks = data.split(/\n  \{ id: "p\d+"/).slice(1);
  for (const block of blocks) {
    const template = block.match(/template: "([^"]+)"/)?.[1];
    const answers = [...block.matchAll(/answer: "([^"]+)"/g)].map((match) => match[1]);
    const slots = [...block.matchAll(/slot: "([^"]+)"/g)].map((match) => match[1]);
    slots.forEach((slot, index) => {
      const substituted = template.replace("___", slot);
      const expected = /[.?]$/.test(substituted) ? substituted : `${substituted}.`;
      assert.equal(expected, answers[index]);
    });
  }
});

test("pattern substitution practice reveals answers, rates progress and resumes locally", () => {
  assert.match(page, /核心句型替换/);
  assert.match(page, /替换练习 \{patternDrillIndex \+ 1\} \/ 3/);
  assert.match(page, /我说好了，查看参考答案/);
  assert.match(page, /finishPattern/);
  assert.match(page, /setPatternMastered/);
  assert.match(page, /setPatternDifficult/);
  assert.match(page, /\[unseen, needsWork, learned\]\.reduce/);
  assert.match(page, /takeRotatedSpread\(group, 10 - items\.length, selectionRotation \+ groupIndex\)/);
  assert.match(page, /wordflow-pattern-mastered-v1/);
  assert.match(page, /wordflow-pattern-difficult-v1/);
  assert.match(page, /wordflow-pattern-active-session-v1/);
  assert.match(page, /cleanPatternSession/);
  assert.match(page, /已保留在待加强练习中/);
  assert.match(page, /返回句型设置并保留进度/);
  assert.match(page, /resumePatternSession/);
  assert.match(page, /未完成的句型替换/);
  assert.match(page, /patternResumeSnapshotRef/);
  assert.match(page, /newestSnapshot\(cleanPatternSession\(readJson<unknown>\(STORAGE\.patternActiveSession, null\)\), patternResumeSnapshotRef\.current\)/);
});

test("pattern summary cards fill their three-column grid", () => {
  assert.match(styles, /\.pattern-summary>div\{width:auto\}/);
});
