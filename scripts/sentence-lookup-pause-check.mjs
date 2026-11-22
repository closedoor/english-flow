import assert from 'node:assert/strict';
import { openSetupDetails } from './browser-disclosures.mjs';
import { settleLearningStorage } from './storage-settlement-checks.mjs';

const sessionKey = 'wordflow-sentence-active-session-v1';
const courseKeys = [sessionKey, 'wordflow-sentence-preferences-v1', 'wordflow-practice-rotation-v1'];
const savedKey = 'wordflow-sentence-saved-v1';
const knownKey = 'wordflow-sentence-mastered-v1';
const seenKey = 'wordflow-sentence-seen-v1';

// Both callers start a real short-sentence course in a disposable profile.
// The same steps verify the local build and the exact Render release.
export async function verifyPausedSentenceLookup(page, mode, expectedCommit) {
  const button = name => page.getByRole('button', { name, exact: true });
  const course = async () => {
    await settleLearningStorage(page);
    return page.evaluate(keys => keys.map(key => localStorage.getItem(key)), courseKeys);
  };
  const hasId = (key, id) => page.evaluate(({ key, id }) =>
    JSON.parse(localStorage.getItem(key) || '[]').includes(id), { key, id });
  const before = JSON.parse((await course())[0]);
  assert.equal(before.kind, 'group');
  assert.equal(before.mode, mode);
  if (mode === 'speak') await button('我说好了，查看英文答案').click();
  await button('还不熟悉').click();
  await page.waitForFunction(({ key, id }) =>
    JSON.parse(localStorage.getItem(key) || 'null')?.ratings[id] === 'difficult',
  { key: sessionKey, id: before.sentenceIds[before.index] });
  const protectedCourse = await course();
  const paused = JSON.parse(protectedCourse[0]);
  assert.ok(paused.index > before.index);
  const prompt = page.locator(mode === 'speak' ? '.speak-prompt p' : '.sentence-translation');
  const pausedChinese = await prompt.innerText();
  await button('返回句库设置并保留进度').click();
  await openSetupDetails(page, '.sentence-find');

  // Use a sentence from another band so the displayed card cannot be mistaken
  // for the paused group, or reached using only its already-filtered results.
  const lookupId = 1091;
  assert.equal(paused.sentenceIds.includes(lookupId), false);
  await page.getByRole('searchbox', { name: '搜索长短句' }).fill('turn off the light');
  const result = page.locator(`.sentence-result-list button[data-sentence-id="${lookupId}"]`);
  const lookupChinese = await result.locator('small').innerText();
  await result.click();
  assert.equal(await page.locator('#discard-title').count(), 0, 'Looking up a sentence must not ask to end the course');
  await page.locator('.sentence-study-card').waitFor();
  assert.equal(await prompt.innerText(), lookupChinese);
  assert.deepEqual(await course(), protectedCourse, 'The paused course, preferences and rotation must remain byte-for-byte intact');
  await button('收藏句子').click();
  await settleLearningStorage(page);
  assert.equal(await hasId(savedKey, lookupId), true);
  if (mode === 'speak') {
    assert.equal(await page.locator('.sentence-english').count(), 0);
    assert.equal(await button('播放英文').isDisabled(), true);
    const response = await page.reload({ waitUntil: 'domcontentloaded' });
    assert.equal(response.status(), 200);
    if (expectedCommit) assert.equal(await page.locator('meta[name="english-flow-build"]').getAttribute('content'), expectedCommit);
  } else {
    // Completing the one-card lookup is an intentional global rating; it is
    // not progress through the original short-sentence course.
    await button('我学会了').click();
    await page.getByRole('heading', { name: '这一组句子完成了' }).waitFor();
    assert.deepEqual(await course(), protectedCourse);
    assert.equal(await hasId(knownKey, lookupId), true);
    assert.equal(await hasId(seenKey, lookupId), true);
    await button('返回句库').click();
    await button('开始学习句子').click();
  }
  await page.locator('.sentence-study-card').waitFor();
  assert.equal(await prompt.innerText(), pausedChinese);
  assert.deepEqual(await course(), protectedCourse, 'Resuming must preserve the original IDs, position, ratings and timestamp');
  assert.equal(await hasId(savedKey, lookupId), true);
  if (mode === 'speak') {
    assert.equal(await page.locator('.sentence-english').count(), 0);
    assert.equal(await button('播放英文').isDisabled(), true);
  }
  return { mode, resumedAt: paused.index, lookupId, path: mode === 'speak' ? 'reload' : 'rate-and-resume' };
}
