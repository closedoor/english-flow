import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

if (!process.env.PLAYWRIGHT_MODULE) throw new Error("PLAYWRIGHT_MODULE is required");
const playwright = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const origin = process.env.BROWSER_TEST_URL || "http://127.0.0.1:4173";
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname)) throw new Error("Daily-use audit must run against a local build");

const results = [];
const WORD_SESSION_KEY = "wordflow-active-session-v1";

async function runCheck(engine, name, body, options = {}) {
  const browser = await playwright[engine].launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    hasTouch: true,
    acceptDownloads: true,
    serviceWorkers: options.serviceWorkers || "block",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  try {
    await body(page, context);
    assert.deepEqual(pageErrors, [], "Uncaught page errors");
    assert.deepEqual(consoleErrors.filter((item) => !item.includes("Failed to load resource")), [], "Unexpected console errors");
    results.push({ engine, name, status: "PASS" });
  } catch (error) {
    results.push({
      engine,
      name,
      status: "FAIL",
      error: String(error),
      pageErrors,
      consoleErrors,
      body: (await page.locator("body").innerText().catch(() => "")).slice(0, 3500),
    });
  } finally {
    await context.close();
    await browser.close();
  }
  console.log(JSON.stringify(results.at(-1)));
}

async function ready(page) {
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await page.locator(".bottom-nav, .quiz-page, .app-loading").first().waitFor({ timeout: 30_000 });
  await page.locator(".bottom-nav").waitFor({ timeout: 30_000 });
}

async function nav(page, label) {
  await page.locator(".bottom-nav button").filter({ hasText: label }).click();
  await page.locator(".page").first().waitFor();
}

for (const engine of ["chromium", "webkit"]) {
  await runCheck(engine, "reconnect-recovers-a-failed-core-pack-without-user-reload", async (page, context) => {
    let failPack = true;
    await context.route(/ngsl-words-3\.json/, async (route) => {
      if (failPack) await route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
      else await route.continue();
    });
    await page.goto(origin, { waitUntil: "domcontentloaded" });
    await page.getByText("核心词库暂时没有加载成功", { exact: true }).waitFor({ timeout: 30_000 });
    failPack = false;
    await context.setOffline(true);
    await page.getByText("当前处于离线状态，联网后会自动继续载入。", { exact: true }).waitFor();
    await context.setOffline(false);
    await page.locator(".bottom-nav").waitFor({ timeout: 20_000 });
  });

  await runCheck(engine, "a-just-rated-word-survives-an-immediate-reload", async (page) => {
    await ready(page);
    await nav(page, "学习");
    await page.getByRole("button", { name: "自由学习", exact: false }).click();
    await page.getByRole("button", { name: "开始这组学习", exact: true }).click();
    await page.locator(".word-heading h2").waitFor();
    const navigation = page.waitForNavigation({ waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      const button = document.querySelector(".learn-actions .secondary-action");
      if (!(button instanceof HTMLButtonElement)) throw new Error("Missing difficult-word action");
      button.click();
      setTimeout(() => window.location.reload(), 0);
    });
    await navigation;
    await page.locator(".word-heading h2, .bottom-nav").first().waitFor({ timeout: 30_000 });
    const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || "null"), WORD_SESSION_KEY);
    assert.ok(saved, "The active learning session disappeared after an immediate reload");
    assert.equal(Object.keys(saved.ratings || {}).length, 1, "The most recent rating was not persisted before reload");
  });

  await runCheck(engine, "double-tapping-backup-export-creates-one-consistent-file", async (page) => {
    await ready(page);
    await nav(page, "进度");
    const downloads = [];
    page.on("download", (download) => downloads.push(download));
    await page.getByRole("button", { name: "导出备份", exact: true }).evaluate((button) => {
      button.click();
      button.click();
    });
    await page.waitForTimeout(1000);
    assert.equal(downloads.length, 1, `Expected one backup download, received ${downloads.length}`);
  });

  await runCheck(engine, "a-complete-ten-word-session-remains-consistent", async (page) => {
    await ready(page);
    await nav(page, "学习");
    await page.getByRole("button", { name: "自由学习", exact: false }).click();
    await page.getByRole("button", { name: "开始这组学习", exact: true }).click();
    for (let completed = 1; completed <= 10; completed += 1) {
      await page.locator(".word-heading h2").waitFor();
      await page.locator(".learn-actions .primary-action").click();
      if (completed < 10) {
        await page.waitForFunction(({ key, completed }) => {
          const value = JSON.parse(localStorage.getItem(key) || "null");
          return value && Object.keys(value.ratings || {}).length === completed;
        }, { key: WORD_SESSION_KEY, completed });
      }
    }
    await page.locator(".result-page").waitFor({ timeout: 20_000 });
    const stats = await page.locator(".result-stats").innerText();
    assert.match(stats, /10/, "Completed session should report all ten words");
    const mastered = await page.evaluate(() => JSON.parse(localStorage.getItem("wordflow-ngsl-mastered-v1") || "[]"));
    assert.equal(mastered.length, 10, "Completing ten known cards should persist ten mastered words");
  });

  await runCheck(engine, "rapid-realistic-navigation-and-rotation-do-not-degrade-the-app", async (page) => {
    await ready(page);
    const labels = ["今天", "学习", "句库", "阅读", "复习", "进度"];
    const sizes = [
      { width: 320, height: 740 },
      { width: 375, height: 812 },
      { width: 430, height: 780 },
      { width: 740, height: 360 },
    ];
    for (let index = 0; index < 48; index += 1) {
      if (index % 6 === 0) await page.setViewportSize(sizes[(index / 6) % sizes.length]);
      await nav(page, labels[index % labels.length]);
      assert.ok(await page.evaluate(() => document.querySelectorAll("*").length < 6500), "DOM grew unexpectedly during repeated navigation");
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `Horizontal overflow after switching to ${labels[index % labels.length]}`);
    }
    assert.equal(await page.locator(".sheet-backdrop:visible").count(), 0, "A stale modal backdrop remained after normal navigation");
  });

  await runCheck(engine, "short-landscape-use-remains-scrollable-while-offline", async (page, context) => {
    await page.goto(origin, { waitUntil: "domcontentloaded" });
    await page.locator(".bottom-nav").waitFor({ timeout: 30_000 });
    await page.waitForFunction(async () => (await navigator.serviceWorker.getRegistration())?.active?.state === "activated", null, { timeout: 30_000 });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator(".bottom-nav").waitFor();
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, { timeout: 30_000 });
    await page.setViewportSize({ width: 740, height: 360 });
    await context.setOffline(true);
    await page.locator(".offline-status").waitFor();
    await nav(page, "学习");
    const start = page.getByRole("button", { name: "开始这组学习", exact: true });
    await start.scrollIntoViewIfNeeded();
    assert.equal(await start.isVisible(), true, "Primary learning action is unreachable in short landscape mode");
    await start.click();
    await page.locator(".word-heading h2").waitFor();
  }, { serviceWorkers: "allow" });
}

const summary = {
  passed: results.filter((item) => item.status === "PASS").length,
  failed: results.filter((item) => item.status === "FAIL").length,
  total: results.length,
};
console.log("DAILY_USE_AUDIT_SUMMARY", JSON.stringify(summary));
if (summary.failed) process.exitCode = 1;
