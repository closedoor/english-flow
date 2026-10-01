import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

if (!process.env.PLAYWRIGHT_MODULE) throw new Error('Set PLAYWRIGHT_MODULE to the isolated Playwright installation.');
const playwright = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const base = new URL(process.env.PRODUCTION_URL || 'https://english-flow-mwnn.onrender.com/');
if (!['https://english-flow-mwnn.onrender.com', 'http://127.0.0.1:4173'].includes(base.origin)) {
  throw new Error('Only the official English Flow site or its local rehearsal is allowed.');
}
const expected = process.env.EXPECTED_COMMIT;
assert.match(expected || '', /^[0-9a-f]{40}$/, 'EXPECTED_COMMIT must be a full Git commit SHA');
const later = expected === 'f'.repeat(40) ? 'e'.repeat(40) : 'f'.repeat(40);
const choices = { band: 'short', category: 'food', count: 20, mode: 'speak' };
const keys = {
  preferences: 'wordflow-sentence-preferences-v1', word: 'wordflow-active-session-v1',
  sentence: 'wordflow-sentence-active-session-v1', rotation: 'wordflow-practice-rotation-v1',
};
const stored = (page, key) => page.evaluate(key => JSON.parse(localStorage.getItem(key) || 'null'), key);
const nav = (page, label) => page.locator('.bottom-nav button').filter({ hasText: label }).click();
const results = [];

async function retainChoices(page) {
  assert.deepEqual(await stored(page, keys.preferences), choices);
  const summary = await page.locator('.session-choice-summary').innerText();
  for (const label of ['看中文说英文', '短句', '餐饮', '20 句']) assert.ok(summary.includes(label), summary);
}
async function beginWords(page) {
  await nav(page, '学习');
  await page.getByRole('button', { name: '自由学习', exact: false }).click();
  await page.getByRole('button', { name: '10 个', exact: true }).click();
  await page.getByRole('button', { name: '开始这组学习', exact: true }).click();
  await page.locator('.word-card').waitFor();
}
async function identify(page, scripts) {
  const url = new URL('/', base);
  url.searchParams.set('ef-update', expected);
  const response = await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  assert.equal(response.status(), 200);
  assert.equal(await page.title(), '词流英语');
  assert.equal(await page.locator('meta[name="english-flow-build"]').getAttribute('content'), expected);
  await page.locator('.bottom-nav').waitFor();
  await nav(page, '进度');
  assert.ok((await page.locator('.app-version-panel').innerText()).includes(`当前版本 ${expected.slice(0, 7)}`),
    'The executing client must report the expected release');
  assert.ok((await Promise.all(scripts)).some(source => source.includes(expected)),
    'The full expected release identity must appear in a loaded client module');
}

