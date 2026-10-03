import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { navigate } from './browser-navigation.mjs';
import { openSetupDetails } from './browser-disclosures.mjs';
import { settleLearningStorage } from './storage-settlement-checks.mjs';

if (!process.env.PLAYWRIGHT_MODULE) throw new Error('Set PLAYWRIGHT_MODULE to the isolated Playwright installation.');
const playwright = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const base = new URL(process.env.PRODUCTION_URL || 'https://english-flow-mwnn.onrender.com/');
const local = base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
if (base.origin !== 'https://english-flow-mwnn.onrender.com' && !local) throw new Error('Only the official English Flow site or a local rehearsal is allowed.');
const expected = process.env.EXPECTED_COMMIT;
assert.match(expected || '', /^[0-9a-f]{40}$/, 'EXPECTED_COMMIT must be the full deployed commit');
const keys = {
  word: 'wordflow-active-session-v1', sentence: 'wordflow-sentence-active-session-v1',
  mastered: 'wordflow-ngsl-mastered-v1', difficult: 'wordflow-ngsl-difficult-v1',
  sentencePreferences: 'wordflow-sentence-preferences-v1',
};
const results = [];
const clientIdentities = new WeakMap();
// Chromium's network emulation permits a real controlled offline navigation.
// Playwright WebKit cannot provide equivalent offline Service Worker cold-load
// acceptance. Its loaded-document coverage remains in browser-smoke.mjs.
const browser = await playwright.chromium.launch({ headless: true });

async function records(page) {
  await settleLearningStorage(page);
  return page.evaluate(() => Object.fromEntries(Object.keys(localStorage)
    .filter(key => key.startsWith('wordflow-')).sort().map(key => [key, localStorage.getItem(key)])));
}

