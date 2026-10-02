const buildEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
export const APP_BUILD_COMMIT = buildEnv?.VITE_ENGLISH_FLOW_BUILD_COMMIT || "local";

export function isPublishedVersion(value: unknown, origin: string): value is { commit: string } {
  if (!value || typeof value !== "object") return false;
  const info = value as Record<string, unknown>;
  return info.app === "english-flow" && info.title === "词流英语" && info.origin === origin
    && typeof info.commit === "string" && /^[0-9a-f]{40}$/.test(info.commit);
}

// Explicit updates must retain the current page until the returned document
// contains the same application entry required by the offline shell worker.
export function isAppDocument(document: Document, expectedCommit: string, origin: string) {
  if (!/^[0-9a-f]{40}$/.test(expectedCommit) || document.title !== "词流英语") return false;
  const identities = document.querySelectorAll('meta[name="english-flow-build"]');
  if (identities.length !== 1 || identities[0].getAttribute("content") !== expectedCommit) return false;
  const isEntry = (reference: string) => {
    try {
      const url = new URL(reference, origin);
      return url.origin === origin && url.pathname.startsWith("/assets/") && url.pathname.endsWith(".js");
    } catch { return false; }
  };
  return [...document.querySelectorAll("script")].some((script) => {
    const type = (script.getAttribute("type") || "").toLowerCase();
    if (!["", "module", "text/javascript", "application/javascript"].includes(type)) return false;
    const src = script.getAttribute("src");
    if (src !== null) return isEntry(src);
    const entry = (script.textContent || "").trim().match(/^import\s*\(\s*["']([^"']+)["']\s*\)\s*;?$/);
    return Boolean(entry && isEntry(entry[1]));
  });
}

export function versionReloadUrl(href: string, commit: string) {
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error("Invalid release identity");
  const url = new URL(href);
  url.searchParams.set("ef-update", commit);
  return url.href;
}

// Older installed workers use cache-first for fetch() even with no-store.
// A unique URL for each explicit attempt lets their next retry reach the server.
export function versionPreflightUrl(href: string, commit: string, nonce: string) {
  if (!/^[a-z0-9-]{1,128}$/i.test(nonce)) throw new Error("Invalid update attempt identity");
  const url = new URL(versionReloadUrl(href, commit));
  url.searchParams.set("ef-preflight", nonce);
  return url.href;
}

// Read-only verification. A dismissed storage warning must never allow a
// reload to discard newer in-memory work. Missing empty records are equivalent.
export function isSnapshotPersisted(storage: Pick<Storage, "getItem">, snapshot: Record<string, unknown>) {
  try {
    return Object.entries(snapshot).every(([key, value]) => {
      const raw = storage.getItem(key);
      if (raw === null) return value == null || (typeof value === "object" && Object.keys(value as object).length === 0);
      return JSON.stringify(JSON.parse(raw)) === JSON.stringify(value);
    });
  } catch {
    return false;
  }
}
