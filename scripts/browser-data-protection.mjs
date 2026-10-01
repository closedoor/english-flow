import { navigate } from './browser-navigation.mjs';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';

if (!process.env.PLAYWRIGHT_MODULE) throw new Error('Set PLAYWRIGHT_MODULE; see TESTING.md.');
const playwright = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const origin = process.env.BROWSER_TEST_URL || 'http://127.0.0.1:4173';
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname)) {
  throw new Error('Data-protection fixtures must remain on a local test origin.');
}
const evidence = process.env.BROWSER_EVIDENCE_DIR || path.join(os.tmpdir(), 'english-flow-evidence');
await mkdir(evidence, { recursive: true });
const results = [];
const masteredKey = 'wordflow-ngsl-mastered-v1';
const wordKey = 'wordflow-active-session-v1';
const records = page => page.evaluate(() => Object.fromEntries(Object.keys(localStorage)
  .filter(key => key.startsWith('wordflow-')).sort().map(key => [key, localStorage.getItem(key)])));

async function instrument(context) {
  // Only synthetic records in disposable contexts are used. API failures and
  // share results below are simulated, not physical storage/share-sheet tests.
  await context.addInitScript(({ masteredKey }) => {
    window.__dataProtection = { failSave: false, saveFailures: 0, writes: [], shareMode: 'download', shares: [] };
    const set = Storage.prototype.setItem;
    const remove = Storage.prototype.removeItem;
    Storage.prototype.setItem = function (key, value) {
      const state = window.__dataProtection;
      if (state.failSave && key === masteredKey) {
        state.saveFailures += 1;
        throw new DOMException('Simulated quota refusal in this learning window', 'QuotaExceededError');
      }
      if (key.startsWith('wordflow-')) state.writes.push({ key, value });
      return set.call(this, key, value);
    };
    Storage.prototype.removeItem = function (key) {
      if (key.startsWith('wordflow-')) window.__dataProtection.writes.push({ key, value: null });
      return remove.call(this, key);
    };
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => window.__dataProtection.shareMode !== 'download' });
    Object.defineProperty(navigator, 'share', { configurable: true, value: async payload => {
      const state = window.__dataProtection;
      state.shares.push(JSON.parse(await payload.files[0].text()));
      if (state.shareMode === 'cancel') throw new DOMException('Simulated share cancellation', 'AbortError');
      if (state.shareMode === 'fail') throw new DOMException('Simulated share failure', 'NotAllowedError');
      if (state.shareMode === 'hold') await new Promise(resolve => { state.finishShare = resolve; });
    } });
    const create = URL.createObjectURL;
    URL.createObjectURL = function (file) {
      if (window.__dataProtection.shareMode === 'fail') throw new Error('Simulated download fallback failure');
      return create.call(this, file);
    };
    window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      getVoices: () => [], cancel() {}, resume() {}, paused: false,
      speak(utterance) { utterance.onstart?.(); }, addEventListener() {}, removeEventListener() {},
    } });
  }, { masteredKey });
}

