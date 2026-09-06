import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const ORIGIN = "https://english-flow.test";
const workerSource = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
const ACTIVE_CACHE = "wordflow-ngsl-v33";

function cacheKey(request) {
  const value = request instanceof Request ? request.url : String(request);
  return new URL(value, ORIGIN).href;
}

class MemoryCache {
  constructor() { this.values = new Map(); }
  async match(request) { return this.values.get(cacheKey(request))?.clone(); }
  async put(request, response) { this.values.set(cacheKey(request), response.clone()); }
  async delete(request) { return this.values.delete(cacheKey(request)); }
  async keys() { return [...this.values.keys()].map((url) => new Request(url)); }
}

class MemoryCacheStorage {
  constructor() {
    this.stores = new Map();
    this.deleteCalls = [];
  }

  async open(name) {
    if (!this.stores.has(name)) this.stores.set(name, new MemoryCache());
    return this.stores.get(name);
  }

  async match(request) {
    for (const cache of this.stores.values()) {
      const response = await cache.match(request);
      if (response) return response;
    }
    return undefined;
  }

  async keys() { return [...this.stores.keys()]; }

  async delete(name) {
    this.deleteCalls.push(name);
    return this.stores.delete(name);
  }
}

function loadWorker({ caches, fetch, timers = {} }) {
  const listeners = new Map();
  const lifecycle = { skipWaitingCalls: 0, claimCalls: 0 };
  const self = {
    location: new URL(ORIGIN),
    addEventListener(type, handler) { listeners.set(type, handler); },
    async skipWaiting() { lifecycle.skipWaitingCalls += 1; },
    clients: {
      async claim() { lifecycle.claimCalls += 1; },
    },
  };

  vm.runInNewContext(workerSource, {
    AbortController,
    Request,
    Response,
    URL,
    caches,
    clearTimeout,
    console,
    fetch,
    self,
    setTimeout,
    ...timers,
  }, { filename: "public/sw.js" });

  return { lifecycle, listeners };
}

async function dispatchExtendable(handler, detail = {}) {
  const pending = [];
  handler({
    ...detail,
    waitUntil(value) { pending.push(Promise.resolve(value)); },
  });
  await Promise.all(pending);
}

async function dispatchFetch(handler, request) {
  let responsePromise;
  handler({
    request,
    respondWith(value) { responsePromise = Promise.resolve(value); },
  });
  assert.ok(responsePromise, "the service worker should handle this request");
  return responsePromise;
}

test("cache match and put failures do not discard a successful network response", async () => {
  let matchAttempts = 0;
  let putAttempts = 0;
  const caches = {
    async open() {
      return {
        async match() {
          matchAttempts += 1;
          throw new Error("Cache Storage read failed");
        },
        async put() {
          putAttempts += 1;
          throw new Error("Cache Storage write failed");
        },
      };
    },
  };
  const { listeners } = loadWorker({
    caches,
    fetch: async () => new Response("network-ok", { status: 200, headers: { "content-type": "text/javascript" } }),
  });

  const response = await dispatchFetch(
    listeners.get("fetch"),
    new Request(`${ORIGIN}/assets/app-a1b2c3.js`),
  );

  assert.equal(response.status, 200);
  assert.equal(await response.text(), "network-ok");
  assert.equal(matchAttempts, 1);
  assert.equal(putAttempts, 1);
});

test("a 200 HTML error page never poisons a JavaScript cache entry", async () => {
  const caches = new MemoryCacheStorage();
  const { listeners } = loadWorker({
    caches,
    fetch: async () => new Response("<h1>temporary error</h1>", {
      status: 200,
      headers: { "content-type": "text/html" },
    }),
  });

  const request = new Request(`${ORIGIN}/assets/app-broken.js`);
  const response = await dispatchFetch(listeners.get("fetch"), request);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "<h1>temporary error</h1>");
  assert.equal(await (await caches.open(ACTIVE_CACHE)).match(request), undefined);
});

test("a JavaScript response without a MIME type is not cached", async () => {
  const caches = new MemoryCacheStorage();
  const { listeners } = loadWorker({
    caches,
    fetch: async () => new Response(null, { status: 200 }),
  });
  const request = new Request(`${ORIGIN}/assets/app-no-type.js`);
  await dispatchFetch(listeners.get("fetch"), request);
  assert.equal(await (await caches.open(ACTIVE_CACHE)).match(request), undefined);
});

