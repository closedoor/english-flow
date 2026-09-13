import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

function sourceBetween(startMarker, endMarker) {
  const start = page.indexOf(startMarker);
  const end = page.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return page.slice(start, end);
}

test("session start actions reject synchronous duplicate taps", () => {
  for (const [functionName, refName] of [["startSession", "wordStartLock"], ["beginSentenceSession", "sentenceStartLock"], ["beginPatternSession", "patternStartLock"]]) {
    const source = sourceBetween(`const ${functionName} =`, functionName === "startSession" ? "const startSingleWord =" : functionName === "beginSentenceSession" ? "const startSentenceSession =" : "const startPatternSession =");
    assert.ok(source.includes(`if (${refName}.current) return;`));
    assert.ok(source.includes(`${refName}.current = true;`));
    assert.ok(source.includes(`${refName}.current = false;`));
  }
});

test("sentence and pattern rating guards follow the displayed item", () => {
  const sentence = sourceBetween("const finishSentenceCard =", "const moveSentence =");
  assert.match(sentence, /const sentenceId = currentSentence\.id/);
  assert.match(sentence, /sentenceActionLock\.current === sentenceId/);
  assert.doesNotMatch(sentence, /if \(!currentSentence \|\| sentenceActionLock\.current\) return/);

  const pattern = sourceBetween("const finishPattern =", "const retryDifficultPatterns =");
  assert.match(pattern, /const patternId = currentPattern\.id/);
  assert.match(pattern, /patternActionLock\.current === patternId/);
  assert.doesNotMatch(pattern, /if \(!currentPattern \|\| patternActionLock\.current\) return/);
});

test("reading completion and sentence favorites are idempotent during a double tap", () => {
  const reading = sourceBetween("const toggleReadingCompleted =", "const retryReadingQuestion =");
  assert.match(reading, /readingCompletionLock\.current === readingId/);
  assert.match(reading, /current\.includes\(readingId\) \? current : \[\.\.\.current, readingId\]/);

  const favorite = sourceBetween("const toggleSentenceSaved =", "const retryReadingQuestion =");
  assert.match(favorite, /sentenceSaveLock\.current === sentenceId/);
  assert.match(favorite, /items\.includes\(sentenceId\) \? items : \[\.\.\.items, sentenceId\]/);
  assert.match(page, /onClick=\{\(\) => toggleSentenceSaved\(currentSentence\.id\)\}/);
});

test("rapid-action browser scenarios stay in the normal validation command", () => {
  assert.match(packageJson.scripts["test:browser"], /browser-rapid-actions\.mjs/);
});
