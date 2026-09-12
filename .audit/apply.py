from pathlib import Path
import json
import shutil

p=Path('app/page.tsx')
s=p.read_text()
def replace(old,new):
    global s
    assert s.count(old)==1, f'Expected one source anchor: {old[:100]}'
    s=s.replace(old,new,1)
replace('loadSentencePack(pack).then((items) => [pack, items] as const)', '''loadSentencePack(pack).then((items) => {
      // Publish each usable pack without waiting for unrelated slow requests.
      if (active) setSentencePacks((current) => current[pack] === items ? current : { ...current, [pack]: items });
      return [pack, items] as const;
    })''')
replace('''        const loaded = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
        if (loaded.length) setSentencePacks((current) => ({ ...current, ...Object.fromEntries(loaded) }));
''','')
replace('  const sentenceLoading = requiredSentencePacks.some((pack) => !sentencePacks[pack]) && !sentenceLoadError;', '''  const sentenceLoading = requiredSentencePacks.some((pack) => !sentencePacks[pack]) && !sentenceLoadError;
  const sentenceSelectionLoading = !sentencePacks[SENTENCE_PACK_BY_BAND[sentenceBand]] && !sentenceLoadError;''')
replace('{sentenceLoading ? "正在加载…" : `${availableCount} 句可学`}', '{sentenceSelectionLoading ? "正在加载…" : `${availableCount} 句可学`}')
replace('disabled={sentenceLoading || availableCount === 0}', 'disabled={sentenceSelectionLoading || availableCount === 0}')
replace('<div className="sentence-result-list">{sentenceLoading ? <p>正在加载完整句库…</p> : filteredSentences.length ? <>', '<div className="sentence-result-list">{sentenceLoading && !filteredSentences.length ? <p role="status">正在加载完整句库…</p> : filteredSentences.length ? <>{sentenceLoading && <p className="browser-hint" role="status">其余句库仍在加载，先显示已载入的结果。</p>}')
p.write_text(s)

p=Path('app/content-loader.ts')
s=p.read_text()
a=s.index('async function legacyCachedJson<T>')
b=s.index('\nasync function removeLegacyCopies',a)
s=s[:a]+'''async function legacyCachedJson<T>(url: string, validate: JsonValidator<T>) {
  if (typeof caches === "undefined") return null;
  const unversionedUrl = url.replace(/[?#].*$/, "");
  let cacheNames: string[] = [];
  try {
    cacheNames = typeof caches.keys === "function" ? await caches.keys() : [];
  } catch {
    // The old shell fallback can still be readable when enumeration fails.
  }
  const olderContentCaches = cacheNames
    .filter((name) => name.startsWith(CONTENT_CACHE_PREFIX) && name !== CONTENT_CACHE_NAME)
    .reverse();
  for (const cacheName of olderContentCaches) {
    const revision = cacheRevision(cacheName);
    let cache: Cache;
    try {
      cache = await caches.open(cacheName);
    } catch {
      // A single damaged or unavailable cache must not hide other revisions.
      continue;
    }
    for (const candidate of new Set([revision ? `${unversionedUrl}?rev=${revision}` : "", unversionedUrl])) {
      if (!candidate) continue;
      let saved: Response | undefined;
      try {
        saved = await cache.match(candidate);
      } catch {
        continue;
      }
      if (!saved) continue;
      try {
        return await parseValidatedJson(saved.clone(), validate);
      } catch {
        await cache.delete(candidate).catch(() => false);
      }
    }
  }
  // Older shell workers cached data without a dedicated content-cache name.
  try {
    const saved = await caches.match(unversionedUrl);
    if (saved) return await parseValidatedJson(saved.clone(), validate);
  } catch {
    // Cache Storage may be unavailable; the network path can still work.
  }
  return null;
}
''' +s[b:]
p.write_text(s)
shutil.copyfile('.audit/cache-fault.test.mjs','tests/cache-fault-isolation.test.mjs')
shutil.copyfile('.audit/browser-network.mjs','scripts/browser-network.mjs')
p=Path('package.json')
data=json.loads(p.read_text())
assert data['scripts']['test:browser']=='node scripts/browser-smoke.mjs'
data['scripts']['test:browser']='node scripts/browser-smoke.mjs && node scripts/browser-network.mjs'
p.write_text(json.dumps(data,indent=2,ensure_ascii=False)+'\n')
p=Path('TESTING.md')
p.write_text(p.read_text()+'''\n## Partial network and cache faults\n\nThe browser command also runs `scripts/browser-network.mjs` in Chromium and WebKit. These isolated local-only scenarios hold unrelated sentence requests open and verify that already loaded search results remain usable, the selected loaded pack can start and resume, each newly returned pack appears before slower packs finish, and unfinished empty searches do not falsely claim no matches. Service Workers are blocked only in these request-interception tests; the existing offline-shell suite remains separate and unchanged.\n\nCache fault tests isolate failures in enumeration, opening a cache, reading one key and cleaning damaged JSON. Offline recovery must continue to other valid copies, while online learning remains usable if all cache storage fails. No learning records, IDs, backup keys or dependency versions are changed.\n''')
print('Applied incremental sentence loading and isolated cache fallback; storage schema unchanged.')