// waitForFunction polls synchronously: an async predicate returns a truthy
// Promise even when its eventual value is false. Await readiness explicitly,
// then poll the actual controlling worker with a synchronous Boolean.
async function waitForActivatedController(page, timeout = 45_000) {
  await page.evaluate(async timeout => {
    let timer;
    try {
      await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Service Worker readiness timed out')), timeout);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }, timeout);
  await page.waitForFunction(() => navigator.serviceWorker.controller?.state === 'activated', null, { timeout });
  assert.equal(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.state),
    'activated', 'The document must have an activated registration and an activated controller');
}

async function documentIdentity(page) {
  assert.equal(await page.title(), '词流英语');
  assert.equal(await page.locator('meta[name="english-flow-build"]').getAttribute('content'), expected);
  await waitForActivatedController(page);
  assert.equal(await page.evaluate(() => navigator.serviceWorker.controller?.state), 'activated');
  const workerUrl = await page.evaluate(() => navigator.serviceWorker.controller.scriptURL);
  const worker = page.context().serviceWorkers().find(candidate => candidate.url() === workerUrl);
  assert.ok(worker, 'The actual controlling Chromium worker must be observable');
  assert.equal(await worker.evaluate('BUILD_COMMIT'), expected, 'The executing worker must have the full expected commit');
  // Static export HTML may start dynamic imports after DOMContentLoaded.
  // Wait for a full client identity without treating a still-empty response
  // list as a failure or borrowing an earlier document's successful module.
  const deadline = Date.now() + 30_000;
  while (!clientIdentities.get(page).matched && Date.now() < deadline) await page.waitForTimeout(50);
  assert.equal(clientIdentities.get(page).matched, true,
    'A loaded client module in this document must contain the full expected release identity');
}

async function newDocument(context, previous, pathname = '/') {
  const oldId = await previous.evaluate(() => window.__offlineDocumentId);
  await previous.close();
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  const response = await page.goto(new URL(pathname, base).href, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  assert.equal(response.status(), 200, 'The actual installed worker must serve an offline document');
  assert.equal(response.fromServiceWorker(), true, 'Offline navigation must be served by the real worker');
  assert.equal(await page.evaluate(() => navigator.onLine), false);
  assert.notEqual(await page.evaluate(() => window.__offlineDocumentId), oldId, 'Closing and reopening must create a new document, without pack memory');
  await documentIdentity(page);
  return page;
}

async function packEntries(page) {
  return page.evaluate(async () => {
    const entries = [];
    for (const name of (await caches.keys()).filter(name => name.startsWith('english-flow-content-'))) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) entries.push({ cache: name, url: request.url, pathname: new URL(request.url).pathname });
    }
    return entries;
  });
}

async function check(name, body) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, serviceWorkers: 'allow' });
  const errors = [];
  context.on('page', page => {
    const identities = { generation: 0, matched: false };
    const requestGenerations = new WeakMap();
    clientIdentities.set(page, identities);
    page.on('pageerror', error => errors.push(error.message));
    page.on('framenavigated', frame => {
      if (frame !== page.mainFrame()) return;
      identities.generation++;
      identities.matched = false;
    });
    page.on('request', request => requestGenerations.set(request, identities.generation));
    page.on('response', response => {
      if (/\/assets\/[^?]+\.m?js(?:\?|$)/.test(response.url())) {
        const generation = requestGenerations.get(response.request());
        response.text().then(source => {
          if (generation === identities.generation && source.includes(expected)) identities.matched = true;
        }).catch(() => undefined);
      }
    });
  });
  await context.addInitScript(() => {
    window.__offlineDocumentId = `${Date.now()}-${Math.random()}`;
    // Text/record/offline acceptance only; no claim of real device sound.
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: class { constructor(text) { this.text = text; } } });
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      paused: false, getVoices() { return []; }, cancel() {}, resume() {},
      speak(utterance) { utterance.onstart?.(); utterance.onend?.(); },
    } });
  });
  let page;
  try {
    page = await context.newPage();
    page.setDefaultTimeout(30_000);
    const url = new URL('/', base);
    url.searchParams.set('ef-update', expected);
    const response = await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    assert.equal(response.status(), 200);
    await page.locator('.bottom-nav').waitFor();
    await documentIdentity(page);
    await navigate(page, '进度');
    assert.ok((await page.locator('.app-version-panel').innerText()).includes(`当前版本 ${expected.slice(0, 7)}`), 'The executing client must match the document identity');
    const detail = await body(page, context);
    assert.deepEqual(errors, [], 'Offline use must not produce uncaught browser errors');
    results.push({ engine: 'chromium', name, status: 'PASS', commit: expected, ...detail });
    console.log('LIVE_OFFLINE_PASS', JSON.stringify(results.at(-1)));
  } catch (error) {
    page = context.pages().at(-1) || page;
    results.push({ engine: 'chromium', name, status: 'FAIL', commit: expected, error: String(error),
      stack: error.stack, url: page?.url(), body: (await page?.locator('body').innerText().catch(() => '') || '').slice(0, 3000), errors });
    console.error('LIVE_OFFLINE_FAIL', JSON.stringify(results.at(-1)));
    process.exitCode = 1;
  } finally {
    await context.close();
  }
}

