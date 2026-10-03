import { openSetupDetails, selectSentenceMethod, resumePausedSentence, sentenceChoices } from './browser-disclosures.mjs';
import { navigate, openLegacyPatterns } from './browser-navigation.mjs';
import { settleLearningStorage } from './storage-settlement-checks.mjs';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

if (!process.env.PLAYWRIGHT_MODULE) throw Error('Set PLAYWRIGHT_MODULE; see TESTING.md.');
const pw = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const origin = process.env.BROWSER_TEST_URL || 'http://127.0.0.1:4173';
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname)) throw Error('Synthetic setup records must stay on a local origin.');
const results = [];
const wordKey = 'wordflow-active-session-v1', sentenceKey = 'wordflow-sentence-active-session-v1', patternKey = 'wordflow-pattern-active-session-v1';
const wordStart = '开始学习', sentenceStart = '开始学习句子', patternStart = '开始句型替换练习';
const start = (page, label) => label === sentenceStart
  ? page.locator('.sentence-page .setup-start').and(page.getByRole('button', { name: /^(?:开始学习句子|正在加载句子…)$/, exact: true }))
  : page.getByRole('button', { name: label, exact: true });
const saved = (page, key) => page.evaluate(key => JSON.parse(localStorage.getItem(key) || 'null'), key);
const exitWord = page => page.getByRole('button', { name: '退出学习并保留进度', exact: true }).click();
const exitSentence = page => page.getByRole('button', { name: '返回句库设置并保留进度', exact: true }).click();
const exitPattern = page => page.getByRole('button', { name: '返回句型设置并保留进度', exact: true }).click();
async function ready(page) { await page.goto(origin, { waitUntil: 'domcontentloaded' }); await page.locator('.bottom-nav').waitFor(); }
async function enabled(page, label) {
  await page.waitForFunction(label => {
    const button = [...document.querySelectorAll('button')].find(button => button.textContent === label);
    return button && !button.disabled;
  }, label);
}
async function topStart(page, label) {
  assert.equal(await start(page, label).count(), 1);
  const m = await start(page, label).evaluate(button => {
    const rect = button.getBoundingClientRect(), section = button.closest('section');
    const header = section.querySelector('header').getBoundingClientRect();
    const options = [...section.querySelectorAll('.setup-block,.setup-disclosure')].find(element => element.getBoundingClientRect().height > 0).getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, bottom: rect.bottom, headerBottom: header.bottom,
      optionsTop: options.top, navTop: document.querySelector('.bottom-nav').getBoundingClientRect().top, scrollY,
      viewport: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth + 1,
      hit: button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)), position: getComputedStyle(button).position };
  });
  assert.ok(m.scrollY <= 1, 'Opening setup must not require scrolling');
  assert.ok(m.y >= m.headerBottom - 1 && m.y < 300, 'Start must be directly below the header');
  assert.ok(m.bottom <= m.optionsTop && m.bottom < m.navTop, 'Start must precede settings and bottom navigation');
  assert.ok(m.height >= 44 && m.x >= 0 && m.x + m.width <= m.viewport + 1 && m.hit, 'Start must be an unobstructed touch target');
  assert.equal(m.overflow, false); assert.equal(m.position, 'static');
  return m;
}
async function tapStart(page, label) { const m = await topStart(page, label); await page.touchscreen.tap(m.x + m.width / 2, m.y + m.height / 2); }
async function sentenceBand(page, label) {
  await openSetupDetails(page, '.sentence-range');
  await page.locator('.sentence-band-switch button').filter({ hasText: label }).click();
  await enabled(page, sentenceStart); await page.evaluate(() => scrollTo(0, 0));
}
async function settleNavigation(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
const legacyPattern = { version: 1, updatedAt: Date.now(), category: 'all', patternIds: ['p01', 'p02', 'p03', 'p04', 'p05', 'p06', 'p07', 'p08', 'p09', 'p10'], index: 0, drillIndex: 0, ratings: {} };

for (const engine of ['chromium', 'webkit']) {
  const browser = await pw[engine].launch({ headless: true });
  async function check(name, fn, { width = 390, height = 844, largeText = false, seed = null } = {}) {
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: true, serviceWorkers: 'block' });
    await context.addInitScript(({ seed, patternKey }) => {
      if (seed && !sessionStorage.getItem('setup-start-legacy-seed')) {
        sessionStorage.setItem('setup-start-legacy-seed', '1'); localStorage.setItem(patternKey, JSON.stringify(seed));
      }
      Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: class { constructor(text) { this.text = text; } } });
      Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
        paused: false, getVoices() { return []; }, cancel() {}, resume() { this.paused = false; },
        speak(utterance) { queueMicrotask(() => { utterance.onstart?.(); utterance.onend?.(); }); },
      } });
    }, { seed, patternKey });
    const page = await context.newPage(); page.setDefaultTimeout(15000); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await ready(page);
      if (largeText) await page.addStyleTag({ content: 'html{font-size:20px!important}.page{padding-top:60px!important}' });
      await fn(page, context); assert.deepEqual(errors, []); results.push({ engine, name, status: 'PASS' });
    } catch (error) {
      results.push({ engine, name, status: 'FAIL', error: String(error), body: (await page.locator('body').innerText().catch(() => '')).slice(0, 2200), errors });
    } finally { await context.close(); }
    console.log(JSON.stringify(results.at(-1)));
  }
  for (const [label, width, height, largeText] of [['small-phone', 320, 568, false], ['compact-phone', 375, 667, false], ['browser-bars', 390, 700, false], ['reported-phone', 390, 844, false], ['large-text', 430, 932, true], ['desktop', 1280, 900, false]]) {
    await check(label + '-two-module-starts-directly-tappable-with-continuous-ranges', async page => {
      await navigate(page, '单词'); await tapStart(page, wordStart); await page.locator('.word-card').waitFor();
      await settleLearningStorage(page);
      const word = await saved(page, wordKey); assert.equal(word.continuous, true); assert.equal(word.mode, 'free'); assert.ok(word.wordIds.length > 20);
      assert.equal(await page.locator('.immersive-learning').count(), 1); assert.equal(await page.locator('.bottom-nav').count(), 0);
      assert.equal(await page.locator('.word-auto-controls').count(), 0);
      await exitWord(page); await navigate(page, '句子'); await enabled(page, sentenceStart); await tapStart(page, sentenceStart);
      await page.locator('.sentence-study-card').waitFor(); await settleLearningStorage(page); const sentence = await saved(page, sentenceKey);
      assert.equal(sentence.continuous, true); assert.ok(sentence.sentenceIds.length > 20); assert.equal(sentence.mode, 'bilingual');
    }, { width, height, largeText });
  }
  await check('normal-word-setup-has-no-mode-or-count-and-keeps-range-and-search', async page => {
    await navigate(page, '单词');
    for (const name of ['自由学习', '学习＋考试', '10 个', '20 个']) assert.equal(await page.getByRole('button', { name, exact: true }).count(), 0);
    await openSetupDetails(page, '.word-range'); await page.locator('.scene-list button').filter({ hasText: '日常' }).first().click();
    await page.evaluate(() => scrollTo(0, 0)); assert.match(await page.locator('#word-session-choice').innerText(), /日常/);
    await tapStart(page, wordStart); await page.locator('.word-card').waitFor(); await settleLearningStorage(page); const word = await saved(page, wordKey);
    assert.equal(word.mode, 'free'); assert.equal(word.path, 'daily'); assert.equal(word.continuous, true); assert.ok(word.wordIds.length > 0);
    await exitWord(page); await openSetupDetails(page, '.word-find'); await page.getByRole('searchbox', { name: '搜索词库' }).fill('the');
    await page.locator('.library-list button').first().waitFor();
  });
  await check('word-continuous-learning-crosses-twenty-and-exit-reload-keeps-exact-position', async page => {
    await navigate(page, '单词'); await start(page, wordStart).click(); await page.locator('.word-card').waitFor();
    for (let index = 0; index < 21; index++) {
      await page.getByRole('button', { name: '下一张 ›', exact: true }).click();
      await page.waitForFunction(({ key, index }) => JSON.parse(localStorage.getItem(key))?.index === index + 1, { key: wordKey, index });
    }
    await page.getByRole('button', { name: '我学会了', exact: true }).click();
    await page.waitForFunction(key => Object.keys(JSON.parse(localStorage.getItem(key)).ratings).length === 1, wordKey);
    const before = await saved(page, wordKey); assert.ok(before.index > 20); await exitWord(page);
    assert.equal(await page.locator('#discard-title').count(), 0, 'Continuous pause is direct and saves progress');
    await start(page, wordStart).click(); await page.locator('.word-card').waitFor(); assert.deepEqual(await saved(page, wordKey), before);
    await page.reload(); await page.locator('.word-card').waitFor(); assert.deepEqual(await saved(page, wordKey), before);
  });
  await check('sentence-continuous-learning-crosses-twenty-and-exit-start-keeps-ids-and-ratings', async page => {
    await navigate(page, '句子'); await enabled(page, sentenceStart); await start(page, sentenceStart).click(); await page.locator('.sentence-study-card').waitFor();
    for (let index = 0; index < 21; index++) {
      await page.getByRole('button', { name: '下一句 ›', exact: true }).click();
      await page.waitForFunction(({ key, index }) => JSON.parse(localStorage.getItem(key))?.index === index + 1, { key: sentenceKey, index });
    }
    await page.getByRole('button', { name: '还不熟悉', exact: true }).click();
    await page.waitForFunction(key => Object.keys(JSON.parse(localStorage.getItem(key)).ratings).length === 1, sentenceKey);
    const before = await saved(page, sentenceKey); assert.ok(before.index > 20); await exitSentence(page);
    for (let attempt = 0; attempt < 2; attempt++) {
      await start(page, sentenceStart).click(); await page.locator('.sentence-study-card').waitFor();
      assert.equal(await page.locator('#discard-title').count(), 0); assert.deepEqual(await saved(page, sentenceKey), before); await exitSentence(page);
    }
    await page.reload(); await page.locator('.sentence-study-card').waitFor(); assert.deepEqual(await saved(page, sentenceKey), before);
  });
  await check('top-sentence-start-uses-selected-speaking-mode-and-full-selected-band', async page => {
    await navigate(page, '句子'); await enabled(page, sentenceStart);
    await selectSentenceMethod(page, '看中文说英文'); await sentenceBand(page, '常用句');
    const choices = (await sentenceChoices(page)).join(' '); assert.match(choices, /看中文说英文/); assert.match(choices, /常用句/);
    await page.evaluate(() => scrollTo(0, 0));
    await tapStart(page, sentenceStart); await page.locator('.speak-prompt').waitFor(); await settleLearningStorage(page); const session = await saved(page, sentenceKey);
    assert.equal(session.continuous, true); assert.ok(session.sentenceIds.length > 20); assert.ok(session.sentenceIds.every(id => id > 1000 && id <= 2000));
    assert.equal(await page.locator('.sentence-english').count(), 0);
  });
  await check('top-sentence-start-disabled-until-selected-pack-arrives', async (page, context) => {
    await navigate(page, '句子'); await enabled(page, sentenceStart);
    let release; const gate = new Promise(resolve => { release = resolve; });
    await context.route(/tatoeba-sentences-2\.json/, async route => { await gate; await route.continue().catch(() => {}); });
    try {
      const request = page.waitForRequest(request => request.url().includes('tatoeba-sentences-2.json'));
      await openSetupDetails(page, '.sentence-range'); await page.locator('.sentence-band-switch button').filter({ hasText: '常用句' }).click(); await request;
      await page.evaluate(() => scrollTo(0, 0)); assert.equal(await start(page, sentenceStart).isDisabled(), true);
      assert.equal(await start(page, sentenceStart).getAttribute('aria-busy'), 'true');
      assert.equal(await start(page, sentenceStart).innerText(), '正在加载句子…');
      const before = await saved(page, sentenceKey); await tapStart(page, sentenceStart); assert.deepEqual(await saved(page, sentenceKey), before);
      release(); await enabled(page, sentenceStart); await tapStart(page, sentenceStart); await page.locator('.sentence-study-card').waitFor();
    } finally { release(); }
  });
  await check('changed-sentence-mode-protects-paused-listening-and-explicit-resume-retains-it', async page => {
    await navigate(page, '句子'); await enabled(page, sentenceStart); await start(page, sentenceStart).click(); await page.locator('.sentence-study-card').waitFor();
    await page.locator('.learn-actions .secondary-action').click();
    await page.waitForFunction(key => Object.keys(JSON.parse(localStorage.getItem(key)).ratings).length === 1, sentenceKey);
    const before = await saved(page, sentenceKey); await exitSentence(page);
    await selectSentenceMethod(page, '看中文说英文');
    assert.deepEqual(await saved(page, sentenceKey), before); await start(page, sentenceStart).click(); await page.locator('#discard-title').waitFor();
    await page.getByRole('button', { name: '保留进度', exact: true }).click(); assert.deepEqual(await saved(page, sentenceKey), before);
    await resumePausedSentence(page); await page.locator('.sentence-study-card').waitFor();
    assert.equal(await page.locator('.speak-prompt').count(), 0); assert.deepEqual(await saved(page, sentenceKey), before);
  });
  for (const [name, width, height, largeText] of [['small', 320, 568, false], ['phone', 390, 844, false], ['large-text', 430, 932, true]]) {
    await check('simple-setup-' + name + '-keeps-range-search-folded-and-only-two-sentence-methods', async page => {
      await navigate(page, '单词'); assert.equal(await page.locator('h1').innerText(), '单词');
      for (const selector of ['.word-range', '.word-find']) assert.equal(await page.locator(selector).evaluate(element => element.open), false);
      assert.equal(await page.getByRole('searchbox', { name: '搜索词库' }).isVisible(), false); await topStart(page, wordStart);
      const summary = page.locator('.word-range>summary'); await summary.focus(); await page.keyboard.press('Enter');
      await page.locator('.scene-list button').first().waitFor(); await page.locator('.scene-list button').first().click();
      assert.match(await page.locator('#word-session-choice').innerText(), /日常/); await summary.click();
      await openSetupDetails(page, '.word-find'); await page.getByRole('searchbox', { name: '搜索词库' }).fill('the'); await page.locator('.library-list button').first().waitFor();
      await page.locator('.word-find>summary').click(); await openSetupDetails(page, '.word-find'); assert.equal(await page.getByRole('searchbox', { name: '搜索词库' }).inputValue(), 'the');
      await navigate(page, '句子'); await enabled(page, sentenceStart); assert.equal(await page.locator('h1').innerText(), '句子');
      for (const selector of ['.sentence-range', '.sentence-find']) assert.equal(await page.locator(selector).evaluate(element => element.open), false);
      assert.equal(await page.locator('.practice-methods button').count(), 2); assert.equal(await page.getByRole('button', { name: '核心句型', exact: true }).count(), 0);
      assert.equal(await page.locator('.practice-methods').isVisible(), false);
      assert.equal(await page.locator('.session-choice-summary,.resume-session-card,.setup-footnote').count(), 0);
      for (const label of ['10 句', '20 句']) assert.equal(await page.getByRole('button', { name: label, exact: true }).count(), 0);
      await selectSentenceMethod(page, '看中文说英文'); assert.match((await sentenceChoices(page)).join(' '), /看中文说英文/);
      assert.equal(await page.locator('.sentence-range .practice-methods').isVisible(), true);
      await selectSentenceMethod(page, '英文卡片');
      await openSetupDetails(page, '.sentence-find'); await page.locator('.sentence-summary button').last().click();
      await page.getByText('还没有收藏句子。学习时点 ☆ 就能在这里找到。', { exact: true }).waitFor();
      await page.locator('.browser-switch').click(); await page.getByRole('searchbox', { name: '搜索长短句' }).fill('I');
      await page.locator('.sentence-result-list button[data-sentence-id]').first().waitFor();
      await page.locator('.setup-source>summary').click(); assert.equal(await page.getByRole('link', { name: 'Tatoeba 数据与授权' }).isVisible(), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      for (const selector of ['.setup-disclosure>summary', '.practice-methods button'])
        for (const target of await page.locator(selector).all()) assert.ok(await target.evaluate(element => element.getBoundingClientRect().height >= 44));
    }, { width, height, largeText });
  }
  await check('new-method-after-single-sentence-lookup-opens-setup-at-top-and-retains-query', async page => {
    await navigate(page, '句子'); await enabled(page, sentenceStart); await openSetupDetails(page, '.sentence-find');
    await page.getByRole('searchbox', { name: '搜索长短句' }).fill('I'); await page.locator('.sentence-result-list button[data-sentence-id]').nth(5).click();
    await page.locator('.sentence-study-card').waitFor(); await settleLearningStorage(page); const before = await saved(page, sentenceKey);
    await navigate(page, '首页'); await navigate(page, '句子');
    await selectSentenceMethod(page, '看中文说英文'); await settleNavigation(page); await page.waitForFunction(() => scrollY === 0);
    await topStart(page, sentenceStart); assert.deepEqual(await saved(page, sentenceKey), before);
    await openSetupDetails(page, '.sentence-find'); assert.equal(await page.getByRole('searchbox', { name: '搜索长短句' }).inputValue(), 'I');
    assert.equal(await page.locator('button[data-sentence-id]:focus').count(), 0);
  });
  await check('returning-from-favorites-does-not-steal-a-fast-search-input', async page => {
    await navigate(page, '句子'); await enabled(page, sentenceStart); await openSetupDetails(page, '.sentence-find');
    await page.locator('.sentence-summary button').last().click();
    await page.getByText('还没有收藏句子。学习时点 ☆ 就能在这里找到。', { exact: true }).waitFor(); await settleNavigation(page);
    // Delay the first frame requested by the real return-to-search click so
    // the learner can focus/type first. Other browser frames remain native.
    await page.evaluate(() => {
      const nativeFrame = window.requestAnimationFrame.bind(window);
      let holdNext = false;
      document.addEventListener('click', event => { if (event.target.closest('.browser-switch')) holdNext = true; }, true);
      window.requestAnimationFrame = callback => {
        if (holdNext) { holdNext = false; window.__sentenceSearchFocusFrame = callback; return nativeFrame(() => {}); }
        return nativeFrame(callback);
      };
    });
    await page.locator('.browser-switch').click();
    const input = page.getByRole('searchbox', { name: '搜索长短句' }); await input.fill('airport');
    assert.equal(await input.evaluate(element => document.activeElement === element), true);
    assert.equal(await page.evaluate(() => typeof window.__sentenceSearchFocusFrame), 'function');
    await page.evaluate(() => window.__sentenceSearchFocusFrame(performance.now()));
    assert.equal(await input.evaluate(element => document.activeElement === element), true, 'The late frame must preserve the learner focus');
    await page.keyboard.type(' '); assert.equal(await input.inputValue(), 'airport ');
    await page.locator('.sentence-result-list button[data-sentence-id]').first().waitFor();
  }, { width: 320, height: 568 });
  await check('legacy-pattern-v1-keeps-substitution-and-record-management-resume-with-hidden-answer', async page => {
    await page.locator('.pattern-prompt').waitFor(); await page.getByRole('button', { name: '我说好了，查看参考答案', exact: true }).click();
    await page.getByRole('button', { name: '下一组 ›', exact: true }).click();
    await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).drillIndex === 1, patternKey);
    const before = await saved(page, patternKey); await exitPattern(page); await tapStart(page, patternStart); await page.locator('.pattern-prompt').waitFor();
    assert.equal(await page.locator('#discard-title').count(), 0); assert.deepEqual(await saved(page, patternKey), before); assert.equal(await page.locator('.pattern-answer').count(), 0);
    await openLegacyPatterns(page); await page.locator('.pattern-prompt').waitFor();
    assert.deepEqual(await saved(page, patternKey), before); assert.equal(await page.locator('.pattern-answer').count(), 0);
  }, { seed: legacyPattern });
  await check('legacy-pattern-top-start-protects-changed-scene-without-normal-core-pattern-entry', async page => {
    await page.locator('.pattern-prompt').waitFor(); await page.getByRole('button', { name: '我说好了，查看参考答案', exact: true }).click();
    await page.getByRole('button', { name: '下一组 ›', exact: true }).click();
    await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).drillIndex === 1, patternKey);
    const before = await saved(page, patternKey); await exitPattern(page); await openSetupDetails(page, '.pattern-range');
    await page.locator('.pattern-category-grid button').filter({ hasText: '出行' }).click(); await page.evaluate(() => scrollTo(0, 0));
    await tapStart(page, patternStart); await page.locator('#discard-title').waitFor(); await page.getByRole('button', { name: '保留进度', exact: true }).click();
    assert.deepEqual(await saved(page, patternKey), before); await tapStart(page, patternStart);
    await page.getByRole('button', { name: '结束并开始新练习', exact: true }).click(); await page.locator('.pattern-prompt').waitFor();
    await settleLearningStorage(page);
    assert.equal((await saved(page, patternKey)).category, 'travel'); assert.equal(await page.locator('.pattern-answer').count(), 0);
  }, { seed: legacyPattern });
  await browser.close();
}
const failed = results.filter(result => result.status === 'FAIL').length;
console.log('SETUP_START_SUMMARY', JSON.stringify({ passed: results.length - failed, failed, total: results.length }));
if (failed) process.exitCode = 1;
