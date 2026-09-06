import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const revisionMarker = 'const BUILD_REVISION = "local";';

// Include all published files, including lazy chunks and icons. Do not hash the
// generated worker itself: repeated builds of the same files must be stable.
export async function buildServiceWorker(output, source) {
  assert.equal(source.split(revisionMarker).length, 2, "Missing or ambiguous worker revision marker");
  const hash = createHash("sha256").update(source);
  async function includeDirectory(directory, prefix = "") {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    for (const entry of entries) {
      const relative = `${prefix}${entry.name}`;
      if (relative === "sw.js") continue;
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) await includeDirectory(filename, `${relative}/`);
      else if (entry.isFile()) {
        hash.update(`\0${relative}\0`).update(await readFile(filename));
      }
    }
  }
  await includeDirectory(output);
  const revision = hash.digest("hex").slice(0, 20);
  return source.replace(revisionMarker, `const BUILD_REVISION = "${revision}";`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const output = path.join(root, "dist/client");
  const source = await readFile(path.join(root, "public/sw.js"), "utf8");
  await writeFile(path.join(output, "sw.js"), await buildServiceWorker(output, source));
  console.log("Stamped service worker with the published build fingerprint.");
}
