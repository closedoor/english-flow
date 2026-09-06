import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dataSource = await readFile(new URL("../app/data.ts", import.meta.url), "utf8");
const readingSource = await readFile(new URL("../app/reading-data.ts", import.meta.url), "utf8");
const ngslSource = await readFile(new URL("../app/ngsl-data.ts", import.meta.url), "utf8");
const officialWords = new Set([...ngslSource.matchAll(/"word":"([^"]+)"/g)].map((match) => match[1]));
const curatedSection = dataSource.split("const curatedWords", 2)[1].split("];", 1)[0];
const curatedWords = new Set([...curatedSection.matchAll(/word: "([^"]+)"/g)].map((match) => match[1]));

test("graded reading has five texts at each level", () => {
  const levels = [...readingSource.matchAll(/\{ id: "r\d+", level: (\d)/g)].map((match) => Number(match[1]));
  assert.equal(levels.length, 15);
  assert.deepEqual([1, 2, 3].map((level) => levels.filter((item) => item === level).length), [5, 5, 5]);
});

test("graded reading contains complete texts at the promised lengths", () => {
  const ranges = { 1: [60, 90], 2: [120, 180], 3: [220, 300] };
  const items = [...readingSource.matchAll(/\{ id: "(r\d+)", level: (\d)[\s\S]*?text: "([^"]+)"/g)];
  assert.equal(items.length, 15);
  for (const [, id, rawLevel, text] of items) {
    const level = Number(rawLevel);
    const wordCount = text.replaceAll("\\n", " ").trim().split(/\s+/).length;
    const [minimum, maximum] = ranges[level];
    assert.ok(wordCount >= minimum && wordCount <= maximum, `${id} has ${wordCount} words; expected ${minimum}–${maximum}`);
    if (level > 1) assert.ok(text.includes("\\n\\n"), `${id} should have multiple paragraphs`);
  }
});

test("every reading focus can be saved as a study word", () => {
  const readingSection = readingSource.split("export const readings", 2)[1];
  const focusWords = [...readingSection.matchAll(/focus: \[([^\]]+)\]/g)]
    .flatMap((match) => [...match[1].matchAll(/"([^"]+)"/g)].map((wordMatch) => wordMatch[1]));
  for (const word of focusWords) {
    assert.ok(officialWords.has(word) || curatedWords.has(word), `missing reading focus: ${word}`);
  }
});

test("every reading focus word appears in its article", () => {
  const items = [...readingSource.matchAll(/\{ id: "(r\d+)"[\s\S]*?text: "([^"]+)"[\s\S]*?focus: \[([^\]]+)\]/g)];
  assert.equal(items.length, 15);
  for (const [, id, text, rawFocus] of items) {
    const focusWords = [...rawFocus.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
    for (const word of focusWords) assert.ok(text.toLowerCase().includes(word.toLowerCase()), `${id} does not contain focus word ${word}`);
  }
});

test("graded readings use natural everyday phrasing", () => {
  assert.match(readingSource, /delayed by ninety minutes/);
  assert.match(readingSource, /take Bus 2/);
  assert.match(readingSource, /a water leak has closed/);
  assert.match(readingSource, /needs them before the race/);
  assert.doesNotMatch(readingSource, /delayed for ninety minutes|In careful English|take the second bus|race deadline/);
});
