import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { navigate } from './browser-navigation.mjs';
import { openSetupDetails } from './browser-disclosures.mjs';
import { settleLearningStorage } from './storage-settlement-checks.mjs';

if (!process.env.PLAYWRIGHT_MODULE) throw new Error('Set PLAYWRIGHT_MODULE; see TESTING.md.');
const playwright = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const origin = process.env.BROWSER_TEST_URL || 'http://127.0.0.1:4173';
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname)) throw new Error('Content fixtures must remain on a local test origin.');
const evidence = process.env.BROWSER_EVIDENCE_DIR || path.join(os.tmpdir(), 'english-flow-content-evidence');
await mkdir(evidence, { recursive: true });
const keys = { preferences: 'wordflow-sentence-preferences-v1', active: 'wordflow-sentence-active-session-v1' };
const wordCards = [
  { id: 295, word: 'consider', phonetic: '/kənˈsɪd.ə/', example: "Let's consider it again when the time comes.", translation: '到时候我们再考虑吧。' },
  { id: 230, word: 'increase', phonetic: '/ˈɪn.kriːs/', example: 'The number of cars is on the increase.', translation: '汽车的数量在增长。' },
  { id: 237, word: 'offer', example: 'Of course I accepted his offer of support.', translation: '我当然接受了他主动提供的支持。' },
  { id: 255, word: 'until', meaning: '直到；到……为止', example: 'Please wait until the end of this month.', translation: '请等到这个月底。' },
  { id: 209, word: 'month', example: 'Please wait until the end of this month.', translation: '请等到这个月底。' },
  { id: 152, word: 'end', example: 'Please wait until the end of this month.', translation: '请等到这个月底。' },
  { id: 213, word: 'information', example: 'Do you have any information on classical music concerts?', translation: '你有关于古典音乐会的信息吗？' },
];
const sentenceCards = new Map([
  [53, { text: 'What would you like to drink?', translation: '你们想喝什么？' }],
  [72, { text: 'What would you like to eat?', translation: '你们想吃什么？' }],
  [157, { text: 'Could I have the check?', translation: '把账单给我好吗？' }],
  [166, { text: 'Would you like to order?', translation: '你要点菜吗？' }],
  [1771, { text: 'You should pay more attention to what he says.', translation: '你应该多注意他说的话。' }],
  [1858, { text: 'You should pay attention to what he says.', translation: '你得注意他说的话。' }],
  [2689, { text: "What have I got to do so that you'll pay attention to me?", translation: '我该怎么做才能让你更注意我？' }],
  [2812, { text: 'I doubt if Mary would do that if she were in your shoes.', translation: '我怀疑如果玛丽处在你的位置上是否还会那样做。' }],
]);
const results = [];
async function stored(page, key) {
  await settleLearningStorage(page);
  return page.evaluate(key => JSON.parse(localStorage.getItem(key) || 'null'), key);
}
async function startScope(page, band, category) {
  await navigate(page, '句子');
  await openSetupDetails(page, '.sentence-range');
  const label = { short: '短句', medium: '常用句', long: '长句' }[band];
  await page.locator('.sentence-band-switch button').filter({ hasText: label }).click();
  await page.locator('.sentence-category-grid button').filter({ hasText: category }).click();
  await page.waitForFunction(() => !document.querySelector('.sentence-page .setup-start')?.disabled);
  await page.locator('.sentence-page .setup-start').click();
  await page.locator('.sentence-study-card').waitFor();
  const snapshot = await stored(page, keys.active);
  assert.equal(snapshot.band, band);
  assert.equal(snapshot.category, category === '餐饮' ? 'food' : 'shopping');
  assert.equal(snapshot.continuous, true);
  assert.equal(snapshot.kind, 'group');
  assert.equal(snapshot.mode, 'bilingual');
  assert.ok(snapshot.sentenceIds.length > 0);
  return snapshot;
}
async function sentenceDom(page, id, mode) {
  const expected = sentenceCards.get(id);
  assert.ok(expected);
  await page.locator('.sentence-study-card').waitFor();
  if (mode === 'speak') {
    assert.equal(await page.locator('.sentence-english').count(), 0, 'Recall keeps the unchanged English hidden before reveal');
    assert.equal(await page.getByRole('button', { name: '播放英文', exact: true }).isDisabled(), true);
    assert.equal(await page.locator('.speak-prompt p').innerText(), expected.translation);
    await page.getByRole('button', { name: '我说好了，查看英文答案', exact: true }).click();
  }
  assert.equal(await page.locator('.sentence-english').innerText(), expected.text);
  const chinese = await page.locator(mode === 'speak' ? '.speak-prompt p' : '.sentence-translation').innerText();
  assert.equal(chinese, expected.translation);
  return { id, text: await page.locator('.sentence-english').innerText(), translation: chinese, mode };
}