try {
  await check('downloaded-words-and-sentences-survive-offline-new-documents', async (page, context) => {
    await navigate(page, '单词');
    await page.getByRole('button', { name: '开始学习', exact: true }).click();
    await page.locator('.word-card').waitFor();
    await page.getByRole('button', { name: '我学会了', exact: true }).click();
    await settleLearningStorage(page);
    const wordText = await page.locator('.word-heading h2').innerText();
    await navigate(page, '句子');
    const start = page.getByRole('button', { name: '开始学习句子', exact: true });
    await start.waitFor();
    await page.waitForFunction(() => !document.querySelector('.sentence-page .setup-start')?.disabled);
    await start.click();
    await page.locator('.sentence-study-card').waitFor();
    await page.getByRole('button', { name: '还不熟悉', exact: true }).click();
    await settleLearningStorage(page);
    const sentenceText = await page.locator('.sentence-english').innerText();
    const before = await records(page);
    const initialWord = JSON.parse(before[keys.word]), initialSentence = JSON.parse(before[keys.sentence]);
    assert.equal(initialWord.index, 1);
    assert.equal(initialWord.ratings[initialWord.wordIds[0]], 'known');
    assert.equal(initialSentence.index, 1);
    assert.equal(initialSentence.ratings[initialSentence.sentenceIds[0]], 'difficult');
    const entries = await packEntries(page);
    for (const filename of ['ngsl-words-1.json', 'ngsl-words-2.json', 'ngsl-words-3.json', 'tatoeba-sentences-1.json']) {
      assert.ok(entries.some(entry => entry.pathname === `/data/${filename}`), `A validated ${filename} must actually be saved before going offline`);
    }
    await context.setOffline(true);
    page = await newDocument(context, page);
    await page.locator('.bottom-nav, .word-card, .sentence-study-card').first().waitFor();
    await page.locator('.offline-status').waitFor();
    assert.deepEqual(await records(page), before, 'Offline hydration must preserve all existing learning records');
    await navigate(page, '单词');
    await page.locator('.word-card').waitFor();
    assert.equal(await page.locator('.word-heading h2').innerText(), wordText);
    await page.getByRole('button', { name: '还不熟悉', exact: true }).click();
    const changed = await records(page);
    const originalWord = JSON.parse(before[keys.word]), newWord = JSON.parse(changed[keys.word]);
    const ratedId = originalWord.wordIds[originalWord.index];
    assert.equal(newWord.ratings[ratedId], 'difficult');
    assert.equal(newWord.index, originalWord.index + 1);
    assert.ok(JSON.parse(changed[keys.difficult]).includes(ratedId));
    assert.equal(changed[keys.sentence], before[keys.sentence], 'Word practice must preserve the paused sentence course');
    await navigate(page, '句子');
    // A reopened document resumes one active view. The other saved course is
    // deliberately paused at its normal setup entry until the learner starts.
    const resumeSentence = page.getByRole('button', { name: '开始学习句子', exact: true });
    if (await resumeSentence.isVisible()) await resumeSentence.click();
    await page.locator('.sentence-study-card').waitFor();
    assert.equal(await page.locator('.sentence-english').innerText(), sentenceText);
    assert.equal(await page.locator('.sentence-translation').count(), 1);
    const after = await records(page);
    page = await newDocument(context, page, '/index.html');
    await page.locator('.bottom-nav, .word-card, .sentence-study-card').first().waitFor();
    assert.deepEqual(await records(page), after, 'A second offline document must retain the new offline rating');
    await context.setOffline(false);
    await page.locator('.offline-status').waitFor({ state: 'detached' });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.bottom-nav, .word-card, .sentence-study-card').first().waitFor();
    await documentIdentity(page);
    assert.deepEqual(await records(page), after, 'Online recovery must preserve offline work');
    return { realWorkerOfflineNavigation: true, offlineDocuments: ['/', '/index.html'], savedPacks: 4,
      wordAndSentenceResume: true, offlineRatingPersisted: true, onlineRecoveryPreservedRecords: true, speechInstrumented: true };
  });

  await check('partly-evicted-core-pack-fails-clearly-and-recovers-in-place', async (page, context) => {
    await navigate(page, '单词');
    await page.getByRole('button', { name: '开始学习', exact: true }).click();
    await page.locator('.word-card').waitFor();
    await page.getByRole('button', { name: '我学会了', exact: true }).click();
    const before = await records(page);
    // Cache eviction is injected only into this disposable profile. Server
    // content and the learner's actual records are never modified.
    const removed = await page.evaluate(async () => {
      let count = 0;
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        for (const request of await cache.keys()) if (new URL(request.url).pathname === '/data/ngsl-words-2.json') {
          if (await cache.delete(request)) count++;
        }
      }
      return count;
    });
    assert.ok(removed > 0, 'The missing-pack case must remove a real saved pack');
    await context.setOffline(true);
    page = await newDocument(context, page);
    await page.getByText('核心词库暂时没有加载成功', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '重试核心词库', exact: true }).isDisabled(), true);
    assert.ok((await page.locator('.app-loading').innerText()).includes('联网后会自动继续载入'));
    assert.deepEqual(await records(page), before, 'An unavailable pack must not replace records with empty data');
    const documentId = await page.evaluate(() => window.__offlineDocumentId);
    await context.setOffline(false);
    await page.locator('.word-card').waitFor();
    assert.equal(await page.evaluate(() => window.__offlineDocumentId), documentId, 'The online event must recover the same document');
    assert.deepEqual(await records(page), before, 'Recovery must restore the exact paused course and existing records');
    assert.ok((await packEntries(page)).some(entry => entry.pathname === '/data/ngsl-words-2.json'));
    return { cacheEvictionSimulated: true, realWorkerOfflineNavigation: true, missingPackErrorVisible: true,
      recordsPreservedDuringFailure: true, onlineRecoveryWithoutReload: true, missingPackSavedAgain: true };
  });

  await check('cached-sentence-band-works-while-missing-band-recovers-online', async (page, context) => {
    await navigate(page, '句子');
    await page.waitForFunction(() => !document.querySelector('.sentence-page .setup-start')?.disabled);
    const entries = await packEntries(page);
    assert.ok(entries.some(entry => entry.pathname === '/data/tatoeba-sentences-1.json'));
    assert.equal(entries.some(entry => /tatoeba-sentences-[23]\.json$/.test(entry.pathname)), false, 'This case must begin with only the visited sentence band cached');
    const before = await records(page);
    await context.setOffline(true);
    page = await newDocument(context, page);
    await page.locator('.bottom-nav').waitFor();
    await navigate(page, '句子');
    await page.waitForFunction(() => !document.querySelector('.sentence-page .setup-start')?.disabled);
    assert.deepEqual(await records(page), before, 'Loading the cached band after offline reopening must preserve every record');
    await page.getByRole('button', { name: '开始学习句子', exact: true }).click();
    await page.locator('.sentence-study-card').waitFor();
    await page.getByRole('button', { name: '返回句库设置并保留进度', exact: true }).click();
    const beforeBandChange = await records(page);
    await openSetupDetails(page, '.sentence-range');
    await page.locator('.sentence-band-switch button').nth(1).click();
    await page.locator('.sentence-load-error').waitFor();
    assert.equal(await page.getByRole('button', { name: '开始学习句子', exact: true }).isDisabled(), true);
    assert.ok((await page.locator('.sentence-load-error').innerText()).includes('联网后会自动补全'));
    const partial = await records(page);
    const exceptPreferences = values => Object.fromEntries(Object.entries(values).filter(([key]) => key !== keys.sentencePreferences));
    assert.deepEqual(exceptPreferences(partial), exceptPreferences(beforeBandChange), 'Selecting an unavailable band must only change the intended preference');
    assert.equal(JSON.parse(partial[keys.sentencePreferences]).band, 'medium');
    const sentenceSnapshot = partial[keys.sentence];
    const documentId = await page.evaluate(() => window.__offlineDocumentId);
    await context.setOffline(false);
    await page.waitForFunction(() => !document.querySelector('.sentence-page .setup-start')?.disabled);
    await page.locator('.sentence-load-error').waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => window.__offlineDocumentId), documentId);
    assert.equal((await records(page))[keys.sentence], sentenceSnapshot, 'Loading a different band must preserve the paused short-sentence course');
    assert.deepEqual(await records(page), partial, 'Online pack recovery must preserve every record and the selected preference');
    assert.ok((await packEntries(page)).some(entry => entry.pathname === '/data/tatoeba-sentences-2.json'));
    return { realWorkerOfflineNavigation: true, downloadedBandUsable: true, uncachedBandDisabledAndExplained: true,
      onlineRecoveryWithoutReload: true, pausedCoursePreserved: true };
  });

  await check('previous-content-revision-is-fallback-only-and-survives-online-refresh', async (page, context) => {
    await navigate(page, '句子');
    await page.waitForFunction(() => !document.querySelector('.sentence-page .setup-start')?.disabled);
    const before = await records(page);
    // Model a content-fingerprint change using real, validated downloaded
    // responses in a disposable native cache. This does not deploy an old or
    // future app and is separate from the actual current-worker navigation.
    const previousRevision = 'qa5-previous-content';
    const fixture = await page.evaluate(async revision => {
      const names = (await caches.keys()).filter(name => name.startsWith('english-flow-content-'));
      if (names.length !== 1) throw new Error(`Expected one new-profile content cache, found ${names.length}`);
      const currentName = names[0], current = await caches.open(currentName);
      const previousName = `english-flow-content-${revision}`, previous = await caches.open(previousName);
      const hashes = [];
      for (const request of await current.keys()) {
        const response = await current.match(request);
        const url = new URL(request.url);
        url.searchParams.set('rev', revision);
        const digest = await crypto.subtle.digest('SHA-256', await response.clone().arrayBuffer());
        hashes.push({ url: url.href, hash: [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('') });
        await previous.put(url.href, response);
      }
      await caches.delete(currentName);
      return { currentName, previousName, hashes };
    }, previousRevision);
    assert.equal(fixture.hashes.length, 4, 'The old-revision fixture must include three words packs and the visited sentence pack');
    await context.setOffline(true);
    page = await newDocument(context, page);
    await page.locator('.bottom-nav').waitFor();
    await navigate(page, '句子');
    await page.waitForFunction(() => !document.querySelector('.sentence-page .setup-start')?.disabled);
    assert.deepEqual(await records(page), before);
    const offlineEntries = await packEntries(page);
    assert.equal(offlineEntries.filter(entry => entry.cache === fixture.currentName).length, 0, 'Fallback must not pin the previous content as a confirmed current revision');
    assert.equal(offlineEntries.filter(entry => entry.cache === fixture.previousName).length, 4);
    await context.setOffline(false);
    await page.close();
    page = await context.newPage();
    page.setDefaultTimeout(30_000);
    const response = await page.goto(new URL('/', base).href, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    assert.equal(response.status(), 200);
    await page.locator('.bottom-nav').waitFor();
    await documentIdentity(page);
    await navigate(page, '句子');
    await page.waitForFunction(() => !document.querySelector('.sentence-page .setup-start')?.disabled);
    const onlineEntries = await packEntries(page);
    assert.equal(onlineEntries.filter(entry => entry.cache === fixture.currentName).length, 4, 'Online reopening must populate the actual current revision');
    const retained = await page.evaluate(async cacheName => {
      const cache = await caches.open(cacheName), hashes = [];
      for (const request of await cache.keys()) {
        const response = await cache.match(request);
        const digest = await crypto.subtle.digest('SHA-256', await response.arrayBuffer());
        hashes.push({ url: request.url, hash: [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('') });
      }
      return hashes;
    }, fixture.previousName);
    assert.deepEqual(retained, fixture.hashes, 'Refreshing this page must preserve every byte of another content revision');
    assert.deepEqual(await records(page), before);
    return { previousRevisionSimulated: true, nativeCacheStorage: true, realWorkerOfflineNavigation: true,
      oldRevisionUsableOffline: true, oldDataNotPromotedToCurrent: true, currentRevisionDownloadedOnline: true,
      otherRevisionPreservedByteForByte: true };
  });
} finally {
  await browser.close();
}
console.log('LIVE_OFFLINE_SUMMARY', JSON.stringify({ commit: expected, passed: results.filter(result => result.status === 'PASS').length,
  failed: results.filter(result => result.status === 'FAIL').length, total: results.length,
  engine: 'chromium', webkitOfflineColdNavigation: 'not covered by Playwright WebKit', physicalDeviceAndSound: 'not verified' }));
