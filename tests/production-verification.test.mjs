import assert from "node:assert/strict";
import test from "node:test";
import { inspectProduction, verifyProduction } from "../scripts/verify-production.mjs";
import { OFFICIAL_SITE } from "../scripts/write-build-info.mjs";

const expectedCommit = "a".repeat(40);
const oldCommit = "b".repeat(40);
const contentRevision = `data-${"c".repeat(20)}`;

function productionResponses(commit = expectedCommit) {
  return new Map([
    ["/", new Response('<!doctype html><title>词流英语</title><script src="/assets/app.js"></script><link rel="stylesheet" href="/assets/app.css">', { status: 200 })],
    ["/build-info.json", new Response(JSON.stringify({ app: "english-flow", title: "词流英语", commit, contentRevision, origin: OFFICIAL_SITE }), { status: 200 })],
    ["/manifest.webmanifest", new Response(JSON.stringify({ name: "词流英语", start_url: "/", scope: "/", icons: [{ src: "/icon-192.png" }, { src: "/icon-512.png" }] }), { status: 200 })],
    ["/sw.js", new Response(`const BUILD_REVISION = "${"d".repeat(20)}";`, { status: 200 })],
    ["/assets/app.js", new Response("export{}", { status: 200 })],
    ["/assets/app.css", new Response("body{}", { status: 200 })],
    ["/icon-192.png", new Response("icon", { status: 200 })],
    ["/icon-512.png", new Response("icon", { status: 200 })],
  ]);
}

function fetchFrom(responses, visited = []) {
  return async (input) => {
    const url = new URL(input);
    visited.push(url.pathname);
    return responses.get(url.pathname)?.clone() ?? new Response("missing", { status: 404 });
  };
}

test("production inspection checks the deployed commit, title, scripts and PWA files", async () => {
  const visited = [];
  const result = await inspectProduction({
    baseUrl: OFFICIAL_SITE,
    expectedCommit,
    fetchImpl: fetchFrom(productionResponses(), visited),
    token: "test",
  });
  assert.equal(result.info.commit, expectedCommit);
  assert.equal(result.assetCount, 4);
  assert.deepEqual(new Set(visited), new Set(["/", "/build-info.json", "/manifest.webmanifest", "/sw.js", "/assets/app.js", "/assets/app.css", "/icon-192.png", "/icon-512.png"]));
});

test("production verification waits for Render to replace an older commit", async () => {
  let attempt = 0;
  let sleeps = 0;
  const fetchImpl = async (input) => {
    const url = new URL(input);
    if (url.pathname === "/") attempt += 1;
    const responses = productionResponses(attempt === 1 ? oldCommit : expectedCommit);
    return responses.get(url.pathname)?.clone() ?? new Response("missing", { status: 404 });
  };
  const messages = [];
  const result = await verifyProduction({
    baseUrl: OFFICIAL_SITE,
    expectedCommit,
    attempts: 2,
    delayMs: 1,
    fetchImpl,
    sleep: async () => { sleeps += 1; },
    logger: { log: (message) => messages.push(message) },
  });
  assert.equal(result.info.commit, expectedCommit);
  assert.equal(sleeps, 1);
  assert.ok(messages.some((message) => message.includes(oldCommit)));
});

test("production inspection rejects unstamped PWA workers", async () => {
  const responses = productionResponses();
  responses.set("/sw.js", new Response('const BUILD_REVISION = "local";', { status: 200 }));
  await assert.rejects(() => inspectProduction({
    baseUrl: OFFICIAL_SITE,
    expectedCommit,
    fetchImpl: fetchFrom(responses),
    token: "test",
  }), /not stamped/);
});
