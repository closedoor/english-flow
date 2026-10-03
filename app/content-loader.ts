const buildEnvironment = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
const configuredRevision = buildEnvironment?.VITE_ENGLISH_FLOW_CONTENT_REVISION?.trim();
export const CONTENT_REVISION = configuredRevision && /^[a-z0-9-]+$/i.test(configuredRevision) ? configuredRevision : "local";
const CONTENT_CACHE_PREFIX = "english-flow-content-";
const CONTENT_CACHE_NAME = `${CONTENT_CACHE_PREFIX}${CONTENT_REVISION}`;
const DEFAULT_TIMEOUT = 8_000;
const CACHE_TIMEOUT = 2_000;
const RETRY_DELAYS = [0, 500, 1_500] as const;
const OFFLINE_CACHE_ERROR_EVENT = "english-flow-offline-cache-error";

type JsonValidator<T> = (value: unknown) => value is T;

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
}

// Cache Storage has no AbortSignal. Bound each cache phase separately so a
// stalled disk read/write cannot block usable online content indefinitely.
// Promise.race observes late rejections too; timed-out operations are never
// treated as a confirmed offline save, and no learning records are touched.
async function withinCacheDeadline<T>(operation: Promise<T>): Promise<T> {
  let timeout: number | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = window.setTimeout(() => reject(new Error("Cache operation timed out")), CACHE_TIMEOUT);
      }),
    ]);
  } finally {
    if (timeout !== undefined) window.clearTimeout(timeout);
  }
}

async function parseValidatedJson<T>(response: Response, validate: JsonValidator<T>) {
  const value: unknown = await response.json();
  if (!validate(value)) throw new Error("Downloaded learning content is invalid");
  return value;
}

function cacheRevision(cacheName: string) {
  return cacheName.startsWith(CONTENT_CACHE_PREFIX) ? cacheName.slice(CONTENT_CACHE_PREFIX.length) : "";
}

async function currentCachedJson<T>(url: string, validate: JsonValidator<T>) {
  if (typeof caches === "undefined") return null;
  try {
    const cache = await caches.open(CONTENT_CACHE_NAME);
    const saved = await cache.match(url);
    if (saved) {
      try {
        return await parseValidatedJson(saved.clone(), validate);
      } catch {
        // Another tab can replace this captured invalid response before its
        // read finishes. Ignore it; a valid network write replaces this key.
      }
    }
  } catch {
    // Cache Storage may be blocked in private browsing.
  }
  return null;
}

async function legacyCachedJson<T>(url: string, validate: JsonValidator<T>) {
  if (typeof caches === "undefined") return null;
  const unversionedUrl = url.replace(/[?#].*$/, "");
  // Read the old unversioned shell independently: stalled enumeration must
  // not hide it. Both branches start together and share the same time budget.
  const oldShell = withinCacheDeadline((async () => {
    const saved = await caches.match(unversionedUrl);
    return saved ? await parseValidatedJson(saved.clone(), validate) : null;
  })()).catch(() => null);

  const content = await withinCacheDeadline((async () => {
    const cacheNames = typeof caches.keys === "function" ? await caches.keys() : [];
    const olderContentCaches = cacheNames
      .filter((name) => name.startsWith(CONTENT_CACHE_PREFIX) && name !== CONTENT_CACHE_NAME)
      .reverse();
    // Start the most recently created revision first. Each revision and each
    // key is independent, so one stalled disk read cannot hide a usable copy.
    return Promise.any(olderContentCaches.map(async (cacheName) => {
      const revision = cacheRevision(cacheName);
      const cache = await caches.open(cacheName);
      const candidates = new Set(revision ? [`${unversionedUrl}?rev=${revision}`, unversionedUrl] : [unversionedUrl]);
      return Promise.any([...candidates].map(async (candidate) => {
        const saved = await cache.match(candidate);
        if (!saved) throw new Error("Cached learning content is unavailable");
        // Reject invalid snapshots without deleting a key another page may
        // already have repaired. Promise.any observes late failures as well.
        return parseValidatedJson(saved.clone(), validate);
      }));
    }));
  })()).catch(() => null);
  // Healthy dedicated revisions retain priority over the older shell copy.
  return content !== null ? content : await oldShell;
}

async function rememberResponse(url: string, response: Response) {
  if (typeof caches === "undefined") {
    window.dispatchEvent?.(new Event(OFFLINE_CACHE_ERROR_EVENT));
    return false;
  }
  try {
    await withinCacheDeadline((async () => {
      const cache = await caches.open(CONTENT_CACHE_NAME);
      await cache.put(url, response);
    })());
  } catch {
    // Network content remains usable for this visit, but its offline save could not be confirmed in time. Read timeouts must not trigger this warning.
    window.dispatchEvent?.(new Event(OFFLINE_CACHE_ERROR_EVENT));
    return false;
  }
  // Content fingerprints have no release ordering. Another revision can
  // belong to a newer or still-open page, including an older page recreating
  // its cache after an upgrade. Only maintain this page's own revision.
  return true;
}

export async function fetchJsonWithRecovery<T>(url: string, validate: JsonValidator<T>) {
  const cached = await withinCacheDeadline(currentCachedJson(url, validate)).catch(() => null);
  if (cached !== null) return cached;

  // Keep a validated previous revision ready. On captive or unreachable Wi-Fi,
  // one short refresh attempt is enough before showing the usable offline copy.
  const fallback = await legacyCachedJson(url, validate);
  const retryDelays = fallback === null ? RETRY_DELAYS : [0] as const;

  let lastError: unknown = new Error("Learning content is unavailable");
  for (const delay of retryDelays) {
    if (delay) await wait(delay);
    if (typeof navigator !== "undefined" && navigator.onLine === false) break;

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), fallback === null ? DEFAULT_TIMEOUT : 3_000);
    try {
      const response = await fetch(url, { signal: controller.signal, cache: "no-cache" });
      if (!response.ok) throw new Error(`Learning content request failed: ${response.status}`);
      const cacheCopy = response.clone();
      const value = await parseValidatedJson(response, validate);
      // Wait until the validated pack is safely stored before reporting the
      // load as complete. Safari can suspend a freshly closed PWA before a
      // detached cache write finishes.
      await rememberResponse(url, cacheCopy);
      return value;
    } catch (error) {
      lastError = error;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  // An older cache is deliberately fallback-only. Promoting it to the current
  // cache would make a temporarily offline upgrade stay stale forever.
  if (fallback !== null) return fallback;
  throw lastError;
}
