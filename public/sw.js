const CACHE_PREFIX = "wordflow-ngsl-";
// The production build replaces this value with a fingerprint of its files.
const BUILD_REVISION = "local";
const CACHE = `${CACHE_PREFIX}v34-${BUILD_REVISION}`;
const STAGING_CACHE = `${CACHE}-staging`;
const OPTIONAL_CACHE_TIMEOUT = 8000;
const NAVIGATION_TIMEOUT = 3000;
const MAX_SHELL_ASSETS = 128;
const CORE_SHELL = [
  "/",
  "/manifest.webmanifest",
  "/favicon.ico",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
];

async function safeCacheMatch(request) {
  try {
    const active = await caches.open(CACHE);
    const current = await active.match(request);
    if (current) return current;
    // Staging is deliberately incomplete until installation succeeds. Never
    // serve its document as an offline fallback while an update is downloading.
    for (const name of await caches.keys()) {
      if (name === CACHE || name.endsWith("-staging")) continue;
      const cached = await (await caches.open(name)).match(request);
      if (cached) return cached;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function responseMatchesRequest(request, response) {
  const value = request instanceof Request ? request.url : String(request);
  const pathname = new URL(value, self.location.origin).pathname.toLowerCase();
  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  if (!contentType) return !(
    pathname === "/"
    || pathname.endsWith(".js")
    || pathname.endsWith(".css")
    || pathname.endsWith(".png")
    || pathname.endsWith(".ico")
    || pathname.endsWith(".webmanifest")
  );
  if (pathname.endsWith(".js")) return /(?:java|ecma)script/.test(contentType);
  if (pathname.endsWith(".css")) return contentType.includes("text/css");
  if (pathname.endsWith(".png")) return contentType.includes("image/png");
  if (pathname.endsWith(".ico")) return contentType.includes("image/") || contentType.includes("application/octet-stream");
  if (pathname.endsWith(".webmanifest")) return contentType.includes("json") || contentType.includes("manifest");
  if (pathname === "/") return contentType.includes("text/html");
  return true;
}

async function fetchAndCache(request, timeoutMs = 0) {
  const controller = timeoutMs ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetch(request, controller ? { signal: controller.signal } : undefined);
    if (response.ok && responseMatchesRequest(request, response)) {
      try {
        const cache = await caches.open(CACHE);
        await cache.put(request, response.clone());
      } catch {
        // A usable network response must not be discarded when Cache Storage
        // is blocked, corrupt or out of space.
      }
    }
    return response;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function referencedBuildAssets(source, baseUrl) {
  return [...source.matchAll(/["'`]((?:\.{0,2}\/|\/|assets\/)[^"'`\s]+?\.(?:js|css)(?:\?[^"'`\s]*)?)["'`]/g)]
    .map((match) => {
      try {
        const reference = match[1].startsWith("assets/") ? `/${match[1]}` : match[1];
        return new URL(reference, baseUrl);
      } catch {
        return null;
      }
    })
    .filter((url) => url && url.origin === self.location.origin && url.pathname.startsWith("/assets/"))
    .map((url) => url.href);
}

async function cacheCompleteBuildGraph(cache, initialUrls, tolerateFailures = false) {
  const queued = [...new Set(initialUrls)];
  const visited = new Set();
  while (queued.length) {
    const url = queued.shift();
    if (!url || visited.has(url)) continue;
    visited.add(url);
    if (visited.size > MAX_SHELL_ASSETS) throw new Error("App shell contains too many assets");
    let response = await cache.match(url);
    if (response && !responseMatchesRequest(url, response)) {
      await cache.delete(url);
      response = undefined;
    }
    if (!response) {
      try {
        response = await fetchWithTimeout(url, OPTIONAL_CACHE_TIMEOUT);
      } catch (error) {
        if (tolerateFailures) continue;
        throw error;
      }
    }
    if (!response.ok || !responseMatchesRequest(url, response)) {
      if (tolerateFailures) continue;
      throw new Error(`Unable to cache ${url}`);
    }
    const pathname = new URL(url, self.location.origin).pathname;
    if (pathname.endsWith(".js") || pathname.endsWith(".css")) {
      const source = await response.clone().text();
      for (const dependency of referencedBuildAssets(source, url)) {
        if (!visited.has(dependency) && !queued.includes(dependency)) queued.push(dependency);
      }
    }
    if (!(await cache.match(url))) await cache.put(url, response);
  }
}

async function installCompleteShell() {
  try {
    await caches.delete(STAGING_CACHE);
    const cache = await caches.open(STAGING_CACHE);
    const pageResponse = await fetchWithTimeout("/", NAVIGATION_TIMEOUT);
    if (!pageResponse.ok || !responseMatchesRequest("/", pageResponse)) throw new Error("Unable to cache the app shell");
    const html = await pageResponse.clone().text();
    const discoveredAssets = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
      .map((match) => {
        try { return new URL(match[1], self.location.origin); } catch { return null; }
      })
      .filter((url) => url && url.origin === self.location.origin && !url.pathname.startsWith("/data/"))
      .map((url) => url.href);
    await cache.put("/", pageResponse);
    await cacheCompleteBuildGraph(cache, [...CORE_SHELL.filter((url) => url !== "/"), ...discoveredAssets]);
  } catch (error) {
    try { await caches.delete(STAGING_CACHE); } catch { /* A later install can overwrite staging. */ }
    throw error;
  }
}

async function promoteStagedShell() {
  const cacheNames = await caches.keys();
  if (!cacheNames.includes(STAGING_CACHE)) return;
  const staging = await caches.open(STAGING_CACHE);
  const requests = await staging.keys();
  if (!requests.length) throw new Error("Staged app shell is empty");
  const target = await caches.open(CACHE);
  for (const request of requests) {
    const response = await staging.match(request);
    if (!response) throw new Error(`Missing staged response for ${request.url}`);
    await target.put(request, response);
  }
  await caches.delete(STAGING_CACHE);
}

async function deleteOldShellCaches() {
  try {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE).map((key) => caches.delete(key)));
  } catch {
    // Keeping an older shell is safer than blocking activation.
  }
}

async function fetchWithTimeout(request, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(request, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

self.addEventListener("install", (event) => {
  // Large learning packs remain lazy, while the HTML and every critical
  // script/style it references are committed before this worker takes over.
  // Let an existing worker keep controlling already-open pages until they
  // close, so their older lazy chunks remain available as one coherent app.
  event.waitUntil(installCompleteShell());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    await promoteStagedShell();
    await deleteOldShellCaches();
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "CACHE_URLS" || !Array.isArray(event.data.urls)) return;
  const urls = [...new Set(event.data.urls)].filter((url) => {
    try {
      const parsed = new URL(url, self.location.origin);
      return parsed.origin === self.location.origin && !parsed.pathname.startsWith("/data/");
    } catch {
      return false;
    }
  }).slice(0, MAX_SHELL_ASSETS);
  event.waitUntil(
    caches.open(CACHE).then((cache) => cacheCompleteBuildGraph(cache, urls, true)).catch(() => undefined)
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        // Only a completed install may replace the offline document. A network
        // navigation can arrive before its new hashed scripts are downloaded.
        const response = await fetchWithTimeout(event.request, NAVIGATION_TIMEOUT);
        if (response.ok && responseMatchesRequest(event.request, response)) return response;
        return (await safeCacheMatch(event.request)) || (await safeCacheMatch("/")) || response;
      } catch {
        return (await safeCacheMatch(event.request)) || (await safeCacheMatch("/")) || Response.error();
      }
    })());
    return;
  }

  if (url.pathname.startsWith("/data/")) {
    event.respondWith((async () => {
      try {
        const response = await fetchWithTimeout(event.request, OPTIONAL_CACHE_TIMEOUT);
        if (response.ok) return response;
        return (await safeCacheMatch(event.request)) || response;
      } catch {
        return (await safeCacheMatch(event.request)) || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await safeCacheMatch(event.request);
    if (cached) return cached;
    try {
      return await fetchAndCache(event.request, OPTIONAL_CACHE_TIMEOUT);
    } catch {
      return Response.error();
    }
  })());
});
