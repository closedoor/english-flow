import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

if (!process.env.PLAYWRIGHT_MODULE) throw new Error("Set PLAYWRIGHT_MODULE; see TESTING.md.");
const playwright = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const origin = process.env.BROWSER_TEST_URL || "http://127.0.0.1:4173";
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(new URL(origin).hostname), "Synthetic practice stays local-only");
const sessionKey = "wordflow-pattern-active-session-v1";
const results = [];
const stored = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), sessionKey);
const buttons = page => page.locator(".pattern-card-actions .pattern-drill-pager button, .pattern-card-actions .learn-actions button");

async function navigationPaint(page) {
  // Persisted state and scrollY=0 can be observable before the navigation effect's
  // queued frame runs. Let that frame paint before a subsequent user content scroll.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function geometry(page) {
  return page.evaluate(() => {
    const actions = document.querySelector(".pattern-card-actions");
    const nav = document.querySelector(".bottom-nav").getBoundingClientRect();
    return {
      scrollY, viewport: innerHeight, navTop: nav.top, overflow: document.documentElement.scrollWidth > innerWidth + 1,
      position: actions && getComputedStyle(actions).position,
      buttons: [...document.querySelectorAll(".pattern-card-actions .pattern-drill-pager button, .pattern-card-actions .learn-actions button")].map(button => {
        const r = button.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return { label: button.textContent, x: r.x, y: r.y, width: r.width, height: r.height, hit: button.contains(hit), disabled: button.disabled };
      }),
    };
  });
}

async function assertActions(page) {
  const m = await geometry(page);
  assert.equal(m.overflow, false);
  assert.ok(m.buttons.length >= 2, "The substitution pager stays available");
  for (const button of m.buttons) {
    assert.ok(button.y >= 0 && button.y + button.height <= m.navTop + 1, JSON.stringify(m));
    assert.ok(button.width >= 44 && button.height >= 44 && button.hit, JSON.stringify(m));
  }
  return m;
}

async function tap(page, locator) {
  const m = await locator.evaluate(button => {
    const r = button.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { x: r.x, y: r.y, width: r.width, height: r.height, hit: button.contains(hit), disabled: button.disabled };
  });
  assert.equal(m.disabled, false, "A direct tap targets an enabled control");
  assert.ok(m.hit && m.y >= 0 && m.y + m.height <= page.viewportSize().height + 1, JSON.stringify(m));
  await page.touchscreen.tap(m.x + m.width / 2, m.y + m.height / 2);
}

async function reveal(page) {
  assert.equal(await page.locator(".pattern-answer").count(), 0, "Recall keeps the complete English answer hidden");
  assert.equal(await page.getByRole("button", { name: "慢速播放", exact: true }).isDisabled(), true);
  await navigationPaint(page);
  // Reading/revealing is content interaction; repeated navigation below must work without scrolling.
  await page.locator(".reveal-answer").evaluate(button => button.scrollIntoView({ block: "center" }));
  await tap(page, page.getByRole("button", { name: "我说好了，查看参考答案", exact: true }));
  await page.locator(".pattern-answer").waitFor();
  await page.waitForFunction(() => document.activeElement === document.querySelector(".pattern-answer"));
  await page.evaluate(() => scrollTo(0, 0));
}

async function move(page, direction, drillIndex) {
  await assertActions(page);
  await tap(page, page.getByRole("button", { name: direction > 0 ? "下一组 ›" : "‹ 上一组", exact: true }));
  await page.waitForFunction(({ key, drillIndex }) => JSON.parse(localStorage.getItem(key))?.drillIndex === drillIndex, { key: sessionKey, drillIndex });
  assert.equal(await page.locator(".pattern-answer").count(), 0);
  await navigationPaint(page);
  await page.waitForFunction(() => scrollY <= 1);
  assert.ok(await page.evaluate(() => scrollY <= 1), "Changing substitution starts at the top with navigation still reachable");
}

