import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
const origin = "https://english-flow.test";
const cacheName = (revision) => `wordflow-ngsl-v34-${revision}`;
const commit = (revision) => revision === "r2" ? "2".repeat(40) : "3".repeat(40);
const appHtml = (revision) => `<!doctype html><title>词流英语</title><meta name="english-flow-build" content="${commit(revision)}"><link rel="stylesheet" href="/assets/app-${revision}.css"><script type="module" src="/assets/app-${revision}.js"></script>`;
const documentResponse = (revision) => new Response(appHtml(revision), { headers: { "content-type": "text/html" } });
const appScript = (revision) => `const load = () => import("./lazy-${revision}.js");`;
const shellPaths = (revision) => ["/", "/manifest.webmanifest", "/favicon.ico", "/icon-192.png", "/icon-512.png", "/apple-touch-icon.png", `/assets/app-${revision}.css`, `/assets/app-${revision}.js`, `/assets/lazy-${revision}.js`];

function barrier() {
  let release;
  const promise = new Promise((resolve) => { release = resolve; });
  return { promise, release };
}

function fixture() {
  const stores = new Map();
  const beforePut = new Map();
  const beforeFetch = new Map();
  const beforeDelete = new Map();
  let offline = false;
  const key = (request) => new URL(request instanceof Request ? request.url : String(request), origin).href;
  const caches = {
    async open(name) {
      if (!stores.has(name)) {
        const values = new Map();
        // Deleting a CacheStorage name detaches this Cache object. A worker
        // already holding it can finish put(), without re-registering its name.
        stores.set(name, {
          async match(request) { return values.get(key(request))?.clone(); },
          async put(request, response) {
            await beforePut.get(name)?.(request, response);
            values.set(key(request), response.clone());
          },
          async delete(request) { return values.delete(key(request)); },
          async keys() { return [...values.keys()].map((url) => new Request(url)); },
        });
      }
      return stores.get(name);
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) {
      await beforeDelete.get(name)?.();
      return stores.delete(name);
    },
  };

  function worker(revision) {
    const listeners = new Map();
    const lifecycle = { claimCalls: 0, skipWaitingCalls: 0 };
    const workerSource = source
      .replace('const BUILD_REVISION = "local";', `const BUILD_REVISION = "${revision}";`)
      .replace('const BUILD_COMMIT = "local";', `const BUILD_COMMIT = "${commit(revision)}";`);
    vm.runInNewContext(workerSource, {
      AbortController, Request, Response, URL, caches, setTimeout, clearTimeout,
      self: {
        location: new URL(origin),
        addEventListener(name, handler) { listeners.set(name, handler); },
        async skipWaiting() { lifecycle.skipWaitingCalls += 1; },
        clients: { async claim() { lifecycle.claimCalls += 1; } },
      },
      fetch: async (request) => {
        if (offline) throw new Error("Network unavailable");
        const path = new URL(key(request)).pathname;
        await beforeFetch.get(path)?.();
        if (path === "/") return documentResponse(revision);
        if (path.endsWith(".webmanifest")) {
          return new Response(JSON.stringify({ name: "词流英语", start_url: "/", scope: "/", icons: [{ src: "/icon-192.png" }, { src: "/icon-512.png" }] }), { headers: { "content-type": "application/manifest+json" } });
        }
        if (path === `/assets/app-${revision}.js`) return new Response(appScript(revision), { headers: { "content-type": "text/javascript" } });
        if (path === `/assets/lazy-${revision}.js`) return new Response(`export const revision = "${revision}";`, { headers: { "content-type": "text/javascript" } });
        if (path.endsWith(".css")) return new Response(`body { --revision: ${revision}; }`, { headers: { "content-type": "text/css" } });
        return new Response(`asset:${path}`, { headers: { "content-type": path.endsWith(".png") ? "image/png" : "image/x-icon" } });
      },
    }, { filename: `public/sw.js (${revision})` });

    return {
      lifecycle,
      extend(name) {
        const pending = [];
        listeners.get(name)({ waitUntil(value) { pending.push(Promise.resolve(value)); } });
        assert.equal(pending.length, 1, `${name} must extend its lifetime`);
        return Promise.all(pending);
      },
      request(path, navigate = false) {
        const request = new Request(new URL(path, origin));
        if (navigate) Object.defineProperty(request, "mode", { value: "navigate" });
        let pending;
        listeners.get("fetch")({ request, respondWith(value) { pending = Promise.resolve(value); } });
        assert.ok(pending, "the worker must handle this same-origin request");
        return pending;
      },
    };
  }

  return { caches, stores, beforePut, beforeFetch, beforeDelete, worker, goOffline() { offline = true; } };
}

