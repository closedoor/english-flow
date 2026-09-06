import { execFile as execFileCallback } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

export const OFFICIAL_SITE = "https://english-flow-mwnn.onrender.com";
const root = fileURLToPath(new URL("../", import.meta.url));
const execFile = promisify(execFileCallback);

function normalizedCommit(value) {
  const commit = value?.trim().toLowerCase();
  return commit && /^[0-9a-f]{40}$/.test(commit) ? commit : null;
}

export async function resolveBuildCommit({ env = process.env, cwd = root } = {}) {
  for (const value of [env.ENGLISH_FLOW_BUILD_COMMIT, env.RENDER_GIT_COMMIT, env.GITHUB_SHA, env.SOURCE_VERSION]) {
    const commit = normalizedCommit(value);
    if (commit) return commit;
  }
  try {
    const { stdout } = await execFile("git", ["rev-parse", "HEAD"], { cwd });
    return normalizedCommit(stdout) ?? "unknown";
  } catch {
    return "unknown";
  }
}

export async function writeBuildInfo({ env = process.env, outputDirectory = path.join(root, "dist/client"), cwd = root } = {}) {
  const origin = new URL(env.RENDER_EXTERNAL_URL || OFFICIAL_SITE).origin;
  const contentRevision = env.VITE_ENGLISH_FLOW_CONTENT_REVISION?.trim() || "local";
  const info = {
    app: "english-flow",
    title: "词流英语",
    commit: await resolveBuildCommit({ env, cwd }),
    contentRevision,
    origin,
  };
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(path.join(outputDirectory, "build-info.json"), `${JSON.stringify(info, null, 2)}\n`);
  return info;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const info = await writeBuildInfo();
  console.log(`Wrote production build metadata for ${info.commit}.`);
}
