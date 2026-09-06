import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("exports production title and metadata without development markers", async () => {
  const html = await readFile(new URL("../dist/client/index.html", import.meta.url), "utf8");
  const origin = process.env.RENDER_EXTERNAL_URL || "https://english-flow.iscream95.chatgpt.site";
  assert.ok(html.includes("<title>词流英语</title>"));
  assert.ok(html.includes(`property="og:image" content="${new URL("/og.png", origin).href}"`));
  assert.ok(html.includes(`rel="manifest" href="${new URL("/manifest.webmanifest", origin).href}"`));
  assert.ok(html.includes('name="twitter:card" content="summary_large_image"'));
  assert.doesNotMatch(html, /codex-preview|@vite\/client/i);
});