async function createPausedWindows(context) {
  const page = await context.newPage();
  await page.addInitScript(({ masteredKey, wordKey }) => {
    if (sessionStorage.getItem('data-protection-seeded')) return;
    sessionStorage.setItem('data-protection-seeded', '1');
    localStorage.setItem(masteredKey, '[1]');
    localStorage.setItem('wordflow-ngsl-difficult-v1', '[]');
    localStorage.setItem('wordflow-session-preferences-v1', JSON.stringify({ mode: 'free', count: 10, path: 'frequency' }));
    localStorage.setItem(wordKey, JSON.stringify({
      version: 1, kind: 'group', path: 'frequency', mode: 'free', wordIds: [1,2,3,4,5,6,7,8,9,10],
      index: 1, ratings: {}, stage: 'cards', quizIndex: 0, quizAnswer: '', quizFeedback: null,
      quizResults: [], updatedAt: Date.now(),
    }));
  }, { masteredKey, wordKey });
  page.setDefaultTimeout(15_000);
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.locator('.word-card').waitFor({ timeout: 30_000 });
  await page.evaluate(() => { window.__dataProtection.failSave = true; });
  await page.locator('.learn-actions .primary-action').click();
  await page.locator('.storage-warning').waitFor();
  assert.equal(await page.evaluate(key => localStorage.getItem(key), masteredKey), '[1]', 'The second mastered word exists only in A memory');
  await navigate(page,'首页');
  assert.match(await page.locator('.home-word-progress').innerText(), /已学习 2 \/ 2809/, 'A retains its unsaved second word');
  await navigate(page,'进度');
  const newer = await context.newPage();
  newer.setDefaultTimeout(15_000);
  await newer.goto(origin, { waitUntil: 'domcontentloaded' });
  await newer.locator('.word-card').waitFor({ timeout: 30_000 });
  await newer.locator('.learn-actions .primary-action').click();
  await page.locator('.sync-dialog').waitFor();
  await newer.waitForFunction(key => localStorage.getItem(key) === '[1,3]', masteredKey);
  const before = await records(page);
  const writes = await page.evaluate(() => window.__dataProtection.writes.length);
  const documentId = await page.evaluate(() => { window.__protectionDocument = `${Date.now()}-${Math.random()}`; return window.__protectionDocument; });
  assert.equal(await page.locator('.backup-actions').evaluate(element => Boolean(element.closest('[inert]'))), true, 'The stale page remains paused');
  return { page, newer, before, writes, documentId };
}

async function assertPausedRecords({ page, before, writes, documentId }) {
  assert.equal(await page.locator('.sync-dialog').count(), 1);
  assert.equal(await page.evaluate(() => window.__protectionDocument), documentId, 'No unsolicited reload');
  assert.deepEqual(await records(page), before, 'Export does not replace B records or merge stale A state');
  assert.equal(await page.evaluate(() => window.__dataProtection.writes.length), writes, 'A remains read-only while paused');
}
const exportButton = page => page.locator('.sync-dialog').getByRole('button', { name: '导出本页备份', exact: true });
const reloadButton = page => page.locator('.sync-dialog').getByRole('button', { name: '载入最新记录', exact: true });
async function readDownload(page, action) {
  const pending = page.waitForEvent('download');
  await action();
  const download = await pending;
  return JSON.parse(await readFile(await download.path(), 'utf8'));
}

