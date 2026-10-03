import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { checkNoticeLayoutMatrix } from './notice-layout-checks.mjs';

const base = new URL(process.env.PRODUCTION_URL || 'https://english-flow-mwnn.onrender.com/');
const official = base.origin === 'https://english-flow-mwnn.onrender.com';
const local = ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) && ['http:', 'https:'].includes(base.protocol);
if (!official && !local) throw new Error('Only the original Render site or a loopback rehearsal may be tested.');
if (base.username || base.password) throw new Error('Verification URLs must not contain credentials.');
const expected = process.env.EXPECTED_COMMIT;
assert.match(expected || '', /^[0-9a-f]{40}$/, 'EXPECTED_COMMIT must be the full Git commit SHA');
if (!process.env.PLAYWRIGHT_MODULE) throw new Error('Set PLAYWRIGHT_MODULE to the isolated Playwright installation.');
const playwright = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const results = [];
for (const engine of ['chromium', 'webkit']) {
  let browser;
  try {
    browser = await playwright[engine].launch({ headless: true });
    await checkNoticeLayoutMatrix(browser, engine, new URL('/', base).href, results, expected);
  } catch (error) {
    results.push({ engine, name: 'notice-engine-setup', status: 'FAIL', error: String(error) });
    console.error('LIVE_NOTICE_ENGINE_FAIL', JSON.stringify(results.at(-1)));
  } finally {
    await browser?.close();
  }
}
const failed = results.filter(result => result.status === 'FAIL').length;
console.log('LIVE_NOTICE_SUMMARY', JSON.stringify({ commit: expected, passed: results.length - failed, failed, total: results.length, expectedTotal: 24,
  freshIsolatedProfiles: true, htmlAndLoadedClientCheckedPerProfile: true, serviceWorkers: 'block',
  simulatedSpeechAndCacheFailures: true, networkOfflineEmulated: true, physicalDeviceOrAudioVerified: false }));
if (failed || results.length !== 24) process.exitCode = 1;