for (const engine of ['chromium', 'webkit']) {
  const browser = await playwright[engine].launch({ headless: true });
  async function check(name, initial, body) {
    const context = await browser.newContext({ viewport: { width: 390, height: 740 }, hasTouch: true, serviceWorkers: 'block' });
    await context.addInitScript(initial => {
      if (!sessionStorage.getItem('content-context-seeded')) {
        sessionStorage.setItem('content-context-seeded', '1');
        for (const [key, value] of Object.entries(initial)) localStorage.setItem(key, JSON.stringify(value));
      }
      // Device sound is deliberately simulated; these checks concern DOM and
      // records, and make no claim about real speakers or iPhone voices.
      Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: class { constructor(text) { this.text = text; } } });
      Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
        paused: false, getVoices: () => [{ lang: 'en-US', name: 'Test English' }, { lang: 'zh-CN', name: 'Test Chinese' }],
        cancel() {}, resume() {}, speak(utterance) { queueMicrotask(() => { utterance.onstart?.(); utterance.onend?.(); }); },
      } });
    }, initial);
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(origin, { waitUntil: 'domcontentloaded' });
      const observed = await body(page);
      assert.deepEqual(errors, [], 'No uncaught browser errors');
      results.push({ engine, name, status: 'PASS', observed });
      await page.screenshot({ path: path.join(evidence, `${engine}-content-${name}.png`), fullPage: true });
    } catch (error) {
      results.push({ engine, name, status: 'FAIL', error: String(error), errors,
        body: (await page.locator('body').innerText().catch(() => '')).slice(-2400) });
      await page.screenshot({ path: path.join(evidence, `${engine}-content-${name}-failed.png`), fullPage: true }).catch(() => {});
    } finally {
      await context.close();
    }
    console.log(JSON.stringify(results.at(-1)));
  }

  for (const expected of wordCards) {
    await check(`word-${expected.word}-actual-lookup-card`, {}, async page => {
      await page.locator('.bottom-nav').waitFor();
      await navigate(page, '单词');
      await openSetupDetails(page, '.word-find');
      await page.getByRole('searchbox', { name: '搜索词库' }).fill(expected.word);
      await page.locator(`.library-list button[data-word-id="${expected.id}"]`).click();
      await page.locator('.word-card').waitFor();
      const observed = await page.locator('.word-card').evaluate(card => ({
        word: card.querySelector('.word-heading h2').textContent,
        phonetic: card.querySelector('.word-heading p').textContent,
        meaning: card.querySelector('.word-heading strong').textContent,
        example: card.querySelector('.example-box p').textContent,
        translation: card.querySelector('.example-box small').textContent,
      }));
      assert.equal(observed.word, expected.word);
      assert.equal(observed.example, expected.example);
      assert.equal(observed.translation, expected.translation);
      if (expected.phonetic) assert.equal(observed.phonetic, expected.phonetic);
      if (expected.meaning) assert.equal(observed.meaning, expected.meaning);
      assert.match(await page.locator('.scene-pill').innerText(), new RegExp(`#${expected.id}$`));
      return observed;
    });
  }

  await check('new-food-course-includes-four-restaurant-cards', {}, async page => {
    await page.locator('.bottom-nav').waitFor();
    const snapshot = await startScope(page, 'short', '餐饮');
    for (const id of [53, 72, 157, 166]) assert.ok(snapshot.sentenceIds.includes(id), `New food scope includes ${id}`);
    const observed = [];
    const last = Math.max(...[53, 72, 157, 166].map(id => snapshot.sentenceIds.indexOf(id)));
    for (let index = 0; index <= last; index++) {
      const id = snapshot.sentenceIds[index];
      if (sentenceCards.has(id)) observed.push(await sentenceDom(page, id, 'bilingual'));
      if (index < last) await page.getByRole('button', { name: '下一句 ›', exact: true }).click();
    }
    assert.deepEqual(observed.map(item => item.id), [53, 72, 157, 166]);
    return { sentenceIds: snapshot.sentenceIds, observed };
  });

  for (const band of ['medium', 'long']) {
    await check(`new-shopping-${band}-course-excludes-idioms`, {}, async page => {
      await page.locator('.bottom-nav').waitFor();
      const snapshot = await startScope(page, band, '购物');
      for (const id of [1771, 1858, 2689, 2812]) assert.equal(snapshot.sentenceIds.includes(id), false, `New shopping scope excludes ${id}`);
      const retainedPurchase = band === 'medium' ? 1852 : 2805;
      assert.ok(snapshot.sentenceIds.includes(retainedPurchase), 'The selected shopping scope is real and retains literal purchasing');
      assert.ok((await page.locator('.sentence-english').innerText()).trim());
      const preferences = await stored(page, keys.preferences);
      assert.equal(preferences.category, 'shopping');
      assert.equal(preferences.band, band);
      return { sentenceIds: snapshot.sentenceIds, firstText: await page.locator('.sentence-english').innerText(), preferences };
    });
  }

  for (const mode of ['bilingual', 'speak']) for (const band of ['medium', 'long']) {
    const sentenceIds = band === 'medium' ? [1852, 1771, 1858] : [2805, 2689, 2812];
    const original = { version: 1, kind: 'group', continuous: true, updatedAt: Date.now() - 45 * 86_400_000,
      band, category: 'shopping', count: 10, mode, sentenceIds, index: 1, ratings: { [sentenceIds[0]]: 'known' } };
    const preferences = { band, category: 'shopping', count: 10, mode };
    await check(`legacy-shopping-${band}-${mode}-retains-ids-ratings-and-reload`, {
      [keys.active]: original, [keys.preferences]: preferences,
      'wordflow-sentence-mastered-v1': [sentenceIds[0]], 'wordflow-sentence-seen-v1': [sentenceIds[0]],
    }, async page => {
      await page.locator('.sentence-study-card').waitFor();
      const initialDom = await sentenceDom(page, sentenceIds[1], mode);
      assert.deepEqual(await stored(page, keys.active), original, 'Initial restoration keeps the precise old snapshot, including its 45-day timestamp');
      assert.equal(await page.locator('#discard-title').count(), 0);
      await page.getByRole('button', { name: '下一句 ›', exact: true }).click();
      const nextDom = await sentenceDom(page, sentenceIds[2], mode);
      const moved = await stored(page, keys.active);
      assert.ok(Number.isFinite(moved.updatedAt) && moved.updatedAt > original.updatedAt);
      assert.deepEqual(moved, { ...original, index: 2, updatedAt: moved.updatedAt }, 'Navigation changes only position and timestamp, preserving old IDs, scope and ratings');
      await page.getByRole('button', { name: '返回句库设置并保留进度', exact: true }).click();
      await page.locator('.sentence-page .setup-start').waitFor();
      assert.deepEqual(await stored(page, keys.active), moved, 'Pausing preserves the old shopping course');
      await page.locator('.sentence-page .setup-start').click();
      const resumedDom = await sentenceDom(page, sentenceIds[2], mode);
      assert.equal(await page.locator('#discard-title').count(), 0, 'Starting the same scope resumes without replacing the course');
      assert.deepEqual(await stored(page, keys.active), moved, 'Start resumes the same position and ratings');
      await page.reload({ waitUntil: 'domcontentloaded' });
      const reloadedDom = await sentenceDom(page, sentenceIds[2], mode);
      assert.deepEqual(await stored(page, keys.active), moved, 'Reload preserves the exact moved snapshot');
      assert.deepEqual(await stored(page, keys.preferences), preferences, 'Old practice preferences remain unchanged');
      assert.equal(await page.locator('#discard-title').count(), 0);
      return { original, moved, initialDom, nextDom, resumedDom, reloadedDom };
    });
  }
  await browser.close();
}

const failed = results.filter(result => result.status !== 'PASS').length;
await writeFile(path.join(evidence, 'content-context-results.json'), JSON.stringify({ origin, audio: 'simulated', results }, null, 2));
console.log('CONTENT_CONTEXT_SUMMARY', JSON.stringify({ passed: results.length - failed, failed, total: results.length }));
if (failed) process.exitCode = 1;
