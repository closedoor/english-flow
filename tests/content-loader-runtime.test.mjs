import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const loaderSource = await readFile(new URL("../app/content-loader.ts", import.meta.url), "utf8");
const loaderJavaScript = ts.transpileModule(loaderSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { fetchJsonWithRecovery } = await import(`data:text/javascript;base64,${Buffer.from(loaderJavaScript).toString("base64")}`);

class MemoryCache {
  constructor() { this.values = new Map(); }
  async match(url) { return this.values.get(String(url))?.clone(); }
  async put(url, response) { this.values.set(String(url), response.clone()); }
  async delete(url) { return this.values.delete(String(url)); }
}

function cacheStorage() {
  const stores = new Map();
  return {
    stores,
    async open(name) {
      if (!stores.has(name)) stores.set(name, new MemoryCache());
      return stores.get(name);
    },
    async match(url) {
      for (const cache of stores.values()) {
        const response = await cache.match(url);
        if (response) return response;
      }
      return undefined;
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
  };
}

async function withBrowserGlobals({ online, caches, fetch }, run) {
  const names = ["window", "navigator", "caches", "fetch"];
  const previous = new Map(names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  Object.defineProperty(globalThis, "window", { configurable: true, value: { setTimeout, clearTimeout } });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: online } });
  Object.defineProperty(globalThis, "caches", { configurable: true, value: caches });
  Object.defineProperty(globalThis, "fetch", { configurable: true, value: fetch });
  try { return await run(); } finally {
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
}

const validArray = (value) => Array.isArray(value) && value.every((item) => Number.isInteger(item));

test("a valid current content-cache hit avoids the network", { concurrency: false }, async () => {
  const caches = cacheStorage();
  const cache = await caches.open("english-flow-content-v20");
  await cache.put("/data/test.json", new Response("[1,2,3]", { headers: { "content-type": "application/json" } }));
  let fetches = 0;
  const value = await withBrowserGlobals({ online: true, caches, fetch: async () => { fetches += 1; throw new Error("unexpected network"); } },
    () => fetchJsonWithRecovery("/data/test.json", validArray));
  assert.deepEqual(value, [1, 2, 3]);
  assert.equal(fetches, 0);
});

test("a corrupt current cache uses an older unversioned cache only while offline", { concurrency: false }, async () => {
  const caches = cacheStorage();
  const current = await caches.open("english-flow-content-v20");
  const legacy = await caches.open("wordflow-ngsl-v17");
  await current.put("/data/test.json?rev=v20", new Response("{broken"));
  await legacy.put("/data/test.json", new Response("[7,8]"));
  const value = await withBrowserGlobals({ online: false, caches, fetch: async () => { throw new Error("offline"); } },
    () => fetchJsonWithRecovery("/data/test.json?rev=v20", validArray));
  assert.deepEqual(value, [7, 8]);
  assert.equal(await current.match("/data/test.json?rev=v20"), undefined);
});

test("an offline upgrade can read the versioned key left by the v19 content cache", { concurrency: false }, async () => {
  const caches = cacheStorage();
  const previous = await caches.open("english-flow-content-v19");
  await previous.put("/data/test.json?rev=v19", new Response("[19,20]"));
  let fetches = 0;

  const value = await withBrowserGlobals({
    online: false,
    caches,
    fetch: async () => { fetches += 1; throw new Error("offline"); },
  }, () => fetchJsonWithRecovery("/data/test.json?rev=v20", validArray));

  assert.deepEqual(value, [19, 20]);
  assert.equal(fetches, 0);
});

test("an online upgrade replaces older content instead of pinning the stale cache", { concurrency: false }, async () => {
  const caches = cacheStorage();
  const legacy = await caches.open("english-flow-content-v1");
  await legacy.put("/data/test.json", new Response("[1,2]"));
  let fetches = 0;
  const value = await withBrowserGlobals({ online: true, caches, fetch: async () => {
    fetches += 1;
    return new Response("[3,4]", { status: 200, headers: { "content-type": "application/json" } });
  } }, async () => {
    return fetchJsonWithRecovery("/data/test.json?rev=v20", validArray);
  });
  assert.deepEqual(value, [3, 4]);
  assert.equal(fetches, 1);
  const current = await caches.open("english-flow-content-v20");
  assert.deepEqual(await (await current.match("/data/test.json?rev=v20")).json(), [3, 4]);
});

test("committing one upgraded pack removes only that pack from older content caches", { concurrency: false }, async () => {
  const caches = cacheStorage();
  const previous = await caches.open("english-flow-content-v19");
  await previous.put("/data/test.json?rev=v19", new Response("[1,2]"));
  await previous.put("/data/other.json?rev=v19", new Response("[7,8]"));

  const value = await withBrowserGlobals({
    online: true,
    caches,
    fetch: async () => new Response("[3,4]", { status: 200, headers: { "content-type": "application/json" } }),
  }, () => fetchJsonWithRecovery("/data/test.json?rev=v20", validArray));

  assert.deepEqual(value, [3, 4]);
  assert.equal(await previous.match("/data/test.json?rev=v19"), undefined);
  assert.deepEqual(await (await previous.match("/data/other.json?rev=v19")).json(), [7, 8]);
  assert.ok(caches.stores.has("english-flow-content-v19"));
});

test("offline without a cache fails immediately without attempting fetch", { concurrency: false }, async () => {
  const caches = cacheStorage();
  let fetches = 0;
  await assert.rejects(() => withBrowserGlobals({ online: false, caches, fetch: async () => { fetches += 1; throw new Error("offline"); } },
    () => fetchJsonWithRecovery("/data/missing.json", validArray)));
  assert.equal(fetches, 0);
});

test("a successful network response is returned and remembered", { concurrency: false }, async () => {
  const caches = cacheStorage();
  let fetches = 0;
  const value = await withBrowserGlobals({ online: true, caches, fetch: async () => {
    fetches += 1;
    return new Response("[9,10]", { status: 200, headers: { "content-type": "application/json" } });
  } }, async () => {
    return fetchJsonWithRecovery("/data/network.json", validArray);
  });
  assert.deepEqual(value, [9, 10]);
  assert.equal(fetches, 1);
  const cache = await caches.open("english-flow-content-v20");
  assert.deepEqual(await (await cache.match("/data/network.json")).json(), [9, 10]);
});

test("a first-load response does not finish before its offline copy is committed", { concurrency: false }, async () => {
  let releaseWrite;
  const writeBarrier = new Promise((resolve) => { releaseWrite = resolve; });
  const cache = new MemoryCache();
  const originalPut = cache.put.bind(cache);
  cache.put = async (url, response) => {
    await writeBarrier;
    return originalPut(url, response);
  };
  const caches = {
    async open() { return cache; },
    async match() { return undefined; },
  };
  let settled = false;
  const pending = withBrowserGlobals({
    online: true,
    caches,
    fetch: async () => new Response("[11,12]", { status: 200, headers: { "content-type": "application/json" } }),
  }, () => fetchJsonWithRecovery("/data/commit.json", validArray));
  pending.then(() => { settled = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  releaseWrite();
  assert.deepEqual(await pending, [11, 12]);
  assert.deepEqual(await (await cache.match("/data/commit.json")).json(), [11, 12]);
});
