import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildServiceWorker } from "../scripts/stamp-service-worker.mjs";

const source = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");

async function fixture(t) {
  const output = await mkdtemp(path.join(os.tmpdir(), "english-flow-worker-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  await mkdir(path.join(output, "assets"));
  await writeFile(path.join(output, "index.html"), '<script src="/assets/page.js"></script>');
  await writeFile(path.join(output, "assets/page.js"), "export const page = 1;");
  return output;
}

test("unchanged published files produce identical workers across repeated stamping", async (t) => {
  const output = await fixture(t);
  const first = await buildServiceWorker(output, source);
  assert.match(first, /const BUILD_REVISION = "[0-9a-f]{20}";/);
  await writeFile(path.join(output, "sw.js"), first);
  assert.equal(await buildServiceWorker(output, source), first);
});

test("HTML, lazy assets, public files and worker logic each invalidate the offline shell", async (t) => {
  const output = await fixture(t);
  let previous = await buildServiceWorker(output, source);
  for (const [name, contents] of [
    ["index.html", '<script src="/assets/page.js"></script><title>Updated</title>'],
    ["assets/page.js", "export const page = 2;"],
    ["assets/reading.js", "export const reading = 1;"],
    ["icon.svg", '<svg xmlns="http://www.w3.org/2000/svg"/>'],
  ]) {
    await writeFile(path.join(output, name), contents);
    const next = await buildServiceWorker(output, source);
    assert.notEqual(next, previous, `${name} must trigger a worker update`);
    previous = next;
  }
  assert.notEqual(await buildServiceWorker(output, `${source}\n// worker change\n`), previous);
});

test("a missing build marker fails instead of silently publishing a fixed cache version", async (t) => {
  const output = await fixture(t);
  await assert.rejects(buildServiceWorker(output, "// no revision marker"), /revision marker/);
});
