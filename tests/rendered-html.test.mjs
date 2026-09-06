import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const OFFICIAL_SITE = "https://english-flow-mwnn.onrender.com";

test("exports production title, official metadata and deployment identity", async () => {
  const html = await readFile(new URL("../dist/client/index.html", import.meta.url), "utf8");
  const origin = new URL(process.env.RENDER_EXTERNAL_URL || OFFICIAL_SITE).origin;
  const buildInfo = JSON.parse(await readFile(new URL("../dist/client/build-info.json", import.meta.url), "utf8"));
  assert.ok(html.includes("<title>词流英语</title>"));
  assert.ok(html.includes(`property="og:image" content="${new URL("/og.png", origin).href}"`));
  assert.ok(html.includes(`rel="manifest" href="${new URL("/manifest.webmanifest", origin).href}"`));
  assert.ok(html.includes('name="twitter:card" content="summary_large_image"'));
  assert.doesNotMatch(html, /codex-preview|@vite\/client/i);
  assert.equal(buildInfo.app, "english-flow");
  assert.equal(buildInfo.title, "词流英语");
  assert.equal(buildInfo.origin, origin);
  assert.match(buildInfo.contentRevision, /^data-[0-9a-f]{20}$/);
  assert.match(buildInfo.commit, /^(?:[0-9a-f]{40}|unknown)$/);
});
