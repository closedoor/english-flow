const CACHE_PREFIX = "wordflow-ngsl-";
// The production build replaces this value with a fingerprint of its files.
const BUILD_REVISION = "local";
const BUILD_COMMIT = "local";
const CACHE = `${CACHE_PREFIX}v34-${BUILD_REVISION}`;
const STAGING_CACHE = `${CACHE}-staging`;
const OPTIONAL_CACHE_TIMEOUT = 8000;
const NAVIGATION_TIMEOUT = 3000;
const RUNTIME_CACHE_TIMEOUT = 2000;
const MAX_SHELL_ASSETS = 128;
const CORE_SHELL = [
  "/",
  "/manifest.webmanifest",
  "/favicon.ico",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
];

function isEnglishAppDocumentPath(pathname) {
  return pathname === "/" || pathname === "/index.html";
}

// Cache Storage has no AbortSignal. Bound runtime reads and writes separately
// so a stalled disk operation cannot hold a usable network response forever.
// Promise.race observes late rejections; an expired read is never served later.
// Installation still requires the complete staged shell before activation.
async function withinRuntimeCacheDeadline(operation) {
  let timeout;
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Runtime cache operation timed out")), RUNTIME_CACHE_TIMEOUT);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

async function safeCacheMatch(request) {
  try {
    return await withinRuntimeCacheDeadline((async () => {
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
    })());
  } catch {
    return undefined;
  }
}

function responseMatchesRequest(request, response) {
  const value = request instanceof Request ? request.url : String(request);
  const pathname = new URL(value, self.location.origin).pathname.toLowerCase();
  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  if (!contentType) return !(
    isEnglishAppDocumentPath(pathname)
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
  if (isEnglishAppDocumentPath(pathname)) return contentType.includes("text/html");
  return true;
}

function htmlAttribute(tag, name) {
  const match = tag.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"));
  return match ? match[1] ?? match[2] : null;
}

function isAppShellHtml(source, expectedCommit = null) {
  const html = source.replace(/<!--[\s\S]*?-->/g, "");
  if (html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1].trim() !== "词流英语") return false;
  const identity = [...html.matchAll(/<meta\b[^>]*>/gi)]
    .map(([tag]) => ({ name: htmlAttribute(tag, "name"), content: htmlAttribute(tag, "content") }))
    .filter((tag) => tag.name === "english-flow-build");
  if (identity.length !== 1 || !/^[0-9a-f]{40}$/.test(identity[0].content || "")) return false;
  if (/^[0-9a-f]{40}$/.test(expectedCommit || "") && identity[0].content !== expectedCommit) return false;
  const isEntry = (reference) => {
    try {
      const url = new URL(reference, self.location.origin);
      return url.origin === self.location.origin && url.pathname.startsWith("/assets/") && url.pathname.endsWith(".js");
    } catch { return false; }
  };
  return [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)].some(([, attributes, body]) => {
    const type = (htmlAttribute(attributes, "type") || "").toLowerCase();
    if (!["", "module", "text/javascript", "application/javascript"].includes(type)) return false;
    const src = htmlAttribute(attributes, "src");
    if (src !== null) return isEntry(src);
    const entry = body.trim().match(/^import\s*\(\s*["']([^"']+)["']\s*\)\s*;?$/);
    return Boolean(entry && isEntry(entry[1]));
  });
}

async function validateAppDocument(request, response, expectedCommit = null) {
  if (!response.ok || !responseMatchesRequest(request, response)
    || (response.url && new URL(response.url).origin !== self.location.origin)
    || !isAppShellHtml(await response.clone().text(), expectedCommit)) {
    throw new Error("Unable to cache the app shell: invalid application document");
  }
}

// Some static hosts label .webmanifest as binary/octet-stream. Do not reject
// a whole release for that header alone, and never accept an HTML error page.
// Only the exact application manifest gets this validated MIME repair.
async function normalizeManifestResponse(request, response) {
  if (!response || response.status !== 200) return response;
  const value = request instanceof Request ? request.url : String(request);
  const url = new URL(value, self.location.origin);
  const contentType = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (url.origin !== self.location.origin || url.pathname !== "/manifest.webmanifest"
    || !["binary/octet-stream", "application/octet-stream"].includes(contentType)) return response;
  try {
    const text = await response.clone().text();
    if (text.length > 64_000) return response;
    const manifest = JSON.parse(text);
    if (!manifest || manifest.name !== "词流英语" || manifest.start_url !== "/" || manifest.scope !== "/"
      || !Array.isArray(manifest.icons) || manifest.icons.length < 2
      || !manifest.icons.every((icon) => icon && typeof icon.src === "string" && new URL(icon.src, url).origin === self.location.origin)) return response;
    const headers = Object.fromEntries(response.headers.entries());
    headers["content-type"] = "application/manifest+json; charset=utf-8";
    delete headers["content-encoding"];
    delete headers["content-length"];
    return new Response(text, { status: response.status, statusText: response.statusText, headers });
  } catch {
    return response;
  }
}

