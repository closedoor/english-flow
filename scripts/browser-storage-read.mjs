import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { settleLearningStorage } from './storage-settlement-checks.mjs';

if (!process.env.PLAYWRIGHT_MODULE) throw new Error('Set PLAYWRIGHT_MODULE; see TESTING.md.');
const playwright = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const origin = process.env.BROWSER_TEST_URL || 'http://127.0.0.1:4173';
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname)) {
  throw new Error('Storage-read fixtures must remain on a local test origin.');
}
const evidence = process.env.BROWSER_EVIDENCE_DIR || path.join(os.tmpdir(), 'english-flow-evidence');
await mkdir(evidence, { recursive: true });
const results = [];
const errorTitle = '学习记录暂时无法读取';
const retryLabel = '重试读取记录';
const keys = {
  mastered: 'wordflow-ngsl-mastered-v1', difficult: 'wordflow-ngsl-difficult-v1',
  schedule: 'wordflow-ngsl-schedule-v1', days: 'wordflow-days',
  preferences: 'wordflow-session-preferences-v1', word: 'wordflow-active-session-v1',
  readingCompleted: 'wordflow-reading-completed-v1', readingLast: 'wordflow-reading-last-v1',
  readingAnswers: 'wordflow-reading-answers-v1', sentenceSaved: 'wordflow-sentence-saved-v1',
  sentenceSeen: 'wordflow-sentence-seen-v1', sentenceMastered: 'wordflow-sentence-mastered-v1',
  sentenceDifficult: 'wordflow-sentence-difficult-v1', sentencePreferences: 'wordflow-sentence-preferences-v1',
  sentence: 'wordflow-sentence-active-session-v1', patternMastered: 'wordflow-pattern-mastered-v1',
  patternDifficult: 'wordflow-pattern-difficult-v1', pattern: 'wordflow-pattern-active-session-v1',
  rotation: 'wordflow-practice-rotation-v1',
};

function records() {
  const now = Date.now();
  return {
    [keys.mastered]: [1, 3], [keys.difficult]: [2],
    [keys.schedule]: { 2: { due: now + 86_400_000, stage: 1 } },
    [keys.days]: [new Date(now - 86_400_000).toISOString().slice(0, 10)],
    [keys.preferences]: { mode: 'free', count: 10, path: 'frequency' },
    [keys.word]: {
      version: 1, kind: 'group', path: 'frequency', mode: 'free',
      wordIds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], index: 4,
      ratings: { 1: 'known', 2: 'difficult' }, stage: 'cards',
      quizIndex: 0, quizAnswer: '', quizFeedback: null, quizResults: [], updatedAt: now,
    },
    [keys.readingCompleted]: ['r1'], [keys.readingLast]: { id: 'r2', updatedAt: now },
    [keys.readingAnswers]: { r1: 0, r2: 2 }, [keys.sentenceSaved]: [4],
    [keys.sentenceSeen]: [1, 2], [keys.sentenceMastered]: [1], [keys.sentenceDifficult]: [2],
    [keys.sentencePreferences]: { band: 'short', category: 'all', count: 10, mode: 'bilingual' },
    [keys.sentence]: {
      version: 1, band: 'short', category: 'all', count: 10, mode: 'bilingual',
      sentenceIds: [1, 2], index: 1, ratings: { 1: 'known' }, updatedAt: now - 1,
    },
    [keys.patternMastered]: ['p01'], [keys.patternDifficult]: ['p02'],
    [keys.pattern]: {
      version: 1, category: 'all', patternIds: ['p01', 'p02'], index: 1,
      drillIndex: 2, ratings: { p01: 'known' }, updatedAt: now - 2,
    },
    [keys.rotation]: { word: 2, sentence: 3, pattern: 4 },
  };
}

