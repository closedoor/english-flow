import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { navigate } from './browser-navigation.mjs';

export const calendarCases = [
  { timezoneId: 'Asia/Shanghai', instant: '2026-12-31T16:05:00.000Z', date: '2027-01-01' },
  { timezoneId: 'America/Los_Angeles', instant: '2027-01-01T07:55:00.000Z', date: '2026-12-31' },
];

// A fresh empty context uses the real download path. Fix only the export clock;
// the file and its suggested name are read from the browser.
export async function checkBackupCalendar(browser, origin, { timezoneId, instant, date }) {
  const context = await browser.newContext({ timezoneId, acceptDownloads: true, serviceWorkers: 'block' });
  try {
    await context.addInitScript(() => Object.defineProperty(navigator, 'canShare', {
      configurable: true, value: () => false,
    }));
    const page = await context.newPage();
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await navigate(page, '进度');
    await page.clock.setFixedTime(new Date(instant));
    const pending = page.waitForEvent('download');
    await page.locator('.backup-actions').getByRole('button', { name: '导出备份', exact: true }).click();
    const download = await pending;
    assert.equal(await download.failure(), null);
    const backup = JSON.parse(await readFile(await download.path(), 'utf8'));
    assert.equal(backup.formatVersion, 1);
    assert.equal(Object.keys(backup.data).length, 19);
    assert.equal(backup.exportedAt, instant, 'The portable backup retains its precise UTC timestamp');
    assert.equal(download.suggestedFilename(), `english-flow-backup-${date}.json`, timezoneId);
  } finally {
    await context.close();
  }
}
