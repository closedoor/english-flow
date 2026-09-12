import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

if (!process.env.PLAYWRIGHT_MODULE) throw new Error("PLAYWRIGHT_MODULE is required");
if (!process.env.AXE_SOURCE) throw new Error("AXE_SOURCE is required");
const playwright = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const axeSource = await readFile(process.env.AXE_SOURCE, "utf8");
const origin = process.env.BROWSER_TEST_URL || "http://127.0.0.1:4173";
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname)) throw new Error("Deep audit must use a local origin");

const results = [];
async function runCheck(engine, name, body) {
  const browser = await playwright[engine].launch({ headless: true });
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
    results.push({ engine, name, status: "FAIL", error: String(error), pageErrors: errors, body: (await page.locator("body").innerText().catch(() => "")).slice(-2200) });
  } finally {
    await context.close();
    await browser.close();
  }
  console.log(JSON.stringify(results.at(-1)));
}

for (const engine of ["chromium", "webkit"]) {
  await runCheck(engine, "core-word-pack-can-retry-without-reloading-document", async (page, context) => {
    let failPack = true;
    await context.route(/ngsl-words-3\.json/, async (route) => {
      if (failPack) await route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
      else await route.continue();
    });
    await page.goto(origin, { waitUntil: "domcontentloaded" });
    await page.getByText("核心词库暂时没有加载成功", { exact: true }).waitFor({ timeout: 30_000 });
    const marker = await page.evaluate(() => { window.__deepAuditDocument = Math.random(); return window.__deepAuditDocument; });
    const retry = page.getByRole("button", { name: "重试核心词库", exact: true });
    assert.equal(await retry.count(), 1, "A transient pack failure should offer an in-page retry before full reload");
    failPack = false;
    await retry.click();
    await page.locator(".bottom-nav").waitFor({ timeout: 30_000 });
    assert.equal(await page.evaluate(() => window.__deepAuditDocument), marker, "Retry must preserve the current document");
    assert.equal(await page.getByText("核心词库暂时没有加载成功", { exact: true }).count(), 0);
  });
}

await runCheck("chromium", "reduced-motion-disables-visible-animation-and-transition", async (page) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await page.locator(".bottom-nav").waitFor({ timeout: 30_000 });
  const moving = await page.evaluate(() => {
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const longest = (value) => Math.max(...value.split(",").map((part) => {
      const text = part.trim();
      return text.endsWith("ms") ? Number.parseFloat(text) : Number.parseFloat(text) * 1000;
    }).filter(Number.isFinite), 0);
    return [...document.querySelectorAll("*")].filter(visible).flatMap((element) => {
      const style = getComputedStyle(element);
      const duration = Math.max(longest(style.animationDuration), longest(style.transitionDuration));
      return duration > 1 ? [{ tag: element.tagName, className: element.className, duration }] : [];
    }).slice(0, 12);
  });
  assert.deepEqual(moving, [], `Visible motion remains enabled: ${JSON.stringify(moving)}`);
});

await runCheck("chromium", "serious-accessibility-rules-pass-on-primary-screens", async (page) => {
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await page.locator(".bottom-nav").waitFor({ timeout: 30_000 });
  await page.addScriptTag({ content: axeSource });
  const screens = ["今天", "学习", "句库", "阅读", "复习", "进度"];
  const violations = [];
  for (const label of screens) {
    await page.locator(".bottom-nav button").filter({ hasText: label }).click();
    await page.locator(".page").first().waitFor();
    const current = await page.evaluate(async () => {
      const report = await window.axe.run(document, {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
      });
      return report.violations.filter((item) => item.impact === "critical" || item.impact === "serious").map((item) => ({
        id: item.id,
        impact: item.impact,
        help: item.help,
        nodes: item.nodes.slice(0, 100).map((node) => ({ target: node.target, summary: node.failureSummary })),
      }));
    });
    for (const violation of current) violations.push({ screen: label, ...violation });
  }
  const unique = [...new Map(violations.map((item) => [`${item.screen}:${item.id}:${JSON.stringify(item.nodes)}`, item])).values()];
  console.log("AXE_SERIOUS", JSON.stringify(unique));
  assert.deepEqual(unique, []);
});

const summary = { passed: results.filter((item) => item.status === "PASS").length, failed: results.filter((item) => item.status === "FAIL").length, total: results.length };
console.log("DEEP_AUDIT_SUMMARY", JSON.stringify(summary));
if (summary.failed) process.exitCode = 1;
