import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

if (!process.env.PLAYWRIGHT_MODULE) throw new Error("PLAYWRIGHT_MODULE is required");
const playwright = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const origin = process.env.BROWSER_TEST_URL || "http://127.0.0.1:4173";
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname)) throw new Error("Rapid-action tests must use a local build");

const keys = {
  rotation: "wordflow-practice-rotation-v1",
  sentenceSession: "wordflow-sentence-active-session-v1",
  readingCompleted: "wordflow-reading-completed-v1",
  sentenceSaved: "wordflow-sentence-saved-v1",
};
const results = [];

async function ready(page) {
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await page.locator(".bottom-nav").waitFor({ timeout: 30_000 });
}

async function nav(page, label) {
  await page.locator(".bottom-nav button").filter({ hasText: label }).click();
  await page.locator(".page").first().waitFor();
}

async function stored(page, key, fallback = null) {
  return page.evaluate(({ key, fallback }) => JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)), { key, fallback });
}

for (const engine of ["chromium", "webkit"]) {
  const browser = await playwright[engine].launch({ headless: true });

  async function check(name, body) {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 }, hasTouch: true, serviceWorkers: "block" });
    const page = await context.newPage();
    page.setDefaultTimeout(20_000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await body(page, context);
      assert.deepEqual(errors, [], "Uncaught page errors");
      results.push({ engine, name, status: "PASS" });
    } catch (error) {
      const detail = { engine, name, status: "FAIL", error: String(error), pageErrors: errors, body: (await page.locator("body").innerText().catch(() => "")).slice(0, 3000) };
      results.push(detail);
    } finally {
      await context.close();
    }
    console.log(JSON.stringify(results.at(-1)));
  }

  await check("double-tapping-word-start-creates-one-session", async (page) => {
    await ready(page);
    await nav(page, "学习");
    await page.getByRole("button", { name: "自由学习", exact: false }).click();
    await page.getByRole("button", { name: "开始这组学习", exact: true }).evaluate((button) => {
      button.click();
      button.click();
    });
    await page.locator(".word-heading h2").waitFor();
    await page.waitForTimeout(250);
    const rotation = await stored(page, keys.rotation, { word: 0, sentence: 0, pattern: 0 });
    assert.equal(rotation.word, 1, "One visible start action must advance word rotation once");
  });

  await check("double-tapping-sentence-start-creates-one-session", async (page) => {
    await ready(page);
    await nav(page, "句库");
    const start = page.getByRole("button", { name: "开始这组学习", exact: true });
    await start.waitFor();
    await page.waitForFunction(() => {
      const button = [...document.querySelectorAll("button")].find((item) => item.textContent?.trim() === "开始这组学习");
      return button instanceof HTMLButtonElement && !button.disabled;
    });
    await start.evaluate((button) => {
      button.click();
      button.click();
    });
    await page.locator(".sentence-study-card").waitFor();
    await page.waitForTimeout(250);
    const rotation = await stored(page, keys.rotation, { word: 0, sentence: 0, pattern: 0 });
    assert.equal(rotation.sentence, 1, "One visible start action must advance sentence rotation once");
  });

  await check("double-tapping-pattern-start-creates-one-session", async (page) => {
    await ready(page);
    await nav(page, "句库");
    await page.locator(".sentence-section-switch button").filter({ hasText: "核心句型" }).click();
    const start = page.getByRole("button", { name: "开始句型替换练习", exact: true });
    await start.waitFor();
    await start.evaluate((button) => {
      button.click();
      button.click();
    });
    await page.locator(".pattern-card").waitFor();
    await page.waitForTimeout(250);
    const rotation = await stored(page, keys.rotation, { word: 0, sentence: 0, pattern: 0 });
    assert.equal(rotation.pattern, 1, "One visible start action must advance pattern rotation once");
  });

  await check("a-fast-intentional-rating-on-the-next-sentence-is-not-lost", async (page) => {
    await ready(page);
    await nav(page, "句库");
    const start = page.getByRole("button", { name: "开始这组学习", exact: true });
    await page.waitForFunction(() => {
      const button = [...document.querySelectorAll("button")].find((item) => item.textContent?.trim() === "开始这组学习");
      return button instanceof HTMLButtonElement && !button.disabled;
    });
    await start.click();
    await page.locator(".sentence-study-card").waitFor();
    await page.evaluate(() => new Promise((resolve, reject) => {
      const heading = document.querySelector(".sentence-english")?.textContent;
      const first = document.querySelector(".learn-actions .secondary-action");
      if (!(first instanceof HTMLButtonElement) || !heading) return reject(new Error("Missing first sentence action"));
      first.click();
      const started = performance.now();
      const timer = setInterval(() => {
        const nextHeading = document.querySelector(".sentence-english")?.textContent;
        const next = document.querySelector(".learn-actions .primary-action");
        if (nextHeading && nextHeading !== heading && next instanceof HTMLButtonElement) {
          clearInterval(timer);
          next.click();
          resolve(undefined);
        } else if (performance.now() - started > 320) {
          clearInterval(timer);
          reject(new Error("Next sentence did not become actionable quickly enough"));
        }
      }, 0);
    }));
    await page.waitForTimeout(450);
    const session = await stored(page, keys.sentenceSession);
    assert.equal(Object.keys(session?.ratings || {}).length, 2, "The next sentence rating was swallowed by a stale lock");
  });

  await check("double-tapping-reading-complete-keeps-the-article-completed", async (page) => {
    await ready(page);
    await nav(page, "阅读");
    await page.locator(".reading-card").first().click();
    const complete = page.locator(".reading-complete-action");
    await complete.waitFor();
    await complete.evaluate((button) => {
      button.click();
      button.click();
    });
    await page.waitForTimeout(300);
    const completed = await stored(page, keys.readingCompleted, []);
    assert.deepEqual(completed, ["r1"], "An accidental double tap must not immediately undo completion");
  });

  await check("double-tapping-sentence-favorite-saves-one-record", async (page) => {
    await ready(page);
    await nav(page, "句库");
    const start = page.getByRole("button", { name: "开始这组学习", exact: true });
    await page.waitForFunction(() => {
      const button = [...document.querySelectorAll("button")].find((item) => item.textContent?.trim() === "开始这组学习");
      return button instanceof HTMLButtonElement && !button.disabled;
    });
    await start.click();
    await page.locator(".sentence-study-card").waitFor();
    const favorite = page.getByRole("button", { name: "收藏句子", exact: true });
    await favorite.evaluate((button) => {
      button.click();
      button.click();
    });
    await page.waitForTimeout(300);
    const saved = await stored(page, keys.sentenceSaved, []);
    assert.equal(saved.length, 1, `Expected one saved sentence after an accidental double tap, received ${saved.length}`);
    assert.equal(new Set(saved).size, 1, "Saved sentence IDs must remain unique");
  });

  await browser.close();
}

const summary = {
  passed: results.filter((item) => item.status === "PASS").length,
  failed: results.filter((item) => item.status === "FAIL").length,
  total: results.length,
};
console.log("RAPID_ACTIONS_SUMMARY", JSON.stringify(summary));
if (summary.failed) process.exitCode = 1;
