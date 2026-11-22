import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { navigate } from './browser-navigation.mjs';
import { settleLearningStorage } from './storage-settlement-checks.mjs';

const cases = {
  word: { key: 'wordflow-active-session-v1', ids: 'wordIds', mastered: 'wordflow-ngsl-mastered-v1',
    difficult: 'wordflow-ngsl-difficult-v1', fields: { path: 'frequency', mode: 'free', stage: 'cards' },
    card: '.word-heading h2', expected: ['be', 'and'] },
  sentence: { key: 'wordflow-sentence-active-session-v1', ids: 'sentenceIds', mastered: 'wordflow-sentence-mastered-v1',
    difficult: 'wordflow-sentence-difficult-v1', fields: { band: 'short', category: 'all', count: 10, mode: 'bilingual' },
    card: '.sentence-study-card .sentence-english', expected: ['Where can we find you?', 'I wish I could help you.'] },
};

export async function checkLegacyRestorePosition(browser, url, kind, expectedCommit) {
  const test = cases[kind];
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true,
    acceptDownloads: true, serviceWorkers: 'block' });
  try {
    await context.addInitScript(() => Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => false }));
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await navigate(page, '进度');
    // Obtain the actual v1 envelope in this disposable profile. No real learner records
    // are used, and the fixture goes through the same file and confirmation as a restore.
    const pending = page.waitForEvent('download');
    await page.locator('.backup-actions').getByRole('button', { name: '导出备份', exact: true }).click();
    const download = await pending;
    assert.equal(await download.failure(), null);
    const backup = JSON.parse(await readFile(await download.path(), 'utf8'));
    assert.equal(backup.formatVersion, 1);
    backup.data[test.mastered] = [1];
    backup.data[test.key] = { version: 1, ...test.fields, [test.ids]: [1, 1, 2, 3], index: 2,
      ratings: { 1: 'known' }, updatedAt: Date.now() };
    await page.locator('input[type="file"]').setInputFiles({ name: 'legacy-paused-course.json',
      mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
    const confirmed = page.locator('.restore-dialog').getByRole('button', { name: '确认恢复', exact: true });
    await Promise.all([page.waitForEvent('domcontentloaded'), confirmed.click()]);
    const card = page.locator(test.card);
    const stored = key => page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
    async function assertRestored(index, ratings) {
      await card.waitFor();
      assert.equal(await card.innerText(), test.expected[index - 1], 'Show the original card, not its old array position');
      if (expectedCommit) assert.equal(await page.locator('meta[name="english-flow-build"]').getAttribute('content'), expectedCommit);
      await settleLearningStorage(page);
      const course = await stored(test.key);
      assert.deepEqual(course[test.ids], [1, 2, 3]);
      assert.equal(course.index, index);
      assert.deepEqual(course.ratings, ratings);
      assert.deepEqual(await stored(test.mastered), [1]);
    }
    await assertRestored(1, { 1: 'known' });
    await page.getByRole('button', { name: '还不熟悉', exact: true }).click();
    await assertRestored(2, { 1: 'known', 2: 'difficult' });
    // A second document must retain both the corrected course and the new rating.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await assertRestored(2, { 1: 'known', 2: 'difficult' });
    assert.deepEqual(await stored(test.difficult), [2]);
    assert.deepEqual(errors, []);
    return { kind, restoredId: 2, resumedIdAfterRatingAndReload: 3 };
  } finally {
    await context.close();
  }
}
