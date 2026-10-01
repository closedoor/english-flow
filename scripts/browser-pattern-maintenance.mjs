import { openSetupDetails } from './browser-disclosures.mjs';
import { openLegacyPatterns } from './browser-navigation.mjs';
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

if (!process.env.PLAYWRIGHT_MODULE) throw new Error("Set PLAYWRIGHT_MODULE; see TESTING.md.");
const playwright = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const origin = process.env.BROWSER_TEST_URL || "http://127.0.0.1:4173";
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname)) {
  throw new Error("Synthetic pattern practice must remain on a local test origin.");
}
const sessionKey = "wordflow-pattern-active-session-v1";
const results = [];
const stored = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), sessionKey);
const rotation = page => page.evaluate(() => JSON.parse(localStorage.getItem("wordflow-practice-rotation-v1"))?.pattern ?? 0);
const speechCount = page => page.evaluate(() => window.__patternSpeech.length);
const exit = page => page.getByRole("button", { name: "返回句型设置并保留进度", exact: true }).click();
const start = page => page.getByRole("button", { name: "开始句型替换练习", exact: true }).click();
const reveal = page => page.getByRole("button", { name: "我说好了，查看参考答案", exact: true }).click();

async function setup(page, category = "全部") {
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await page.locator(".bottom-nav").waitFor({ timeout: 30_000 });
  await page.locator(".pattern-prompt").waitFor();
  await exit(page);
  await openSetupDetails(page, '.pattern-range');
  await page.locator(".pattern-category-grid button").filter({ hasText: category }).click();
}
async function cards(page) {
  await page.locator(".pattern-prompt").waitFor();
  await page.waitForFunction(key => Boolean(localStorage.getItem(key)), sessionKey);
  assert.equal(await page.locator(".pattern-answer").count(), 0, "An entering/recalled substitution hides its answer");
}
async function toSecondSubstitution(page) {
  await reveal(page);
  await page.getByRole("button", { name: "下一组 ›", exact: true }).click();
  await page.waitForFunction(key => JSON.parse(localStorage.getItem(key))?.drillIndex === 1, sessionKey);
  assert.equal(await page.locator(".pattern-answer").count(), 0);
}
async function ratePattern(page, known) {
  for (let index = 0; index < 3; index++) {
    await reveal(page);
    if (index < 2) await page.getByRole("button", { name: "下一组 ›", exact: true }).click();
  }
  // The product intentionally guards accidental double ratings for 350 ms.
  await page.waitForTimeout(380);
  await page.getByRole("button", { name: known ? "掌握句型" : "还需练习", exact: true }).click();
}

