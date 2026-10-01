import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';

if (!process.env.PLAYWRIGHT_MODULE) throw new Error('Set PLAYWRIGHT_MODULE; see TESTING.md.');
const playwright = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const origin = process.env.BROWSER_TEST_URL || 'http://127.0.0.1:4173';
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname)) {
  throw new Error('Maintenance fixtures must remain on a local test origin.');
}
const evidence = process.env.BROWSER_EVIDENCE_DIR || path.join(os.tmpdir(), 'english-flow-evidence');
await mkdir(evidence, { recursive: true });
const results = [];

async function ready(page) {
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.locator('.bottom-nav').waitFor({ timeout: 30_000 });
}
async function nav(page, label) {
  await page.locator('.bottom-nav button').filter({ hasText: label }).click();
}
async function openLongReading(page, filter = '全部') {
  await ready(page);
  await nav(page, '阅读');
  await page.locator('.reading-filters button').filter({ hasText: filter }).click();
  await page.locator('.level-switch button').filter({ hasText: 'Level 3' }).click();
  await page.locator('.reading-card').first().click();
  await page.locator('.reading-detail h1').waitFor();
  await page.waitForFunction(() => window.scrollY === 0);
}
const storedRecords = page => page.evaluate(() => Object.fromEntries(
  Object.keys(localStorage).filter(key => key.startsWith('wordflow-')).sort().map(key => [key, localStorage.getItem(key)]),
));

// Integration snippet for scripts/browser-maintenance.mjs. Pass its local check helper.
// Existing fresh isolated contexts only; native speech is not claimed as verified.
async function runSentenceMaintenanceChecks(check, origin) {
  const preferencesKey = 'wordflow-sentence-preferences-v1';
  const seedChoices = { band: 'short', category: 'food', count: 20, mode: 'speak' };
  async function setup(page, extra = {}) {
    await page.addInitScript(({ key, choices, extra }) => {
      if (sessionStorage.getItem('sentence-maintenance-seeded')) return;
      sessionStorage.setItem('sentence-maintenance-seeded', '1');
      localStorage.setItem(key, JSON.stringify(choices));
      for (const [storageKey, value] of Object.entries(extra)) localStorage.setItem(storageKey, JSON.stringify(value));
    }, { key: preferencesKey, choices: seedChoices, extra });
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await page.locator('.bottom-nav').waitFor();
    await page.locator('.bottom-nav button').filter({ hasText: '句子' }).click();
    await page.waitForFunction(() => !document.querySelector('.sentence-page .setup-start')?.disabled);
  }
  async function retainedChoices(page) {
    // Returning from a lookup can restore the short-pack preference before its
    // lazy content finishes loading. Check the settled choice, not the interim
    // zero-available count; a changed mode, band, scene or count still fails.
    await page.waitForFunction(() => {
      const button = document.querySelector('.sentence-page .setup-start');
      const summary = document.querySelector('.session-choice-summary')?.textContent || '';
      return button && !button.disabled && ['看中文说英文', '短句', '餐饮', '20 句'].every(label => summary.includes(label));
    });
    const summary = await page.locator('.session-choice-summary').innerText();
    if (!summary.includes('看中文说英文') || !summary.includes('短句') || !summary.includes('餐饮') || !summary.includes('20 句')) throw Error(`Practice choices changed: ${summary}`);
    const stored = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), preferencesKey);
    if (JSON.stringify(stored) !== JSON.stringify(seedChoices)) throw Error(`Stored practice choices changed: ${JSON.stringify(stored)}`);
  }
  for (const view of ['收藏句子', '待加强']) {
    await check(`sentence-${view}-preserves-practice-scene-and-shows-every-band`, async page => {
      await setup(page, {
        'wordflow-sentence-saved-v1': [1, 1001, 2001],
        'wordflow-sentence-difficult-v1': [1, 1001, 2001],
      });
      await page.locator('.sentence-summary button').filter({ hasText: view }).click();
      await page.waitForFunction(() => document.querySelectorAll('.sentence-result-list button[data-sentence-id]').length === 3);
      await retainedChoices(page);
      const ids = await page.locator('.sentence-result-list button[data-sentence-id]').evaluateAll(buttons => buttons.map(button => Number(button.dataset.sentenceId)));
      if (JSON.stringify(ids) !== JSON.stringify([1, 1001, 2001])) throw Error(`Incomplete ${view}: ${JSON.stringify(ids)}`);
      await page.locator('button[data-sentence-id="2001"]').click();
      await page.locator('.sentence-study-card').waitFor();
      if (await page.locator('.sentence-english').count()) throw Error('Chinese-first lookup revealed English before recall');
      await page.getByRole('button', { name: '返回句库设置并保留进度', exact: true }).click();
      await page.waitForFunction(() => document.querySelectorAll('.sentence-result-list button[data-sentence-id]').length === 3);
      await retainedChoices(page);
      await page.getByRole('button', { name: '‹ 返回句库搜索', exact: true }).click();
      await retainedChoices(page);
      await page.reload();
      await page.locator('.sentence-study-card').waitFor();
      await page.getByRole('button', { name: '返回句库设置并保留进度', exact: true }).click();
      await retainedChoices(page);
    });
  }
  await check('sentence-full-library-English-Chinese-search-keeps-next-practice-choices', async page => {
    await setup(page);
    const search = page.getByRole('searchbox', { name: '搜索长短句' });
    for (const query of ['airport', '机场']) {
      await search.fill(query);
      await page.locator('.sentence-result-list button[data-sentence-id]').first().waitFor();
      await retainedChoices(page);
    }
    // The search cannot change the group the top Start button selects.
    await page.getByRole('button', { name: '开始这组学习', exact: true }).click();
    await page.locator('.sentence-study-card').waitFor();
    const group = await page.evaluate(() => JSON.parse(localStorage.getItem('wordflow-sentence-active-session-v1')));
    for (const [key, value] of Object.entries(seedChoices)) if (group[key] !== value) throw Error(`Search changed new practice ${key}: ${group[key]}`);
    if (group.sentenceIds.length !== 20) throw Error(`Wrong sentence count: ${group.sentenceIds.length}`);
    if (await page.locator('.sentence-english').count()) throw Error('Chinese-first group revealed an answer');
  });
}