async function injectFault(context, mode) {
  // All records belong to a new disposable profile. These injected API errors
  // exercise real startup/retry UI; they do not reproduce a physical disk fault.
  await context.addInitScript(({ initial, mode, masteredKey }) => {
    const storage = window.localStorage;
    const get = Storage.prototype.getItem;
    const set = Storage.prototype.setItem;
    const remove = Storage.prototype.removeItem;
    for (const [key, value] of Object.entries(initial)) set.call(storage, key, JSON.stringify(value));
    const readRecords = () => Object.fromEntries(Object.keys(initial).map(key => [key, get.call(storage, key)]));
    const fault = {
      mode, documentId: `${Date.now()}-${Math.random()}`, transientFailures: 0,
      getterFailures: 0, keyFailures: 0, writes: [], original: readRecords(), readRecords,
    };
    window.__storageReadFault = fault;
    Storage.prototype.getItem = function (key) {
      if (this === storage && key === masteredKey) {
        if (fault.mode === 'transient' && fault.transientFailures === 0) {
          fault.transientFailures += 1;
          throw new DOMException('Simulated transient learning-record read failure', 'SecurityError');
        }
        if (fault.mode === 'key') {
          fault.keyFailures += 1;
          throw new DOMException('Simulated persistent learning-record read failure', 'SecurityError');
        }
      }
      return get.call(this, key);
    };
    Storage.prototype.setItem = function (key, value) {
      if (this === storage) fault.writes.push({ operation: 'set', key, value });
      return set.call(this, key, value);
    };
    Storage.prototype.removeItem = function (key) {
      if (this === storage) fault.writes.push({ operation: 'remove', key });
      return remove.call(this, key);
    };
    Object.defineProperty(window, 'localStorage', { configurable: true, get() {
      if (fault.mode === 'getter') {
        fault.getterFailures += 1;
        throw new DOMException('Simulated persistent browser storage access failure', 'SecurityError');
      }
      return storage;
    } });
    // Speech is instrumented only to keep a resumed card silent in automation.
    window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      getVoices: () => [], cancel() {}, resume() {}, paused: false,
      speak(utterance) { utterance.onstart?.(); }, addEventListener() {}, removeEventListener() {},
    } });
  }, { initial: records(), mode, masteredKey: keys.mastered });
}

const snapshot = page => page.evaluate(() => {
  const fault = window.__storageReadFault;
  return {
    documentId: fault.documentId, original: fault.original, current: fault.readRecords(),
    writes: fault.writes, transientFailures: fault.transientFailures,
    getterFailures: fault.getterFailures, keyFailures: fault.keyFailures,
  };
});
const parseRecords = values => Object.fromEntries(Object.entries(values).map(([key, raw]) => [key, JSON.parse(raw)]));
async function assertPaused(page, documentId) {
  await page.getByText(errorTitle, { exact: true }).waitFor({ timeout: 30_000 });
  assert.equal(await page.locator('.app-loading[role="alert"]').count(), 1, 'A startup storage error is explicit');
  assert.equal(await page.locator('.bottom-nav').count(), 0, 'Default learning navigation must stay unavailable');
  assert.equal(await page.locator('.word-card, .sentence-study-card, .pattern-study-card').count(), 0, 'No default card may replace paused progress');
  const state = await snapshot(page);
  assert.equal(Object.keys(state.original).length, 19, 'Seed every learning-record key');
  assert.deepEqual(state.current, state.original, 'Failed hydration preserves every original raw record');
  assert.deepEqual(state.writes, [], 'Failed hydration must not normalize, remove, or autosave records');
  if (documentId) assert.equal(state.documentId, documentId, 'Retry remains in the same document');
  return state;
}