for (const engine of ["chromium", "webkit"]) {
  const browser = await playwright[engine].launch({ headless: true });
  async function check(name, body, { difficult = [], width = 390, height = 844 } = {}) {
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: true, serviceWorkers: "block" });
    await context.addInitScript(ids => {
      if (!sessionStorage.getItem("pattern-maintenance-seeded")) {
        sessionStorage.setItem("pattern-maintenance-seeded", "1");
        localStorage.setItem("wordflow-pattern-difficult-v1", JSON.stringify(ids));
        localStorage.setItem("wordflow-pattern-active-session-v1", JSON.stringify({
          version: 1, updatedAt: Date.now(), category: "all",
          patternIds: Array.from({ length: 10 }, (_, index) => `p${String(index + 1).padStart(2, "0")}`),
          index: 0, drillIndex: 0, ratings: {},
        }));
      }
      window.__patternSpeech = [];
      Object.defineProperty(window, "SpeechSynthesisUtterance", {
        configurable: true, value: class { constructor(text) { this.text = text; } },
      });
      Object.defineProperty(window, "speechSynthesis", {
        configurable: true, value: {
          paused: false, cancel() {}, resume() {},
          getVoices() { return [{ name: "English", lang: "en-US" }]; },
          speak(utterance) { window.__patternSpeech.push({ text: utterance.text, lang: utterance.lang }); utterance.onstart?.(); },
        },
      });
    }, difficult);
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    try {
      await body(page);
      assert.deepEqual(errors, [], "No uncaught browser errors");
      results.push({ engine, name, status: "PASS" });
    } catch (error) {
      results.push({ engine, name, status: "FAIL", error: String(error), errors,
        body: (await page.locator("body").innerText().catch(() => "")).slice(-2000) });
    } finally {
      await context.close();
    }
    console.log(JSON.stringify(results.at(-1)));
  }

  await check("untouched-first-substitution-start-resumes-without-dialog-or-new-rotation", async page => {
    await setup(page); await start(page); await cards(page);
    const before = await stored(page), beforeRotation = await rotation(page);
    for (let attempt = 0; attempt < 3; attempt++) {
      await exit(page); await start(page); await cards(page);
      assert.equal(await page.locator("#discard-title").count(), 0);
      assert.deepEqual(await stored(page), before);
    }
    assert.equal(await rotation(page), beforeRotation);
    assert.equal(await speechCount(page), 0, "Recall practice never automatically reads the answer");
  });

  await check("second-substitution-start-and-reload-retain-position-with-hidden-answer", async page => {
    await setup(page); await start(page); await cards(page); await toSecondSubstitution(page);
    const before = await stored(page), beforeRotation = await rotation(page);
    await exit(page); await start(page); await cards(page);
    assert.equal(await page.locator("#discard-title").count(), 0);
    assert.deepEqual(await stored(page), before);
    await reveal(page); assert.equal(await speechCount(page), 0);
    await page.reload(); await cards(page);
    assert.deepEqual(await stored(page), before);
    await exit(page); await start(page); await cards(page);
    assert.deepEqual(await stored(page), before);
    assert.equal(await rotation(page), beforeRotation);
    assert.equal(await speechCount(page), 0);
  });

  await check("rated-legacy-patterns-and-record-management-resume-keep-the-same-group-and-substitution", async page => {
    await setup(page); await start(page); await cards(page); await ratePattern(page, true);
    await page.waitForFunction(key => Object.keys(JSON.parse(localStorage.getItem(key))?.ratings ?? {}).length === 1, sessionKey);
    await toSecondSubstitution(page);
    const before = await stored(page), beforeRotation = await rotation(page);
    await openLegacyPatterns(page);
    await cards(page);
    assert.deepEqual(await stored(page), before);
    await exit(page); await start(page); await cards(page);
    assert.deepEqual(await stored(page), before);
    assert.equal(await rotation(page), beforeRotation);
    assert.equal(await speechCount(page), 0);
  });

  await check("changed-scene-protects-real-progress-and-confirmation-starts-the-chosen-practice", async page => {
    await setup(page); await start(page); await cards(page); await toSecondSubstitution(page);
    const before = await stored(page);
    await exit(page);
    await openSetupDetails(page, '.pattern-range');
    await page.locator(".pattern-category-grid button").filter({ hasText: "出行" }).click();
    await start(page); await page.locator("#discard-title").waitFor();
    await page.getByRole("button", { name: "保留进度", exact: true }).click();
    assert.deepEqual(await stored(page), before);
    await start(page); await page.locator("#discard-title").waitFor();
    await page.getByRole("button", { name: "结束并开始新练习", exact: true }).click();
    await cards(page);
    const after = await stored(page);
    assert.equal(after.category, "travel");
    assert.equal(after.index, 0); assert.equal(after.drillIndex, 0); assert.deepEqual(after.ratings, {});
    assert.equal(await speechCount(page), 0);
  });

  await check("explicit-new-group-requires-confirmation-without-changing-normal-start", async page => {
    await setup(page); await start(page); await cards(page); await toSecondSubstitution(page);
    const before = await stored(page), beforeRotation = await rotation(page);
    await exit(page);
    await page.getByRole("button", { name: "另开新一组", exact: true }).click();
    await page.locator("#discard-title").waitFor();
    await page.getByRole("button", { name: "保留进度", exact: true }).click();
    assert.deepEqual(await stored(page), before);
    await start(page); await cards(page);
    assert.deepEqual(await stored(page), before);
    await exit(page);
    await page.getByRole("button", { name: "另开新一组", exact: true }).click();
    await page.getByRole("button", { name: "结束并开始新练习", exact: true }).click();
    await cards(page);
    const after = await stored(page);
    assert.notDeepEqual(after.patternIds, before.patternIds);
    assert.deepEqual(after.ratings, {}); assert.equal(after.index, 0); assert.equal(after.drillIndex, 0);
    assert.equal(await rotation(page), beforeRotation + 1);
  });

  await check("untouched-first-substitution-can-change-scene-without-warning", async page => {
    await setup(page); await start(page); await cards(page); await exit(page);
    await openSetupDetails(page, '.pattern-range');
    await page.locator(".pattern-category-grid button").filter({ hasText: "出行" }).click();
    await start(page); await cards(page);
    assert.equal(await page.locator("#discard-title").count(), 0);
    assert.equal((await stored(page)).category, "travel");
    assert.equal(await speechCount(page), 0);
  });

  await check("reinforcement-protects-the-current-group-and-starts-only-difficult-patterns", async page => {
    await setup(page); await start(page); await cards(page); await toSecondSubstitution(page);
    const before = await stored(page);
    await exit(page);
    const review = page.getByRole("button", { name: "复习当前范围内 2 个待加强句型", exact: true });
    await review.click(); await page.locator("#discard-title").waitFor();
    await page.getByRole("button", { name: "保留进度", exact: true }).click();
    assert.deepEqual(await stored(page), before);
    await review.click();
    await page.getByRole("button", { name: "结束并开始新练习", exact: true }).click();
    await cards(page);
    assert.deepEqual((await stored(page)).patternIds.sort(), ["p01", "p06"]);
    assert.equal(await speechCount(page), 0);
  }, { difficult: ["p01", "p06"] });

  await check("completed-pattern-practice-retries-only-difficult-items-and-can-start-again", async page => {
    await setup(page, "餐饮"); await start(page); await cards(page);
    const firstId = (await stored(page)).patternIds[0];
    await ratePattern(page, false); await ratePattern(page, true); await ratePattern(page, true);
    await page.getByRole("heading", { name: "句型替换完成了", exact: true }).waitFor();
    assert.equal(await stored(page), null);
    await page.getByRole("button", { name: "再练这 1 个待加强句型", exact: true }).click(); await cards(page);
    assert.deepEqual((await stored(page)).patternIds, [firstId]);
    assert.equal((await stored(page)).drillIndex, 0); assert.deepEqual((await stored(page)).ratings, {});
    await ratePattern(page, true);
    await page.getByRole("heading", { name: "句型替换完成了", exact: true }).waitFor();
    await page.getByRole("button", { name: "再练一组", exact: true }).click();
    await start(page); await cards(page);
    assert.equal(await page.locator("#discard-title").count(), 0);
    assert.equal((await stored(page)).patternIds.length, 3);
    assert.equal(await speechCount(page), 0);
  });

  await browser.close();
}
const failed = results.filter(result => result.status === "FAIL").length;
console.log("PATTERN_MAINTENANCE_SUMMARY", JSON.stringify({ passed: results.length - failed, failed, total: results.length, instrumentedSpeech: true }));
if (failed) process.exitCode = 1;