test("install discovers and commits the current hashed JavaScript and CSS shell", async () => {
  const caches = new MemoryCacheStorage();
  const fetched = [];
  const html = `<!doctype html>
    <link rel="stylesheet" href="/assets/index-a1b2c3.css">
    <script type="module" src="/assets/index-d4e5f6.js"></script>
    <script type="module" src="/assets/page-a1b2c3.js"></script>
    <link rel="preload" href="/data/ngsl-words-1.json?rev=v20">
    <script src="https://cdn.example.test/external.js"></script>`;
  const { lifecycle, listeners } = loadWorker({
    caches,
    fetch: async (request) => {
      const url = new URL(request instanceof Request ? request.url : String(request), ORIGIN);
      fetched.push(url.href);
      if (url.pathname === "/") {
        return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
      }
      if (url.pathname === "/assets/page-a1b2c3.js") {
        return new Response(`
          import "./framework-f1f2f3.js";
          const lazy = () => import(\`./word-data-w1w2w3.js\`);
          const mapped = ["assets/sentence-data-s1s2s3.js"];
        `, { status: 200, headers: { "content-type": "text/javascript" } });
      }
      if (url.pathname === "/assets/word-data-w1w2w3.js") {
        return new Response(`import "./content-loader-c1c2c3.js";`, { status: 200, headers: { "content-type": "text/javascript" } });
      }
      const contentType = url.pathname.endsWith(".js") ? "text/javascript"
        : url.pathname.endsWith(".css") ? "text/css"
          : url.pathname.endsWith(".png") ? "image/png"
            : url.pathname.endsWith(".ico") ? "image/x-icon"
              : url.pathname.endsWith(".webmanifest") ? "application/manifest+json"
                : "application/octet-stream";
      return new Response(`asset:${url.pathname}`, { status: 200, headers: { "content-type": contentType } });
    },
  });

  await dispatchExtendable(listeners.get("install"));
  await dispatchExtendable(listeners.get("activate"));

  const shell = await caches.open(ACTIVE_CACHE);
  assert.ok(await shell.match("/"));
  assert.ok(await shell.match("/assets/index-a1b2c3.css"));
  assert.ok(await shell.match("/assets/index-d4e5f6.js"));
  assert.ok(await shell.match("/assets/page-a1b2c3.js"));
  assert.ok(await shell.match("/assets/framework-f1f2f3.js"));
  assert.ok(await shell.match("/assets/word-data-w1w2w3.js"));
  assert.ok(await shell.match("/assets/content-loader-c1c2c3.js"));
  assert.ok(await shell.match("/assets/sentence-data-s1s2s3.js"));
  assert.equal(await shell.match("/data/ngsl-words-1.json?rev=v20"), undefined);
  assert.equal(await shell.match("https://cdn.example.test/external.js"), undefined);
  assert.ok(fetched.includes(`${ORIGIN}/assets/index-a1b2c3.css`));
  assert.ok(fetched.includes(`${ORIGIN}/assets/index-d4e5f6.js`));
  assert.ok(fetched.includes(`${ORIGIN}/assets/word-data-w1w2w3.js`));
  assert.ok(fetched.includes(`${ORIGIN}/assets/content-loader-c1c2c3.js`));
  assert.equal(lifecycle.skipWaitingCalls, 0);
});

test("a failed same-version install preserves the active shell cache", async () => {
  const caches = new MemoryCacheStorage();
  const active = await caches.open(ACTIVE_CACHE);
  await active.put("/assets/current.js", new Response("current", { headers: { "content-type": "text/javascript" } }));
  const html = `<script type="module" src="/assets/broken.js"></script>`;
  const { listeners } = loadWorker({
    caches,
    fetch: async (request) => {
      const url = new URL(request instanceof Request ? request.url : String(request), ORIGIN);
      if (url.pathname === "/") return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
      if (url.pathname === "/assets/broken.js") return new Response("<h1>error</h1>", { status: 200, headers: { "content-type": "text/html" } });
      const contentType = url.pathname.endsWith(".png") ? "image/png"
        : url.pathname.endsWith(".ico") ? "image/x-icon"
          : url.pathname.endsWith(".webmanifest") ? "application/manifest+json"
            : "application/octet-stream";
      return new Response("asset", { status: 200, headers: { "content-type": contentType } });
    },
  });

  await assert.rejects(dispatchExtendable(listeners.get("install")));
  assert.equal(await (await active.match("/assets/current.js")).text(), "current");
  assert.equal((await caches.keys()).includes(`${ACTIVE_CACHE}-staging`), false);
});

