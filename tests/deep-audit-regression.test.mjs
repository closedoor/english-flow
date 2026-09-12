import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const workflow = await readFile(new URL("../.github/workflows/validate.yml", import.meta.url), "utf8");

test("a failed core word pack can retry in place before a full reload", () => {
  assert.match(page, /重试核心词库/);
  assert.match(page, /setWordDataLoadedPacks\(0\)/);
  assert.match(page, /setWordDataLoadAttempt\(\(value\) => value \+ 1\)/);
  assert.match(page, /app-loading-actions/);
  assert.match(page, /重新载入页面/);
});

test("WCAG and reduced-motion browser checks are part of the normal validation path", () => {
  assert.match(packageJson.scripts["test:browser"], /browser-accessibility\.mjs/);
  assert.match(workflow, /axe-core@4\.10\.3/);
  assert.match(workflow, /AXE_SOURCE/);
  assert.match(styles, /Deep audit: in-page core recovery and WCAG AA secondary-text contrast/);
  assert.match(styles, /prefers-reduced-motion:reduce/);
});
