import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OFFICIAL_SITE } from "./write-build-info.mjs";

const REQUEST_TIMEOUT_MS = 5_000;
const DEFAULT_ATTEMPTS = 45;
const DEFAULT_DELAY_MS = 10_000;

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.min(Math.max(parsed, minimum), maximum) : fallback;
}

function cacheBusted(url, token) {
  const next = new URL(url);
  next.searchParams.set("__english_flow_verify", token);
  return next;
}

async function fetchOk(fetchImpl, url, token) {
  const response = await fetchImpl(cacheBusted(url, token), {
    cache: "no-store",
    headers: { "cache-control": "no-cache" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (response.status !== 200) throw new Error(`${new URL(url).pathname} returned HTTP ${response.status}; expected 200`);
  return response;
}

function browserAssetUrls(html, origin) {
  return [...new Set([...html.matchAll(/(?:src|href)=["']([^"'#]+)["']/g)].flatMap((match) => {
    try {
      const url = new URL(match[1], origin);
      return url.origin === origin && url.pathname.startsWith("/assets/") && /\.(?:js|css)$/.test(url.pathname) ? [url.href] : [];
    } catch {
      return [];
    }
  }))];
}

export async function inspectProduction({ baseUrl = OFFICIAL_SITE, expectedCommit, fetchImpl = fetch, token = `${Date.now()}` } = {}) {
  assert.match(expectedCommit ?? "", /^[0-9a-f]{40}$/, "EXPECTED_COMMIT must be a full Git commit SHA");
  const base = new URL(baseUrl);

  const html = await (await fetchOk(fetchImpl, new URL("/", base), token)).text();
  assert.match(html, /<title>\s*词流英语\s*<\/title>/i, "Production title is not 词流英语");

  const info = await (await fetchOk(fetchImpl, new URL("/build-info.json", base), token)).json();
  assert.equal(info.app, "english-flow");
  assert.equal(info.title, "词流英语");
  assert.equal(info.commit, expectedCommit, `Render is still serving commit ${info.commit || "unknown"}`);
  assert.equal(new URL(info.origin).origin, base.origin);
  assert.match(info.contentRevision ?? "", /^data-[0-9a-f]{20}$/, "Production content cache is not fingerprinted");

  const manifest = await (await fetchOk(fetchImpl, new URL("/manifest.webmanifest", base), token)).json();
  assert.equal(manifest.name, "词流英语");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.scope, "/");

  const worker = await (await fetchOk(fetchImpl, new URL("/sw.js", base), token)).text();
  assert.match(worker, /const BUILD_REVISION = "[0-9a-f]{20}";/, "Production service worker is not stamped");
  assert.doesNotMatch(worker, /const BUILD_REVISION = "local";/);

  const iconUrls = Array.isArray(manifest.icons)
    ? manifest.icons.map((icon) => new URL(icon.src, base).href)
    : [];
  const assets = [...new Set([...browserAssetUrls(html, base.origin), ...iconUrls])];
  assert.ok(assets.some((url) => new URL(url).pathname.endsWith(".js")), "No production JavaScript asset was found");
  assert.ok(iconUrls.length >= 2, "PWA manifest is missing install icons");
  await Promise.all(assets.map((url) => fetchOk(fetchImpl, url, token)));

  return { info, assetCount: assets.length };
}

export async function verifyProduction({
  baseUrl = OFFICIAL_SITE,
  expectedCommit,
  attempts = DEFAULT_ATTEMPTS,
  delayMs = DEFAULT_DELAY_MS,
  fetchImpl = fetch,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  logger = console,
} = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await inspectProduction({ baseUrl, expectedCommit, fetchImpl, token: `${Date.now()}-${attempt}` });
      logger.log(`Verified Render production commit ${expectedCommit} with ${result.assetCount} static/PWA assets.`);
      return result;
    } catch (error) {
      lastError = error;
      logger.log(`Render verification attempt ${attempt}/${attempts}: ${error instanceof Error ? error.message : error}`);
      if (attempt < attempts) await sleep(delayMs);
    }
  }
  throw lastError ?? new Error("Render production verification failed");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const attempts = boundedInteger(process.env.PRODUCTION_VERIFY_ATTEMPTS, DEFAULT_ATTEMPTS, 1, 90);
  const delayMs = boundedInteger(process.env.PRODUCTION_VERIFY_DELAY_MS, DEFAULT_DELAY_MS, 0, 60_000);
  try {
    await verifyProduction({
      baseUrl: process.env.PRODUCTION_URL || OFFICIAL_SITE,
      expectedCommit: process.env.EXPECTED_COMMIT,
      attempts,
      delayMs,
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