test("an activated upgrade can serve its lazy startup chunk after the old shell is removed", async () => {
  const caches = new MemoryCacheStorage();
  const oldShell = await caches.open("wordflow-ngsl-v20");
  await oldShell.put("/assets/word-data-old.js", new Response("old"));
  const html = `<script type="module" src="/assets/page-new.js"></script>`;
  let offline = false;
  const { listeners } = loadWorker({
    caches,
    fetch: async (request) => {
      if (offline) throw new Error("offline");
      const url = new URL(request instanceof Request ? request.url : String(request), ORIGIN);
      if (url.pathname === "/") return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
      if (url.pathname === "/assets/page-new.js") {
        return new Response(`const loadWords = () => import("./word-data-new.js");`, { status: 200, headers: { "content-type": "text/javascript" } });
      }
      if (url.pathname === "/assets/word-data-new.js") return new Response("export const words = [];", { status: 200, headers: { "content-type": "text/javascript" } });
      const contentType = url.pathname.endsWith(".js") ? "text/javascript"
        : url.pathname.endsWith(".css") ? "text/css"
          : url.pathname.endsWith(".png") ? "image/png"
            : url.pathname.endsWith(".ico") ? "image/x-icon"
              : url.pathname.endsWith(".webmanifest") ? "application/manifest+json"
                : "application/octet-stream";
      return new Response(`asset:${url.pathname}`, { status: 200, headers: { "content-type": contentType } });
    },
  });

  await dispatchExtendable(listeners.get("install"));
  await dispatchExtendable(listeners.get("activate"));
  assert.equal((await caches.keys()).includes("wordflow-ngsl-v20"), false);
  offline = true;

  const response = await dispatchFetch(
    listeners.get("fetch"),
    new Request(`${ORIGIN}/assets/word-data-new.js`),
  );
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "export const words = [];");
});

test("an existing worker recursively caches a newly loaded app chunk and its lazy dependency", async () => {
  const caches = new MemoryCacheStorage();
  let offline = false;
  const fetched = [];
  const { listeners } = loadWorker({
    caches,
    fetch: async (request) => {
      if (offline) throw new Error("offline");
      const url = new URL(request instanceof Request ? request.url : String(request), ORIGIN);
      fetched.push(url.pathname);
      if (url.pathname === "/assets/page-new.js") {
        return new Response(`const openReading = () => import("./reading-new.js");`, { status: 200, headers: { "content-type": "text/javascript" } });
      }
      if (url.pathname === "/assets/reading-new.js") {
        return new Response("export const readings = [];", { status: 200, headers: { "content-type": "text/javascript" } });
      }
      return new Response("missing", { status: 404 });
    },
  });

  await dispatchExtendable(listeners.get("message"), {
    data: { type: "CACHE_URLS", urls: [`${ORIGIN}/assets/page-new.js`] },
  });

  const shell = await caches.open(ACTIVE_CACHE);
  assert.ok(await shell.match(`${ORIGIN}/assets/page-new.js`));
  assert.ok(await shell.match(`${ORIGIN}/assets/reading-new.js`));
  assert.deepEqual(fetched, ["/assets/page-new.js", "/assets/reading-new.js"]);

  offline = true;
  const response = await dispatchFetch(
    listeners.get("fetch"),
    new Request(`${ORIGIN}/assets/reading-new.js`),
  );
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "export const readings = [];");
});

