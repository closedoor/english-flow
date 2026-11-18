import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { navigate } from './browser-navigation.mjs';
import { settleLearningStorage } from './storage-settlement-checks.mjs';

if (!process.env.PLAYWRIGHT_MODULE) throw new Error('Set PLAYWRIGHT_MODULE; see TESTING.md.');
const pw = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const origin = process.env.BROWSER_TEST_URL || 'http://127.0.0.1:4173';
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname)) throw new Error('Backup fixtures must remain on a local test origin.');
const engines = process.env.BROWSER_ENGINES?.split(',') ?? ['chromium', 'webkit'];
if (!engines.length || engines.some(engine => !['chromium', 'webkit'].includes(engine))) throw new Error('Invalid BROWSER_ENGINES.');
const pageSource = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
const storageKeys = [...pageSource.slice(pageSource.indexOf('const STORAGE ='), pageSource.indexOf('type StorageKey'))
  .matchAll(/\w+: "(wordflow-[^"]+)"/g)].map(match => match[1]);
assert.equal(storageKeys.length, 19);
const masteredKey = 'wordflow-ngsl-mastered-v1';
const activeKey = 'wordflow-active-session-v1';
const restoreButton = page => page.getByRole('button', { name: '恢复备份', exact: true });
const readStatus = page => page.getByText('正在读取备份文件…', { exact: true });
const snapshot = page => page.evaluate(keys => Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)])), storageKeys);
const backup = mastered => ({ app: 'english-flow', formatVersion: 1, exportedAt: '2026-11-17T10:00:00Z',
  data: { ...Object.fromEntries(storageKeys.map(key => [key, null])), [masteredKey]: mastered } });

async function upload(page, filename, mastered) {
  await page.locator('input[type="file"]').setInputFiles({ name: filename, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup(mastered))) });
  await readStatus(page).waitFor();
  await page.waitForFunction(name => window.__backupReadGates.has(name), filename);
}

async function finishRead(page, filename, rejects = false) {
  await page.evaluate(async ({ filename, rejects }) => {
    const finish = window.__backupReadGates.get(filename);
    if (!finish) throw new Error('Missing test file gate');
    await finish(rejects);
    // Cross a rendering turn so stale file handlers and their UI updates have run.
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }, { filename, rejects });
}