for (const engine of ['chromium', 'webkit']) {
  const browser = await playwright[engine].launch({ headless: true });
  async function check(name, body, { width = 390, height = 650 } = {}) {
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: true, serviceWorkers: 'block' });
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await body(page, context);
      assert.deepEqual(errors, [], 'No uncaught browser errors');
      results.push({ engine, name, status: 'PASS' });
    } catch (error) {
      results.push({ engine, name, status: 'FAIL', error: String(error), errors,
        body: (await page.locator('body').innerText().catch(() => '')).slice(-2000) });
      await page.screenshot({ path: path.join(evidence, `${engine}-maintenance-${name}.png`), fullPage: true }).catch(() => {});
    } finally {
      await context.close();
    }
    console.log(JSON.stringify(results.at(-1)));
  }

  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 650 }]) {
    await check(`reading-tab-return-keeps-place-${viewport.width}`, async page => {
      await openLongReading(page);
      const title = await page.locator('.reading-detail h1').innerText();
      await page.getByRole('button', { name: '显示完整中文翻译', exact: true }).click();
      await page.locator('.reading-question').scrollIntoViewIfNeeded();
      const before = await page.evaluate(() => scrollY);
      assert.ok(before > 500, 'The learner is deep in a long article');
      await page.waitForFunction(() => Boolean(localStorage.getItem('wordflow-reading-last-v1')));
      const records = await storedRecords(page);
      for (const destination of ['今天', '复习', '进度']) {
        await nav(page, destination);
        await nav(page, '阅读');
        await page.waitForFunction(position => Math.abs(scrollY - position) <= 2, before);
        assert.equal(await page.locator('.reading-detail h1').innerText(), title);
        assert.equal(await page.locator('.reading-translation').count(), 1, 'The expanded translation remains open');
        assert.deepEqual(await storedRecords(page), records, 'Switching modules does not change learning records');
      }
    }, viewport);
  }

  await check('reading-new-article-starts-at-top', async page => {
    await openLongReading(page);
    const firstTitle = await page.locator('.reading-detail h1').innerText();
    await page.locator('.reading-question').scrollIntoViewIfNeeded();
    await nav(page, '今天');
    await nav(page, '阅读');
    await page.locator('.reading-next').click();
    await page.waitForFunction(title => document.querySelector('.reading-detail h1')?.textContent !== title, firstTitle);
    await page.waitForFunction(() => scrollY <= 1);
    assert.equal(await page.locator('.reading-translation').count(), 0, 'A new article starts with its own translation state');
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('wordflow-reading-completed-v1') || '[]')), [],
      'Moving to another article does not invent completed readings');
  });

  await check('reading-list-return-focus-and-reopen-stay-intentional', async page => {
    await openLongReading(page, '未读');
    const title = await page.locator('.reading-detail h1').innerText();
    await page.getByRole('button', { name: '标记本篇已读', exact: true }).click();
    await page.getByRole('button', { name: '返回阅读列表', exact: true }).click();
    await page.waitForFunction(() => document.activeElement?.classList.contains('reading-list'));
    assert.equal(await page.locator('.reading-detail').count(), 0);
    assert.equal(await page.locator('.reading-card').filter({ hasText: title }).count(), 0, 'The completed article leaves the unread list');
    await page.locator('.reading-filters button').filter({ hasText: '全部' }).click();
    await page.locator('.reading-card').filter({ hasText: title }).click();
    await page.waitForFunction(() => scrollY <= 1);
    assert.equal(await page.locator('.reading-detail h1').innerText(), title);
    assert.equal(await page.getByRole('button', { name: '✓ 本篇已完成 · 点击取消', exact: true }).count(), 1);
    await page.getByRole('button', { name: '返回阅读列表', exact: true }).click();
    await page.waitForFunction(() => Boolean(document.activeElement?.getAttribute('data-reading-id')));
    assert.ok((await page.locator('button:focus').innerText()).includes(title), 'Return focuses the actual originating article');
  });

  await check('word-new-search-and-band-start-at-first-result-without-losing-lookup-return', async page => {
    await ready(page);
    await nav(page, '单词');
    const list = page.locator('.library-list');
    await list.evaluate(element => { element.scrollTop = 1000; });
    await page.locator('.rank-switch button').nth(1).click();
    await page.waitForFunction(() => document.querySelector('.library-list').scrollTop === 0);
    assert.equal(await list.locator('button').first().getAttribute('data-word-id'), '1001');
    await list.evaluate(element => { element.scrollTop = 1000; });
    await page.getByRole('searchbox', { name: '搜索词库' }).fill('e');
    await page.waitForFunction(() => document.querySelector('.library-list').scrollTop === 0);
    assert.equal(await list.locator('button').first().getAttribute('data-word-id'), '1');

    await list.evaluate(element => { element.scrollTop = 500; });
    await page.locator('.library-more').click();
    await page.waitForFunction(() => document.querySelectorAll('.library-list button').length === 48);
    assert.equal(await list.evaluate(element => element.scrollTop), 500, 'More results must preserve the current result position');

    const target = list.locator('button').nth(10);
    await target.scrollIntoViewIfNeeded();
    const before = await page.evaluate(() => ({ top: scrollY, list: document.querySelector('.library-list').scrollTop }));
    const id = await target.getAttribute('data-word-id');
    await target.click();
    await page.locator('.word-card').waitFor();
    await page.getByRole('button', { name: '返回词库', exact: true }).click();
    await page.waitForFunction(({ top, list }) => Math.abs(scrollY - top) <= 2 && document.querySelector('.library-list')?.scrollTop === list, before);
    assert.equal(await page.locator('button:focus').getAttribute('data-word-id'), id, 'Returning from a lookup must retain the originating result');
    assert.equal(await list.locator('button').count(), 48, 'A lookup must not reset the expanded result count');
    await page.getByRole('searchbox', { name: '搜索词库' }).fill('   ');
    await page.waitForFunction(() => document.querySelector('.library-list').scrollTop === 0);
    assert.equal(await page.locator('.rank-switch button').nth(1).getAttribute('aria-pressed'), 'true', 'Whitespace is an empty search in both filtering and selection labels');
    assert.equal(await list.locator('button').first().getAttribute('data-word-id'), '1001');
    assert.ok(!(await page.locator('.library-block .row-heading small').innerText()).includes('全库'), 'An empty query must not claim a full-library search');
  });

  await check('sentence-new-query-starts-at-first-result-without-resetting-more-or-return', async page => {
    await ready(page);
    await nav(page, '句子');
    const search = page.getByRole('searchbox', { name: '搜索长短句' });
    await search.fill('I');
    await page.locator('.sentence-result-list button[data-sentence-id]').first().waitFor();
    await page.waitForFunction(() => !document.querySelector('.sentence-result-list .browser-hint'));
    const list = page.locator('.sentence-result-list');
    await list.evaluate(element => { element.scrollTop = 1000; });
    await search.fill('you');
    await page.waitForFunction(() => document.querySelector('.sentence-result-list').scrollTop === 0);
    assert.equal(await list.locator('button[data-sentence-id]').first().getAttribute('data-sentence-id'), '1');

    const more = list.locator('.library-more');
    await more.scrollIntoViewIfNeeded();
    const previousPosition = await list.evaluate(element => element.scrollTop);
    await more.click();
    await page.waitForFunction(() => document.querySelectorAll('.sentence-result-list button[data-sentence-id]').length === 60);
    assert.equal(await list.evaluate(element => element.scrollTop), previousPosition, 'Adding sentence results must retain the existing scroll position');

    const target = list.locator('button[data-sentence-id]').nth(35);
    await target.scrollIntoViewIfNeeded();
    const before = await page.evaluate(() => ({ top: scrollY, list: document.querySelector('.sentence-result-list').scrollTop }));
    const id = await target.getAttribute('data-sentence-id');
    await target.click();
    await page.locator('.sentence-study-card').waitFor();
    await page.getByRole('button', { name: '返回句库设置并保留进度', exact: true }).click();
    await page.waitForFunction(({ top, list }) => Math.abs(scrollY - top) <= 2 && document.querySelector('.sentence-result-list')?.scrollTop === list, before);
    assert.equal(await page.locator('button:focus').getAttribute('data-sentence-id'), id, 'Sentence lookup return must retain its original result');
    assert.equal(await list.locator('button[data-sentence-id]').count(), 60);
  });

  await check('sentence-late-content-does-not-reset-the-current-search-scroll', async (page, context) => {
    await ready(page);
    await nav(page, '句子');
    await page.waitForFunction(() => !document.querySelector('.sentence-page .setup-start')?.disabled);
    let mediumRoute;
    let mediumRequested;
    const heldMedium = new Promise(resolve => { mediumRequested = resolve; });
    await context.route(/tatoeba-sentences-2\.json/, route => { mediumRoute = route; mediumRequested(); });
    await context.route(/tatoeba-sentences-3\.json/, () => {});
    await page.getByRole('searchbox', { name: '搜索长短句' }).fill('I');
    await heldMedium;
    await page.locator('.sentence-result-list button[data-sentence-id]').first().waitFor();
    const list = page.locator('.sentence-result-list');
    const beforeCount = Number((await page.locator('.sentence-browser .row-heading small').innerText()).match(/\d+/)[0]);
    await list.evaluate(element => { element.scrollTop = 600; });
    const response = page.waitForResponse(item => item.url().includes('tatoeba-sentences-2.json') && item.status() === 200);
    await mediumRoute.continue();
    await response;
    await page.waitForFunction(count => Number(document.querySelector('.sentence-browser .row-heading small').textContent.match(/\d+/)[0]) > count, beforeCount);
    assert.equal(await list.evaluate(element => element.scrollTop), 600, 'A late pack is additional content, not a new search');
  });

  await runSentenceMaintenanceChecks(check, origin);

  await browser.close();
}

const failed = results.filter(result => result.status === 'FAIL').length;
console.log('MAINTENANCE_SUMMARY', JSON.stringify({ passed: results.length - failed, failed, total: results.length }));
if (failed) process.exitCode = 1;
