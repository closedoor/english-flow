import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { navigate } from './browser-navigation.mjs';
import { settleLearningStorage } from './storage-settlement-checks.mjs';

if (!process.env.PLAYWRIGHT_MODULE) throw new Error('Set PLAYWRIGHT_MODULE; see TESTING.md.');
const playwright = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const origin = process.env.BROWSER_TEST_URL || 'http://127.0.0.1:4173';
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname)) {
  throw new Error('Backup-relationship fixtures must remain on a local test origin.');
}
const engines = process.env.BROWSER_ENGINES?.split(',') ?? ['chromium', 'webkit'];
if (!engines.length || engines.some(engine => !['chromium', 'webkit'].includes(engine))) {
  throw new Error('BROWSER_ENGINES must contain chromium and/or webkit.');
}
const evidence = process.env.BROWSER_EVIDENCE_DIR || path.join(os.tmpdir(), 'english-flow-evidence');
await mkdir(evidence, { recursive: true });
const results = [];
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

function records(quiz) {
  const now = Date.now();
  return {
    [keys.mastered]: [1], [keys.difficult]: [2],
    [keys.schedule]: { 2: { due: now + 86_400_000, stage: 1 } },
    [keys.days]: [new Date(now - 86_400_000).toISOString().slice(0, 10)],
    [keys.preferences]: { mode: quiz ? 'test' : 'free', count: 10, path: 'frequency' },
    [keys.word]: {
      version: 1, kind: 'group', path: 'frequency', mode: quiz ? 'test' : 'free',
      wordIds: [1, 2, 3], index: 2,
      ratings: quiz ? { 1: 'known', 2: 'difficult', 3: 'difficult' } : { 1: 'known', 2: 'difficult' },
      stage: quiz ? 'quiz' : 'cards', quizIndex: quiz ? 2 : 0,
      quizAnswer: '', quizFeedback: quiz ? 'wrong' : null,
      quizResults: quiz ? [true, false, false] : [], updatedAt: now,
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

async function seed(context, quiz) {
  await context.addInitScript(initial => {
    // A fresh disposable profile receives synthetic records, never user data.
    if (!sessionStorage.getItem('backup-relationships-seeded')) {
      for (const [key, value] of Object.entries(initial)) localStorage.setItem(key, JSON.stringify(value));
      sessionStorage.setItem('backup-relationships-seeded', '1');
    }
    // Keep automation silent; actual export/download and file input remain native.
    window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      getVoices: () => [], cancel() {}, resume() {}, paused: false,
      speak(utterance) { utterance.onstart?.(); }, addEventListener() {}, removeEventListener() {},
    } });
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => false });
  }, records(quiz));
}

const storageSnapshot = page => page.evaluate(keyNames => Object.fromEntries(
  keyNames.map(key => [key, localStorage.getItem(key)])), Object.values(keys));
const parsed = values => Object.fromEntries(Object.entries(values).map(([key, raw]) => [key, JSON.parse(raw)]));
async function progressSnapshot(page) {
  await navigate(page, '首页');
  const progress = await page.locator('.dashboard-progress').innerText();
  await navigate(page, '进度');
  await settleLearningStorage(page);
  return progress;
}

async function exportBackup(page) {
  const pending = page.waitForEvent('download');
  await page.locator('.backup-actions').getByRole('button', { name: '导出备份', exact: true }).click();
  const download = await pending;
  assert.equal(await download.failure(), null, 'The native browser download finishes');
  assert.match(download.suggestedFilename(), /^english-flow-backup-.*\.json$/);
  return JSON.parse(await readFile(await download.path(), 'utf8'));
}

async function upload(page, backup, filename) {
  await page.locator('input[type="file"]').setInputFiles({
    name: filename, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)),
  });
}

