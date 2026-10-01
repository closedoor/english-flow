import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
const origin = "https://english-flow.test";
const current = "a".repeat(40);
const latest = "b".repeat(40);
const oldCache = "wordflow-ngsl-old-complete";
const activeCache = "wordflow-ngsl-v34-local";
const documentHtml = (commit, entry = `<script type="module" src="/assets/app-${commit}.js"></script>`) =>
  `<!doctype html><title>词流英语</title><meta name="english-flow-build" content="${commit}">${entry}`;
const htmlResponse = (body) => new Response(body, { headers: { "content-type": "text/html" } });

async function fixture(document, { expectedCommit = latest, timers = {} } = {}) {
  const stores = new Map();
  const listeners = new Map();
  const key = (request) => new URL(request instanceof Request ? request.url : String(request), origin).href;
  const counts = { claims: 0, writes: 0, deletes: [] };
  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const values = stores.get(name);
      return {
        async match(request) { return values.get(key(request))?.clone(); },
        async put(request, response) { counts.writes += 1; values.set(key(request), response.clone()); },
        async delete(request) { return values.delete(key(request)); },
        async keys() { return [...values.keys()].map((url) => new Request(url)); },
      };
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { counts.deletes.push(name); return stores.delete(name); },
  };
  const old = await caches.open(oldCache);
  await old.put("/", htmlResponse(documentHtml(current)));
  counts.writes = 0;
  vm.runInNewContext(source.replace('const BUILD_COMMIT = "local";', `const BUILD_COMMIT = "${expectedCommit}";`), {
    AbortController, Request, Response, URL, caches, setTimeout, clearTimeout, ...timers,
    self: { location: new URL(origin), addEventListener(name, handler) { listeners.set(name, handler); },
      clients: { async claim() { counts.claims += 1; } } },
    fetch: async (request, options) => {
      const url = new URL(key(request));
      if (url.pathname === "/") return typeof document === "function" ? document(request, options) : htmlResponse(document);
      const mime = url.pathname.endsWith(".js") ? "text/javascript"
        : url.pathname.endsWith(".png") ? "image/png"
          : url.pathname.endsWith(".ico") ? "image/x-icon"
            : url.pathname.endsWith(".webmanifest") ? "application/manifest+json" : "text/html";
      return new Response(url.pathname.startsWith("/huilv/") ? "<title>Existing currency tool</title>" : "static-asset", {
        headers: { "content-type": mime },
      });
    },
  }, { filename: "public/sw.js" });
  const extend = async (name, detail = {}) => {
    let pending;
    listeners.get(name)({ ...detail, waitUntil(value) { pending = Promise.resolve(value); } });
    await pending;
  };
  const request = (path = "/", navigate = true) => {
    let pending;
    const url = new URL(path, origin).href;
    const request = navigate ? { method: "GET", mode: "navigate", url, toString() { return this.url; } } : new Request(url);
    listeners.get("fetch")({ request, respondWith(value) { pending = Promise.resolve(value); } });
    return pending;
  };
  return { stores, caches, counts, extend, request, old };
}

test("a 200 maintenance or incomplete application document cannot replace the last complete offline shell", async () => {
  const invalidDocuments = [
    "<!doctype html><title>Temporary maintenance</title><h1>Please retry later</h1>",
    documentHtml(latest).replace("词流英语", "Another application"),
    documentHtml(latest).replace(/<meta[^>]+>/, ""),
    documentHtml("short"),
    documentHtml(current),
    documentHtml(latest, ""),
    documentHtml(latest, '<script type="module" src="https://other.test/assets/app.js"></script>'),
    documentHtml(latest, '<script src="">import("/assets/app.js")</script>'),
    documentHtml(latest, '<script type="application/json">{"entry":"import(\'/assets/app.js\')"}</script>'),
    documentHtml(latest, '<script>// import("/assets/app.js")</script>'),
    `<!--${documentHtml(latest)}--><title>Temporary maintenance</title>`,
  ];
  for (const html of invalidDocuments) {
    const audit = await fixture(html);
    await assert.rejects(audit.extend("install"), /invalid application document/);
    assert.equal(await (await audit.old.match("/")).text(), documentHtml(current));
    assert.equal(audit.counts.claims, 0);
    assert.equal(audit.counts.deletes.includes(oldCache), false);
    assert.equal((await audit.caches.keys()).some((name) => name.endsWith("-staging")), false);
  }
});

test("valid module and current inline-import entries install a complete matching release", async () => {
  for (const entry of [`<script type="module" src="/assets/app-${latest}.js"></script>`,
    `<script id="_R_">import("/assets/app-${latest}.js")</script>`]) {
    const audit = await fixture(documentHtml(latest, entry));
    await audit.extend("install");
    assert.ok(audit.stores.has(oldCache), "installation does not force an old page to lose its working shell");
    await audit.extend("activate");
    assert.equal(audit.counts.claims, 1);
    assert.equal(audit.stores.has(oldCache), false);
    const shell = await audit.caches.open(activeCache);
    assert.equal(await (await shell.match("/")).text(), documentHtml(latest, entry));
    assert.ok(await shell.match(`/assets/app-${latest}.js`), "the inline hydration entry is part of the complete shell graph too");
  }
});

test("a normal navigation receiving a 200 wrong document recovers the existing offline application", async () => {
  const audit = await fixture("<title>Temporary maintenance</title><h1>Please retry</h1>");
  assert.equal(await (await audit.request()).text(), documentHtml(current));
  assert.equal(audit.counts.writes, 0);
  assert.equal(await (await audit.old.match("/")).text(), documentHtml(current));
});

test("valid newer online HTML is usable without replacing the old complete offline shell early", async () => {
  const future = "c".repeat(40);
  const audit = await fixture(documentHtml(future));
  assert.equal(await (await audit.request()).text(), documentHtml(future));
  assert.equal(audit.counts.writes, 0);
  assert.equal(await (await audit.old.match("/")).text(), documentHtml(current));
});

test("a runtime root request or warm-cache message cannot write a 200 wrong document", async () => {
  const audit = await fixture("<title>Temporary maintenance</title>");
  assert.equal((await audit.request("/?runtime=1", false)).type, "error");
  await audit.extend("message", { data: { type: "CACHE_URLS", urls: [`${origin}/?warm=1`] } });
  assert.equal(audit.counts.writes, 0);
  assert.equal(await (await audit.old.match("/")).text(), documentHtml(current));
});

test("the document identity guard is scoped to the English app and leaves existing currency navigation alone", async () => {
  const audit = await fixture(documentHtml(latest));
  assert.equal(await (await audit.request("/huilv/")).text(), "<title>Existing currency tool</title>");
  assert.equal(audit.counts.writes, 0);
});

test("a document body stalled after its headers still reaches the navigation deadline and usable offline shell", { timeout: 1000 }, async () => {
  let aborted = false;
  const audit = await fixture((_request, { signal }) => {
    const stream = new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode("<!doctype html><title>"));
      signal.addEventListener("abort", () => { aborted = true; controller.error(new Error("Aborted document stream")); }, { once: true });
    } });
    return new Response(stream, { headers: { "content-type": "text/html" } });
  }, { timers: { setTimeout(callback, delay) { return setTimeout(callback, delay === 3000 ? 5 : delay); } } });
  assert.equal(await (await audit.request()).text(), documentHtml(current));
  assert.equal(aborted, true);
  assert.equal(audit.counts.writes, 0);
});