async function noticePlacement(page) {
  await page.waitForFunction(() => {
    const toast = document.querySelector(".status-toast-stack"), actions = document.querySelector(".pattern-card-actions");
    return toast && actions && toast.getBoundingClientRect().bottom <= actions.getBoundingClientRect().top - 4;
  });
  await assertActions(page);
}

async function checkWarnings(page) {
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("english-flow-speech-error", { detail: "not-allowed" }));
    window.dispatchEvent(new Event("english-flow-offline-cache-error"));
    window.dispatchEvent(new Event("offline"));
  });
  await page.getByRole("button", { name: "关闭语音提示", exact: true }).waitFor();
  await page.getByRole("button", { name: "关闭离线保存提示", exact: true }).waitFor();
  await page.locator(".offline-status").waitFor();
  await noticePlacement(page);
  await move(page, -1, 1); await noticePlacement(page);
  // Returning hides the answer and removes ratings; the stack must follow that toolbar-height change.
  await tap(page, page.getByRole("button", { name: "关闭语音提示", exact: true }));
  await page.getByRole("button", { name: "关闭语音提示", exact: true }).waitFor({ state: "hidden" });
  await noticePlacement(page);
  await tap(page, page.getByRole("button", { name: "关闭离线保存提示", exact: true }));
  await page.getByRole("button", { name: "关闭离线保存提示", exact: true }).waitFor({ state: "hidden" });
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.locator(".status-toast-stack").waitFor({ state: "hidden" });
  await reveal(page); await move(page, 1, 2); await reveal(page); await assertActions(page);
}

