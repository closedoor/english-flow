import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "dist/client");
const html = await readFile(path.join(output, "index.html"), "utf8");
assert.match(html, /<title>词流英语<\/title>/);
assert.ok(/<script[^>]+src="\/assets\/[^"\s]+\.js"/.test(html)
  || /<script[^>]*>import\("\/assets\/[^"\s]+\.js"\)<\/script>/.test(html), "Missing browser hydration entry");
assert.doesNotMatch(html, /@vite\/client|codex-preview/);

const expectedOrigin = process.env.RENDER_EXTERNAL_URL || "https://english-flow.iscream95.chatgpt.site";
assert.ok(html.includes(`property="og:image" content="${new URL("/og.png", expectedOrigin).href}"`), "Social metadata must use the deployment origin");

let publicFiles = 0;
async function checkPublicFiles(directory, relative = "") {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = path.join(relative, entry.name);
    if (entry.isDirectory()) {
      await checkPublicFiles(path.join(directory, entry.name), name);
    } else {
      const source = await readFile(path.join(directory, entry.name));
      const built = await readFile(path.join(output, name));
      assert.ok(source.equals(built), `Missing or altered public asset: ${name}`);
      publicFiles++;
    }
  }
}
await checkPublicFiles(path.join(root, "public"));

for (const [rel, pathname] of [["manifest", "/manifest.webmanifest"], ["icon", "/icon.svg"], ["apple-touch-icon", "/apple-touch-icon.png"]]) {
  assert.ok(html.includes(`rel="${rel}" href="${new URL(pathname, expectedOrigin).href}"`), `${rel} must use the deployment origin`);
}

const references = [...html.matchAll(/(?:src|href)="([^"#]+)"/g)].map((match) => match[1]);
for (const reference of references) {
  const url = new URL(reference, expectedOrigin);
  if (url.origin !== new URL(expectedOrigin).origin || url.pathname === "/") continue;
  assert.ok((await stat(path.join(output, decodeURIComponent(url.pathname)))).isFile(), `Missing HTML asset: ${url.pathname}`);
}

const files = await readdir(output, { recursive: true });
assert.ok(!files.some((name) => /(^|\/)(?:server|\.openai|\.env[^/]*|node_modules)(?:\/|$)/.test(name)), "Static publish directory contains server or private files");
console.log(`Validated Render static export: index.html, ${publicFiles} public assets, metadata and HTML references.`);
