import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(process.env.SW_ALIAS_SOURCE_FILE || new URL("../public/sw.js", import.meta.url), "utf8");
const origin = "https://english-flow.test";
const current = "a".repeat(40);
const latest = "b".repeat(40);
const oldCache = "wordflow-ngsl-old-complete";
const activeCache = "wordflow-ngsl-v34-local";
const html = (commit) => `<!doctype html><title>词流英语</title><meta name="english-flow-build" content="${commit}"><script type="module" src="/assets/app-${commit}.js"></script>`;
const documentResponse = (body, type = "text/html") => new Response(body, { headers: type ? { "content-type": type } : undefined });

async function fixture(initialDocument, { timers = {} } = {}) {
  let document = initialDocument;
  const listeners = new Map();
  const stores = new Map();
  const key = (request) => new URL(request instanceof Request ? request.url : String(request), origin).href;
  const counts = { requests: [], writes: [], deleted: [], claims: 0 };
  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        async match(request) { return store.get(key(request))?.clone(); },
        async put(request, response) {
          counts.writes.push(key(request));
          // Cache.put commits a consumed complete body, never a pending stream.
          const body = await response.arrayBuffer();
          store.set(key(request), new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers }));
        },
        async keys() { return [...store.keys()].map((url) => new Request(url)); },
        async delete(request) { return store.delete(key(request)); },
      };
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { counts.deleted.push(name); return stores.delete(name); },
  };
  const old = await caches.open(oldCache);
  await old.put("/", documentResponse(html(current)));
  counts.writes.length = 0;
  vm.runInNewContext(source.replace('const BUILD_COMMIT = "local";', `const BUILD_COMMIT = "${latest}";`), {
    AbortController, Request, Response, URL, caches, setTimeout, clearTimeout, ...timers,
    self: { location: new URL(origin), addEventListener(name, handler) { listeners.set(name, handler); },
      clients: { async claim() { counts.claims += 1; } } },
    fetch: async (request, options = {}) => {
      const url = new URL(key(request));
      counts.requests.push(url.href);
      if (url.pathname === "/" || url.pathname === "/index.html") {
        return typeof document === "function" ? document(request, options) : document.clone();
      }
      const type = url.pathname.endsWith(".js") ? "text/javascript"
        : url.pathname.endsWith(".png") ? "image/png"
          : url.pathname.endsWith(".ico") ? "image/x-icon"
            : url.pathname.endsWith(".webmanifest") ? "application/manifest+json" : "text/html";
      return new Response(url.pathname.startsWith("/huilv/") ? "<title>Existing currency tool</title>" : "static-asset", {
        headers: { "content-type": type },
      });
    },
  }, { filename: "public/sw.js" });
  const request = (path, { navigate = true, signal } = {}) => {
    const request = new Request(new URL(path, origin), signal ? { signal } : undefined);
    if (navigate) Object.defineProperty(request, "mode", { value: "navigate" });
    let pending;
    listeners.get("fetch")({ request, respondWith(value) { pending = Promise.resolve(value); } });
    assert.ok(pending, "the actual worker listener must handle the request");
    return pending;
  };
  const extend = (name, detail = {}) => {
    let pending;
    listeners.get(name)({ ...detail, waitUntil(value) { pending = Promise.resolve(value); } });
    assert.ok(pending, "the actual worker listener must own the lifecycle task");
    return pending;
  };
  return { caches, old, counts, request, extend, setDocument(value) { document = value; } };
}

async function assertOldShell(audit) {
  assert.equal(await (await audit.old.match("/")).text(), html(current));
  assert.equal(audit.counts.deleted.includes(oldCache), false);
  assert.equal(audit.counts.claims, 0);
}