async function fetchAndCache(request, timeoutMs = 0) {
  const controller = timeoutMs ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await normalizeManifestResponse(request, await fetch(request, controller ? { signal: controller.signal } : undefined));
    const url = new URL(request instanceof Request ? request.url : String(request), self.location.origin);
    if (isEnglishAppDocumentPath(url.pathname)) await validateAppDocument(request, response);
    // The network deadline must not abort an obtained response merely because
    // its optional disk copy is slow. Reads and writes have their own limits.
    if (timeout) clearTimeout(timeout);
    if (response.ok && responseMatchesRequest(request, response)) {
      try {
        const cacheCopy = response.clone();
        await withinRuntimeCacheDeadline((async () => {
          const cache = await caches.open(CACHE);
          await cache.put(request, cacheCopy);
        })());
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
    let response = await normalizeManifestResponse(url, await cache.match(url));
    if (response && !responseMatchesRequest(url, response)) {
      await cache.delete(url);
      response = undefined;
    }
    if (!response) {
      try {
        response = await normalizeManifestResponse(url, await fetchCompleteWithTimeout(url, OPTIONAL_CACHE_TIMEOUT));
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
    if (isEnglishAppDocumentPath(pathname)) {
      try { await validateAppDocument(url, response); }
      catch (error) { if (tolerateFailures) continue; throw error; }
    }
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
    const pageResponse = await fetchWithTimeout("/", NAVIGATION_TIMEOUT, BUILD_COMMIT);
    if (!pageResponse.ok || !responseMatchesRequest("/", pageResponse)) throw new Error("Unable to cache the app shell");
    const html = await pageResponse.clone().text();
    const discoveredAssets = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
      .map((match) => {
        try { return new URL(match[1], self.location.origin); } catch { return null; }
      })
      .filter((url) => url && url.origin === self.location.origin && !url.pathname.startsWith("/data/"))
      .map((url) => url.href);
    await cache.put("/", pageResponse);
    await cacheCompleteBuildGraph(cache, [...CORE_SHELL.filter((url) => url !== "/"), ...discoveredAssets,
      ...referencedBuildAssets(html, self.location.origin)]);
  } catch (error) {
    try { await caches.delete(STAGING_CACHE); } catch { /* A later install can overwrite staging. */ }
    throw error;
  }
}

async function promoteStagedShell() {
  const cacheNames = await caches.keys();
  if (!cacheNames.includes(STAGING_CACHE)) throw new Error("Staged app shell is missing");
  const staging = await caches.open(STAGING_CACHE);
  const requests = await staging.keys();
  if (!requests.length) throw new Error("Staged app shell is empty");
  const documentRequest = requests.find((request) => new URL(request.url).pathname === "/" && !new URL(request.url).search);
  const documentResponse = documentRequest && await staging.match(documentRequest);
  if (!documentResponse) throw new Error("Staged app shell document is missing");
  await validateAppDocument(documentRequest, documentResponse, BUILD_COMMIT);
  const target = await caches.open(CACHE);
  try {
    // Publish the document last. A failed copy must leave offline navigation
    // on the previous complete shell, never a new page with missing chunks.
    for (const request of requests.filter((request) => request !== documentRequest)) {
      const response = await staging.match(request);
      if (!response) throw new Error(`Missing staged response for ${request.url}`);
      await target.put(request, response);
    }
    await target.put(documentRequest, documentResponse);
  } catch (error) {
    // Keep an existing same-revision cache intact: this attempt has not
    // published its document. Remove only a target created by this promotion.
    if (!cacheNames.includes(CACHE)) {
      try { await caches.delete(CACHE); } catch { /* No incomplete document was published. */ }
    }
    throw error;
  }
  await caches.delete(STAGING_CACHE);
}

async function deleteOldShellCaches() {
  try {
    const keys = await caches.keys();
    // A newer worker can install while this worker is still activating. Its
    // staging cache is incomplete and belongs to that separate install job.
    await Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE && !key.endsWith("-staging")).map((key) => caches.delete(key)));
  } catch {
    // Keeping an older shell is safer than blocking activation.
  }
}

// The install/warm graph needs a complete resource before it can cache or
// inspect it. Bound the whole fetch and clone read, including responses whose
// streams do not settle when aborted. Ordinary runtime responses still stream.
async function fetchCompleteWithTimeout(request, timeoutMs) {
  const controller = new AbortController();
  let timeout;
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(request, { signal: controller.signal });
        await response.clone().arrayBuffer();
        return response;
      })(),
      new Promise((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new Error("App resource request timed out"));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

async function fetchWithTimeout(request, timeoutMs, documentCommit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(request, { signal: controller.signal });
    if (documentCommit !== undefined
      && isEnglishAppDocumentPath(new URL(request instanceof Request ? request.url : String(request), self.location.origin).pathname)) {
      await validateAppDocument(request, response, documentCommit);
    }
    return response;
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

  // Version probes must describe the server, never the worker's old cache.
  if (url.pathname === "/build-info.json") {
    event.respondWith(fetch(event.request, { cache: "no-store" }).catch(() => Response.error()));
    return;
  }

  // Explicit update preflights describe the live server. Never cache them or
  // reuse a failed/stale query entry left by a previously installed worker.
  if (isEnglishAppDocumentPath(url.pathname) && url.searchParams.has("ef-update") && event.request.mode !== "navigate") {
    event.respondWith(fetch(event.request, { cache: "no-store" }).catch(() => Response.error()));
    return;
  }

  if (event.request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        // Only a completed install may replace the offline document. A network
        // navigation can arrive before its new hashed scripts are downloaded.
        const response = await fetchWithTimeout(event.request, url.searchParams.has("ef-update") ? 12_000 : NAVIGATION_TIMEOUT, null);
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
