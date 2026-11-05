import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { navigate } from './browser-navigation.mjs';
import { selectSentenceMethod } from './browser-disclosures.mjs';
import { settleLearningStorage } from './storage-settlement-checks.mjs';

if (!process.env.PLAYWRIGHT_MODULE) throw Error('Set PLAYWRIGHT_MODULE; see TESTING.md.');
const pw = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const origin = process.env.BROWSER_TEST_URL || 'http://127.0.0.1:4173';
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname)) throw Error('Polish checks use disposable local learning records only.');
const engines = process.env.BROWSER_ENGINES?.split(',').map(value => value.trim()).filter(Boolean) || ['chromium', 'webkit'];
if (!engines.length || engines.some(engine => !['chromium', 'webkit'].includes(engine))) throw Error('BROWSER_ENGINES must contain chromium and/or webkit.');
const results = [];

async function records(page) {
  await settleLearningStorage(page);
  return page.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter(key => key.startsWith('wordflow')).sort().map(key => [key, localStorage.getItem(key)])));
}

async function noHorizontalOverflow(page) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'The document must fit the viewport horizontally');
}

async function slowButtonGeometry(page) {
  const geometry = await page.locator('.sentence-slow').evaluate(button => {
    const range = document.createRange();
    range.selectNodeContents(button);
    const label = range.getBoundingClientRect(), bounds = button.getBoundingClientRect();
    const bookmark = document.querySelector('.sentence-bookmark').getBoundingClientRect();
    const hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    return { labelLeft: label.left, labelRight: label.right, buttonLeft: bounds.left, buttonRight: bounds.right,
      width: bounds.width, height: bounds.height, bookmarkLeft: bookmark.left, viewport: innerWidth,
      unobstructed: hit === button || button.contains(hit) };
  });
  assert.ok(geometry.width >= 44 && geometry.height >= 44, JSON.stringify(geometry));
  assert.ok(geometry.labelLeft >= geometry.buttonLeft - 1 && geometry.labelRight <= geometry.buttonRight + 1, 'Slow-play text must stay inside its button: ' + JSON.stringify(geometry));
  assert.ok(geometry.buttonRight <= geometry.bookmarkLeft && geometry.labelRight <= geometry.bookmarkLeft, 'Slow-play text must not overlap the bookmark: ' + JSON.stringify(geometry));
  assert.ok(geometry.buttonLeft >= 0 && geometry.buttonRight <= geometry.viewport && geometry.unobstructed, 'Slow play must remain directly tappable');
  await noHorizontalOverflow(page);
}

async function startSentences(page, recall) {
  await navigate(page, '句子');
  if (recall) await selectSentenceMethod(page, '看中文说英文');
  await page.waitForFunction(() => { const start = document.querySelector('.sentence-page .setup-start'); return start && !start.disabled; });
  await page.getByRole('button', { name: '开始学习句子', exact: true }).click();
  await page.locator('.sentence-study-card').waitFor();
}

async function manualSlowPlay(page) {
  const before = await records(page);
  const english = await page.locator('.sentence-english').innerText();
  await page.evaluate(() => { window.__polishSpeech.length = 0; });
  await page.getByRole('button', { name: '慢速播放', exact: true }).click();
  await page.waitForFunction(() => window.__polishSpeech.length > 0);
  const utterances = await page.evaluate(() => window.__polishSpeech);
  assert.equal(utterances[0].text, english);
  assert.equal(utterances[0].lang, 'en-US');
  assert.ok(utterances[0].rate < 0.8, 'The slow-play action must request a slower English utterance');
  assert.deepEqual(await records(page), before, 'Replaying must preserve the entire saved learning record');
}

