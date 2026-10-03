import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { navigate, openLegacyWords } from './browser-navigation.mjs';
import { verifyKeyboardActivation } from './keyboard-activation-checks.mjs';

if (!process.env.PLAYWRIGHT_MODULE) throw new Error('Set PLAYWRIGHT_MODULE; see TESTING.md.');
const playwright = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const origin = process.env.BROWSER_TEST_URL || 'http://127.0.0.1:4173';
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname)) throw new Error('Learning fixtures must remain on a local test origin.');
const DAY = 86_400_000;
const keys = {
  word: 'wordflow-active-session-v1', mastered: 'wordflow-ngsl-mastered-v1', difficult: 'wordflow-ngsl-difficult-v1',
  schedule: 'wordflow-ngsl-schedule-v1', days: 'wordflow-days', sentence: 'wordflow-sentence-active-session-v1',
  sentenceMastered: 'wordflow-sentence-mastered-v1', sentenceDifficult: 'wordflow-sentence-difficult-v1',
  sentenceSeen: 'wordflow-sentence-seen-v1', sentencePreferences: 'wordflow-sentence-preferences-v1', sentenceSaved: 'wordflow-sentence-saved-v1',
  pattern: 'wordflow-pattern-active-session-v1', patternMastered: 'wordflow-pattern-mastered-v1', patternDifficult: 'wordflow-pattern-difficult-v1',
};
const wordIds = Array.from({ length: 2809 }, (_, index) => index + 1);
const sentenceIds = Array.from({ length: 1000 }, (_, index) => index + 2001);
const ratingsFor = (ids, missing = []) => Object.fromEntries(ids.filter(id => !missing.includes(id)).map(id => [id, 'known']));
const wordSnapshot = (patch = {}) => ({ version: 1, kind: 'group', continuous: true, updatedAt: Date.now() - 45 * DAY,
  path: 'frequency', mode: 'free', stage: 'cards', wordIds, index: 2808, ratings: ratingsFor(wordIds, [2809]),
  quizIndex: 0, quizAnswer: '', quizFeedback: null, quizResults: [], ...patch });
const sentenceSnapshot = (mode, patch = {}) => ({ version: 1, kind: 'group', continuous: true, updatedAt: Date.now() - 45 * DAY,
  band: 'long', category: 'all', count: 10, mode, sentenceIds, index: 999, ratings: ratingsFor(sentenceIds, [3000]), ...patch });
