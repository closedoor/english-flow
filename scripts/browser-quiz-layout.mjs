import assert from 'node:assert/strict';
import { settleLearningStorage } from './storage-settlement-checks.mjs';
import { mkdir, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';

if (!process.env.PLAYWRIGHT_MODULE) throw new Error('PLAYWRIGHT_MODULE is required; see TESTING.md.');
const playwright = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const origin = process.env.BROWSER_TEST_URL || 'http://127.0.0.1:4173';
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname), 'Quiz fixtures must stay on a local origin.');
const evidence = process.env.BROWSER_EVIDENCE_DIR || path.join(os.tmpdir(), 'english-flow-evidence');
await mkdir(evidence, { recursive: true });
const wordKey = 'wordflow-active-session-v1';
const packs = await Promise.all([1, 2, 3].map((pack) => readFile(new URL(`../public/data/ngsl-words-${pack}.json`, import.meta.url), 'utf8').then(JSON.parse)));
const longWord = packs.flat().reduce((longest, word) => (word.exampleForm ?? word.word).length > (longest.exampleForm ?? longest.word).length ? word : longest);
const results = [];

function snapshot({ index = 0, restored = false, long = false } = {}) {
  const wordIds = long ? [1, longWord.id, 3] : [1, 2, 3];
  return {
    version: 1, kind: 'group', updatedAt: Date.now(), path: 'frequency', mode: 'test', wordIds,
    index: 2, ratings: Object.fromEntries(wordIds.map((id) => [id, 'known'])), stage: 'quiz',
    quizIndex: index, quizAnswer: restored ? 'unrecognized' : '', quizFeedback: restored ? 'wrong' : null,
    quizResults: [...Array(index).fill(true), ...(restored ? [false] : [])],
  };
}

async function saved(page) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) || 'null'), wordKey);
}

async function geometry(page, readiness = null) {
  return page.evaluate(async (readiness) => {
    const rectangle = (selectorOrElement) => {
      const element = typeof selectorOrElement === 'string' ? document.querySelector(selectorOrElement) : selectorOrElement;
      if (!element) return null;
      const box = element.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return { x: box.x, y: box.y, width: box.width, height: box.height, bottom: box.bottom, hit: hit === element || element.contains(hit) };
    };
    const measure = () => {
      const named = readiness?.name ? [...document.querySelectorAll('button')].find((button) => button.getAttribute('aria-label') === readiness.name || button.textContent.trim() === readiness.name) : null;
      return {
        scrollY, viewport: innerHeight, overflow: document.documentElement.scrollWidth > innerWidth + 1,
        primary: rectangle('.quiz-page .sticky-start'), skip: rectangle('.quiz-skip'), feedback: rectangle('.feedback-box'), answer: rectangle('.feedback-box p'),
        actions: rectangle('.quiz-actions'), notices: rectangle('.status-toast-stack'), field: rectangle('.answer-field'), named: rectangle(named),
        active: document.activeElement?.tagName,
        inputFocused: document.activeElement === document.querySelector('.quiz-page input'),
        primaryFocused: document.activeElement === document.querySelector('.quiz-page .sticky-start'),
      };
    };
    if (!readiness) return measure();
    // Hydration/navigation and the question-focus effect each schedule a frame.
    // Do not sample a first-screen tap before both can settle.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const started = performance.now();
    let previous = null;
    let stableSince = 0;
    let latest;
    while (performance.now() - started < 12_000) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      latest = measure();
      const { feedback, answer, primary, viewport, field, skip, named, actions } = latest;
      const complete = (box, touchTarget = true) => Boolean(box && box.y >= 0 && box.bottom <= viewport && box.hit
        && (!touchTarget || (box.width >= 44 && box.height >= 44)));
      const feedbackReady = complete(feedback, false) && feedback.bottom <= primary?.y - 3
        && (!answer || (complete(answer, false) && answer.bottom <= primary?.y - 3));
      const questionReady = !feedback && complete(field, false) && field.bottom <= actions?.y - 3
        && complete(skip) && latest.inputFocused;
      const stateReady = readiness.mode === 'feedback' ? feedbackReady && latest.primaryFocused : questionReady;
      const visible = !latest.overflow && complete(primary) && stateReady
        && (readiness.target !== 'named' || complete(named, false));
      const signature = visible ? JSON.stringify(latest) : null;
      if (!signature || signature !== previous) stableSince = performance.now();
      if (signature && signature === previous && performance.now() - stableSince >= 100) return latest;
      previous = signature;
    }
    throw new Error(`Quiz ${readiness.mode}/${readiness.target || 'controls'} geometry, focus and hit targets did not stabilize: ${JSON.stringify(latest)}`);
  }, readiness);
}

