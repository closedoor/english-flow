import { navigate } from './browser-navigation.mjs';
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import os from "node:os";

if (!process.env.PLAYWRIGHT_MODULE) throw new Error("Set PLAYWRIGHT_MODULE; see TESTING.md.");
const playwright = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const origin = process.env.BROWSER_TEST_URL || "http://127.0.0.1:4173";
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname)) throw new Error("Review fixtures must remain on a local test origin.");
const evidence = process.env.BROWSER_EVIDENCE_DIR || path.join(os.tmpdir(), "english-flow-evidence");
await mkdir(evidence, { recursive: true });
const keys = { mastered: "wordflow-ngsl-mastered-v1", difficult: "wordflow-ngsl-difficult-v1", schedule: "wordflow-ngsl-schedule-v1" };
const DAY = 86_400_000;
const results = [];
const records = page => page.evaluate(keys => Object.fromEntries(Object.entries(keys).map(([name, key]) => [name, JSON.parse(localStorage.getItem(key) || "null")])), keys);

for (const engine of ["chromium", "webkit"]) {
  const browser = await playwright[engine].launch({ headless: true });
  for (const view of ["due", "wordbook"]) {
    const name = `fast-${view}-undo-can-immediately-correct-and-persists`;
    const context = await browser.newContext({ viewport: { width: 390, height: 650 }, hasTouch: true, serviceWorkers: "block" });
    await context.addInitScript(keys => {
      if (!sessionStorage.getItem("review-undo-seeded")) {
        sessionStorage.setItem("review-undo-seeded", "1");
        const past = Date.now() - 60_000;
        localStorage.setItem(keys.mastered, "[3]");
        localStorage.setItem(keys.difficult, "[1,2]");
        localStorage.setItem(keys.schedule, JSON.stringify({ 1: { due: past, stage: 3 }, 2: { due: past + 1, stage: 1 }, 3: { due: past + 2, stage: 2 } }));
      }
      window.__reviewUndoClicks = [];
      document.addEventListener("click", event => {
        const text = event.target.closest("button")?.textContent || "";
        if (/忘了|撤销上次|记得|这个词已经会了/.test(text)) window.__reviewUndoClicks.push({ text, at: performance.now() });
      }, true);
    }, keys);
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    try {
      await page.goto(origin, { waitUntil: "domcontentloaded" });
      await page.locator(".bottom-nav").waitFor({ timeout: 30_000 });
      await navigate(page,'复习');
      if (view === "wordbook") await page.getByRole("button", { name: "生词本", exact: false }).click();
      await page.getByRole("button", { name: "显示答案", exact: true }).click();
      const original = await records(page);
      const firstRating = view === "due" ? page.getByRole("button", { name: "忘了 10 分钟后", exact: true }) : page.getByRole("button", { name: "这个词已经会了", exact: true });
      const correction = view === "due" ? page.getByRole("button", { name: "记得 14 天后", exact: true }) : page.getByRole("button", { name: "这个词已经会了", exact: true });
      const before = Date.now();
      await firstRating.click();
      await page.getByRole("button", { name: "撤销上次", exact: true }).click();
      await correction.click();
      const after = Date.now();
      const clicks = await page.evaluate(() => window.__reviewUndoClicks);
      assert.equal(clicks.length, 3, "Use three actual pointer clicks: rating, undo, correction");
      assert.ok(clicks[2].at - clicks[0].at < 350, `Correction must exercise the old lock window; took ${clicks[2].at - clicks[0].at} ms`);
      await page.waitForFunction(keys => JSON.parse(localStorage.getItem(keys.mastered) || "[]").includes(1) && !JSON.parse(localStorage.getItem(keys.difficult) || "[]").includes(1), keys);
      const updated = await records(page);
      assert.deepEqual([...updated.mastered].sort(), [1, 3]);
      assert.deepEqual(updated.difficult, [2]);
      assert.deepEqual(updated.schedule[2], original.schedule[2]);
      assert.deepEqual(updated.schedule[3], original.schedule[3]);
      const interval = view === "due" ? 14 * DAY : DAY;
      assert.ok(updated.schedule[1].due >= before + interval && updated.schedule[1].due <= after + interval);
      assert.equal(updated.schedule[1].stage, view === "due" ? 4 : 3);
      await page.reload();
      await page.locator(".bottom-nav").waitFor();
      assert.deepEqual(await records(page), updated, "Corrected membership and schedule survive reloading");
      assert.deepEqual(errors, [], "No uncaught browser errors");
      results.push({ engine, name, status: "PASS", correctionMilliseconds: Math.round(clicks[2].at - clicks[0].at) });
    } catch (error) {
      results.push({ engine, name, status: "FAIL", error: String(error), errors,
        clicks: await page.evaluate(() => window.__reviewUndoClicks).catch(() => []), records: await records(page).catch(() => null) });
      await page.screenshot({ path: path.join(evidence, `${engine}-${name}.png`), fullPage: true }).catch(() => {});
    } finally {
      await context.close();
    }
    console.log(JSON.stringify(results.at(-1)));
  }
  await browser.close();
}
if (results.some(result => result.status !== "PASS")) process.exitCode = 1;
