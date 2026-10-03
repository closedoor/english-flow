import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
const origin = "https://english-flow.test";
const oldCache = "wordflow-ngsl-old-complete";
const activeCache = "wordflow-ngsl-v34-local";
const current = "a".repeat(40);
const latest = "b".repeat(40);
const html = (commit) => `<!doctype html><title>词流英语</title><meta name="english-flow-build" content="${commit}"><link rel="stylesheet" href="/assets/app.css"><script type="module" src="/assets/app.js"></script>`;
const documentResponse = (commit) => new Response(html(commit), { headers: { "content-type": "text/html" } });

async function fixture({ stalledPath, abortSettles = true, streamedPath } = {}) {
  const listeners = new Map();
  const stores = new Map();
  const key = (request) => new URL(request instanceof Request ? request.url : String(request), origin).href;
  const counts = { aborts: 0, claims: 0 };
  let stalledBody;
  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const values = stores.get(name);
      return {
        async match(request) { return values.get(key(request))?.clone(); },
        async put(request, response) { values.set(key(request), response.clone()); },
        async delete(request) { return values.delete(key(request)); },
        async keys() { return [...values.keys()].map((url) => new Request(url)); },
      };
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
  };
  const old = await caches.open(oldCache);
  await old.put("/", documentResponse(current));
  await old.put("/assets/app.js", new Response("export const oldReady = true;", { headers: { "content-type": "text/javascript" } }));
  vm.runInNewContext(source.replace('const BUILD_COMMIT = "local";', `const BUILD_COMMIT = "${latest}";`), {
    AbortController, Request, Response, URL, caches, clearTimeout,
    setTimeout(callback, delay) {
      // Accelerate only the graph's existing network-resource deadline. Cache
      // deadlines and navigation remain unchanged and cannot mask this fault.
      return setTimeout(callback, delay === 8000 ? 100 : delay);
    },
    self: { location: new URL(origin), addEventListener(name, handler) { listeners.set(name, handler); },
      clients: { async claim() { counts.claims += 1; } } },
    fetch: async (request, { signal } = {}) => {
      const path = new URL(key(request)).pathname;
      if (path === "/") return documentResponse(latest);
      const type = path.endsWith(".js") ? "text/javascript" : path.endsWith(".css") ? "text/css"
        : path.endsWith(".png") ? "image/png" : path.endsWith(".ico") ? "image/x-icon" : "application/manifest+json";
      if (path === stalledPath) {
        const body = new ReadableStream({ start(controller) {
          stalledBody = controller;
          controller.enqueue(new TextEncoder().encode("partial-resource"));
          signal.addEventListener("abort", () => {
            counts.aborts += 1;
            if (abortSettles) controller.error(new Error("Aborted resource stream"));
          }, { once: true });
        } });
        return new Response(body, { headers: { "content-type": type } });
      }
      const text = path.endsWith(".js") ? "export const ready = true;" : path.endsWith(".css") ? "body { color: black; }" : "complete-resource";
      if (path === streamedPath) {
        const encoded = new TextEncoder().encode(text);
        return new Response(new ReadableStream({ start(controller) {
          controller.enqueue(encoded.slice(0, 4));
          setImmediate(() => { controller.enqueue(encoded.slice(4)); controller.close(); });
        } }), { headers: { "content-type": type } });
      }
      return new Response(text, { headers: { "content-type": type } });
    },
  }, { filename: "public/sw.js" });
  const extend = (name, detail = {}) => {
    let pending;
    listeners.get(name)({ ...detail, waitUntil(value) { pending = Promise.resolve(value); } });
    return pending;
  };
  const releaseLateBody = () => stalledBody?.error(new Error("Late resource stream failure"));
  return { stores, caches, old, counts, extend, releaseLateBody };
}

async function assertOldShell(audit) {
  assert.equal(await (await audit.old.match("/")).text(), html(current));
  assert.equal(await (await audit.old.match("/assets/app.js")).text(), "export const oldReady = true;");
  assert.equal(audit.counts.claims, 0);
  assert.equal((await audit.caches.keys()).some((name) => name.endsWith("-staging")), false);
}

for (const stalledPath of ["/assets/app.js", "/assets/app.css", "/manifest.webmanifest", "/icon-192.png"]) {
  test(`a stalled ${stalledPath} body reaches the installation deadline and retains the previous shell`, { timeout: 3000 }, async () => {
    const audit = await fixture({ stalledPath });
    await assert.rejects(audit.extend("install"), /timed out|Aborted resource stream/);
    assert.equal(audit.counts.aborts, 1);
    await assertOldShell(audit);
  });
}

test("installation settles on its deadline even when abort does not settle the obtained body", { timeout: 3000 }, async () => {
  const audit = await fixture({ stalledPath: "/assets/app.js", abortSettles: false });
  await assert.rejects(audit.extend("install"), /timed out/);
  assert.equal(audit.counts.aborts, 1);
  await assertOldShell(audit);
  // Promise.race must keep observing its expired clone read when it rejects
  // later, instead of leaking an unhandled rejection from the failed install.
  audit.releaseLateBody();
  await new Promise((resolve) => setImmediate(resolve));
  await assertOldShell(audit);
});

test("warm-cache graph skips an expired body and still caches subsequent usable assets", { timeout: 3000 }, async () => {
  const audit = await fixture({ stalledPath: "/assets/app.js", abortSettles: false });
  await audit.extend("message", { data: { type: "CACHE_URLS", urls: [`${origin}/assets/app.js`, `${origin}/assets/ready.js`] } });
  const cache = await audit.caches.open(activeCache);
  assert.equal(await cache.match("/assets/app.js"), undefined);
  assert.equal(await (await cache.match("/assets/ready.js")).text(), "export const ready = true;");
  assert.equal(audit.counts.aborts, 1);
  await assertOldShell(audit);
  audit.releaseLateBody();
  await new Promise((resolve) => setImmediate(resolve));
});

test("a complete streamed resource still installs and activates the full new shell", { timeout: 3000 }, async () => {
  const audit = await fixture({ streamedPath: "/assets/app.js" });
  await audit.extend("install");
  assert.equal(await (await audit.old.match("/")).text(), html(current));
  await audit.extend("activate");
  assert.equal(audit.counts.claims, 1);
  assert.equal(audit.stores.has(oldCache), false);
  const cache = await audit.caches.open(activeCache);
  assert.equal(await (await cache.match("/")).text(), html(latest));
  assert.equal(await (await cache.match("/assets/app.js")).text(), "export const ready = true;");
  assert.equal(await (await cache.match("/assets/app.css")).text(), "body { color: black; }");
  assert.equal(audit.counts.aborts, 0);
});
