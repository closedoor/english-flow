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

test("word-card rapid-tap protection is scoped to the displayed card", () => {
  assert.match(page, /const cardActionLock = useRef<number \| null>\(null\)/);
  const finishCard = sourceBetween("const finishCard =", "const moveCard =");
  assert.match(finishCard, /const cardId = current\.id/);
  assert.match(finishCard, /if \(cardActionLock\.current === cardId\) return/);
  assert.match(finishCard, /cardActionLock\.current = cardId/);
  assert.match(finishCard, /if \(cardActionLock\.current === cardId\) cardActionLock\.current = null/);
  assert.doesNotMatch(finishCard, /if \(cardActionLock\.current\) return/);
});

test("backup export rejects accidental rapid re-entry", () => {
  assert.match(page, /const backupExportStartedAtRef = useRef\(0\)/);
  const exportBackup = sourceBetween("const exportLearningBackup =", "const chooseBackupFile =");
  assert.match(exportBackup, /const startedAt = Date\.now\(\)/);
  assert.match(exportBackup, /startedAt - backupExportStartedAtRef\.current < 750/);
  assert.match(exportBackup, /backupExportStartedAtRef\.current = startedAt/);
});

test("daily-use browser scenarios stay in the normal validation command", () => {
  assert.match(packageJson.scripts["test:browser"], /browser-daily-use\.mjs/);
});