function assertPrimaryGeometry(measured) {
  assert.equal(measured.overflow, false, JSON.stringify(measured));
  const button = measured.primary;
  assert.ok(button && button.y >= -1 && button.bottom <= measured.viewport + 1, `Quiz action must be in the viewport: ${JSON.stringify(measured)}`);
  assert.ok(button.width >= 44 && button.height >= 44 && button.hit, `Quiz action must receive a direct tap: ${JSON.stringify(measured)}`);
  return button;
}

async function assertPrimary(page, feedback = false) {
  const measured = await geometry(page, { mode: feedback ? 'feedback' : 'question' });
  return assertPrimaryGeometry(measured);
}

function assertFeedbackGeometry(measured) {
  // Notice measurements and WebKit hit testing can settle in different frames.
  // Keep the full geometry and hit checks true across paints, then assert that
  // same atomic sample rather than racing a second measurement after waiting.
  assert.ok(measured.feedback.y >= -1 && measured.feedback.bottom <= measured.primary.y - 3, `Feedback must remain above the action: ${JSON.stringify(measured)}`);
  assert.equal(measured.feedback.hit, true, `Feedback must not be hidden by notices: ${JSON.stringify(measured)}`);
  if (measured.answer) {
    assert.ok(measured.answer.y >= 0 && measured.answer.bottom <= measured.primary.y - 3, `The complete answer must be readable: ${JSON.stringify(measured)}`);
    assert.equal(measured.answer.hit, true, `The answer must not be hidden by notices: ${JSON.stringify(measured)}`);
  }
  assertPrimaryGeometry(measured);
}

async function assertFeedback(page) {
  const measured = await geometry(page, { mode: 'feedback' });
  assertFeedbackGeometry(measured);
}

async function tapPrimary(page, feedback = false) {
  const measured = await geometry(page, { mode: feedback ? 'feedback' : 'question', target: 'primary' });
  const button = assertPrimaryGeometry(measured);
  if (feedback) assertFeedbackGeometry(measured);
  await page.touchscreen.tap(button.x + button.width / 2, button.y + button.height / 2);
}

async function tapUnknownAnswer(page) {
  const measured = await geometry(page, { mode: 'question', target: 'skip' });
  assertPrimaryGeometry(measured);
  const button = measured.skip;
  assert.ok(button && button.y >= -1 && button.bottom <= measured.viewport + 1, `Unknown-answer action must be in the viewport: ${JSON.stringify(measured)}`);
  assert.ok(button.width >= 44 && button.height >= 44 && button.hit, `Unknown-answer action must receive a direct tap: ${JSON.stringify(measured)}`);
  await page.touchscreen.tap(button.x + button.width / 2, button.y + button.height / 2);
}

async function tapNamedButton(page, name) {
  const measured = await geometry(page, { mode: 'feedback', target: 'named', name });
  assertFeedbackGeometry(measured);
  const button = measured.named;
  assert.ok(button.y >= 0 && button.bottom <= measured.viewport && button.hit, `${name} must receive a direct tap: ${JSON.stringify(measured)}`);
  await page.touchscreen.tap(button.x + button.width / 2, button.y + button.height / 2);
}

const cases = [
  { name: 'small-fill-wrong', width: 320, height: 568, index: 0 },
  { name: 'small-listen-wrong', width: 320, height: 568, index: 1 },
  { name: 'small-listen-correct', width: 320, height: 568, index: 1, correct: true },
  { name: 'small-fill-unknown-with-empty-input', width: 320, height: 568, index: 0, skip: true },
  { name: 'small-listen-unknown-with-empty-input', width: 320, height: 568, index: 1, skip: true },
  { name: 'small-listen-stacked-fault-notices', width: 320, height: 568, index: 1, warnings: true },
  { name: 'regular-fill-wrong', width: 390, height: 844, index: 0 },
  { name: 'regular-listen-correct', width: 390, height: 844, index: 1, correct: true },
  { name: 'small-restored-feedback', width: 320, height: 568, index: 1, restored: true },
  { name: 'small-large-text-listen-wrong', width: 320, height: 568, index: 1, large: true },
  { name: 'regular-large-text-long-answer', width: 390, height: 844, index: 1, large: true, long: true },
  { name: 'small-held-enter-and-separate-submit', width: 320, height: 568, index: 0, repeat: true },
  { name: 'resized-height-listen-feedback', width: 390, height: 844, index: 1, resize: true },
  { name: 'desktop-fill-feedback', width: 1280, height: 900, index: 0 },
];

