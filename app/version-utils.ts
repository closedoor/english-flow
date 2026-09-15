const buildEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
export const APP_BUILD_COMMIT = buildEnv?.VITE_ENGLISH_FLOW_BUILD_COMMIT || "local";

export function isPublishedVersion(value: unknown, origin: string): value is { commit: string } {
  if (!value || typeof value !== "object") return false;
  const info = value as Record<string, unknown>;
  return info.app === "english-flow" && info.title === "词流英语" && info.origin === origin
    && typeof info.commit === "string" && /^[0-9a-f]{40}$/.test(info.commit);
}

export function versionReloadUrl(href: string, commit: string) {
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error("Invalid release identity");
  const url = new URL(href);
  url.searchParams.set("ef-update", commit);
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
