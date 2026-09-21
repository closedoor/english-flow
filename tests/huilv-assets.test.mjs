import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const publicRoot = new URL("../public/", import.meta.url);
const page = await readFile(new URL("huilv/index.html", publicRoot), "utf8");
const english = JSON.parse(await readFile(new URL("manifest.webmanifest", publicRoot), "utf8"));
const manifestPath = page.match(/<link rel="manifest" href="([^"]+)"/)?.[1];
assert.ok(manifestPath, "the currency app needs its own install manifest");
const currency = JSON.parse(await readFile(new URL(manifestPath.slice(1), publicRoot), "utf8"));

test("currency and English installs have separate identities, launch pages and icons", () => {
  assert.notEqual(currency.id, english.id);
  assert.notEqual(currency.name, english.name);
  assert.notEqual(currency.start_url, english.start_url);
  assert.equal(currency.scope, "/huilv/");
  assert.ok(currency.start_url.startsWith(currency.scope));
  assert.ok(currency.id.startsWith(currency.scope));
  assert.ok(manifestPath.startsWith(currency.scope));
  assert.equal(currency.display, "standalone");
  const englishIcons = new Set(english.icons.map((icon) => icon.src));
  for (const icon of currency.icons) {
    assert.ok(icon.src.startsWith(currency.scope));
    assert.equal(englishIcons.has(icon.src), false);
  }
  assert.match(page, /name="apple-mobile-web-app-title" content="口袋汇率"/);
});

test("iPhone has an explicit currency touch icon and every PNG matches its declared size", async () => {
  const apple = page.match(/<link rel="apple-touch-icon" sizes="(\d+)x\1" href="([^"]+)"/);
  assert.ok(apple, "iPhone must not fall back to the English app's root icon");
  assert.ok(apple[2].startsWith(currency.scope));
  const images = [{ src: apple[2], size: Number(apple[1]) }, ...currency.icons.map((icon) => ({
    src: icon.src, size: Number(icon.sizes.split("x")[0]),
  }))];
  for (const image of images) {
    const bytes = await readFile(new URL(image.src.slice(1), publicRoot));
    assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal(bytes.readUInt32BE(16), image.size);
    assert.equal(bytes.readUInt32BE(20), image.size);
  }
});
