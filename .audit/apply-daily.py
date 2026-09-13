from pathlib import Path
import json

def replace_once(text, old, new):
    assert text.count(old) == 1, f'Expected exactly one occurrence: {old[:120]}'
    return text.replace(old, new, 1)

path = Path('app/content-loader.ts')
text = path.read_text()
text = replace_once(text, 'const DEFAULT_TIMEOUT = 8_000;', 'const DEFAULT_TIMEOUT = 8_000;\nconst CACHE_TIMEOUT = 2_000;')
helper = '''// Cache Storage has no AbortSignal. Bound each cache phase separately so a
// stalled disk read/write cannot block usable online content indefinitely.
// Promise.race observes late rejections too; timed-out operations are never
// treated as a confirmed offline save, and no learning records are touched.
async function withinCacheDeadline<T>(operation: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof window.setTimeout> | undefined;
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

'''
text = replace_once(text, 'async function parseValidatedJson<T>', helper + 'async function parseValidatedJson<T>')
text = replace_once(text, 'const cached = await currentCachedJson(url, validate);', 'const cached = await withinCacheDeadline(currentCachedJson(url, validate)).catch(() => null);')
text = replace_once(text, 'const fallback = await legacyCachedJson(url, validate);', 'const fallback = await withinCacheDeadline(legacyCachedJson(url, validate)).catch(() => null);')
text = replace_once(text, '    const cache = await caches.open(CONTENT_CACHE_NAME);\n    await cache.put(url, response);', '''    await withinCacheDeadline((async () => {
      const cache = await caches.open(CONTENT_CACHE_NAME);
      await cache.put(url, response);
    })());''')
text = replace_once(text, 'await removeLegacyCopies(url).catch(() => undefined);', 'await withinCacheDeadline(removeLegacyCopies(url)).catch(() => undefined);')
text = text.replace('it was not saved for\n    // offline use.', 'its offline save could not be confirmed in time.').replace('This is the only failure that should show the warning.', 'Read and cleanup timeouts must not trigger this warning.')
path.write_text(text)

path = Path('app/page.tsx')
text = path.read_text()
text = replace_once(text, 'event.key === "Enter" && !event.nativeEvent.isComposing', 'event.key === "Enter" && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229 && !event.repeat')
text = replace_once(text, 'ref={quizNextRef} className=', 'ref={quizNextRef} onKeyDown={(event) => { if (event.repeat && (event.key === "Enter" || event.key === " ")) event.preventDefault(); }} className=')
text = replace_once(text, '本次内容可以正常使用，但设备没有保存离线副本。', '本次内容可以正常使用，但离线副本暂未确认保存。')
path.write_text(text)

path = Path('package.json')
text = path.read_text()
text = replace_once(text, 'node scripts/browser-accessibility.mjs"', 'node scripts/browser-accessibility.mjs && node scripts/browser-daily.mjs"')
json.loads(text)
path.write_text(text)

path = Path('TESTING.md')
path.write_text(path.read_text() + '''

## Daily-use stability and stalled storage

`test:browser` also runs `scripts/browser-daily.mjs` in isolated Chromium and WebKit contexts. Scenarios cover legacy IME confirmation (`keyCode: 229`), repeated Enter, a separate intentional submit/advance, stalled cache reads/writes, 36 consecutive tab switches with delayed content, a complete ten-word learning/exam session with a paused draft and wrong-word-only retry, and a backup round-trip containing 2,000 word records and a year of study days.

The cache-stall runtime tests bound current-cache lookup, legacy lookup, offline write and old-copy cleanup separately. Successful ordinary writes remain awaited; a stalled write allows validated content for the current visit with an unconfirmed-offline-save warning. A housekeeping timeout never reports a saved pack as lost. Cache deadlines touch only public learning content, not localStorage records, backup formats or learning IDs. An older copy remains fallback-only.

IME and held-key cases inject browser keyboard events; they do not claim that a physical iPhone or OS input method was exercised. The new request/storage tests block Service Workers for isolation; the separate existing real-worker offline checks still run. Production dependency versions and Render configuration remain unchanged.
''')
print('Applied bounded cache phases and IME/held-key guards; no learning schema or locked dependency changes.')
