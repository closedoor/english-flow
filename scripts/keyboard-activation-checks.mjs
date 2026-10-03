import assert from 'node:assert/strict';

const keys = {
  word: 'wordflow-active-session-v1', mastered: 'wordflow-ngsl-mastered-v1', difficult: 'wordflow-ngsl-difficult-v1',
  schedule: 'wordflow-ngsl-schedule-v1', days: 'wordflow-days', preferences: 'wordflow-session-preferences-v1',
  sentence: 'wordflow-sentence-active-session-v1', sentenceMastered: 'wordflow-sentence-mastered-v1',
  sentenceDifficult: 'wordflow-sentence-difficult-v1', sentenceSeen: 'wordflow-sentence-seen-v1',
  sentencePreferences: 'wordflow-sentence-preferences-v1', sentenceSaved: 'wordflow-sentence-saved-v1',
  pattern: 'wordflow-pattern-active-session-v1', patternMastered: 'wordflow-pattern-mastered-v1', patternDifficult: 'wordflow-pattern-difficult-v1',
  rotation: 'wordflow-practice-rotation-v1', readingCompleted: 'wordflow-reading-completed-v1',
  readingLast: 'wordflow-reading-last-v1', readingAnswers: 'wordflow-reading-answers-v1',
};
const stored = (page, key) => page.evaluate(key => JSON.parse(localStorage.getItem(key) || 'null'), key);
const records = page => page.evaluate(keys => Object.fromEntries(Object.entries(keys).map(([name, key]) => [name, localStorage.getItem(key)])), keys);
const waitIndex = (page, index) => page.waitForFunction(({ key, index }) => JSON.parse(localStorage.getItem(key) || 'null')?.index === index, { key: keys.sentence, index });
const snapshot = () => ({ version: 1, kind: 'group', continuous: true, updatedAt: Date.now(), band: 'long', category: 'all', count: 10,
  mode: 'bilingual', sentenceIds: Array.from({ length: 1000 }, (_, index) => index + 2001), index: 0, ratings: {} });
async function ready(page, origin) {
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.locator('.sentence-study-card').waitFor({ timeout: 30_000 });
  await page.evaluate(() => {
    window.__keyboardActivationEvents = [];
    document.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') window.__keyboardActivationEvents.push({ key: event.key, repeat: event.repeat });
    }, true);
  });
}
async function assertNativeRepeat(page, key) {
  const events = await page.evaluate(() => window.__keyboardActivationEvents.slice(-2));
  assert.deepEqual(events.map(event => event.repeat), [false, true], 'Exercise native first and repeated keydown events');
  assert.deepEqual(events.map(event => event.key), [key === 'Space' ? ' ' : key, key === 'Space' ? ' ' : key]);
}

/**
 * The caller supplies an isolated context per case and an authorized target URL.
 * check(name, initialStorageValues, body) seeds values before this body's first navigation.
 * These checks verify real UI interaction and persisted records, not physical audio.
 */
export async function verifyKeyboardActivation(check, origin) {
  for (const known of [true, false]) for (const key of ['Enter', 'Space']) {
    await check(`sentence-${known ? 'known' : 'difficult'}-held-${key}-cannot-rate-the-next-card`, { [keys.sentence]: snapshot() }, async page => {
      await ready(page, origin);
      const button = page.locator(known ? '.learn-actions .primary-action' : '.learn-actions .secondary-action');
      await button.focus();await page.keyboard.down(key);
      if (key === 'Enter') await waitIndex(page, 1);
      const beforeRepeat = await records(page);
      await page.waitForTimeout(420);await page.keyboard.down(key);await page.waitForTimeout(60);
      assert.deepEqual(await records(page), beforeRepeat, 'A repeated keydown after the click lock expires cannot change any learning record');
      await page.keyboard.up(key);await waitIndex(page, 1);
      assert.deepEqual((await stored(page, keys.sentence)).ratings, { 2001: known ? 'known' : 'difficult' });
      await assertNativeRepeat(page, key);
      await page.waitForTimeout(420);await button.focus();await page.keyboard.press(key);await waitIndex(page, 2);
      assert.deepEqual((await stored(page, keys.sentence)).ratings, { 2001: known ? 'known' : 'difficult', 2002: known ? 'known' : 'difficult' }, 'An independent press and release can rate the next card');
      await page.waitForTimeout(420);await button.dblclick({ delay: 45 });await waitIndex(page, 3);
      assert.deepEqual((await stored(page, keys.sentence)).ratings, Object.fromEntries([2001, 2002, 2003].map(id => [id, known ? 'known' : 'difficult'])), 'Rapid pointer clicks remain protected by the original lock');
      assert.deepEqual(await stored(page, keys.sentenceMastered), known ? [2001, 2002, 2003] : []);
      assert.deepEqual(await stored(page, keys.sentenceDifficult), known ? [] : [2001, 2002, 2003]);
      assert.deepEqual(await stored(page, keys.sentenceSeen), [2001, 2002, 2003]);
    });
  }
  for (const key of ['Enter', 'Space']) {
    await check(`sentence-bookmark-held-${key}-keeps-one-explicit-toggle`, { [keys.sentence]: snapshot() }, async page => {
      await ready(page, origin);const before = await stored(page, keys.sentence);
      await page.locator('.sentence-bookmark').focus();await page.keyboard.down(key);
      if (key === 'Enter') await page.waitForFunction(key => JSON.parse(localStorage.getItem(key) || '[]').includes(2001), keys.sentenceSaved);
      const beforeRepeat = await records(page);
      await page.waitForTimeout(420);await page.keyboard.down(key);await page.waitForTimeout(60);
      assert.deepEqual(await records(page), beforeRepeat, 'Holding the bookmark key cannot reverse the explicit action');
      await page.keyboard.up(key);
      await page.waitForFunction(key => JSON.parse(localStorage.getItem(key) || '[]').includes(2001), keys.sentenceSaved);
      assert.deepEqual(await stored(page, keys.sentenceSaved), [2001]);assert.deepEqual(await stored(page, keys.sentence), before);
      await assertNativeRepeat(page, key);
      await page.locator('.sentence-bookmark').focus();await page.keyboard.press(key);
      await page.waitForFunction(key => JSON.parse(localStorage.getItem(key) || '[]').length === 0, keys.sentenceSaved);
      assert.deepEqual(await stored(page, keys.sentenceSaved), []);assert.deepEqual(await stored(page, keys.sentence), before);
    });
  }
}
