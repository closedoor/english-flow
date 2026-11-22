import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { navigate } from './browser-navigation.mjs';
import { openSetupDetails } from './browser-disclosures.mjs';
import { settleLearningStorage } from './storage-settlement-checks.mjs';
import { loadSentenceFixturePacks } from './sentence-fixture-data.mjs';
import { verifyPunctuationPrompt } from './sentence-query-check.mjs';

if (!process.env.PLAYWRIGHT_MODULE) throw Error('Set PLAYWRIGHT_MODULE; see TESTING.md.');
const pw = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const origin = process.env.BROWSER_TEST_URL || 'http://127.0.0.1:4173';
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname)) throw Error('Large-history fixtures must remain on a local test origin.');
const engines = process.env.BROWSER_ENGINES?.split(',') || ['chromium', 'webkit'];
if (!engines.length || engines.some(e => !['chromium', 'webkit'].includes(e))) throw Error('Invalid BROWSER_ENGINES.');
const packs = await loadSentenceFixturePacks();
const items = [1, 2, 3].flatMap(n => packs[n]);
const allIds = items.map(x => x.id);
const keys = { saved: 'wordflow-sentence-saved-v1', difficult: 'wordflow-sentence-difficult-v1', preferences: 'wordflow-sentence-preferences-v1' };
const normalize = s => s.normalize('NFKC').toLowerCase().trim().replace(/[.,!?;:'’]/g, '').replace(/\s+/g, ' ');
const results = [];
const resultIds = async page => (await page.locator('.sentence-result-list button[data-sentence-id]').evaluateAll(rows => rows.map(row => Number(row.dataset.sentenceId))));

for (const engine of engines) {
  const browser = await pw[engine].launch({ headless: true });
  async function check(name, savedIds, body) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, serviceWorkers: 'block' });
    await context.addInitScript(({ savedIds, allIds, keys }) => {
      if (!sessionStorage.getItem('large-history-seeded')) {
        sessionStorage.setItem('large-history-seeded', '1');
        localStorage.setItem(keys.saved, JSON.stringify(savedIds));
        localStorage.setItem(keys.difficult, JSON.stringify(allIds));
        localStorage.setItem(keys.preferences, JSON.stringify({ band: 'long', category: 'food', count: 10, mode: 'speak' }));
      }
      // The cards are tested silently; this is not physical audio acceptance.
      window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
      Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { paused: false, getVoices() { return []; }, cancel() {}, resume() {}, speak(u) { u.onstart?.(); } } });
    }, { savedIds, allIds, keys });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    try {
      await page.goto(origin, { waitUntil: 'domcontentloaded' }); await page.locator('.bottom-nav').waitFor();
      await navigate(page, '句子'); await openSetupDetails(page, '.sentence-find');
      await body(page);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      assert.deepEqual(errors, []);
      results.push({ engine, name, status: 'PASS', syntheticRecords: true });
    } catch (error) {
      results.push({ engine, name, status: 'FAIL', error: String(error), errors, body: (await page.locator('body').innerText()).slice(-1400) });
    } finally { await context.close(); }
    console.log(JSON.stringify(results.at(-1)));
  }

  await check('punctuation-shows-a-prompt-and-a-real-word-searches-all-lengths', [], async page => {
    const search = await verifyPunctuationPrompt(page);
    await search.fill('coffee');
    await page.waitForFunction(() => document.querySelector('.sentence-result-list [data-sentence-id]') && !document.querySelector('.sentence-result-list .browser-hint'));
    const expected = items.filter(s => normalize(s.text + ' ' + s.translation).includes('coffee'));
    assert.deepEqual(await resultIds(page), expected.slice(0, 30).map(s => s.id));
  });

  await check('all-3000-favorites-keep-global-order-and-preferences', allIds, async page => {
    const before = await page.evaluate(k => localStorage.getItem(k), keys.preferences);
    await page.locator('.sentence-summary button').filter({ hasText: '收藏句子' }).click();
    await page.waitForFunction(() => document.querySelector('.sentence-result-count')?.textContent.includes('/ 3000 句'));
    assert.deepEqual(await resultIds(page), allIds.slice(0, 30));
    await page.getByRole('button', { name: '再显示 30 句', exact: true }).click();
    assert.deepEqual(await resultIds(page), allIds.slice(0, 60));
    await settleLearningStorage(page);
    assert.equal(await page.evaluate(k => localStorage.getItem(k), keys.preferences), before);
    assert.deepEqual(await page.evaluate(k => JSON.parse(localStorage.getItem(k)), keys.saved), allIds);
  });

  await check('all-3000-needs-work-and-global-search-retain-correct-matches', allIds, async page => {
    await page.getByRole('button', { name: '查看 3000 个待加强句子', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.sentence-result-count')?.textContent.includes('/ 3000 句'));
    assert.deepEqual(await resultIds(page), allIds.slice(0, 30));
    await page.getByRole('button', { name: '‹ 返回句库搜索', exact: true }).click();
    for (const query of ['YOU', '我']) {
      await page.getByRole('searchbox', { name: '搜索长短句', exact: true }).fill(query);
      const expected = items.filter(x => normalize(`${x.text} ${x.translation}`).includes(normalize(query))).map(x => x.id);
      assert.deepEqual(await resultIds(page), expected.slice(0, 30));
      assert.match(await page.locator('.sentence-result-count').innerText(), new RegExp(`/ ${expected.length} 句`));
    }
    await settleLearningStorage(page);
    assert.deepEqual(await page.evaluate(k => JSON.parse(localStorage.getItem(k)), keys.difficult), allIds);
  });

  for (const count of [31, 60, 61]) await check(`accurate-load-more-and-live-count-for-${count}-favorites`, allIds.slice(0, count), async page => {
    await page.locator('.sentence-summary button').filter({ hasText: '收藏句子' }).click();
    await page.waitForFunction(n => document.querySelector('.sentence-result-count')?.textContent.includes(`/ ${n} 句`), count);
    const status = page.locator('.sentence-result-count');
    assert.equal(await status.getAttribute('role'), 'status');
    assert.equal(await status.getAttribute('aria-live'), 'polite');
    let shown = 30;
    while (shown < count) {
      const amount = Math.min(30, count - shown);
      await page.getByRole('button', { name: `再显示 ${amount} 句`, exact: true }).click();
      shown += amount;
      assert.deepEqual(await resultIds(page), allIds.slice(0, shown));
      assert.equal(await status.innerText(), `已显示 ${shown} / ${count} 句`);
    }
    assert.equal(await page.locator('.sentence-result-list .library-more').count(), 0);
  });
  await browser.close();
}
const failed = results.filter(x => x.status === 'FAIL').length;
console.log('LARGE_HISTORY_SUMMARY', JSON.stringify({ passed: results.length - failed, failed, total: results.length, engines, timingsAsserted: false }));
if (failed) process.exitCode = 1;
