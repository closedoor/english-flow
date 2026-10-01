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
async function checkAccessibility(page, screen) {
  if (!await page.evaluate(() => Boolean(window.axe))) await page.addScriptTag({ content: axeSource });
  const violations = await page.evaluate(async () => {
    const report = await window.axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
    });
    return report.violations.filter((item) => item.impact === "critical" || item.impact === "serious").map((item) => ({
      id: item.id,
      impact: item.impact,
      nodes: item.nodes.map((node) => ({ target: node.target, summary: node.failureSummary })),
    }));
  });
  console.log("AXE_LEARNING_STATE", JSON.stringify({ screen, violations }));
  assert.deepEqual(violations, [], `Accessibility violations in ${screen}`);
}

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
  const screens = ["今天", "单词", "句子", "阅读", "复习", "进度"];
  const violations = [];
  for (const label of screens) {
    await page.locator(".bottom-nav button").filter({ hasText: label }).click();
    await page.locator(".page").first().waitFor();
    if (label === "句子") await page.waitForFunction(() => { const button = document.querySelector(".sentence-page .sticky-start"); return button && !button.disabled; });
    if (label === "阅读") await page.locator(".reading-card").first().waitFor({ timeout: 30_000 });
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

await runCheck("chromium", "word-cards-and-progress-dialogs-remain-readable", async (page) => {
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await page.locator(".bottom-nav").waitFor({ timeout: 30_000 });
  await page.locator(".bottom-nav button").filter({ hasText: "单词" }).click();
  await page.getByRole("button", { name: "开始这组学习", exact: true }).click();
  await page.locator(".word-card").waitFor();
  await checkAccessibility(page, "单词词卡");
  await page.locator(".learn-actions .secondary-action").click();
  await page.getByRole("button", { name: "退出本组", exact: true }).click();
  await page.locator(".discard-dialog").waitFor();
  await checkAccessibility(page, "结束学习确认");
  await page.getByRole("button", { name: "保留进度", exact: true }).click();
  await page.locator(".bottom-nav button").filter({ hasText: "进度" }).click();
  await page.getByRole("button", { name: "重置", exact: true }).click();
  await page.locator(".reset-dialog").waitFor();
  await checkAccessibility(page, "重置确认");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  const backup = await page.evaluate(() => ({
    app: "english-flow", formatVersion: 1, exportedAt: new Date().toISOString(),
    data: Object.fromEntries(Object.keys(localStorage).filter((key) => key.startsWith("wordflow-")).map((key) => [key, JSON.parse(localStorage.getItem(key))])),
  }));
  // Optional absent records still need a slot in a current-format backup.
  for (const key of ["wordflow-reading-last-v1", "wordflow-sentence-active-session-v1", "wordflow-pattern-active-session-v1"]) backup.data[key] ??= null;
  await page.locator("input[type=file]").setInputFiles({ name: "accessibility-backup.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(backup)) });
  await page.locator(".restore-dialog").waitFor();
  await checkAccessibility(page, "备份恢复确认");
});

await runCheck("chromium", "quiz-input-feedback-and-results-remain-readable", async (page, context) => {
  await context.addInitScript(() => localStorage.setItem("wordflow-active-session-v1", JSON.stringify({
    version: 1, kind: "group", updatedAt: Date.now(), path: "frequency", mode: "test", wordIds: [1, 2], index: 1,
    ratings: { 1: "known", 2: "known" }, stage: "quiz", quizIndex: 0, quizAnswer: "", quizFeedback: null, quizResults: [],
  })));
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await page.locator(".quiz-page").waitFor({ timeout: 30_000 });
  await checkAccessibility(page, "填空考试");
  await page.locator(".quiz-skip").click();
  await checkAccessibility(page, "考试错题反馈");
  await page.getByRole("button", { name: "下一题", exact: true }).click();
  await checkAccessibility(page, "听音考试");
  await page.locator(".answer-field input").fill("be");
  await page.getByRole("button", { name: "提交答案", exact: true }).click();
  await checkAccessibility(page, "考试正确反馈");
  await page.getByRole("button", { name: "查看结果", exact: true }).click();
  await page.locator(".result-page").waitFor();
  await checkAccessibility(page, "考试结果与错词");
});

await runCheck("chromium", "sentence-listening-speaking-and-results-remain-readable", async (page, context) => {
  await context.addInitScript(() => localStorage.setItem("wordflow-sentence-active-session-v1", JSON.stringify({
    version: 1, updatedAt: Date.now(), band: "short", category: "all", count: 10, mode: "bilingual", sentenceIds: [1], index: 0, ratings: {},
  })));
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await page.locator(".sentence-study-card").waitFor({ timeout: 30_000 });
  await checkAccessibility(page, "英文句卡与中文翻译");
  await page.locator(".learn-actions .primary-action").click();
  await page.locator(".result-page").waitFor();
  await checkAccessibility(page, "句子学习结果");
  await page.getByRole("button", { name: "返回句库", exact: true }).click();
  await page.locator(".sentence-mode-grid button").filter({ hasText: "看中文说英文" }).click();
  await page.getByRole("button", { name: "开始这组学习", exact: true }).click();
  await page.locator(".speak-prompt").waitFor();
  await checkAccessibility(page, "中文回忆提示");
  await page.locator(".reveal-answer").click();
  await checkAccessibility(page, "句子答案揭晓");
});

await runCheck("chromium", "pattern-recall-answer-and-results-remain-readable", async (page, context) => {
  await context.addInitScript(() => localStorage.setItem("wordflow-pattern-active-session-v1", JSON.stringify({
    version: 1, updatedAt: Date.now(), category: "all", patternIds: ["p01"], index: 0, drillIndex: 0, ratings: {},
  })));
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await page.locator(".pattern-card").waitFor({ timeout: 30_000 });
  await checkAccessibility(page, "句型回忆提示");
  for (let index = 0; index < 3; index += 1) {
    await page.locator(".reveal-answer").click();
    await checkAccessibility(page, `句型答案 ${index + 1}`);
    if (index < 2) await page.getByRole("button", { name: "下一组 ›", exact: true }).click();
  }
  await page.getByRole("button", { name: "掌握句型", exact: true }).click();
  await page.locator(".result-page").waitFor();
  await checkAccessibility(page, "句型学习结果");
});

await runCheck("chromium", "reading-and-review-recall-feedback-remain-readable", async (page, context) => {
  await context.addInitScript(() => localStorage.setItem("wordflow-ngsl-difficult-v1", "[1]"));
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await page.locator(".bottom-nav").waitFor({ timeout: 30_000 });
  await page.locator(".bottom-nav button").filter({ hasText: "复习" }).click();
  await checkAccessibility(page, "复习回忆提示");
  await page.locator(".review-reveal").click();
  await checkAccessibility(page, "复习答案揭晓");
  await page.locator(".bottom-nav button").filter({ hasText: "阅读" }).click();
  await page.locator(".reading-card").first().click();
  await checkAccessibility(page, "阅读详情与速度设置");
  await page.locator(".translation-toggle").click();
  await checkAccessibility(page, "阅读中文翻译");
  await page.locator(".reading-question-options button").first().click();
  await checkAccessibility(page, "阅读理解错题反馈");
  await page.getByRole("button", { name: "重新作答", exact: true }).click();
  await page.locator(".reading-question-options button").nth(1).click();
  await checkAccessibility(page, "阅读理解正确反馈");
});

const summary = { passed: results.filter((item) => item.status === "PASS").length, failed: results.filter((item) => item.status === "FAIL").length, total: results.length };
console.log("ACCESSIBILITY_BROWSER_SUMMARY", JSON.stringify(summary));
if (summary.failed) process.exitCode = 1;
