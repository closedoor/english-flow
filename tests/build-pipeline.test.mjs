import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { calculateContentRevision, runCommand } from "../scripts/build-render.mjs";
import { OFFICIAL_SITE, writeBuildInfo } from "../scripts/write-build-info.mjs";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const shellBuild = await readFile(new URL("../scripts/build-render.sh", import.meta.url), "utf8");
const nodeBuild = await readFile(new URL("../scripts/build-render.mjs", import.meta.url), "utf8");
const workflow = await readFile(new URL("../.github/workflows/validate.yml", import.meta.url), "utf8");
const renderConfig = await readFile(new URL("../render.yaml", import.meta.url), "utf8");
const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");

test("build and Render scripts are portable and use the current official site", () => {
  assert.equal(packageJson.scripts.build, "node scripts/build-render.mjs");
  assert.equal(packageJson.scripts["build:render"], "node scripts/build-render.mjs");
  assert.equal(packageJson.scripts["verify:production"], "node scripts/verify-production.mjs");
  assert.match(shellBuild, /exec node scripts\/build-render\.mjs/);
  assert.doesNotMatch(shellBuild, /\btimeout\b/);
  assert.doesNotMatch(nodeBuild, /\btimeout --signal\b/);
  assert.match(nodeBuild, /VITE_ENGLISH_FLOW_CONTENT_REVISION/);
  const buildFunction = nodeBuild.slice(nodeBuild.indexOf("export async function buildRender"));
  assert.ok(
    buildFunction.indexOf("scripts/sync-ngsl-packs.mjs") < buildFunction.indexOf("const contentRevision = await calculateContentRevision()"),
    "content fingerprint must be calculated after generated packs are synchronized",
  );
  assert.match(layout, new RegExp(OFFICIAL_SITE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(renderConfig, /path: \/build-info\.json[\s\S]*Cache-Control[\s\S]*no-cache/);
  assert.match(workflow, /actions\/checkout@v7/);
  assert.match(workflow, /actions\/setup-node@v7/);
  assert.match(workflow, /Verify Render production deployment/);
  assert.match(workflow, /EXPECTED_COMMIT: \$\{\{ github\.sha \}\}/);
});

test("learning-content revisions are deterministic and change with published JSON", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "english-flow-content-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path.join(directory, "b.json"), "[2]");
  await writeFile(path.join(directory, "a.json"), "[1]");
  await writeFile(path.join(directory, "ignore.txt"), "not published learning JSON");
  const first = await calculateContentRevision(directory);
  assert.match(first, /^data-[0-9a-f]{20}$/);
  assert.equal(await calculateContentRevision(directory), first);
  await writeFile(path.join(directory, "b.json"), "[3]");
  assert.notEqual(await calculateContentRevision(directory), first);
});

test("build metadata records the exact commit, content revision and official origin", async (t) => {
  const outputDirectory = await mkdtemp(path.join(os.tmpdir(), "english-flow-build-info-"));
  t.after(() => rm(outputDirectory, { recursive: true, force: true }));
  const commit = "a".repeat(40);
  const info = await writeBuildInfo({
    outputDirectory,
    env: {
      ENGLISH_FLOW_BUILD_COMMIT: commit,
      VITE_ENGLISH_FLOW_CONTENT_REVISION: "data-11111111111111111111",
    },
  });
  assert.deepEqual(info, {
    app: "english-flow",
    title: "词流英语",
    commit,
    contentRevision: "data-11111111111111111111",
    origin: OFFICIAL_SITE,
  });
  assert.deepEqual(JSON.parse(await readFile(path.join(outputDirectory, "build-info.json"), "utf8")), info);
});

test("portable command timeout terminates a stalled build step", { concurrency: false }, async () => {
  await assert.rejects(
    runCommand(process.execPath, ["-e", "setTimeout(() => {}, 5000)"], { timeoutMs: 50 }),
    /timed out after 50 ms/,
  );
});