for (const engine of ['chromium', 'webkit']) {
  const browser = await playwright[engine].launch({ headless: true });
  async function check(name, mode, body) {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 }, hasTouch: true, serviceWorkers: 'block' });
    await injectFault(context, mode);
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(origin, { waitUntil: 'domcontentloaded' });
      await body(page);
      assert.deepEqual(errors, [], 'No uncaught browser errors');
      results.push({ engine, name, status: 'PASS', simulatedStorageFault: true, instrumentedSpeech: true });
    } catch (error) {
      results.push({ engine, name, status: 'FAIL', simulatedStorageFault: true, instrumentedSpeech: true,
        error: String(error), pageErrors: errors, body: (await page.locator('body').innerText().catch(() => '')).slice(-2000) });
      await page.screenshot({ path: path.join(evidence, `${engine}-storage-read-${name}.png`), fullPage: true }).catch(() => {});
    } finally {
      await context.close();
    }
    console.log(JSON.stringify(results.at(-1)));
  }

  await check('transient-read-pauses-without-data-loss-and-retries-in-place', 'transient', async page => {
    const before = await assertPaused(page);
    assert.equal(before.transientFailures, 1, 'A single simulated read error must pause startup');
    await page.getByRole('button', { name: retryLabel, exact: true }).click();
    await page.locator('.word-card').waitFor();
    await settleLearningStorage(page);
    assert.equal(await page.locator('.word-heading h2').innerText(),'to','The original fifth word resumes');
    const resumed = await page.evaluate(key => JSON.parse(localStorage.getItem(key)),keys.word);
    assert.equal(resumed.index,4); assert.deepEqual(resumed.ratings,{1:'known',2:'difficult'});
    const after = await snapshot(page);
    assert.equal(after.documentId, before.documentId, 'Successful retry must not reload the page');
    assert.equal(after.transientFailures, 1);
    assert.deepEqual(parseRecords(after.current), parseRecords(before.original), 'All 19 records and paused sessions survive retry and real autosave');
    assert.equal(await page.getByText(errorTitle, { exact: true }).count(), 0);
    // Unchanged restored records need no redundant setItem calls. Prove that
    // a new real rating still autosaves after recovery instead of counting
    // no-op writes as a prerequisite for a successful startup.
    await page.locator('.learn-actions .primary-action').click();
    await page.waitForFunction(keys => {
      const session = JSON.parse(localStorage.getItem(keys.word) || 'null');
      const mastered = JSON.parse(localStorage.getItem(keys.mastered) || '[]');
      return session?.index === 5 && session.ratings[5] === 'known' && mastered.includes(5);
    }, keys);
    await settleLearningStorage(page);
    const rated = await snapshot(page);
    assert.equal(rated.documentId, before.documentId, 'New work is saved in the recovered document');
    assert.deepEqual(JSON.parse(rated.current[keys.mastered]), [1, 3, 5]);
    assert.deepEqual(JSON.parse(rated.current[keys.word]).ratings, { 1: 'known', 2: 'difficult', 5: 'known' });
    for (const key of [keys.sentence, keys.pattern, keys.sentenceSaved, keys.sentencePreferences, keys.readingCompleted, keys.readingLast, keys.readingAnswers]) {
      assert.equal(rated.current[key], before.original[key], `New word work preserves other records: ${key}`);
    }
    assert.ok(rated.writes.some(write => write.key === keys.word), 'New session progress actually reaches storage');
    assert.ok(rated.writes.some(write => write.key === keys.mastered), 'New mastery actually reaches storage');
  });

  await check('persistent-storage-access-and-key-errors-never-save-defaults', 'getter', async page => {
    const first = await assertPaused(page);
    assert.ok(first.getterFailures > 0, 'The storage getter failure was exercised');
    await page.getByRole('button', { name: retryLabel, exact: true }).click();
    await page.waitForFunction(previous => window.__storageReadFault.getterFailures > previous, first.getterFailures);
    await assertPaused(page, first.documentId);
    await page.evaluate(() => { window.__storageReadFault.mode = 'key'; });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const before = await snapshot(page);
      await page.getByRole('button', { name: retryLabel, exact: true }).click();
      await page.waitForFunction(previous => window.__storageReadFault.keyFailures > previous, before.keyFailures);
      await assertPaused(page, first.documentId);
    }
  });
  await browser.close();
}

const failed = results.filter(result => result.status === 'FAIL').length;
console.log(`STORAGE_READ_BROWSER_SUMMARY ${JSON.stringify({ passed: results.length - failed, failed, total: results.length, evidence, simulatedStorageFault: true })}`);
if (failed) process.exitCode = 1;