test("a shell cache upgrade message leaves every content cache intact", async () => {
  const caches = new MemoryCacheStorage();
  const v19 = await caches.open("english-flow-content-v19");
  const v20 = await caches.open("english-flow-content-v20");
  await v19.put("/data/test.json?rev=v19", new Response("[19]"));
  await v19.put("/data/other.json?rev=v19", new Response("[191]"));
  await v20.put("/data/test.json?rev=v20", new Response("[20]"));
  const { listeners } = loadWorker({
    caches,
    fetch: async () => new Response("asset", { status: 200 }),
  });

  await dispatchExtendable(listeners.get("message"), {
    data: {
      type: "CACHE_URLS",
      urls: [`${ORIGIN}/assets/runtime-f0e1d2.js`],
      contentRevision: "v20",
    },
  });

  assert.deepEqual(await caches.keys(), [
    "english-flow-content-v19",
    "english-flow-content-v20",
    ACTIVE_CACHE,
  ]);
  assert.deepEqual(await (await v19.match("/data/test.json?rev=v19")).json(), [19]);
  assert.deepEqual(await (await v19.match("/data/other.json?rev=v19")).json(), [191]);
  assert.deepEqual(await (await v20.match("/data/test.json?rev=v20")).json(), [20]);
  assert.deepEqual(caches.deleteCalls, []);
});

test("an interrupted online upgrade preserves the last complete offline document", async () => {
  const caches = new MemoryCacheStorage();
  const active = await caches.open(ACTIVE_CACHE);
  const oldHtml = '<script type="module" src="/assets/old.js"></script>';
  const newHtml = '<script type="module" src="/assets/new.js"></script>';
  await active.put("/", new Response(oldHtml, { headers: { "content-type": "text/html" } }));
  await active.put("/assets/old.js", new Response("old-working-app", { headers: { "content-type": "text/javascript" } }));
  let offline = false;
  const { listeners } = loadWorker({ caches, fetch: async () => {
    if (offline) throw new Error("offline before new assets arrived");
    return new Response(newHtml, { headers: { "content-type": "text/html" } });
  } });
  const navigation = { method: "GET", mode: "navigate", url: `${ORIGIN}/`, toString() { return this.url; } };
  assert.equal(await (await dispatchFetch(listeners.get("fetch"), navigation)).text(), newHtml);
  offline = true;
  assert.equal(await (await dispatchFetch(listeners.get("fetch"), navigation)).text(), oldHtml);
  assert.equal(await (await dispatchFetch(listeners.get("fetch"), new Request(`${ORIGIN}/assets/old.js`))).text(), "old-working-app");
  assert.equal(await active.match("/assets/new.js"), undefined);
});

test("offline fallback prefers the active shell and never serves unfinished staging", async () => {
  const caches = new MemoryCacheStorage();
  const old = await caches.open("wordflow-ngsl-v22");
  await old.put("/", new Response("old"));
  const staging = await caches.open(`${ACTIVE_CACHE}-staging`);
  await staging.put("/", new Response("unfinished"));
  const active = await caches.open(ACTIVE_CACHE);
  await active.put("/", new Response("current"));
  const { listeners } = loadWorker({ caches, fetch: async () => { throw new Error("offline"); } });
  const navigation = { method: "GET", mode: "navigate", url: `${ORIGIN}/`, toString() { return this.url; } };
  assert.equal(await (await dispatchFetch(listeners.get("fetch"), navigation)).text(), "current");
  await active.delete("/");
  assert.equal(await (await dispatchFetch(listeners.get("fetch"), navigation)).text(), "old");
  await old.delete("/");
  assert.equal((await dispatchFetch(listeners.get("fetch"), navigation)).type, "error");
});

test("a hung uncached script times out and a later request can recover", async () => {
  const caches = new MemoryCacheStorage();
  const deadlines = [];
  let online = false;
  const { listeners } = loadWorker({
    caches,
    timers: { setTimeout(callback, delay) { deadlines.push(delay); return setTimeout(callback, 0); } },
    fetch: async (_request, options) => {
      if (online) return new Response("recovered", { headers: { "content-type": "text/javascript" } });
      return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
    },
  });
  const request = new Request(`${ORIGIN}/assets/slow.js`);
  assert.equal((await dispatchFetch(listeners.get("fetch"), request)).type, "error");
  assert.deepEqual(deadlines, [8000]);
  online = true;
  assert.equal(await (await dispatchFetch(listeners.get("fetch"), request)).text(), "recovered");
  assert.equal(await (await (await caches.open(ACTIVE_CACHE)).match(request)).text(), "recovered");
});
