#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const sourcePath = resolve(root, "app/ngsl-data.ts");
const packPaths = [1, 2, 3].map((pack) => resolve(root, `public/data/ngsl-words-${pack}.json`));
const source = await readFile(sourcePath, "utf8");
const records = source
  .split("\n")
  .filter((line) => line.startsWith("  {") && line.endsWith(","))
  .map((line) => JSON.parse(line.trim().slice(0, -1)));

if (records.length !== 2809) throw new Error(`Expected 2,809 NGSL records, found ${records.length}`);

const packs = [records.slice(0, 1000), records.slice(1000, 2000), records.slice(2000)];
const serialized = packs.map((pack) => `${JSON.stringify(pack)}\n`);
const writeMode = process.argv.includes("--write");

if (writeMode) {
  await Promise.all(packPaths.map((path, index) => writeFile(path, serialized[index], "utf8")));
  console.log(`Wrote ${packs.map((pack) => pack.length).join(" + ")} NGSL records`);
} else {
  const current = await Promise.all(packPaths.map((path) => readFile(path, "utf8")));
  current.forEach((content, index) => {
    if (content !== serialized[index]) throw new Error(`NGSL pack ${index + 1} is out of date; run scripts/sync-ngsl-packs.mjs --write`);
  });
  console.log("NGSL data packs match the canonical generated source");
}