for (const engine of engines) {
  const browser = await playwright[engine].launch({ headless: true });
  async function check(name, quiz, corruptions) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true,
      acceptDownloads: true, serviceWorkers: 'block' });
    await seed(context, quiz);
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(origin, { waitUntil: 'domcontentloaded' });
      await page.locator(quiz ? '.quiz-card' : '.word-card').waitFor({ timeout: 30_000 });
      const progress = await progressSnapshot(page);
      const before = await storageSnapshot(page);
      assert.equal(Object.keys(before).length, 19);
      assert.ok(Object.values(before).every(raw => raw !== null), 'All 19 fields contain explicit fixture data');
      const original = await exportBackup(page);
      assert.equal(original.formatVersion, 1);
      assert.deepEqual(original.data, parsed(before), 'The downloaded file contains all original learning records');
      for (const [index, corrupt] of corruptions.entries()) {
        const damaged = structuredClone(original);
        corrupt(damaged.data);
        await upload(page, damaged, `damaged-course-${index}.json`);
        await page.locator('.backup-notice.error').waitFor();
        assert.match(await page.locator('.backup-notice.error').innerText(), /未导入/);
        assert.equal(await page.locator('.restore-dialog').count(), 0, 'A damaged course cannot reach restore confirmation');
        assert.deepEqual(await storageSnapshot(page), before, 'A rejected import keeps all 19 raw persisted fields');
        assert.equal(await progressSnapshot(page), progress, 'The visible word and sentence progress remains unchanged');
        assert.deepEqual(await storageSnapshot(page), before, 'Navigating after rejection does not resave altered course data');
      }
      await upload(page, original, 'original-valid-backup.json');
      await page.locator('.restore-dialog').waitFor();
      assert.equal(await page.locator('.restore-dialog').getByRole('button', { name: '确认恢复', exact: true }).isEnabled(), true);
      await page.locator('.restore-dialog').getByRole('button', { name: '取消', exact: true }).click();
      assert.equal(await page.locator('.restore-dialog').count(), 0);
      assert.deepEqual(await storageSnapshot(page), before, 'Canceling a valid restore also keeps all 19 fields');
      assert.equal(await progressSnapshot(page), progress);
      assert.deepEqual(errors, [], 'No uncaught browser errors');
      results.push({ engine, name, status: 'PASS', rejectedInputs: corruptions.length, nativeDownloadAndFileInput: true,
        preservedStorageFields: 19, originalBackupAcceptedAndCanceled: true, syntheticRecords: true, instrumentedSpeech: true });
    } catch (error) {
      results.push({ engine, name, status: 'FAIL', error: String(error), errors,
        body: (await page.locator('body').innerText().catch(() => '')).slice(-2000) });
      await page.screenshot({ path: path.join(evidence, `${engine}-backup-relationships-${name}.png`), fullPage: true }).catch(() => {});
    } finally {
      await context.close();
    }
    console.log(JSON.stringify(results.at(-1)));
  }

  await check('damaged-word-sentence-pattern-positions', false, [
    data => { data[keys.word].index = data[keys.word].wordIds.length; },
    data => { data[keys.sentence].index = data[keys.sentence].sentenceIds.length; },
    data => { data[keys.pattern].index = data[keys.pattern].patternIds.length; },
  ]);
  await check('ratings-from-another-course', false, [
    data => { data[keys.word].ratings[4] = 'known'; },
    data => { data[keys.sentence].ratings[3] = 'known'; },
    data => { data[keys.pattern].ratings.p03 = 'known'; },
  ]);
  await check('damaged-quiz-position-keeps-final-question-backup-valid', true, [
    data => { data[keys.word].quizIndex = data[keys.word].wordIds.length; },
  ]);
  await browser.close();
}

const failed = results.filter(result => result.status === 'FAIL').length;
console.log(`BACKUP_RELATIONSHIPS_BROWSER_SUMMARY ${JSON.stringify({ passed: results.length - failed, failed,
  total: results.length, engines, syntheticRecords: true, physicalDeviceOrSharing: false })}`);
if (failed) process.exitCode = 1;