const results = [];
for (const engine of engines) {
  const browser = await pw[engine].launch({ headless: true });
  async function check(name, body) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, serviceWorkers: 'block', acceptDownloads: true });
    await context.addInitScript(() => {
      const nativeText = Blob.prototype.text;
      window.__backupReadGates = new Map();
      // Only test files get a controlled delay/rejection. File input, validation,
      // navigation, export and cross-document storage all use the real browser.
      File.prototype.text = function () {
        if (!this.name.startsWith('qa8-slow-')) return nativeText.call(this);
        return new Promise((resolve, reject) => window.__backupReadGates.set(this.name, async fails => {
          window.__backupReadGates.delete(this.name);
          if (fails) reject(new Error('Simulated unreadable backup file'));
          else resolve(await nativeText.call(this));
        }));
      };
      window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
      Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
        paused: false, getVoices() { return []; }, cancel() {}, resume() {}, speak(u) { u.onstart?.(); },
      } });
      Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => false });
    });
    const page = await context.newPage(); page.setDefaultTimeout(9_000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(origin, { waitUntil: 'domcontentloaded' });
      await page.locator('.bottom-nav').waitFor();
      await navigate(page, '进度');
      await settleLearningStorage(page);
      await body(page, context);
      assert.deepEqual(errors, []);
      results.push({ engine, name, status: 'PASS', simulatedFileRead: true });
    } catch (error) {
      results.push({ engine, name, status: 'FAIL', error: String(error), errors, body: (await page.locator('body').innerText().catch(() => '')).slice(-1600) });
    } finally { await context.close(); }
    console.log(JSON.stringify(results.at(-1)));
  }

  await check('completed-old-read-cannot-interrupt-a-new-word-session', async page => {
    const filename = 'qa8-slow-leave.json';
    await upload(page, filename, [8, 9]);
    await navigate(page, '单词');
    await page.getByRole('button', { name: '开始学习', exact: true }).click();
    await page.locator('.word-card').waitFor();
    await settleLearningStorage(page);
    const before = await snapshot(page);
    await finishRead(page, filename);
    assert.equal(await page.getByRole('dialog', { name: '恢复这份学习记录？' }).count(), 0, 'A left-behind file must not open a restore dialog during practice');
    assert.deepEqual(await snapshot(page), before, 'The obsolete file must not change any learning record');
    await page.getByRole('button', { name: '我学会了', exact: true }).click();
    await settleLearningStorage(page);
    const after = await snapshot(page);
    assert.equal(Object.keys(JSON.parse(after[activeKey]).ratings).length, 1);
    assert.equal(JSON.parse(before[masteredKey]).length, 0);
    assert.equal(JSON.parse(after[masteredKey]).length, 1);
  });

  await check('returning-to-settings-can-start-a-new-read-before-old-failure', async page => {
    const oldName = 'qa8-slow-old.json', newName = 'qa8-slow-new.json';
    const before = await snapshot(page);
    await upload(page, oldName, [8]);
    await page.getByRole('button', { name: '返回首页', exact: true }).click();
    await navigate(page, '进度');
    assert.equal(await readStatus(page).count(), 0, 'Leaving settings releases the old file read immediately');
    assert.equal(await restoreButton(page).isEnabled(), true);
    await upload(page, newName, [9, 10]);
    await finishRead(page, oldName, true);
    assert.equal(await readStatus(page).isVisible(), true, 'The obsolete error must not clear the newer busy state');
    assert.equal(await page.locator('.backup-notice').count(), 0);
    await finishRead(page, newName);
    const dialog = page.getByRole('dialog', { name: '恢复这份学习记录？' });
    await dialog.waitFor();
    assert.match(await dialog.innerText(), /包含 2 个已掌握单词/);
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    await settleLearningStorage(page);
    assert.deepEqual(await snapshot(page), before);
  });

  await check('a-real-other-window-rating-keeps-backup-rescue-and-reload-available', async (page, context) => {
    // Hydrate the second page before starting the read; a real rating emits
    // native storage events, rather than testing a dispatched fake event.
    const other = await context.newPage();
    await other.goto(origin, { waitUntil: 'domcontentloaded' });
    await other.locator('.bottom-nav').waitFor();
    await navigate(other, '单词');
    await other.getByRole('button', { name: '开始学习', exact: true }).click();
    await other.locator('.word-card').waitFor();
    await settleLearningStorage(other);
    // The first document is intentionally reloaded to share the same newly
    // paused course at the moment the file read begins.
    await page.reload();
    await page.locator('.word-card').waitFor();
    await navigate(page, '进度');
    await settleLearningStorage(page);
    const before = await snapshot(page);
    const filename = 'qa8-slow-conflict.json';
    await upload(page, filename, [8, 9]);
    await other.getByRole('button', { name: '我学会了', exact: true }).click();
    await settleLearningStorage(other);
    const winning = await snapshot(other);
    assert.notDeepEqual(winning, before);
    const dialog = page.getByRole('alertdialog', { name: '另一窗口已更新记录' });
    await dialog.waitFor();
    const rescue = dialog.getByRole('button', { name: '导出本页备份', exact: true });
    const reload = dialog.getByRole('button', { name: '载入最新记录', exact: true });
    assert.equal(await rescue.isEnabled(), true, 'An unrelated pending file must not block rescue export');
    assert.equal(await reload.isEnabled(), true, 'An unrelated pending file must not block safe reload');
    const downloadPromise = page.waitForEvent('download');
    await rescue.click();
    const download = await downloadPromise;
    assert.equal(await download.failure(), null);
    const data = JSON.parse(await readFile(await download.path(), 'utf8'));
    assert.equal(Object.keys(data.data).length, 19);
    assert.deepEqual(data.data[masteredKey], JSON.parse(before[masteredKey]));
    assert.deepEqual(data.data[activeKey], JSON.parse(before[activeKey]));
    await finishRead(page, filename);
    assert.equal(await page.getByRole('dialog', { name: '恢复这份学习记录？' }).count(), 0);
    assert.match(await dialog.locator('.backup-notice').innerText(), /已开始下载备份/);
    assert.deepEqual(await snapshot(other), winning);
    await reload.click();
    await page.locator('.word-card').waitFor();
    await settleLearningStorage(page);
    assert.deepEqual(await snapshot(page), winning);
  });
  await browser.close();
}

const passed = results.filter(result => result.status === 'PASS').length;
console.log('BACKUP_NAVIGATION_SUMMARY', JSON.stringify({ passed, failed: results.length - passed, total: results.length, engines, simulatedFileRead: true }));
if (passed !== results.length) process.exitCode = 1;