const engines = process.env.QUIZ_LAYOUT_ENGINE ? [process.env.QUIZ_LAYOUT_ENGINE] : ['chromium', 'webkit'];
assert.ok(engines.every((engine) => ['chromium', 'webkit'].includes(engine)), 'Unknown quiz layout browser engine.');
for (const engine of engines) {
  const browser = await playwright[engine].launch({ headless: true });
  for (const item of cases) {
    const initial = snapshot(item);
    const context = await browser.newContext({ viewport: { width: item.width, height: item.height }, hasTouch: true, serviceWorkers: 'block' });
    await context.addInitScript(({ key, initial, large }) => {
      if (!sessionStorage.getItem('english-flow-quiz-layout-seeded')) {
        sessionStorage.setItem('english-flow-quiz-layout-seeded', '1');
        localStorage.setItem(key, JSON.stringify(initial));
      }
      if (large) document.addEventListener('DOMContentLoaded', () => {
        const style = document.createElement('style');
        style.textContent = 'html{font-size:22px!important}.quiz-page{padding-top:60px!important}.quiz-page .blank-sentence{font-size:26px!important}.quiz-page .feedback-box{font-size:18px!important;line-height:1.6}.quiz-page .feedback-box button{font-size:16px!important}';
        document.head.appendChild(style);
      });
      window.__quizLayoutSpeech = [];
      window.__quizLayoutTaps = [];
      for (const type of ['touchstart', 'touchend', 'click']) document.addEventListener(type, (event) => {
        const target = event.target instanceof Element ? event.target.closest('button,input') ?? event.target : null;
        const point = event.changedTouches?.[0] ?? event;
        const bounds = target?.getBoundingClientRect();
        window.__quizLayoutTaps.push({ type, x: point.clientX, y: point.clientY, scrollY,
          target: target?.tagName, label: target?.getAttribute('aria-label') ?? target?.textContent?.trim().slice(0, 80),
          top: bounds?.top, bottom: bounds?.bottom, active: document.activeElement?.tagName,
          feedback: Boolean(document.querySelector('.feedback-box')), count: document.querySelector('.quiz-count')?.textContent });
        if (window.__quizLayoutTaps.length > 40) window.__quizLayoutTaps.shift();
      }, { capture: true });
      Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: class { constructor(text) { this.text = text; } } });
      Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
        getVoices: () => [], cancel() {}, resume() {},
        speak(utterance) { window.__quizLayoutSpeech.push(utterance.text); utterance.onstart?.(); },
      } });
    }, { key: wordKey, initial, large: Boolean(item.large) });
    const page = await context.newPage();
    page.setDefaultTimeout(12_000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    try {
      await page.goto(origin, { waitUntil: 'domcontentloaded' });
      await page.locator('.quiz-page input').waitFor({ timeout: 30_000 });
      const input = page.locator('.quiz-page input');
      await geometry(page, { mode: item.restored ? 'feedback' : 'question' });
      if (item.warnings) {
        await page.evaluate(() => {
          window.dispatchEvent(new CustomEvent('english-flow-speech-error', { detail: 'not-allowed' }));
          window.dispatchEvent(new Event('english-flow-offline-cache-error'));
          window.dispatchEvent(new Event('offline'));
        });
        await page.locator('.offline-status').waitFor();
      }
      assert.equal(await page.locator('.bottom-nav').count(), 0, 'Quiz retains its focused navigation mode');
      if (item.restored) {
        await assertFeedback(page);
        assert.deepEqual((await saved(page)).quizResults, initial.quizResults, 'Restored feedback does not submit again');
      } else {
        assert.equal(await page.locator('.feedback-box').count(), 0, 'Unanswered questions keep their answer hidden');
        assert.equal(await page.evaluate(() => window.__quizLayoutSpeech.length), 0, 'Quiz entry must not automatically speak its answer');
        await assertPrimary(page);
        if (item.resize) await page.setViewportSize({ width: item.width, height: 568 });
        if (item.skip) {
          assert.equal(await input.inputValue(), '');
          assert.equal(await page.locator('.quiz-page .sticky-start').isDisabled(), true, 'Empty input keeps submit disabled');
          await tapUnknownAnswer(page);
        } else if (item.repeat) {
          await input.fill('unrecognized');
          await input.evaluate((element) => element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true, cancelable: true })));
          assert.equal(await page.locator('.feedback-box').count(), 0, 'Held Enter does not submit');
          await input.press('Enter');
        } else {
          await input.fill(item.correct ? (item.index === 0 ? 'the' : 'be') : 'unrecognized');
          await tapPrimary(page);
        }
        await page.locator('.feedback-box').waitFor();
        await assertFeedback(page);
        await settleLearningStorage(page);
        const answered = await saved(page);
        assert.equal(answered.quizIndex, item.index, 'Submitting never advances the question');
        assert.deepEqual(answered.quizResults, [...Array(item.index).fill(true), Boolean(item.correct)]);
        if (item.skip) {
          assert.equal(answered.quizAnswer, '', 'Revealing an unknown answer never fabricates input');
          await input.evaluate((element) => element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
          assert.deepEqual((await saved(page)).quizResults, answered.quizResults, 'A late submit event must not score revealed feedback again');
          assert.equal((await saved(page)).quizIndex, item.index, 'A late input event never advances the revealed question');
        }
        assert.equal(await input.isDisabled(), true, 'Submitted input is locked while feedback is shown');
        await page.waitForFunction(() => document.activeElement === document.querySelector('.quiz-page .sticky-start'));
        assert.equal(await page.evaluate(() => document.activeElement?.textContent), item.index === 2 ? '查看结果' : '下一题');
        if (item.repeat) {
          const prevented = await page.locator('.quiz-page .sticky-start').evaluate((button) => !button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true, cancelable: true })));
          assert.equal(prevented, true, 'Held Enter cannot advance feedback');
          assert.equal((await saved(page)).quizIndex, item.index);
        }
        if (item.warnings) {
          for (const name of ['关闭语音提示', '关闭离线保存提示']) {
            await tapNamedButton(page, name);
            await page.getByRole('button', { name, exact: true }).waitFor({ state: 'hidden' });
            await assertFeedback(page);
          }
          await page.evaluate(() => window.dispatchEvent(new Event('online')));
          await page.locator('.status-toast-stack').waitFor({ state: 'hidden' });
          await page.setViewportSize({ width: item.width, height: 844 });
          await assertFeedback(page);
          assert.deepEqual((await saved(page)).quizResults, answered.quizResults, 'Dismissing notices and resizing never scores again');
        }
      }
      if (item.resize) {
        await page.setViewportSize({ width: item.width, height: 844 });
        await assertFeedback(page);
      }
      await tapPrimary(page, true);
      await page.waitForFunction(({ key, index }) => JSON.parse(localStorage.getItem(key) || 'null')?.quizIndex === index + 1, { key: wordKey, index: item.index });
      assert.equal(await page.locator('.feedback-box').count(), 0, 'Next question hides the prior answer');
      const advanced = await saved(page);
      assert.equal(advanced.quizAnswer, '');
      assert.equal(advanced.quizFeedback, null);
      assert.equal(advanced.quizResults.length, item.index + 1, 'Direct next records no second result');
      await page.waitForFunction(() => document.activeElement === document.querySelector('.quiz-page input'));
      await geometry(page, { mode: 'question' });
      assert.equal(await input.evaluate((element) => document.activeElement === element), true, 'Next question returns focus to its input');
      assert.deepEqual(errors, []);
      results.push({ engine, name: item.name, status: 'PASS' });
    } catch (error) {
      results.push({ engine, name: item.name, status: 'FAIL', error: String(error), geometry: await geometry(page).catch(() => null),
        tapEvents: await page.evaluate(() => window.__quizLayoutTaps ?? []).catch(() => []), errors });
      await page.screenshot({ path: path.join(evidence, `${engine}-quiz-${item.name}.png`), fullPage: true }).catch(() => undefined);
    } finally {
      console.log(JSON.stringify(results.at(-1)));
      await context.close();
    }
  }
  await browser.close();
}
const failed = results.filter((result) => result.status === 'FAIL').length;
console.log('QUIZ_LAYOUT_SUMMARY', JSON.stringify({ passed: results.length - failed, failed, total: results.length }));
if (failed) process.exitCode = 1;