for (const engine of ['chromium', 'webkit']) {
  const browser = await playwright[engine].launch({ headless: true });
  async function check(name, body) {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 }, hasTouch: true, acceptDownloads: true, serviceWorkers: 'block' });
    await instrument(context);
    const errors = [];
    context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
    let page;
    try {
      const windows = await createPausedWindows(context);
      page = windows.page;
      await body(windows);
      assert.deepEqual(errors, [], 'No uncaught browser errors');
      results.push({ engine, name, status: 'PASS', simulatedStorageAndShareFaults: true, instrumentedSpeech: true });
    } catch (error) {
      page ??= context.pages()[0];
      results.push({ engine, name, status: 'FAIL', simulatedStorageAndShareFaults: true, instrumentedSpeech: true,
        error: String(error), pageErrors: errors, body: page ? (await page.locator('body').innerText().catch(() => '')).slice(-2000) : '' });
      if (page) await page.screenshot({ path: path.join(evidence, `${engine}-data-protection-${name}.png`), fullPage: true }).catch(() => {});
    } finally { await context.close(); }
    console.log(JSON.stringify(results.at(-1)));
  }

  await check('paused-window-can-export-unsaved-work-without-overwriting-newer-records', async windows => {
    const { page, newer } = windows;
    assert.equal(await exportButton(page).isEnabled(), true);
    assert.equal(await exportButton(page).evaluate(element => Boolean(element.closest('[inert]'))), false, 'Rescue action is outside the inert stale page');
    const backup = await readDownload(page, () => exportButton(page).click());
    assert.deepEqual(backup.data[masteredKey], [1,2], 'The backup rescues the unsaved A word');
    assert.equal(backup.formatVersion, 1);
    assert.equal(Object.keys(backup.data).length, 19);
    await page.locator('.sync-dialog .backup-notice.success').waitFor();
    await assertPausedRecords(windows);
    await newer.close();
    await Promise.all([page.waitForEvent('domcontentloaded'), reloadButton(page).click()]);
    await page.locator('.word-card').waitFor();
    assert.equal(await page.locator('.bottom-nav').count(),0,'Reload restores the focused saved card');
    assert.equal(await page.locator('.sync-dialog').count(), 0);
    assert.equal(await page.evaluate(key => localStorage.getItem(key), masteredKey), '[1,3]', 'Explicit reload loads B instead of replaying stale A work');
    assert.deepEqual(await records(page), windows.before, 'Reload preserves B full records');
  });

  await check('share-cancel-and-failure-keep-the-dialog-and-allow-a-safe-retry', async windows => {
    const { page } = windows;
    await readDownload(page, () => exportButton(page).click());
    await page.locator('.sync-dialog .backup-notice.success').waitFor();
    await page.evaluate(() => { window.__dataProtection.shareMode = 'cancel'; });
    await exportButton(page).click();
    await exportButton(page).waitFor();
    assert.equal(await page.locator('.sync-dialog .backup-notice.success').count(), 0, 'A canceled new export must not retain a prior success claim');
    assert.equal(await reloadButton(page).isEnabled(), true);
    await assertPausedRecords(windows);
    await page.evaluate(() => { window.__dataProtection.shareMode = 'fail'; });
    await exportButton(page).click();
    await page.locator('.sync-dialog .backup-notice.error[role="alert"]').waitFor();
    assert.equal(await exportButton(page).isEnabled(), true);
    assert.equal(await reloadButton(page).isEnabled(), true);
    await assertPausedRecords(windows);
    await page.evaluate(() => { window.__dataProtection.shareMode = 'download'; });
    const backup = await readDownload(page, () => exportButton(page).click());
    assert.deepEqual(backup.data[masteredKey], [1,2]);
    await page.locator('.sync-dialog .backup-notice.success').waitFor();
    assert.equal(await page.locator('.sync-dialog .backup-notice.error').count(), 0);
    await assertPausedRecords(windows);
  });

  await check('pending-share-prevents-reload-and-duplicate-export-until-it-finishes', async windows => {
    const { page } = windows;
    await page.evaluate(() => { window.__dataProtection.shareMode = 'hold'; });
    await exportButton(page).click();
    await page.waitForFunction(() => typeof window.__dataProtection.finishShare === 'function');
    assert.equal(await page.locator('.sync-dialog').getAttribute('aria-busy'), 'true');
    assert.equal(await page.locator('.sync-dialog button').filter({ hasText: '正在导出' }).isDisabled(), true);
    assert.equal(await reloadButton(page).isDisabled(), true, 'Do not abandon a pending backup operation');
    await assertPausedRecords(windows);
    assert.equal(await page.evaluate(() => window.__dataProtection.shares.length), 1);
    await page.evaluate(() => { window.__dataProtection.finishShare(); });
    await page.locator('.sync-dialog .backup-notice.success').waitFor();
    assert.equal(await exportButton(page).isEnabled(), true);
    assert.equal(await reloadButton(page).isEnabled(), true);
    await assertPausedRecords(windows);
  });
  await browser.close();
}

const failed = results.filter(result => result.status === 'FAIL').length;
console.log(`DATA_PROTECTION_BROWSER_SUMMARY ${JSON.stringify({ passed: results.length - failed, failed, total: results.length, evidence, simulatedStorageAndShareFaults: true })}`);
if (failed) process.exitCode = 1;
