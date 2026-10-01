import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
const origin = "https://english-flow.test";
const current = "a".repeat(40);
const latest = "b".repeat(40);
const updateUrl = `${origin}/?ef-update=${latest}`;
const html = (commit) => `<!doctype html><title>词流英语</title><meta name="english-flow-build" content="${commit}"><script type="module" src="/assets/app-${commit}.js"></script>`;
const documentResponse = (commit) => new Response(html(commit), { headers: { "content-type": "text/html" } });

function worker(network) {
  const listeners = new Map();
  const stores = new Map();
  const key = (request) => new URL(request instanceof Request ? request.url : String(request), origin).href;
  const counts = { network: 0, writes: 0 };
  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const values = stores.get(name);
      return {
        async match(request) { return values.get(key(request))?.clone(); },
        async put(request, response) { counts.writes += 1; values.set(key(request), response.clone()); },
      };
    },
    async keys() { return [...stores.keys()]; },
  };
  vm.runInNewContext(source, {
    AbortController, Request, Response, URL, caches, setTimeout, clearTimeout,
    self: { location: new URL(origin), addEventListener(name, callback) { listeners.set(name, callback); } },
    fetch: async (request, options) => {
      counts.network += 1;
      return network(request, options, counts.network);
    },
  }, { filename: "public/sw.js" });
  const request = (url = updateUrl) => {
    let pending;
    listeners.get("fetch")({
      // A version preflight is fetch(), not document navigation. Request cache
      // settings alone cannot bypass a worker's custom Cache Storage lookup.
      request: new Request(url, { cache: "no-store" }),
      respondWith(value) { pending = Promise.resolve(value); },
    });
    assert.ok(pending);
    return pending;
  };
  const seed = async (url, response, name = "wordflow-ngsl-v34-local") => {
    await (await caches.open(name)).put(url, response);
    counts.writes = 0;
  };
  const inspect = () => [...stores.values()].flatMap(values => [...values.entries()].map(([url, response]) => [url, response.clone()]));
  return { counts, request, seed, inspect };
}

test("an explicit update preflight retries fresh HTML after the server first returns an older release", async () => {
  const fixture = worker((_request, _options, attempt) => documentResponse(attempt === 1 ? current : latest));
  await fixture.seed("/", documentResponse(current));
  assert.equal(await (await fixture.request()).text(), html(current));
  assert.equal(await (await fixture.request()).text(), html(latest), "a retry must reach the recovered server");
  assert.equal(fixture.counts.network, 2);
  assert.equal(fixture.counts.writes, 0, "an update probe cannot commit an unvalidated future offline shell");
  assert.equal(await fixture.inspect()[0][1].text(), html(current));
});

test("a cached failed update probe cannot pin subsequent attempts to old HTML", async () => {
  const fixture = worker(() => documentResponse(latest));
  await fixture.seed(updateUrl, documentResponse(current));
  assert.equal(await (await fixture.request()).text(), html(latest));
  assert.equal(fixture.counts.network, 1, "explicit update probes must ignore a legacy query cache entry");
  assert.equal(fixture.counts.writes, 0);
});

test("an unavailable update preflight fails closed and retains the current offline shell", async () => {
  const fixture = worker(() => { throw new Error("temporary network failure"); });
  await fixture.seed("/", documentResponse(current));
  await fixture.seed(updateUrl, documentResponse(current));
  const response = await fixture.request();
  assert.equal(response.type, "error", "a failed probe cannot fall back to an old document and pretend to succeed");
  assert.equal(fixture.counts.network, 1);
  assert.equal(fixture.counts.writes, 0);
  assert.equal(await fixture.inspect()[0][1].text(), html(current));
});

test("a 200 maintenance document is never cached by an explicit update preflight", async () => {
  const temporary = "<!doctype html><title>Temporary maintenance</title><h1>Please retry later</h1>";
  const fixture = worker(() => new Response(temporary, { headers: { "content-type": "text/html" } }));
  await fixture.seed("/", documentResponse(current));
  assert.equal(await (await fixture.request()).text(), temporary, "the client retains its existing title and release validation");
  assert.equal(fixture.counts.writes, 0);
  assert.deepEqual(fixture.inspect().map(([url]) => url), [`${origin}/`]);
});
