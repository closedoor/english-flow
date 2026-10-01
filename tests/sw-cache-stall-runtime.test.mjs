import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
const origin = "https://english-flow.test";
const asset = `${origin}/assets/stalled-cache.js`;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

function workerWithCacheFault(fault, cacheDeadline = 5) {
  const gate = deferred();
  const entries = new Map();
  const listeners = new Map();
  const counts = { network: 0, writes: 0 };
  let stalled = true;
  const cache = {
    async match(request) {
      if (stalled && fault === "match") return gate.promise;
      return entries.get(new URL(request instanceof Request ? request.url : request, origin).href)?.clone();
    },
    async put(request, response) {
      counts.writes += 1;
      if (stalled && fault === "put") await gate.promise;
      entries.set(new URL(request instanceof Request ? request.url : request, origin).href, response.clone());
    },
  };
  const caches = {
    async open() { return stalled && fault === "open" ? gate.promise : cache; },
    async keys() { return stalled && fault === "keys" ? gate.promise : []; },
  };
  vm.runInNewContext(source, {
    AbortController, Request, Response, URL, caches, clearTimeout,
    // Accelerate only the actual runtime cache deadline. Network timeouts and
    // installation limits are unchanged, so they cannot hide this regression.
    setTimeout(callback, delay) { return setTimeout(callback, delay === 2000 ? cacheDeadline : delay); },
    self: { location: new URL(origin), addEventListener(name, handler) { listeners.set(name, handler); } },
    fetch: async () => {
      counts.network += 1;
      return new Response("export const usable = true;", { headers: { "content-type": "application/javascript" } });
    },
  }, { filename: "public/sw.js" });
  const request = () => {
    let pending;
    listeners.get("fetch")({ request: new Request(asset), respondWith(value) { pending = Promise.resolve(value); } });
    assert.ok(pending, "the real worker fetch handler must own the request");
    return pending;
  };
  const release = async (error) => {
    stalled = false;
    if (error) gate.reject(error);
    else gate.resolve(fault === "open" ? cache : fault === "keys" ? [] : undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  return { request, release, counts, entries };
}

for (const fault of ["open", "match", "keys", "put"]) {
  test(`a stalled runtime cache ${fault} cannot block a healthy static resource`, { timeout: 1000 }, async () => {
    const worker = workerWithCacheFault(fault);
    const response = await worker.request();
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "export const usable = true;");
    assert.equal(worker.counts.network, 1, "a cache timeout must not repeat the network request");

    // A late cache completion must not consume the returned response, start a
    // duplicate download, or prevent a later request from using the cache.
    await worker.release();
    const recovered = await worker.request();
    assert.equal(await recovered.text(), "export const usable = true;");
    assert.equal(worker.counts.network, 1);
    assert.equal(worker.counts.writes, 1);
    assert.ok(worker.entries.has(asset));
  });
}

for (const fault of ["match", "put"]) {
  test(`a late rejected runtime cache ${fault} remains handled after its deadline`, { timeout: 1000 }, async () => {
    const worker = workerWithCacheFault(fault);
    const unhandled = [];
    const onUnhandled = (error) => unhandled.push(error);
    process.on("unhandledRejection", onUnhandled);
    try {
      assert.equal((await worker.request()).status, 200);
      await worker.release(new Error("Cache rejected after the timeout"));
      assert.deepEqual(unhandled, []);
      const response = await worker.request();
      assert.equal(await response.text(), "export const usable = true;");
      assert.equal(worker.counts.network, fault === "put" ? 2 : 1);
    } finally {
      process.removeListener("unhandledRejection", onUnhandled);
    }
  });
}

test("ordinary runtime cache writes finish before the response is announced", { timeout: 1000 }, async () => {
  const worker = workerWithCacheFault("put", 50);
  let completed = false;
  const pending = worker.request().then((response) => { completed = true; return response; });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(worker.counts.network, 1);
  assert.equal(worker.counts.writes, 1);
  assert.equal(completed, false);
  await worker.release();
  assert.equal((await pending).status, 200);
  assert.ok(worker.entries.has(asset));
});

test("an obtained streaming response is not aborted while its cache write stalls", { timeout: 1000 }, async () => {
  const listeners = new Map();
  let aborted = false;
  const cache = { match: async () => undefined, put: async () => new Promise(() => {}) };
  vm.runInNewContext(source, {
    AbortController, Request, Response, URL, clearTimeout,
    caches: { open: async () => cache, keys: async () => [] },
    setTimeout(callback, delay) {
      return setTimeout(callback, delay === 2000 ? 10 : delay === 8000 ? 5 : delay);
    },
    self: { location: new URL(origin), addEventListener(name, handler) { listeners.set(name, handler); } },
    fetch: async (_request, options) => {
      const body = new ReadableStream({
        start(controller) {
          options.signal.addEventListener("abort", () => {
            aborted = true;
            controller.error(new DOMException("Network request was aborted", "AbortError"));
          }, { once: true });
          setTimeout(() => {
            if (aborted) return;
            controller.enqueue(new TextEncoder().encode("export const streamFinished = true;"));
            controller.close();
          }, 15);
        },
      });
      return new Response(body, { headers: { "content-type": "application/javascript" } });
    },
  }, { filename: "public/sw.js" });
  let pending;
  listeners.get("fetch")({ request: new Request(asset), respondWith(value) { pending = value; } });
  const response = await pending;
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "export const streamFinished = true;");
  assert.equal(aborted, false, "optional cache persistence must not abort the returned stream");
});