async function assertCompleteShell(audit, revision, { expectedHtml = appHtml(revision) } = {}) {
  assert.ok((await audit.caches.keys()).includes(cacheName(revision)), "the complete shell must remain registered");
  const cache = await audit.caches.open(cacheName(revision));
  for (const path of shellPaths(revision)) assert.ok(await cache.match(path), `the shell must contain ${path}`);
  assert.equal(await (await cache.match("/")).text(), expectedHtml);
  assert.equal(await (await cache.match(`/assets/app-${revision}.js`)).text(), appScript(revision));
  assert.equal(await (await cache.match(`/assets/lazy-${revision}.js`)).text(), `export const revision = "${revision}";`);
}

test("a preceding worker activation preserves a concurrently installing revision's staged shell", { timeout: 3000 }, async () => {
  const audit = fixture();
  const preceding = audit.worker("r2");
  const next = audit.worker("r3");
  await preceding.extend("install");

  const promotionStarted = barrier();
  const allowPromotion = barrier();
  let firstCopy = true;
  audit.beforePut.set(cacheName("r2"), async () => {
    if (!firstCopy) return;
    firstCopy = false;
    promotionStarted.release();
    await allowPromotion.promise;
  });
  const scriptStarted = barrier();
  const allowScript = barrier();
  audit.beforeFetch.set("/assets/app-r3.js", async () => {
    scriptStarted.release();
    await allowScript.promise;
  });

  const precedingActivation = preceding.extend("activate");
  await promotionStarted.promise;
  const nextInstallation = next.extend("install");
  try {
    await scriptStarted.promise;
    assert.ok((await audit.caches.keys()).includes(`${cacheName("r3")}-staging`));
    allowPromotion.release();
    await precedingActivation;
    assert.ok((await audit.caches.keys()).includes(`${cacheName("r3")}-staging`), "the preceding activation must not remove another installing worker's cache");
    assert.ok(await (await audit.caches.open(`${cacheName("r3")}-staging`)).match("/"));
  } finally {
    allowPromotion.release();
    allowScript.release();
    await Promise.allSettled([precedingActivation, nextInstallation]);
  }
  await nextInstallation;
  await assertCompleteShell(audit, "r2");
  assert.equal(next.lifecycle.claimCalls, 0);
  assert.equal(next.lifecycle.skipWaitingCalls, 0);

  // Install jobs may run during an older activation, but Try Activate delays
  // this revision until that activation and its last controlled client finish.
  // Dispatch the next activate only at that later, permitted lifecycle point.
  await next.extend("activate");
  await assertCompleteShell(audit, "r3");
  assert.equal((await audit.caches.keys()).includes(cacheName("r2")), false);
  assert.equal((await audit.caches.keys()).some((name) => name.endsWith("-staging")), false);
  assert.equal(next.lifecycle.claimCalls, 1);
  audit.goOffline();
  const navigation = await next.request("/", true);
  assert.equal(navigation.status, 200);
  assert.equal(await navigation.text(), appHtml("r3"));
  for (const path of shellPaths("r3").filter((path) => path !== "/")) {
    assert.equal((await next.request(path)).status, 200, `offline requests must retain ${path}`);
  }
});

test("a missing staged shell with an empty target rejects activation without deleting the previous complete shell or claiming clients", { timeout: 3000 }, async () => {
  const audit = fixture();
  const preceding = audit.worker("r2");
  const next = audit.worker("r3");
  await preceding.extend("install");
  await preceding.extend("activate");
  await next.extend("install");
  await audit.caches.delete(`${cacheName("r3")}-staging`);
  assert.equal((await (await audit.caches.open(cacheName("r3"))).keys()).length, 0);

  await assert.rejects(next.extend("activate"), /stag|shell|missing|unavailable/i);
  await assertCompleteShell(audit, "r2");
  assert.equal(next.lifecycle.claimCalls, 0);
  audit.goOffline();
  const navigation = await next.request("/", true);
  assert.equal(navigation.status, 200);
  assert.equal(await navigation.text(), appHtml("r2"));
  assert.equal((await next.request("/assets/app-r2.js")).status, 200);
});

