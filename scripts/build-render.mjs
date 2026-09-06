import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const BUILD_TIMEOUT_MS = 180_000;
export const BUILD_KILL_GRACE_MS = 10_000;
const root = fileURLToPath(new URL("../", import.meta.url));

export async function calculateContentRevision(dataDirectory = path.join(root, "public/data")) {
  const files = (await readdir(dataDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort();
  if (!files.length) throw new Error("No published learning-content JSON files were found");

  const hash = createHash("sha256");
  for (const name of files) {
    hash.update(`\0${name}\0`).update(await readFile(path.join(dataDirectory, name)));
  }
  return `data-${hash.digest("hex").slice(0, 20)}`;
}

export function runCommand(command, args, { env = process.env, timeoutMs = 0, shell = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, shell, stdio: "inherit" });
    let finished = false;
    let timedOut = false;
    let timeout;
    let forceKillTimeout;

    const settle = (error) => {
      if (finished) return;
      finished = true;
      if (timeout) clearTimeout(timeout);
      if (forceKillTimeout) clearTimeout(forceKillTimeout);
      if (error) reject(error);
      else resolve();
    };

    child.once("error", (error) => settle(error));
    child.once("exit", (code, signal) => {
      if (timedOut) {
        settle(new Error(`${command} timed out after ${timeoutMs} ms`));
      } else if (code === 0) {
        settle();
      } else {
        settle(new Error(`${command} exited with ${signal ? `signal ${signal}` : `code ${code}`}`));
      }
    });

    if (timeoutMs > 0) {
      timeout = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        forceKillTimeout = setTimeout(() => child.kill("SIGKILL"), BUILD_KILL_GRACE_MS);
        forceKillTimeout.unref?.();
      }, timeoutMs);
      timeout.unref?.();
    }
  });
}

export async function buildRender() {
  const contentRevision = await calculateContentRevision();
  const env = {
    ...process.env,
    ENGLISH_FLOW_RENDER_EXPORT: "1",
    VITE_ENGLISH_FLOW_CONTENT_REVISION: contentRevision,
  };
  const vinext = path.join(root, "node_modules", ".bin", process.platform === "win32" ? "vinext.cmd" : "vinext");

  await runCommand(process.execPath, ["scripts/sync-ngsl-packs.mjs"], { env });
  await runCommand(vinext, ["build"], { env, timeoutMs: BUILD_TIMEOUT_MS, shell: process.platform === "win32" });
  await runCommand(process.execPath, ["scripts/write-build-info.mjs"], { env });
  await runCommand(process.execPath, ["scripts/stamp-service-worker.mjs"], { env });
  await runCommand(process.execPath, ["scripts/validate-render.mjs"], { env });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await buildRender();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
