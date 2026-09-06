export const CONTENT_REVISION = "v20";
const CONTENT_CACHE_PREFIX = "english-flow-content-";
const CONTENT_CACHE_NAME = `english-flow-content-${CONTENT_REVISION}`;
const DEFAULT_TIMEOUT = 8_000;
const RETRY_DELAYS = [0, 500, 1_500] as const;
const OFFLINE_CACHE_ERROR_EVENT = "english-flow-offline-cache-error";

type JsonValidator<T> = (value: unknown) => value is T;

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
}

async function parseValidatedJson<T>(response: Response, validate: JsonValidator<T>) {
  const value: unknown = await response.json();
  if (!validate(value)) throw new Error("Downloaded learning content is invalid");
  return value;
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
        await cache.delete(url);
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
  try {
    const cacheNames = typeof caches.keys === "function" ? await caches.keys() : [];
    const olderContentCaches = cacheNames
      .filter((name) => name.startsWith(CONTENT_CACHE_PREFIX) && name !== CONTENT_CACHE_NAME)
      .sort((left, right) => Number(right.match(/v(\d+)$/)?.[1] ?? -1) - Number(left.match(/v(\d+)$/)?.[1] ?? -1));
    for (const cacheName of olderContentCaches) {
      const revision = cacheName.match(/(v\d+)$/)?.[1];
      const cache = await caches.open(cacheName);
      for (const candidate of new Set([revision ? `${unversionedUrl}?rev=${revision}` : "", unversionedUrl])) {
        if (!candidate) continue;
        const saved = await cache.match(candidate);
        if (!saved) continue;
        try {
          return await parseValidatedJson(saved.clone(), validate);
        } catch {
          await cache.delete(candidate).catch(() => false);
        }
      }
    }
    // Older shell workers cached data without a dedicated content-cache name.
    const saved = await caches.match(unversionedUrl);
    if (saved) return await parseValidatedJson(saved.clone(), validate);
  } catch {
    // Cache Storage may be unavailable; the network path can still work.
  }
  return null;
}

async function removeLegacyCopies(url: string) {
  if (typeof caches === "undefined" || typeof caches.keys !== "function") return;
  const unversionedUrl = url.replace(/[?#].*$/, "");
  const cacheNames = await caches.keys();
  await Promise.all(cacheNames.filter((name) => name.startsWith(CONTENT_CACHE_PREFIX) && name !== CONTENT_CACHE_NAME).map(async (cacheName) => {
    const revision = cacheName.match(/(v\d+)$/)?.[1];
    const cache = await caches.open(cacheName);
    await Promise.all([...new Set([revision ? `${unversionedUrl}?rev=${revision}` : "", unversionedUrl])]
      .map((candidate) => candidate ? cache.delete(candidate).catch(() => false) : Promise.resolve(false)));
  }));
}

async function rememberResponse(url: string, response: Response) {
  if (typeof caches === "undefined") {
    window.dispatchEvent?.(new Event(OFFLINE_CACHE_ERROR_EVENT));
    return;
  }
  try {
    const cache = await caches.open(CONTENT_CACHE_NAME);
    await cache.put(url, response);
    await removeLegacyCopies(url);
  } catch {
    // Network content remains usable for this visit, but the UI should not
    // promise that an offline copy was saved when Cache Storage failed.
    window.dispatchEvent?.(new Event(OFFLINE_CACHE_ERROR_EVENT));
  }
}

export async function fetchJsonWithRecovery<T>(url: string, validate: JsonValidator<T>) {
  const cached = await currentCachedJson(url, validate);
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
