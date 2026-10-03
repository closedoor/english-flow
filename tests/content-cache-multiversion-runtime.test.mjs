import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = await readFile(new URL("../app/content-loader.ts", import.meta.url), "utf8");
const oldRevision = "data-11111111111111111111";
const newRevision = "data-22222222222222222222";
const cacheName = (revision) => `english-flow-content-${revision}`;
const packUrl = (revision) => `/data/test.json?rev=${revision}`;
const valid = (value) => Array.isArray(value) && value.every(Number.isInteger);

function fixture() {
  const stores = new Map();
  let deletions = 0;
  return {
    stores,
    deletions: () => deletions,
    async open(name) {
      if (!stores.has(name)) {
        const values = new Map();
        stores.set(name, {
          async match(url) { return values.get(String(url))?.clone(); },
          async put(url, response) { values.set(String(url), response.clone()); },
          async delete(url) { deletions += 1; return values.delete(String(url)); },
          async keys() { return [...values.keys()]; },
        });
      }
      return stores.get(name);
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { deletions += 1; return stores.delete(name); },
    async match(url) {
      for (const cache of stores.values()) {
        const saved = await cache.match(url);
        if (saved) return saved;
      }
    },
  };
}

// Model two tabs built from the actual loader, sharing origin Cache Storage
// while retaining independent content revisions, online states and requests.
function page(revision, caches, value, { cacheDeadline } = {}) {
  const navigator = { onLine: true };
  const window = Object.assign(new EventTarget(), {
    setTimeout(callback, delay, ...args) {
      return setTimeout(callback, delay === 2000 && cacheDeadline !== undefined ? cacheDeadline : delay, ...args);
    },
    clearTimeout,
  });
  let warnings = 0;
  window.addEventListener("english-flow-offline-cache-error", () => { warnings += 1; });
  const configuredSource = source
    .replace(/^const buildEnvironment = .*;$/m, `const buildEnvironment = { VITE_ENGLISH_FLOW_CONTENT_REVISION: ${JSON.stringify(revision)} };`)
    .replace(/^export /gm, "");
  const code = ts.transpileModule(configuredSource, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  let requests = 0;
  const { fetchJsonWithRecovery } = vm.runInNewContext(`${code}\n({ fetchJsonWithRecovery });`, {
    window, navigator, caches, Response, AbortController, Event,
    fetch: async () => { requests += 1; return new Response(JSON.stringify(value)); },
  });
  return {
    navigator,
    requests: () => requests,
    warnings: () => warnings,
    load: () => fetchJsonWithRecovery(packUrl(revision), valid),
  };
}

test("a delayed older tab write preserves the newer tab's committed offline pack", { timeout: 3000 }, async () => {
  const caches = fixture();
  const oldCache = await caches.open(cacheName(oldRevision));
  const originalPut = oldCache.put.bind(oldCache);
  let releaseWrite;
  let writeStarted;
  const barrier = new Promise((resolve) => { releaseWrite = resolve; });
  const started = new Promise((resolve) => { writeStarted = resolve; });
  oldCache.put = async (...args) => { writeStarted(); await barrier; return originalPut(...args); };
  const oldPage = page(oldRevision, caches, [1, 2]);
  const newPage = page(newRevision, caches, [3, 4]);
  const pendingOldLoad = oldPage.load();
  await started;
  try {
    assert.deepEqual(await newPage.load(), [3, 4]);
  } finally {
    releaseWrite();
  }
  assert.deepEqual(await pendingOldLoad, [1, 2]);

  const current = await caches.open(cacheName(newRevision));
  const saved = await current.match(packUrl(newRevision));
  assert.ok(saved, "the newer pack must remain registered after the older tab completes");
  assert.deepEqual(await saved.json(), [3, 4]);
  newPage.navigator.onLine = false;
  oldPage.navigator.onLine = false;
  assert.deepEqual(await newPage.load(), [3, 4]);
  assert.deepEqual(await oldPage.load(), [1, 2]);
  assert.equal(newPage.requests(), 1);
  assert.equal(oldPage.requests(), 1);
});

async function holdFirstCacheRead(cache) {
  const match = cache.match.bind(cache);
  let releaseRead;
  let readStarted;
  let first = true;
  const barrier = new Promise((resolve) => { releaseRead = resolve; });
  const started = new Promise((resolve) => { readStarted = resolve; });
  cache.match = async (url) => {
    const delayed = first;
    first = false;
    const snapshot = await match(url);
    if (delayed) { readStarted(); await barrier; }
    return snapshot;
  };
  return { started, releaseRead };
}

test("a delayed corrupt current-cache read cannot delete another tab's repaired pack", { timeout: 3000 }, async () => {
  const caches = fixture();
  const cache = await caches.open(cacheName(newRevision));
  await cache.put(packUrl(newRevision), new Response("{broken"));
  const { started, releaseRead } = await holdFirstCacheRead(cache);
  const delayedPage = page(newRevision, caches, [1, 2]);
  const repairingPage = page(newRevision, caches, [3, 4]);
  const delayedLoad = delayedPage.load();
  await started;
  try {
    assert.deepEqual(await repairingPage.load(), [3, 4]);
    delayedPage.navigator.onLine = false;
    repairingPage.navigator.onLine = false;
  } finally {
    releaseRead();
  }
  // Reject the captured malformed response; a normal retry then reads the
  // valid copy that the other tab committed while the disk read was delayed.
  await assert.rejects(delayedLoad, /Learning content is unavailable/);
  assert.deepEqual(await delayedPage.load(), [3, 4]);
  assert.deepEqual(await repairingPage.load(), [3, 4]);
  assert.equal(delayedPage.requests(), 0);
  assert.equal(repairingPage.requests(), 1);
  assert.equal(delayedPage.warnings(), 0);
  assert.equal(repairingPage.warnings(), 0);
});

test("a delayed corrupt fallback read cannot delete a pack repaired by its own revision", { timeout: 3000 }, async () => {
  const caches = fixture();
  const oldCache = await caches.open(cacheName(oldRevision));
  await oldCache.put(packUrl(oldRevision), new Response("{broken"));
  const { started, releaseRead } = await holdFirstCacheRead(oldCache);
  const upgradedPage = page(newRevision, caches, [5, 6]);
  const repairingPage = page(oldRevision, caches, [3, 4]);
  const delayedLoad = upgradedPage.load();
  await started;
  try {
    assert.deepEqual(await repairingPage.load(), [3, 4]);
    upgradedPage.navigator.onLine = false;
    repairingPage.navigator.onLine = false;
  } finally {
    releaseRead();
  }
  await assert.rejects(delayedLoad, /Learning content is unavailable/);
  assert.deepEqual(await upgradedPage.load(), [3, 4]);
  assert.deepEqual(await repairingPage.load(), [3, 4]);
  assert.equal(upgradedPage.requests(), 0);
  assert.equal(repairingPage.requests(), 1);
  assert.equal(upgradedPage.warnings(), 0);
  assert.equal(repairingPage.warnings(), 0);
});

test("an older tab recreating its removed cache cannot delete a newer content revision", { timeout: 3000 }, async () => {
  const caches = fixture();
  const oldPage = page(oldRevision, caches, [1, 2]);
  const newPage = page(newRevision, caches, [3, 4]);
  await caches.open(cacheName(oldRevision));
  assert.deepEqual(await newPage.load(), [3, 4]);
  // A prior deployment or browser eviction removed the old namespace. The
  // still-open tab creates it again after the newer cache already exists.
  await caches.delete(cacheName(oldRevision));
  assert.deepEqual(await oldPage.load(), [1, 2]);
  assert.deepEqual(await caches.keys(), [cacheName(newRevision), cacheName(oldRevision)]);

  newPage.navigator.onLine = false;
  oldPage.navigator.onLine = false;
  assert.deepEqual(await newPage.load(), [3, 4]);
  assert.deepEqual(await oldPage.load(), [1, 2]);
  assert.equal(newPage.requests(), 1);
  assert.equal(oldPage.requests(), 1);
});

const upgradedRevision = "data-33333333333333333333";
const stalled = () => new Promise(() => {});

test("one stalled newer legacy cache cannot hide an older valid offline pack", { timeout: 3000 }, async () => {
  const caches = fixture();
  const older = await caches.open(cacheName(oldRevision));
  await older.put(packUrl(oldRevision), new Response("[1,2]"));
  await caches.open(cacheName(newRevision));
  const open = caches.open.bind(caches);
  caches.open = (name) => name === cacheName(newRevision) ? stalled() : open(name);
  const upgradedPage = page(upgradedRevision, caches, [5, 6], { cacheDeadline: 100 });
  upgradedPage.navigator.onLine = false;

  assert.deepEqual(await upgradedPage.load(), [1, 2]);
  assert.equal(upgradedPage.requests(), 0);
  assert.equal(upgradedPage.warnings(), 0);
  assert.equal(caches.deletions(), 0);
  assert.deepEqual(await (await older.match(packUrl(oldRevision))).json(), [1, 2]);
  assert.equal(await (await caches.open(cacheName(upgradedRevision))).match(packUrl(upgradedRevision)), undefined, "fallback-only data must not pin the current revision");
});

test("a stalled versioned lookup cannot hide an unversioned entry in the same old cache", { timeout: 3000 }, async () => {
  const caches = fixture();
  const older = await caches.open(cacheName(oldRevision));
  await older.put("/data/test.json", new Response("[7,8]"));
  const match = older.match.bind(older);
  older.match = (url) => String(url).includes("?rev=") ? stalled() : match(url);
  const upgradedPage = page(upgradedRevision, caches, [5, 6], { cacheDeadline: 100 });
  upgradedPage.navigator.onLine = false;

  assert.deepEqual(await upgradedPage.load(), [7, 8]);
  assert.equal(upgradedPage.requests(), 0);
  assert.equal(upgradedPage.warnings(), 0);
  assert.equal(caches.deletions(), 0);
});

test("stalled enumeration still recovers a validated unversioned old shell pack offline", { timeout: 3000 }, async () => {
  const caches = fixture();
  const older = await caches.open("wordflow-ngsl-old-complete");
  await older.put("/data/test.json", new Response("[7,8]"));
  caches.keys = stalled;
  const upgradedPage = page(upgradedRevision, caches, [5, 6], { cacheDeadline: 100 });
  upgradedPage.navigator.onLine = false;

  assert.deepEqual(await upgradedPage.load(), [7, 8]);
  assert.equal(upgradedPage.requests(), 0);
  assert.equal(upgradedPage.warnings(), 0);
  assert.equal(caches.deletions(), 0);
  assert.deepEqual(await (await older.match("/data/test.json")).json(), [7, 8]);
});

test("healthy legacy revision reads prefer the most recently created revision over the old shell", { timeout: 3000 }, async () => {
  const caches = fixture();
  const shell = await caches.open("wordflow-ngsl-old-complete");
  await shell.put("/data/test.json", new Response("[7,8]"));
  const older = await caches.open(cacheName(oldRevision));
  await older.put(packUrl(oldRevision), new Response("[1,2]"));
  const newer = await caches.open(cacheName(newRevision));
  await newer.put(packUrl(newRevision), new Response("[3,4]"));
  const upgradedPage = page(upgradedRevision, caches, [5, 6]);
  upgradedPage.navigator.onLine = false;

  assert.deepEqual(await upgradedPage.load(), [3, 4]);
  assert.equal(upgradedPage.requests(), 0);
  assert.equal(upgradedPage.warnings(), 0);
  assert.equal(caches.deletions(), 0);
});