const stored = (page, key) => page.evaluate(key => JSON.parse(localStorage.getItem(key) || 'null'), key);
const records = page => page.evaluate(keys => Object.fromEntries(Object.entries(keys).map(([name, key]) => [name, localStorage.getItem(key)])), keys);
const waitRecord = (page, key, field, value) => page.waitForFunction(({ key, field, value }) => {
  const record = JSON.parse(localStorage.getItem(key) || 'null');
  return record && record[field] === value;
}, { key, field, value });
async function rate(page, known, recall = false) {
  // A separate deliberate rating follows the existing 350 ms repeated-click guard.
  await page.waitForTimeout(370);
  if (recall) await page.getByRole('button', { name: '我说好了，查看英文答案', exact: true }).click();
  await page.locator(known ? '.learn-actions .primary-action' : '.learn-actions .secondary-action').click();
}
const results = [];
for (const engine of ['chromium', 'webkit']) {
  const browser = await playwright[engine].launch({ headless: true });
  async function check(name, initial, body) {
    const context = await browser.newContext({ viewport: { width: 390, height: 740 }, hasTouch: true, serviceWorkers: 'block' });
    await context.addInitScript(initial => {
      if (!sessionStorage.getItem('learning-boundaries-seeded')) {
        sessionStorage.setItem('learning-boundaries-seeded', '1');
        for (const [key, value] of Object.entries(initial)) localStorage.setItem(key, JSON.stringify(value));
      }
      window.__learningKeys = [];
      document.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') window.__learningKeys.push({ key: event.key, repeat: event.repeat });
      }, true);
      // This fixture suppresses device audio. It provides no evidence about physical sound.
      Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: class { constructor(text) { this.text = text; } } });
      Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
        paused: false, getVoices: () => [{ lang: 'en-US', name: 'Test English' }, { lang: 'zh-CN', name: 'Test Chinese' }],
        cancel() {}, resume() {}, speak(utterance) { utterance.onstart?.(); },
      } });
    }, initial);
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(origin, { waitUntil: 'domcontentloaded' });
      await body(page);
      assert.deepEqual(errors, [], 'No uncaught browser errors');
      results.push({ engine, name, status: 'PASS' });
    } catch (error) {
      results.push({ engine, name, status: 'FAIL', error: String(error), errors,
        body: (await page.locator('body').innerText().catch(() => '')).slice(-2400) });
    } finally {
      await context.close();
    }
    console.log(JSON.stringify(results.at(-1)));
  }

  for (const practice of ['word']) for (const known of [true, false]) for (const key of ['Enter', 'Space']) {
    const initial = practice === 'word' ? wordSnapshot({ index: 0, ratings: {}, updatedAt: Date.now() })
      : sentenceSnapshot('bilingual', { index: 0, ratings: {}, updatedAt: Date.now() });
    await check(`${practice}-${known ? 'known' : 'difficult'}-held-${key}-cannot-rate-the-next-card`, {
      [keys[practice]]: initial,
    }, async page => {
      await page.locator(practice === 'word' ? '.word-card' : '.sentence-study-card').waitFor();
      await page.waitForTimeout(80); // Let the initial card-heading focus finish before choosing the rating button.
      const button = page.locator(known ? '.learn-actions .primary-action' : '.learn-actions .secondary-action');
      await button.focus();await page.keyboard.down(key);
      if (key === 'Enter') await waitRecord(page, keys[practice], 'index', 1);
      const beforeRepeat = await records(page);
      await page.waitForTimeout(420);await page.keyboard.down(key);
      await page.waitForTimeout(60);
      assert.deepEqual(await records(page), beforeRepeat, 'A repeated keydown after the click lock expires cannot change any learning record');
      await page.keyboard.up(key);await waitRecord(page, keys[practice], 'index', 1);
      let snapshot = await stored(page, keys[practice]);
      assert.deepEqual(snapshot.ratings, { [practice === 'word' ? 1 : 2001]: known ? 'known' : 'difficult' });
      const pressed = await page.evaluate(() => window.__learningKeys.slice(-2));
      assert.deepEqual(pressed.map(event => event.repeat), [false, true], 'Exercise native first and repeated keydown events');
      assert.deepEqual(pressed.map(event => event.key), [key === 'Space' ? ' ' : key, key === 'Space' ? ' ' : key]);
      await page.waitForTimeout(420);await button.focus();await page.keyboard.press(key);
      await waitRecord(page, keys[practice], 'index', 2);
      snapshot = await stored(page, keys[practice]);
      assert.equal(Object.keys(snapshot.ratings).length, 2, 'An independent press and release can rate the next card');
      await page.waitForTimeout(420);await button.dblclick({ delay: 45 });
      await waitRecord(page, keys[practice], 'index', 3);
      snapshot = await stored(page, keys[practice]);
      assert.equal(Object.keys(snapshot.ratings).length, 3, 'Rapid pointer clicks remain protected by the original lock');
    });
  }

  await verifyKeyboardActivation(check, origin);

  const finalWord = wordSnapshot({ ratings: { ...ratingsFor(wordIds, [2809]), 2808: 'difficult' } });
  await check('full-2809-word-course-last-card-correction-retry-pause-and-completion', {
    [keys.word]: finalWord, [keys.mastered]: wordIds.slice(0, -2), [keys.difficult]: [2808],
  }, async page => {
    await page.locator('.word-card').waitFor();
    assert.deepEqual(await stored(page, keys.word), finalWord, 'A 45-day-old continuous snapshot retains every real word ID and its timestamp');
    await page.getByRole('button', { name: '‹ 上一张', exact: true }).click();
    await waitRecord(page, keys.word, 'index', 2807);
    await rate(page, true);
    await waitRecord(page, keys.word, 'index', 2808);
    assert.equal((await stored(page, keys.word)).ratings[2808], 'known');
    assert.deepEqual(await stored(page, keys.difficult), []);
    await rate(page, false);
    await page.locator('.result-page').waitFor();
    assert.equal(await stored(page, keys.word), null);
    assert.deepEqual(await stored(page, keys.difficult), [2809]);
    const dueSchedule = await stored(page, keys.schedule);
    assert.equal(dueSchedule[2809].stage, 0);
    assert.ok(dueSchedule[2809].due <= Date.now(), 'The final difficult word is immediately due for review');
    await page.getByRole('button', { name: '再练这 1 个待加强单词', exact: true }).click();
    await page.locator('.word-card').waitFor();
    const retry = await stored(page, keys.word);
    assert.deepEqual(retry.wordIds, [2809]);assert.equal(retry.kind, 'group');assert.deepEqual(retry.ratings, {});
    await page.getByRole('button', { name: '退出学习并保留进度', exact: true }).click();
    await page.getByRole('button', { name: '开始学习', exact: true }).click();
    await page.locator('.word-card').waitFor();
    assert.deepEqual(await stored(page, keys.word), retry);
    assert.equal(await page.locator('#discard-title').count(), 0);
    await rate(page, true);await page.locator('.result-page').waitFor();
    assert.equal(await stored(page, keys.word), null);
    assert.deepEqual(await stored(page, keys.difficult), []);
    assert.deepEqual((await stored(page, keys.mastered)).sort((a, b) => a - b), wordIds);
    await navigate(page, '首页');
    assert.match(await page.locator('.home-word-progress').innerText(), /100%/);
    await navigate(page, '生词本');await page.locator('.empty-state').waitFor();
    assert.match(await page.locator('.empty-state').innerText(), /生词本还是空的/);
    await page.reload();await page.locator('.bottom-nav').waitFor();
    assert.equal(await stored(page, keys.word), null);
    assert.deepEqual((await stored(page, keys.mastered)).sort((a, b) => a - b), wordIds);
  });

  const skippedWord = wordSnapshot({ ratings: ratingsFor(wordIds, [2807, 2809]) });
  await check('last-word-wraps-to-earlier-unrated-card-before-finishing', { [keys.word]: skippedWord }, async page => {
    await page.locator('.word-card').waitFor();await rate(page, true);
    await waitRecord(page, keys.word, 'index', 2806);
    const remaining = await stored(page, keys.word);
    assert.deepEqual(remaining.wordIds, wordIds);assert.equal(Object.keys(remaining.ratings).length, 2808);
    assert.equal(await page.locator('.result-page').count(), 0);
    await rate(page, false);await page.locator('.result-page').waitFor();
    assert.equal(await stored(page, keys.word), null);
    assert.deepEqual(await stored(page, keys.difficult), [2807]);
    assert.deepEqual(await stored(page, keys.mastered), [2809]);
  });

  for (const mode of ['bilingual', 'speak']) {
    const finalSentence = sentenceSnapshot(mode, { ratings: { ...ratingsFor(sentenceIds, [3000]), 2999: 'difficult' } });
    await check(`full-long-sentence-course-final-correction-retry-and-completion-${mode}`, {
      [keys.sentence]: finalSentence, [keys.sentenceMastered]: sentenceIds.slice(0, -2), [keys.sentenceDifficult]: [2999],
      [keys.sentenceSeen]: sentenceIds.slice(0, -1),
      [keys.sentencePreferences]: { band: 'long', category: 'all', count: 10, mode },
    }, async page => {
      await page.locator('.sentence-study-card').waitFor();assert.deepEqual(await stored(page, keys.sentence), finalSentence);
      await page.getByRole('button', { name: '‹ 上一句', exact: true }).click();
      await waitRecord(page, keys.sentence, 'index', 998);await rate(page, true, mode === 'speak');
      await waitRecord(page, keys.sentence, 'index', 999);
      if (mode === 'speak') assert.equal(await page.locator('.sentence-english').count(), 0);
      assert.equal((await stored(page, keys.sentence)).ratings[2999], 'known');
      assert.deepEqual(await stored(page, keys.sentenceDifficult), []);
      await rate(page, false, mode === 'speak');await page.locator('.result-page').waitFor();
      assert.equal(await stored(page, keys.sentence), null);assert.deepEqual(await stored(page, keys.sentenceDifficult), [3000]);
      await page.getByRole('button', { name: '再练这 1 个待加强句子', exact: true }).click();
      await page.locator('.sentence-study-card').waitFor();const retry = await stored(page, keys.sentence);
      assert.deepEqual(retry.sentenceIds, [3000]);assert.equal(retry.kind, 'group');assert.deepEqual(retry.ratings, {});
      await page.getByRole('button', { name: '返回句库设置并保留进度', exact: true }).click();
      await page.getByRole('button', { name: '开始学习句子', exact: true }).click();
      await page.locator('.sentence-study-card').waitFor();assert.deepEqual(await stored(page, keys.sentence), retry);
      assert.equal(await page.locator('#discard-title').count(), 0);
      await rate(page, true, mode === 'speak');await page.locator('.result-page').waitFor();
      assert.equal(await stored(page, keys.sentence), null);assert.deepEqual(await stored(page, keys.sentenceDifficult), []);
      assert.deepEqual((await stored(page, keys.sentenceMastered)).sort((a, b) => a - b), sentenceIds);
      assert.deepEqual((await stored(page, keys.sentenceSeen)).sort((a, b) => a - b), sentenceIds);
      await navigate(page, '首页');assert.match(await page.locator('.home-sentence-progress').innerText(), /33\.33%/);
      await page.reload();await page.locator('.bottom-nav').waitFor();assert.equal(await stored(page, keys.sentence), null);
    });
  }

  const skippedSentence = sentenceSnapshot('speak', { ratings: ratingsFor(sentenceIds, [2998, 3000]) });
  await check('last-recall-sentence-wraps-to-unrated-card-without-leaking-answer', { [keys.sentence]: skippedSentence }, async page => {
    await page.locator('.sentence-study-card').waitFor();assert.equal(await page.locator('.sentence-english').count(), 0);
    assert.equal(await page.getByRole('button', { name: '播放英文', exact: true }).isDisabled(), true);
    await rate(page, true, true);await waitRecord(page, keys.sentence, 'index', 997);
    assert.equal(await page.locator('.sentence-english').count(), 0);
    assert.equal(await page.getByRole('button', { name: '播放英文', exact: true }).isDisabled(), true);
    assert.deepEqual((await stored(page, keys.sentence)).sentenceIds, sentenceIds);
    assert.equal(Object.keys((await stored(page, keys.sentence)).ratings).length, 999);
    assert.equal(await page.locator('.result-page').count(), 0);
    await rate(page, false, true);await page.locator('.result-page').waitFor();
    assert.equal(await stored(page, keys.sentence), null);assert.deepEqual(await stored(page, keys.sentenceDifficult), [2998]);
  });

  for (const view of ['复习', '生词本']) {
    const originalSchedule = { 2808: { due: Date.now() + DAY, stage: 2 }, 2809: { due: Date.now() - DAY, stage: 3 } };
    await check(`final-${view}-rating-empty-state-undo-and-reload`, {
      [keys.mastered]: [2808], [keys.difficult]: [2809], [keys.schedule]: originalSchedule,
    }, async page => {
      await page.locator('.bottom-nav').waitFor();await navigate(page, view);
      await page.getByRole('button', { name: '显示答案', exact: true }).click();
      await page.waitForTimeout(80);
      await page.getByRole('button', { name: view === '复习' ? '忘了 10 分钟后' : '这个词已经会了', exact: true }).focus();
      await page.keyboard.down('Enter');
      await page.locator('.empty-state').waitFor();
      const afterFirst = await records(page);await page.waitForTimeout(420);await page.keyboard.down('Enter');await page.keyboard.up('Enter');
      assert.deepEqual(await records(page), afterFirst, 'Holding the final rating key cannot change the empty review queue');
      await page.getByRole('button', { name: '撤销上次', exact: true }).click();
      await page.locator('.review-answer').waitFor();
      assert.deepEqual(await stored(page, keys.mastered), [2808]);assert.deepEqual(await stored(page, keys.difficult), [2809]);
      assert.deepEqual(await stored(page, keys.schedule), originalSchedule, 'Undo restores the final word and both exact due records');
      await page.reload();await page.locator('.bottom-nav').waitFor();await navigate(page, view);
      await page.getByRole('button', { name: '显示答案', exact: true }).click();
      await page.waitForTimeout(80);
      assert.deepEqual(await stored(page, keys.schedule), originalSchedule);
      await page.getByRole('button', { name: view === '复习' ? '简单 30 天后' : '这个词已经会了', exact: true }).focus();
      await page.keyboard.press('Enter');
      await page.locator('.empty-state').waitFor();assert.deepEqual(await stored(page, keys.difficult), []);
      assert.deepEqual((await stored(page, keys.mastered)).sort((a, b) => a - b), [2808, 2809]);
      const corrected = await stored(page, keys.schedule);assert.deepEqual(corrected[2808], originalSchedule[2808]);
      assert.equal(corrected[2809].stage, view === '复习' ? 5 : 3);
    });
  }

  await check('legacy-pattern-held-rating-key-keeps-next-pattern-unrated-and-hidden', {
    [keys.pattern]: { version: 1, updatedAt: Date.now(), category: 'all', patternIds: ['p01', 'p04'], index: 0, drillIndex: 2, ratings: {} },
  }, async page => {
    await page.locator('.pattern-prompt').waitFor();
    await page.getByRole('button', { name: '我说好了，查看参考答案', exact: true }).click();
    await page.waitForTimeout(80);
    await page.getByRole('button', { name: '掌握句型', exact: true }).focus();await page.keyboard.down('Enter');
    await waitRecord(page, keys.pattern, 'index', 1);
    const beforeRepeat = await records(page);await page.waitForTimeout(420);await page.keyboard.down('Enter');await page.keyboard.up('Enter');
    assert.deepEqual(await records(page), beforeRepeat);assert.deepEqual((await stored(page, keys.pattern)).ratings, { p01: 'known' });
    assert.equal(await page.locator('.pattern-answer').count(), 0);
    for (let drill = 0; drill < 3; drill++) {
      await page.getByRole('button', { name: '我说好了，查看参考答案', exact: true }).click();
      if (drill < 2) await page.getByRole('button', { name: '下一组 ›', exact: true }).click();
    }
    await page.waitForTimeout(80);
    await page.getByRole('button', { name: '掌握句型', exact: true }).focus();await page.keyboard.press('Enter');
    await page.locator('.result-page').waitFor();assert.equal(await stored(page, keys.pattern), null);
    assert.deepEqual(await stored(page, keys.patternMastered), ['p01', 'p04']);
  });

  const legacyQuiz = wordSnapshot({ continuous: undefined, updatedAt: Date.now() - 60_000, mode: 'test', stage: 'quiz',
    wordIds: [2807, 2808, 2809], index: 2, ratings: ratingsFor([2807, 2808, 2809]), quizIndex: 2, quizResults: [true, false] });
  await check('legacy-final-quiz-answer-result-missed-retry-and-explicit-resume', { [keys.word]: legacyQuiz }, async page => {
    await page.locator('.quiz-page').waitFor();
    await page.getByRole('button', { name: '想不起来，查看答案', exact: true }).click();
    await page.locator('.feedback-box').waitFor();assert.deepEqual((await stored(page, keys.word)).quizResults, [true, false, false]);
    await page.getByRole('button', { name: '查看结果', exact: true }).click();await page.locator('.result-page').waitFor();
    assert.equal(await stored(page, keys.word), null);
    await page.getByRole('button', { name: '再练这 2 个错词', exact: true }).click();await page.locator('.word-card').waitFor();
    const retry = await stored(page, keys.word);assert.deepEqual(retry.wordIds, [2808, 2809]);assert.equal(retry.mode, 'test');
    assert.equal(retry.quizIndex, 0);assert.equal(retry.quizFeedback, null);assert.deepEqual(retry.quizResults, []);
    await page.getByRole('button', { name: '退出学习并保留进度', exact: true }).click();
    await openLegacyWords(page);await page.locator('.word-card').waitFor();assert.deepEqual(await stored(page, keys.word), retry);
    await rate(page, true);await waitRecord(page, keys.word, 'index', 1);await rate(page, true);
    await page.locator('.quiz-page').waitFor();const restarted = await stored(page, keys.word);
    assert.equal(restarted.quizIndex, 0);assert.deepEqual(restarted.quizResults, []);assert.equal(restarted.quizFeedback, null);
  });
  await browser.close();
}
if (results.some(result => result.status !== 'PASS')) process.exitCode = 1;