for (const engine of ["chromium", "webkit"]) {
  const browser = await playwright[engine].launch({ headless: true });
  for (const item of [
    { name: "small-phone-three-substitutions", width: 320, height: 568, warnings: true },
    { name: "compact-phone-three-substitutions", width: 375, height: 667 },
    { name: "browser-bars-three-substitutions", width: 390, height: 650 },
    { name: "reported-phone-three-substitutions", width: 390, height: 844 },
    { name: "large-phone-three-substitutions", width: 430, height: 932 },
    { name: "large-text-and-safe-area", width: 390, height: 844, stress: true, warnings: true },
    { name: "small-phone-large-text-and-safe-area", width: 320, height: 568, stress: true, warnings: true },
    { name: "landscape-normal-flow", width: 844, height: 390, flow: true },
    { name: "desktop-normal-flow", width: 1280, height: 900, flow: true },
  ]) {
    const context = await browser.newContext({ viewport: { width: item.width, height: item.height }, hasTouch: true, serviceWorkers: "block" });
    await context.addInitScript(() => {
      const speech = { log: [], active: null };
      window.__patternLayoutSpeech = speech;
      Object.defineProperty(window, "SpeechSynthesisUtterance", { configurable: true, value: class { constructor(text) { this.text = text; } } });
      Object.defineProperty(window, "speechSynthesis", { configurable: true, value: {
        paused: false, getVoices() { return []; }, cancel() { speech.active = null; }, resume() {},
        speak(utterance) { speech.log.push(utterance.text); speech.active = utterance; utterance.onstart?.(); },
      } });
    });
    const page = await context.newPage(); page.setDefaultTimeout(15_000);
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    try {
      await page.goto(origin); await page.locator(".bottom-nav").waitFor({ timeout: 30_000 });
      await page.locator(".bottom-nav button").filter({ hasText: "句库" }).click();
      await page.getByRole("button", { name: "核心句型", exact: true }).click();
      await page.getByRole("button", { name: "开始句型替换练习", exact: true }).click();
      await page.locator(".pattern-prompt").waitFor();
      await navigationPaint(page);
      if (item.stress) await page.addStyleTag({ content: "html{font-size:24px}.learn-page{padding-top:83px}.bottom-nav{height:108px;padding-bottom:34px}.learn-page>.word-card-actions{bottom:108px}.speech-warning{font-size:18px}" });
      assert.equal(await page.evaluate(() => window.__patternLayoutSpeech.log.length), 0);
      assert.equal(await page.locator(".pattern-answer").count(), 0);
      assert.equal(await page.getByRole("button", { name: "下一组 ›", exact: true }).isDisabled(), true);
      assert.equal(await buttons(page).count(), 2, "Rating stays absent before the final revealed substitution");
      if (item.flow) {
        assert.notEqual(await page.locator(".pattern-card-actions").evaluate(actions => getComputedStyle(actions).position), "sticky");
        await reveal(page);
        await page.locator(".pattern-card-actions").evaluate(actions => actions.scrollIntoView({ block: "center" }));
        await assertActions(page);
        await tap(page, page.getByRole("button", { name: "下一组 ›", exact: true }));
        await page.waitForFunction(key => JSON.parse(localStorage.getItem(key))?.drillIndex === 1, sessionKey);
        assert.equal(await page.locator(".pattern-answer").count(), 0);
      } else {
        assert.equal((await assertActions(page)).position, "sticky");
        await reveal(page); await move(page, 1, 1);
        // Returning to a prior substitution still asks for recall and keeps the same session.
        await move(page, -1, 0); await reveal(page); await move(page, 1, 1);
        await reveal(page); await move(page, 1, 2); await reveal(page);
        assert.equal(await buttons(page).count(), 4, "Only the final revealed substitution enables rating");
        await assertActions(page);
        if (item.warnings) await checkWarnings(page);
        // Long reference text must be readable below the sticky toolbar rather than clipped.
        const sourceAnswer = await page.locator(".pattern-answer>p").innerText();
        await page.locator(".pattern-answer>p").evaluate(answer => { answer.textContent = ("A deliberately long reference remains readable without truncation. ").repeat(12); });
        await page.evaluate(() => scrollTo(0, 0)); await assertActions(page);
        await page.locator(".pattern-answer>div").evaluate(slot => slot.scrollIntoView({ block: "start" }));
        assert.equal(await page.locator(".pattern-answer>div").evaluate(slot => {
          const r = slot.getBoundingClientRect(), hit = document.elementFromPoint(r.x + 8, r.y + r.height / 2);
          return slot.contains(hit);
        }), true, "The final replacement slot can scroll fully clear of the actions");
        await tap(page, page.getByRole("button", { name: "播放参考答案", exact: true }));
        assert.equal(await page.evaluate(() => window.__patternLayoutSpeech.log.at(-1)), sourceAnswer);
        assert.equal(await page.evaluate(() => window.__patternLayoutSpeech.log.length), 1, "Answer audio starts only after an explicit tap");
        await page.evaluate(() => scrollTo(0, 0)); await assertActions(page);
        await page.waitForTimeout(380); // The product guards accidental double ratings for 350 ms.
        await tap(page, page.getByRole("button", { name: "掌握句型", exact: true }));
        await page.waitForFunction(key => JSON.parse(localStorage.getItem(key))?.index === 1, sessionKey);
        await navigationPaint(page);
        assert.equal((await stored(page)).drillIndex, 0);
        assert.equal(await page.locator(".pattern-answer").count(), 0);
        assert.equal(await page.evaluate(() => window.__patternLayoutSpeech.active), null, "Advancing cancels the prior manual answer audio");
        assert.ok(await page.evaluate(() => scrollY <= 1)); await assertActions(page);
        assert.equal(await page.evaluate(() => window.__patternLayoutSpeech.log.length), 1, "A new recalled pattern never auto-reads its answer");
      }
      assert.deepEqual(errors, []);
      results.push({ engine, name: item.name, status: "PASS" });
    } catch (error) {
      results.push({ engine, name: item.name, status: "FAIL", error: error.stack || String(error), geometry: await geometry(page).catch(() => null), errors });
    } finally {
      console.log(JSON.stringify(results.at(-1))); await context.close();
    }
  }
  await browser.close();
}
const failed = results.filter(result => result.status === "FAIL").length;
console.log("PATTERN_LAYOUT_SUMMARY", JSON.stringify({ passed: results.length - failed, failed, total: results.length, instrumentedSpeech: true }));
if (failed) process.exitCode = 1;