for (const engine of ['chromium', 'webkit']) {
  const browser = await playwright[engine].launch({ headless: true });
  async function check(name, body, seed = {}) {
    // Fresh, disposable profiles only. Real Service Worker acceptance is separate
    // in verify-live-pwa.mjs; these UI checks must not intercept a learner's cache.
    const context = await browser.newContext({ viewport: { width: 390, height: 650 }, hasTouch: true,
      isMobile: true, serviceWorkers: 'block' });
    await context.addInitScript(values => {
      for (const [key, value] of Object.entries(values)) localStorage.setItem(key, JSON.stringify(value));
      const speech = { fail: false };
      window.__maintenanceSpeech = speech;
      Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true,
        value: class { constructor(text) { this.text = text; } } });
      Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
        paused: false, getVoices() { return []; }, cancel() {}, resume() {},
        speak(utterance) { if (speech.fail) utterance.onerror?.({ error: 'not-allowed' }); else utterance.onstart?.(); },
      } });
    }, seed);
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    const errors = [], scripts = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {
      if (response.request().resourceType() === 'script' && new URL(response.url()).origin === base.origin) {
        scripts.push(response.text().catch(() => ''));
      }
    });
    try {
      await identify(page, scripts);
      const detail = await body(page, context);
      assert.deepEqual(errors, [], 'No uncaught errors in the deployed client');
      results.push({ engine, name, status: 'PASS', commit: expected, ...detail });
      console.log('LIVE_MAINTENANCE_PASS', JSON.stringify(results.at(-1)));
    } catch (error) {
      results.push({ engine, name, status: 'FAIL', commit: expected, error: String(error), errors });
      console.error('LIVE_MAINTENANCE_FAIL', JSON.stringify(results.at(-1)));
      process.exitCode = 1;
    } finally {
      await context.close();
    }
  }

  await check('cross-range-sentence-lists-search-and-practice-preferences', async page => {
    await nav(page, '句库');
    await page.waitForFunction(() => !document.querySelector('.sentence-page .setup-start')?.disabled);
    for (const label of ['收藏句子', '待加强']) {
      await page.locator('.sentence-summary button').filter({ hasText: label }).click();
      await page.waitForFunction(() => document.querySelectorAll('.sentence-result-list button[data-sentence-id]').length === 3);
      assert.deepEqual(await page.locator('.sentence-result-list button[data-sentence-id]').evaluateAll(
        buttons => buttons.map(button => Number(button.dataset.sentenceId))), [1, 1001, 2001]);
      await retainChoices(page);
      await page.getByRole('button', { name: '‹ 返回句库搜索', exact: true }).click();
    }
    const search = page.getByRole('searchbox', { name: '搜索长短句' });
    for (const query of ['airport', '机场']) {
      await search.fill(query);
      await page.locator('.sentence-result-list button[data-sentence-id]').first().waitFor();
      await retainChoices(page);
    }
    await page.getByRole('button', { name: '开始这组学习', exact: true }).click();
    await page.locator('.sentence-study-card').waitFor();
    const session = await stored(page, keys.sentence);
    for (const [key, value] of Object.entries(choices)) assert.equal(session[key], value);
    assert.equal(session.sentenceIds.length, 20);
    assert.equal(await page.locator('.sentence-english').count(), 0, 'Recall mode does not reveal the English answer');
    return { collectionAndReinforcementIds: [1, 1001, 2001], queries: ['airport', '机场'], practiceChoicesPreserved: true };
  }, {
    [keys.preferences]: choices, 'wordflow-sentence-saved-v1': [1, 1001, 2001],
    'wordflow-sentence-difficult-v1': [1, 1001, 2001],
  });

  await check('unrated-third-word-exit-protects-current-position', async page => {
    await beginWords(page);
    for (let index = 1; index <= 2; index++) {
      await page.getByRole('button', { name: '下一张 ›', exact: true }).click();
      await page.waitForFunction(index => JSON.parse(localStorage.getItem('wordflow-active-session-v1'))?.index === index, index);
    }
    const before = await stored(page, keys.word);
    assert.deepEqual(before.ratings, {});
    await page.getByRole('button', { name: '退出本组', exact: true }).click();
    await page.locator('#discard-title').waitFor();
    await page.getByRole('button', { name: '保留进度', exact: true }).click();
    assert.deepEqual(await stored(page, keys.word), before);
    assert.equal(await page.locator('.word-card').count(), 1);
    return { index: 2, ratingCount: 0, discardProtected: true };
  });

  await check('reading-module-return-restores-the-current-paragraph', async page => {
    await nav(page, '阅读');
    await page.locator('.level-switch button').filter({ hasText: 'Level 3' }).click();
    await page.locator('.reading-card').first().click();
    const title = await page.locator('.reading-detail h1').innerText();
    await page.locator('.reading-question').scrollIntoViewIfNeeded();
    const position = await page.evaluate(() => scrollY);
    assert.ok(position > 500);
    for (const label of ['今天', '进度']) {
      await nav(page, label);
      await nav(page, '阅读');
      await page.waitForFunction(position => Math.abs(scrollY - position) <= 2, position);
      assert.equal(await page.locator('.reading-detail h1').innerText(), title);
    }
    return { title, position, readingPositionPreserved: true };
  });

  await check('speech-warning-keeps-the-next-word-directly-tappable', async page => {
    await beginWords(page);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('english-flow-speech-error', { detail: 'not-allowed' })));
    await page.getByRole('button', { name: '关闭语音提示', exact: true }).waitFor();
    const next = page.getByRole('button', { name: '下一张 ›', exact: true });
    await page.waitForFunction(() => {
      const button = document.querySelector('.learn-page .sentence-pager button:last-child');
      const box = button.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return button === hit || button.contains(hit);
    });
    const box = await next.boundingBox();
    assert.ok(box && box.y >= 0 && box.y + box.height < 650, 'Next remains in the visible viewport');
    const placement = await page.evaluate(() => ({
      toastBottom: document.querySelector('.status-toast-stack').getBoundingClientRect().bottom,
      actionsTop: document.querySelector('.word-card-actions').getBoundingClientRect().top,
    }));
    assert.ok(placement.toastBottom <= placement.actionsTop - 4, JSON.stringify(placement));
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('wordflow-active-session-v1'))?.index === 1);
    return { nextReceivedCoordinateTap: true, instrumentedSpeech: true, warningEventSimulated: true };
  });

  await check('speech-warning-keeps-the-next-sentence-directly-tappable', async page => {
    await nav(page, '句库');
    await page.waitForFunction(() => !document.querySelector('.sentence-page .setup-start')?.disabled);
    await page.getByRole('button', { name: '开始这组学习', exact: true }).click();
    await page.locator('.sentence-study-card').waitFor();
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('english-flow-speech-error', { detail: 'not-allowed' })));
    await page.getByRole('button', { name: '关闭语音提示', exact: true }).waitFor();
    await page.waitForFunction(() => {
      const button = document.querySelector('.sentence-learn-page .sentence-pager button:last-child');
      const box = button.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return button === hit || button.contains(hit);
    });
    const placement = await page.evaluate(() => ({
      toastBottom: document.querySelector('.status-toast-stack').getBoundingClientRect().bottom,
      actionsTop: document.querySelector('.sentence-card-actions').getBoundingClientRect().top,
    }));
    assert.ok(placement.toastBottom <= placement.actionsTop - 4, JSON.stringify(placement));
    const box = await page.getByRole('button', { name: '下一句 ›', exact: true }).boundingBox();
    assert.ok(box && box.y >= 0 && box.y + box.height < 650);
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('wordflow-sentence-active-session-v1'))?.index === 1);
    return { nextSentenceReceivedCoordinateTap: true, instrumentedSpeech: true, warningEventSimulated: true };
  });

  await check('reset-persists-zero-rotation-and-reaches-update-preflight', async (page, context) => {
    await beginWords(page);
    await nav(page, '进度');
    await page.getByRole('button', { name: '重置', exact: true }).click();
    await page.getByRole('button', { name: '确认重置', exact: true }).click();
    await page.waitForFunction(() => localStorage.getItem('wordflow-practice-rotation-v1') === '{"word":0,"sentence":0,"pattern":0}');
    assert.deepEqual(await stored(page, keys.rotation), { word: 0, sentence: 0, pattern: 0 });
    // Safety-flow simulation only: no future release is claimed or installed.
    // The real current HTML/client were verified before these two routes exist.
    await context.route('**/build-info.json?*', route => route.fulfill({ json: {
      app: 'english-flow', title: '词流英语', origin: base.origin, commit: later,
    } }));
    let preflightRequests = 0;
    await context.route(url => url.origin === base.origin && url.pathname === '/' && url.searchParams.get('ef-update') === later,
      route => {
        preflightRequests++;
        return route.fulfill({ contentType: 'text/html', body: `<!doctype html><title>词流英语</title><meta name="english-flow-build" content="${expected}">` });
      });
    await page.evaluate(commit => { window.__maintenanceDocument = commit; }, expected);
    await page.getByRole('button', { name: '检查更新', exact: true }).click();
    await page.getByRole('button', { name: '更新并保留进度', exact: true }).waitFor();
    await page.getByRole('button', { name: '更新并保留进度', exact: true }).click();
    await page.getByText('新页面暂未就绪，或有记录尚未保存。已保留当前页面，请稍后重试或先导出备份。', { exact: true }).waitFor();
    assert.equal(preflightRequests, 1, 'Reset records pass the save guard and reach the HTML preflight');
    assert.equal(await page.evaluate(() => window.__maintenanceDocument), expected);
    assert.equal(await page.getByText('请先到进度页再更新。若有记录尚未保存，请先导出备份；不会强制刷新。', { exact: true }).count(), 0);
    return { persistedRotation: { word: 0, sentence: 0, pattern: 0 }, updatePreflightReached: true,
      simulatedFutureVersionAndStaleHtml: true, releaseSwitchVerified: false };
  });

  await browser.close();
}

console.log('LIVE_MAINTENANCE_SUMMARY', JSON.stringify({ commit: expected,
  passed: results.filter(result => result.status === 'PASS').length,
  failed: results.filter(result => result.status === 'FAIL').length, total: results.length,
  freshIsolatedProfiles: true, physicalAudioVerified: false }));