for (const engine of engines) {
  const browser = await pw[engine].launch({ headless: true });
  async function check(name, body, { width = 320, height = 568, largeText = false } = {}) {
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: true, serviceWorkers: 'block' });
    // Speech callbacks are instrumented. This verifies controls and records,
    // not physical device audio, voice quality or headphone behavior.
    await context.addInitScript(() => {
      window.__polishSpeech = [];
      Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: class { constructor(text) { this.text = text; } } });
      Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
        paused: false,
        getVoices() { return [{ lang: 'en-US', name: 'English' }, { lang: 'zh-CN', name: 'Chinese' }]; },
        cancel() {}, resume() {},
        speak(utterance) {
          window.__polishSpeech.push({ text: utterance.text, lang: utterance.lang, rate: utterance.rate });
          queueMicrotask(() => { utterance.onstart?.(); utterance.onend?.(); });
        },
      } });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(origin, { waitUntil: 'domcontentloaded' });
      await page.locator('.bottom-nav').waitFor();
      if (largeText) await page.addStyleTag({ content: 'html{font-size:32px!important}' });
      await body(page);
      assert.deepEqual(errors, []);
      results.push({ engine, name, status: 'PASS' });
    } catch (error) {
      results.push({ engine, name, status: 'FAIL', error: String(error), errors, body: (await page.locator('body').innerText().catch(() => '')).slice(-1800) });
    } finally {
      await context.close();
    }
    console.log(JSON.stringify(results.at(-1)));
  }

  for (const largeText of [false, true]) await check(`bilingual-slow-play-${largeText ? '200-percent' : 'ordinary-text'}-fits-without-changing-records`, async page => {
    await startSentences(page, false);
    await slowButtonGeometry(page);
    await manualSlowPlay(page);
  }, { largeText });

  await check('recall-200-percent-keeps-answer-protected-and-slow-play-reachable-after-reveal', async page => {
    await startSentences(page, true);
    assert.equal(await page.locator('.sentence-english').count(), 0);
    assert.equal(await page.locator('.sentence-slow').isDisabled(), true);
    assert.deepEqual(await page.evaluate(() => window.__polishSpeech), []);
    await slowButtonGeometry(page);
    await page.getByRole('button', { name: '我说好了，查看英文答案', exact: true }).click();
    assert.equal(await page.locator('.sentence-slow').isEnabled(), true);
    await slowButtonGeometry(page);
    await manualSlowPlay(page);
  }, { largeText: true });

  await check('home-identifies-the-product-and-keeps-both-learning-entries-at-phone-and-large-text-widths', async page => {
    for (const enlarged of [false, true]) {
      if (enlarged) {
        await page.setViewportSize({ width: 320, height: 568 });
        await page.addStyleTag({ content: 'html{font-size:32px!important}' });
      }
      await navigate(page, '首页');
      assert.equal(await page.locator('.dashboard-brand').innerText(), '词流英语');
      assert.deepEqual(await page.locator('.bottom-nav button small').allTextContents(), ['首页', '单词', '句子']);
      assert.equal(await page.locator('.dashboard-progress-row').count(), 2);
      const colors = await page.evaluate(() => {
        const word = getComputedStyle(document.querySelector('.home-word-progress strong')).color.match(/\d+/g).map(Number);
        const sentence = getComputedStyle(document.querySelector('.home-sentence-progress strong')).color.match(/\d+/g).map(Number);
        return { word, sentence };
      });
      assert.ok(colors.word[1] > colors.word[0] && colors.word[1] > colors.word[2], 'Words retain a green progress accent');
      assert.ok(colors.sentence[2] > colors.sentence[0] && colors.sentence[0] > colors.sentence[1], 'Sentences have a distinct purple progress accent');
      await noHorizontalOverflow(page);
      await page.locator('.home-word-progress').click();
      await page.locator('.setup-page .setup-start').waitFor();
      await navigate(page, '首页');
      await page.locator('.home-sentence-progress').click();
      await page.locator('.sentence-page .setup-start').waitFor();
      await noHorizontalOverflow(page);
    }
  }, { width: 390, height: 844 });

  await check('large-text-record-tools-and-reset-cancellation-keep-learning-records', async page => {
    await navigate(page, '单词');
    await page.getByRole('button', { name: '开始学习', exact: true }).click();
    await page.locator('.word-card').waitFor();
    await page.getByRole('button', { name: '我学会了', exact: true }).click();
    await navigate(page, '进度');
    const before = await records(page);
    const reset = page.getByRole('button', { name: '重置', exact: true });
    await reset.scrollIntoViewIfNeeded();
    assert.equal(await reset.evaluate(button => {
      const range = document.createRange(); range.selectNodeContents(button);
      const label = range.getBoundingClientRect(), bounds = button.getBoundingClientRect();
      const hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      return label.left >= bounds.left - 1 && label.right <= bounds.right + 1 && bounds.width >= 44 && bounds.height >= 44 && (hit === button || button.contains(hit));
    }), true, 'Reset remains readable and reachable by normal scrolling');
    await noHorizontalOverflow(page);
    await reset.click();
    const dialog = page.getByRole('dialog', { name: '确定重置学习进度？', exact: true });
    await dialog.waitFor();
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.deepEqual(await records(page), before, 'Canceling reset must preserve every learning-record field');
  }, { largeText: true });

  await browser.close();
}

const failed = results.filter(result => result.status === 'FAIL').length;
console.log('POLISH_SUMMARY', JSON.stringify({ passed: results.length - failed, failed, total: results.length, engines, largeTextIsRootFontEmulation: true, physicalAudioVerified: false }));
if (failed) process.exitCode = 1;
