import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
if (!process.env.PLAYWRIGHT_MODULE) throw new Error('Set PLAYWRIGHT_MODULE; see TESTING.md.');
const playwright = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const origin = process.env.BROWSER_TEST_URL || 'http://127.0.0.1:4173';
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname)) throw new Error('Recovery fixtures may run only on a local test server.');
const corrections = await readFile(new URL('../app/sentence-data.ts', import.meta.url), 'utf8');
const correctedIds = new Set([...corrections.matchAll(/\b(\d+)\s*:/g)].map(match => Number(match[1])));
const medium = JSON.parse(await readFile(new URL('../public/data/tatoeba-sentences-2.json', import.meta.url), 'utf8'));
const target = medium.find(item => !correctedIds.has(item.id));
assert.ok(target);
const keys = { saved: 'wordflow-sentence-saved-v1', difficult: 'wordflow-sentence-difficult-v1', mastered: 'wordflow-sentence-mastered-v1', word: 'wordflow-ngsl-mastered-v1', active: 'wordflow-sentence-active-session-v1' };
const blockedPacks = /tatoeba-sentences-[23]\.json/;
const results = [];
for (const engine of ['chromium', 'webkit']) {
  const browser = await playwright[engine].launch({ headless: true });
  async function check(name, run, initial = {}) {
    const context = await browser.newContext({ viewport: { width: 320, height: 740 }, hasTouch: true, serviceWorkers: 'block' });
    await context.addInitScript(values => {
      if (sessionStorage.getItem('recovery-fixture-seeded')) return;
      sessionStorage.setItem('recovery-fixture-seeded', '1');
      for (const [key, value] of Object.entries(values)) localStorage.setItem(key, JSON.stringify(value));
    }, initial);
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(origin, { waitUntil: 'domcontentloaded' });
      await page.locator('.bottom-nav').waitFor();
      await page.locator('.bottom-nav button').filter({ hasText: '句库' }).click();
      await page.waitForFunction(() => { const button = document.querySelector('.sentence-page .sticky-start'); return button && !button.disabled; });
      await run(page, context);
      assert.deepEqual(errors, [], 'Uncaught browser errors');
      results.push({ engine, name, status: 'PASS' });
    } catch (error) {
      results.push({ engine, name, status: 'FAIL', error: String(error), pageErrors: errors, body: (await page.locator('body').innerText().catch(() => '')).slice(-1800) });
    } finally { await context.close(); }
    console.log(JSON.stringify(results.at(-1)));
  }
  async function failSearch(page, context, term) {
    await context.route(blockedPacks, route => route.abort('failed'));
    await page.getByRole('searchbox', { name: '搜索长短句' }).fill(term);
    await page.locator('.sentence-load-error').waitFor();
  }
  await check('failed-search-is-not-a-definitive-no-match', async (page, context) => {
    await failSearch(page, context, target.text);
    assert.equal(await page.getByText('没有找到相关句子，请换一个关键词。', { exact: true }).count(), 0);
    await page.getByText('句库尚未完整载入，暂时无法确认是否有匹配句子。请重试缺少的句库。', { exact: true }).waitFor();
    assert.match(await page.locator('.sentence-browser .row-heading small').innerText(), /已载入/);
  });
  await check('failed-favorites-load-preserves-and-explains-records', async (page, context) => {
    await context.route(blockedPacks, route => route.abort('failed'));
    await page.locator('.sentence-summary button').last().click();
    await page.locator('.sentence-load-error').waitFor();
    assert.equal(await page.getByText('还没有收藏句子。学习时点 ☆ 就能在这里找到。', { exact: true }).count(), 0);
    await page.getByText('收藏记录仍保留，相关句库尚未载入。请重试缺少的句库。', { exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), keys.saved), [target.id]);
  }, { [keys.saved]: [target.id] });
  await check('failed-review-load-is-not-an-empty-review-list', async (page, context) => {
    await context.route(blockedPacks, route => route.abort('failed'));
    await page.getByRole('button', { name: '查看 1 个待加强句子', exact: true }).click();
    await page.locator('.sentence-load-error').waitFor();
    assert.equal(await page.getByText('当前没有待加强的句子。以后标记“还不熟悉”的句子会出现在这里。', { exact: true }).count(), 0);
    await page.getByText('待加强记录仍保留，相关句库尚未载入。请重试缺少的句库。', { exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), keys.difficult), [target.id]);
  }, { [keys.difficult]: [target.id] });
  await check('failed-partial-results-are-labeled-and-usable', async (page, context) => {
    await failSearch(page, context, 'I');
    await page.getByText('部分句库未载入，当前仅显示已载入的结果。', { exact: true }).waitFor({ timeout: 2000 });
    assert.match(await page.locator('.sentence-browser .row-heading small').innerText(), /已载入/);
    assert.match(await page.locator('.sentence-result-count').innerText(), /已载入/);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Recovery actions must fit a 320px screen');
    await page.locator('.sentence-result-list button[data-sentence-id]').first().click();
    await page.locator('.sentence-study-card').waitFor();
  });
  await check('retry-keeps-query-document-and-learning-records', async (page, context) => {
    await failSearch(page, context, target.text);
    const documentId = await page.evaluate(() => { window.__recoveryDocumentId = Math.random(); return window.__recoveryDocumentId; });
    const tracked = [keys.saved, keys.difficult, keys.mastered, keys.word];
    const before = await page.evaluate(names => Object.fromEntries(names.map(key => [key, localStorage.getItem(key)])), tracked);
    await context.unroute(blockedPacks);
    await page.getByRole('button', { name: '重试缺少的句库', exact: true }).click();
    await page.locator(`.sentence-result-list button[data-sentence-id="${target.id}"]`).waitFor();
    await page.locator('.sentence-load-error').waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => window.__recoveryDocumentId), documentId, 'JSON recovery must not reload the document');
    assert.equal(await page.getByRole('searchbox', { name: '搜索长短句' }).inputValue(), target.text);
    assert.deepEqual(await page.evaluate(names => Object.fromEntries(names.map(key => [key, localStorage.getItem(key)])), tracked), before);
  }, { [keys.saved]: [target.id], [keys.difficult]: [2001], [keys.mastered]: [3], [keys.word]: [17] });
  await check('loaded-selection-remains-usable-after-other-packs-fail', async (page, context) => {
    await failSearch(page, context, 'I');
    const start = page.getByRole('button', { name: '开始这组学习', exact: true });
    assert.equal(await start.isEnabled(), true);
    await start.click(); await page.locator('.sentence-study-card').waitFor();
    await page.locator('.learn-actions .secondary-action').click();
    await page.waitForFunction(key => Object.keys(JSON.parse(localStorage.getItem(key) || '{}').ratings || {}).length === 1, keys.active);
    const before = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), keys.active);
    await page.reload(); await page.locator('.sentence-study-card').waitFor();
    const after = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), keys.active);
    assert.deepEqual(after.sentenceIds, before.sentenceIds);
    assert.deepEqual(after.ratings, before.ratings);
  });
  await check('completed-search-retains-genuine-empty-state', async page => {
    await page.getByRole('searchbox', { name: '搜索长短句' }).fill('qzxv_unmatched_complete_912');
    await page.getByText('没有找到相关句子，请换一个关键词。', { exact: true }).waitFor();
    assert.equal(await page.locator('.sentence-load-error').count(), 0);
    assert.equal(await page.locator('.sentence-browser .row-heading small').innerText(), '0 个结果');
  });
  await check('leaving-failed-search-clears-unrelated-error', async (page, context) => {
    await failSearch(page, context, target.text);
    await page.locator('.sentence-band-switch button').first().click();
    await page.locator('.sentence-load-error').waitFor({ state: 'detached' });
    assert.equal(await page.getByRole('button', { name: '开始这组学习', exact: true }).isEnabled(), true);
    assert.equal(await page.getByRole('searchbox', { name: '搜索长短句' }).inputValue(), '');
  });
  await browser.close();
}
console.log('RECOVERY_BROWSER_SUMMARY', JSON.stringify({ passed: results.filter(item => item.status === 'PASS').length, failed: results.filter(item => item.status === 'FAIL').length, total: results.length }));
if (results.some(item => item.status === 'FAIL')) process.exitCode = 1;