for (const path of ["/", "/index.html"]) {
  test(`${path} and its query variants recover the completed shell after 200 invalid HTML`, async () => {
    const invalid = [
      "<title>Temporary maintenance</title><p>Please retry</p>",
      html(latest).replace(/<meta[^>]+>/, ""),
      html(latest).replace(/<script[\s\S]+<\/script>/, ""),
      html(latest).replace(`/assets/app-${latest}.js`, "https://other.test/assets/app.js"),
    ];
    for (const body of invalid) {
      const audit = await fixture(documentResponse(body));
      for (const suffix of ["", "?user=1", `?ef-update=${latest}&ef-preflight=alias-1`]) {
        assert.equal(await (await audit.request(path + suffix)).text(), html(current));
      }
      assert.deepEqual(audit.counts.writes, []);
      await assertOldShell(audit);
    }
  });

  test(`${path} does not accept missing or non-HTML MIME for a valid-looking document`, async () => {
    for (const type of ["application/javascript", "application/octet-stream"]) {
      const audit = await fixture(documentResponse(html(latest), type));
      assert.equal(await (await audit.request(path)).text(), html(current));
      assert.deepEqual(audit.counts.writes, []);
      await assertOldShell(audit);
    }
    const response = new Response(new TextEncoder().encode(html(latest)));
    assert.equal(response.headers.get("content-type"), null);
    const audit = await fixture(response);
    assert.equal(await (await audit.request(path)).text(), html(current));
    assert.deepEqual(audit.counts.writes, []);
    await assertOldShell(audit);
  });

  test(`${path} accepts valid newer navigation without publishing an incomplete offline document`, async () => {
    const audit = await fixture(documentResponse(html(latest)));
    assert.equal(await (await audit.request(path + "?user=1")).text(), html(latest));
    assert.deepEqual(audit.counts.writes, []);
    await assertOldShell(audit);
  });

  test(`${path} runtime fetch and warming cannot cache a 200 maintenance document`, async () => {
    const audit = await fixture(documentResponse("<title>Temporary maintenance</title>"));
    assert.equal((await audit.request(path + "?runtime=1", { navigate: false })).type, "error");
    await audit.extend("message", { data: { type: "CACHE_URLS", urls: [origin + path + "?warm=1"] } });
    assert.deepEqual(audit.counts.writes, []);
    const active = await audit.caches.open(activeCache);
    assert.equal(await active.match(path + "?runtime=1"), undefined);
    assert.equal(await active.match(path + "?warm=1"), undefined);
    await assertOldShell(audit);
  });

  test(`${path} warming validates a good document and preserves the supplied complete entry graph`, async () => {
    const audit = await fixture(documentResponse(html(latest)));
    // The real page sends its document/performance resource list. HTML is not
    // a JavaScript dependency graph, so include the loaded entry explicitly.
    await audit.extend("message", { data: { type: "CACHE_URLS", urls: [origin + path + "?warm=1", `${origin}/assets/app-${latest}.js`] } });
    const active = await audit.caches.open(activeCache);
    assert.equal(await (await active.match(path + "?warm=1")).text(), html(latest));
    assert.equal(await (await active.match(`/assets/app-${latest}.js`)).text(), "static-asset");
    await assertOldShell(audit);
  });

  test(`${path} explicit preflight ignores an older failed entry and retries the server without caching`, async () => {
    const probe = `${path}?ef-update=${latest}&ef-preflight=retry-1`;
    const audit = await fixture(documentResponse("<title>Temporary maintenance</title>"));
    await audit.old.put(probe, documentResponse("<title>Previously cached failure</title>"));
    audit.counts.writes.length = 0;
    assert.equal(await (await audit.request(probe, { navigate: false })).text(), "<title>Temporary maintenance</title>");
    audit.setDocument(documentResponse(html(latest)));
    assert.equal(await (await audit.request(probe, { navigate: false })).text(), html(latest));
    assert.deepEqual(audit.counts.requests, [origin + probe, origin + probe]);
    assert.deepEqual(audit.counts.writes, []);
    assert.equal(await (await audit.old.match(probe)).text(), "<title>Previously cached failure</title>");
    await assertOldShell(audit);
  });

  test(`${path} unavailable explicit preflight retains the old shell and permits a fresh retry`, async () => {
    const probe = `${path}?ef-update=${latest}&ef-preflight=unavailable-1`;
    const audit = await fixture(() => { throw new Error("Network unavailable"); });
    assert.equal((await audit.request(probe, { navigate: false })).type, "error");
    audit.setDocument(documentResponse(html(latest)));
    assert.equal(await (await audit.request(probe, { navigate: false })).text(), html(latest));
    assert.deepEqual(audit.counts.requests, [origin + probe, origin + probe]);
    assert.deepEqual(audit.counts.writes, []);
    await assertOldShell(audit);
  });

  test(`${path} navigation whose HTML body stalls reaches the deadline and recovers the old shell`, { timeout: 1000 }, async () => {
    let aborted = false;
    const audit = await fixture((_request, { signal }) => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(html(latest)));
        signal.addEventListener("abort", () => {
          aborted = true;
          controller.error(new DOMException("Aborted HTML body", "AbortError"));
        }, { once: true });
      },
    }), { headers: { "content-type": "text/html" } }), {
      timers: { setTimeout(callback, delay) { return setTimeout(callback, delay === 3000 ? 20 : delay); } },
    });
    assert.equal(await (await audit.request(path + "?slow=1")).text(), html(current));
    assert.equal(aborted, true, "the original navigation deadline owns its response body too");
    assert.deepEqual(audit.counts.writes, []);
    await assertOldShell(audit);
  });

  test(`${path} explicit preflight body cancellation cannot cache partial HTML or block a retry`, { timeout: 1000 }, async (t) => {
    const probe = `${path}?ef-update=${latest}&ef-preflight=partial-1`;
    let aborted = false, pendingBody;
    const audit = await fixture((request, options) => new Response(new ReadableStream({
      start(controller) {
        pendingBody = controller;
        controller.enqueue(new TextEncoder().encode(html(latest)));
        const signal = options.signal || request.signal;
        signal.addEventListener("abort", () => {
          aborted = true;
          controller.error(new DOMException("Caller aborted preflight body", "AbortError"));
        }, { once: true });
      },
    }), { headers: { "content-type": "text/html" } }), {
      timers: { setTimeout(callback, delay) { return setTimeout(callback, delay === 2000 ? 20 : delay); } },
    });
    t.after(() => { if (!aborted) pendingBody?.error(new Error("Dispose uncompleted test body")); });
    const controller = new AbortController();
    const response = await audit.request(probe, { navigate: false, signal: controller.signal });
    assert.deepEqual(audit.counts.writes, [], "a preflight must not start a cache write while its body is pending");
    const rejectedRead = assert.rejects(response.text(), /Caller aborted preflight body/);
    controller.abort();
    await rejectedRead;
    assert.equal(aborted, true);
    audit.setDocument(documentResponse(html(latest)));
    assert.equal(await (await audit.request(probe, { navigate: false })).text(), html(latest));
    assert.deepEqual(audit.counts.requests, [origin + probe, origin + probe]);
    assert.deepEqual(audit.counts.writes, []);
    await assertOldShell(audit);
  });
}

test("the complete install and promotion still publish only the canonical root document", async () => {
  const audit = await fixture(documentResponse(html(latest)));
  await audit.extend("install");
  await audit.extend("activate");
  const active = await audit.caches.open(activeCache);
  assert.equal(await (await active.match("/")).text(), html(latest));
  assert.equal(await active.match("/index.html"), undefined);
  assert.ok(await active.match(`/assets/app-${latest}.js`));
  assert.equal(audit.counts.claims, 1);
  assert.equal(audit.counts.deleted.includes(oldCache), true);
});

test("English alias protection leaves the existing currency index and query routes independent", async () => {
  const audit = await fixture(documentResponse("<title>Temporary maintenance</title>"));
  for (const path of ["/huilv/", "/huilv/index.html", `/huilv/index.html?ef-update=${latest}`]) {
    assert.equal(await (await audit.request(path)).text(), "<title>Existing currency tool</title>");
  }
  assert.deepEqual(audit.counts.writes, []);
  await assertOldShell(audit);
});
