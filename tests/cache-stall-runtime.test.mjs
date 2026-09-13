import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../app/content-loader.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { fetchJsonWithRecovery, CONTENT_REVISION } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const cacheName = `english-flow-content-${CONTENT_REVISION}`;
const url = `/data/stall-test.json?rev=${CONTENT_REVISION}`;
const validate = value => Array.isArray(value) && value.every(Number.isInteger);
const stalled = () => new Promise(() => {});

function fixture() {
  const stores = new Map();
  return {
    async open(name) {
      if (!stores.has(name)) {
        const entries = new Map();
        stores.set(name, {
          async match(key) { return entries.get(String(key))?.clone(); },
          async put(key, response) { entries.set(String(key), response.clone()); },
          async delete(key) { return entries.delete(String(key)); },
          async keys() { return [...entries.keys()]; },
        });
      }
      return stores.get(name);
    },
    async keys() { return [...stores.keys()]; },
    async match(key) {
      for (const cache of stores.values()) {
        const value = await cache.match(key);
        if (value) return value;
      }
    },
    async delete(name) { return stores.delete(name); },
  };
}

async function withEnvironment(caches, body, online = true) {
  const window = Object.assign(new EventTarget(), {
    setTimeout: (callback, delay, ...args) => setTimeout(callback, Math.min(delay, 25), ...args),
    clearTimeout,
  });
  let requests = 0;
  let warnings = 0;
  window.addEventListener('english-flow-offline-cache-error', () => warnings++);
  const values = {
    window, navigator: { onLine: online }, caches,
    fetch: async () => { requests++; return new Response('[9,10]'); },
  };
  const previous = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { value, configurable: true });
  let watchdog;
  try {
    await Promise.race([
      body({ counts: () => ({ requests, warnings }) }),
      new Promise((_, reject) => { watchdog = setTimeout(() => reject(new Error('Cache operation never settled; usable content is blocked')), 600); }),
    ]);
  } finally {
    clearTimeout(watchdog);
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
}

test('a stalled current-cache open cannot block usable online content', async () => {
  const caches = fixture();
  const open = caches.open.bind(caches);
  let first = true;
  caches.open = name => { if (first) { first = false; return stalled(); } return open(name); };
  await withEnvironment(caches, async ({ counts }) => {
    assert.deepEqual(await fetchJsonWithRecovery(url, validate), [9,10]);
    assert.deepEqual(counts(), { requests: 1, warnings: 0 });
  });
});

test('a stalled current-cache match still permits a validated older offline copy', async () => {
  const caches = fixture();
  const current = await caches.open(cacheName);
  current.match = stalled;
  const older = await caches.open('english-flow-content-v20');
  await older.put('/data/stall-test.json?rev=v20', new Response('[1,2]'));
  await withEnvironment(caches, async ({ counts }) => {
    assert.deepEqual(await fetchJsonWithRecovery(url, validate), [1,2]);
    assert.deepEqual(counts(), { requests: 0, warnings: 0 });
  }, false);
});

test('stalled cache enumeration cannot prevent the online path', async () => {
  const caches = fixture();
  caches.keys = stalled;
  await withEnvironment(caches, async ({ counts }) => {
    assert.deepEqual(await fetchJsonWithRecovery(url, validate), [9,10]);
    assert.deepEqual(counts(), { requests: 1, warnings: 0 });
  });
});

test('a stalled cache body cannot keep the loading screen open forever', async () => {
  const caches = fixture();
  const cache = await caches.open(cacheName);
  cache.match = async () => ({ clone: () => ({ json: stalled }) });
  caches.match = async () => undefined;
  await withEnvironment(caches, async ({ counts }) => {
    assert.deepEqual(await fetchJsonWithRecovery(url, validate), [9,10]);
    assert.equal(counts().requests, 1);
  });
});

test('a stalled offline write returns validated content once and reports unconfirmed persistence', async () => {
  const caches = fixture();
  const cache = await caches.open(cacheName);
  cache.put = stalled;
  await withEnvironment(caches, async ({ counts }) => {
    assert.deepEqual(await fetchJsonWithRecovery(url, validate), [9,10]);
    assert.deepEqual(counts(), { requests: 1, warnings: 1 });
  });
});

test('stalled housekeeping cannot hide a successful saved pack or issue a false warning', async () => {
  const caches = fixture();
  const keys = caches.keys.bind(caches);
  let calls = 0;
  caches.keys = () => ++calls === 1 ? keys() : stalled();
  await withEnvironment(caches, async ({ counts }) => {
    assert.deepEqual(await fetchJsonWithRecovery(url, validate), [9,10]);
    const cache = await caches.open(cacheName);
    assert.deepEqual(await (await cache.match(url)).json(), [9,10]);
    assert.deepEqual(counts(), { requests: 1, warnings: 0 });
  });
});

test('normal delayed cache writes are still awaited before announcing completion', async () => {
  const caches = fixture();
  const cache = await caches.open(cacheName);
  const put = cache.put.bind(cache);
  let committed = false;
  cache.put = async (...args) => { await new Promise(resolve => setTimeout(resolve, 5)); await put(...args); committed = true; };
  await withEnvironment(caches, async ({ counts }) => {
    assert.deepEqual(await fetchJsonWithRecovery(url, validate), [9,10]);
    assert.equal(committed, true);
    assert.deepEqual(counts(), { requests: 1, warnings: 0 });
  });
});

test('a late rejected cache write is handled after timeout without retrying downloaded content', async () => {
  const caches = fixture();
  const cache = await caches.open(cacheName);
  cache.put = () => new Promise((_, reject) => setTimeout(() => reject(new Error('Late disk failure')), 70));
  await withEnvironment(caches, async ({ counts }) => {
    assert.deepEqual(await fetchJsonWithRecovery(url, validate), [9,10]);
    await new Promise(resolve => setTimeout(resolve, 90));
    assert.deepEqual(counts(), { requests: 1, warnings: 1 });
  });
});