test("a failed shell promotion keeps the previous complete document available to offline runtime fallback", { timeout: 3000 }, async () => {
  const audit = fixture();
  const preceding = audit.worker("r2");
  const next = audit.worker("r3");
  await preceding.extend("install");
  await preceding.extend("activate");
  await next.extend("install");
  audit.beforePut.set(cacheName("r3"), async (request) => {
    if (new URL(request.url).pathname === "/assets/app-r3.js") throw new Error("App entry cache write failed");
  });

  await assert.rejects(next.extend("activate"), /App entry cache write failed/);
  assert.ok((await audit.caches.keys()).includes(`${cacheName("r3")}-staging`), "a failed promotion must retain its recoverable staged shell");
  await assertCompleteShell(audit, "r2");
  assert.equal(next.lifecycle.claimCalls, 0);

  // A rejected activation extension does not prevent the platform from
  // entering activated state. Runtime fallback must therefore avoid the new
  // HTML copied before its entry script failed, and serve a complete old shell.
  audit.goOffline();
  const navigation = await next.request("/", true);
  assert.equal(navigation.status, 200);
  assert.equal(await navigation.text(), appHtml("r2"));
  const oldEntry = await next.request("/assets/app-r2.js");
  assert.equal(oldEntry.status, 200);
  assert.equal(await oldEntry.text(), appScript("r2"));
});

test("a failed repeated promotion preserves an existing complete shell under the same revision", { timeout: 3000 }, async () => {
  const audit = fixture();
  const existing = audit.worker("r3");
  await existing.extend("install");
  await existing.extend("activate");
  await assertCompleteShell(audit, "r3");
  const originalCache = await audit.caches.open(cacheName("r3"));
  // A legal, recognizable document snapshot makes a premature replacement
  // visible even when a retry uses the same build identity and asset URLs.
  await originalCache.put("/", new Response(`${appHtml("r3")}<!-- retained complete shell before retry -->`, { headers: { "content-type": "text/html" } }));
  const originalHtml = await (await originalCache.match("/")).text();
  const originalEntry = await (await originalCache.match("/assets/app-r3.js")).text();
  const retry = audit.worker("r3");
  await retry.extend("install");
  audit.beforePut.set(cacheName("r3"), async (request) => {
    const path = new URL(request.url).pathname;
    if (path === "/assets/app-r3.js") throw new Error("Repeated app entry cache write failed");
  });

  await assert.rejects(retry.extend("activate"), /Repeated app entry cache write failed/);
  assert.ok((await audit.caches.keys()).includes(`${cacheName("r3")}-staging`));
  assert.strictEqual(await audit.caches.open(cacheName("r3")), originalCache, "a failed retry must retain the already registered complete cache");
  await assertCompleteShell(audit, "r3", { expectedHtml: originalHtml });
  assert.equal(retry.lifecycle.claimCalls, 0);
  audit.goOffline();
  const navigation = await retry.request("/", true);
  assert.equal(navigation.status, 200);
  assert.equal(await navigation.text(), originalHtml);
  const entry = await retry.request("/assets/app-r3.js");
  assert.equal(entry.status, 200);
  assert.equal(await entry.text(), originalEntry);
  assert.equal((await retry.request("/assets/lazy-r3.js")).status, 200);
});

test("failed cleanup of a partially promoted target cannot expose an incomplete offline document", { timeout: 3000 }, async () => {
  const audit = fixture();
  const preceding = audit.worker("r2");
  const next = audit.worker("r3");
  await preceding.extend("install");
  await preceding.extend("activate");
  await next.extend("install");
  audit.beforePut.set(cacheName("r3"), async (request) => {
    if (new URL(request.url).pathname === "/assets/app-r3.js") throw new Error("App entry cache write failed");
  });
  audit.beforeDelete.set(cacheName("r3"), async () => { throw new Error("Partial target cleanup blocked"); });

  await assert.rejects(next.extend("activate"), /App entry cache write failed/);
  assert.ok((await audit.caches.keys()).includes(cacheName("r3")), "blocked cleanup leaves the partial target registered");
  assert.equal(await (await audit.caches.open(cacheName("r3"))).match("/"), undefined, "the document must be committed only after every asset succeeds");
  assert.ok((await audit.caches.keys()).includes(`${cacheName("r3")}-staging`));
  await assertCompleteShell(audit, "r2");
  assert.equal(next.lifecycle.claimCalls, 0);
  audit.goOffline();
  const navigation = await next.request("/", true);
  assert.equal(navigation.status, 200);
  assert.equal(await navigation.text(), appHtml("r2"));
  const oldEntry = await next.request("/assets/app-r2.js");
  assert.equal(oldEntry.status, 200);
  assert.equal(await oldEntry.text(), appScript("r2"));
});
