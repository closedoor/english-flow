import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

test("reading completion and most-recent article are validated and persisted locally", () => {
  assert.match(page, /readingCompleted: "wordflow-reading-completed-v1"/);
  assert.match(page, /readingLast: "wordflow-reading-last-v1"/);
  assert.match(page, /function cleanReadingIds/);
  assert.match(page, /function cleanReadingLast/);
  assert.match(page, /writeJson\(STORAGE\.readingCompleted, readingCompleted\)/);
  assert.match(page, /writeJson\(STORAGE\.readingLast, readingLast\)/);
  assert.match(page, /setReadingLast\(\{ id: reading\.id, updatedAt: Date\.now\(\) \}\)/);
});

test("reading UI exposes completion, recent reading and aggregate progress", () => {
  assert.match(page, /阅读完成度/);
  assert.match(page, /继续上次阅读/);
  assert.match(page, /标记本篇已读/);
  assert.match(page, /本篇已完成 · 点击取消/);
  assert.match(page, /分级阅读/);
  assert.match(page, /readingCompleted\.length\}\/\{READING_TOTAL\} 篇已读/);
  assert.match(styles, /\.reading-overview\{/);
  assert.match(styles, /\.reading-resume\{/);
  assert.match(styles, /\.reading-complete-action\{/);
  assert.match(styles, /\.reading-progress-panel\{/);
});

test("reading records participate in backup, restore and a full progress reset", () => {
  assert.match(page, /BACKUP_OPTIONAL_KEYS[^\n]*STORAGE\.readingCompleted, STORAGE\.readingLast/);
  const reset = page.split("const resetLearningProgress", 2)[1].split("const addDifficult", 1)[0];
  assert.match(reset, /STORAGE\.readingCompleted/);
  assert.match(reset, /STORAGE\.readingLast/);
  assert.match(reset, /setReadingCompleted\(\[\]\)/);
  assert.match(reset, /setReadingLast\(null\)/);
  assert.match(page, /和 \{backupItemCount\(pendingBackup, STORAGE\.readingCompleted\)\} 篇已读文章/);
});
