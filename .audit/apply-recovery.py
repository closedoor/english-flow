from pathlib import Path
import json
import shutil

p = Path('app/page.tsx')
s = p.read_text()
def replace_once(old, new):
    global s
    assert s.count(old) == 1, f'Expected exactly one match: {old[:100]}'
    s = s.replace(old, new, 1)
replace_once('''    import("./sentence-data").then(({ loadSentencePack }) => Promise.allSettled(packs.map((pack) => loadSentencePack(pack).then((items) => {
      // Publish each usable pack without waiting for unrelated slow requests.
      if (active) setSentencePacks((current) => current[pack] === items ? current : { ...current, [pack]: items });
      return [pack, items] as const;
    }))))''', '''    import("./sentence-data").then(({ loadSentencePack }) => {
      if (!active) return [];
      setSentenceLoadError(false);
      return Promise.allSettled(packs.map((pack) => loadSentencePack(pack).then((items) => {
        // Publish each usable pack without waiting for unrelated slow requests.
        if (active) setSentencePacks((current) => current[pack] === items ? current : { ...current, [pack]: items });
        return [pack, items] as const;
      })));
    })''')
replace_once('  const sentenceLoading = requiredSentencePacks.some((pack) => !sentencePacks[pack]) && !sentenceLoadError;', '''  // Request failure does not establish that a search or saved list is empty.
  const sentencePacksIncomplete = requiredSentencePacks.some((pack) => !sentencePacks[pack]);
  const sentenceLoading = sentencePacksIncomplete && !sentenceLoadError;''')
replace_once('  const openSentenceBrowser = (savedOnly: boolean, reviewOnly = false) => {', '''  const retrySentenceContent = () => {
    setSentenceLoadError(false);
    setSentenceLoadAttempt((attempt) => attempt + 1);
  };

  const openSentenceBrowser = (savedOnly: boolean, reviewOnly = false) => {''')
replace_once('''      {sentenceLoadError && <div className="sentence-load-error" role="alert"><span>{networkOnline ? "部分句库尚未载入，已显示可用内容。重新载入页面可恢复缺少的数据。" : "当前处于离线状态，已缓存的句子仍可使用；联网后会自动补全。"}</span><button onClick={() => window.location.reload()}>重新载入页面</button></div>}''', '''      {sentenceLoadError && sentencePacksIncomplete && <div className="sentence-load-error" role="alert"><span>{networkOnline ? "部分句库尚未载入，已有内容和本机记录仍保留。可以先重试；仍失败时再重新载入页面。" : "当前处于离线状态，已缓存的句子仍可使用；联网后会自动补全。"}</span><div className="sentence-load-actions"><button onClick={retrySentenceContent}>重试缺少的句库</button><button onClick={() => window.location.reload()}>重新载入页面</button></div></div>}''')
replace_once('''{sentenceSelectionLoading ? "正在加载…" : `${availableCount} 句可学`}''', '''{sentenceSelectionLoading ? "正在加载…" : !sentencePacks[SENTENCE_PACK_BY_BAND[sentenceBand]] ? "句库未载入" : `${availableCount} 句可学`}''')
replace_once('''<small>{sentenceSavedOnly || sentenceReviewOnly ? `${filteredSentences.length} 句` : sentenceSearch ? `${filteredSentences.length} 个结果` : "支持中英文"}</small></div>''', '''<small>{sentenceSavedOnly || sentenceReviewOnly ? `${sentencePacksIncomplete ? "已载入 " : ""}${filteredSentences.length} 句` : sentenceSearch ? `${sentencePacksIncomplete ? "已载入 " : ""}${filteredSentences.length} 个结果` : "支持中英文"}</small></div>''')
replace_once('''{sentenceLoading && !filteredSentences.length ? <p role="status">正在加载完整句库…</p> : filteredSentences.length ? <>{sentenceLoading && <p className="browser-hint" role="status">其余句库仍在加载，先显示已载入的结果。</p>}''', '''{sentencePacksIncomplete && !filteredSentences.length ? <p role="status">{sentenceLoading ? "正在加载完整句库…" : sentenceSavedOnly ? "收藏记录仍保留，相关句库尚未载入。请重试缺少的句库。" : sentenceReviewOnly ? "待加强记录仍保留，相关句库尚未载入。请重试缺少的句库。" : "句库尚未完整载入，暂时无法确认是否有匹配句子。请重试缺少的句库。"}</p> : filteredSentences.length ? <>{sentencePacksIncomplete && <p className="browser-hint" role="status">{sentenceLoading ? "其余句库仍在加载，先显示已载入的结果。" : "部分句库未载入，当前仅显示已载入的结果。"}</p>}''')
replace_once('''<p className="sentence-result-count">已显示 {Math.min(sentenceResultLimit, filteredSentences.length)} / {filteredSentences.length} 句</p>''', '''<p className="sentence-result-count">已显示 {Math.min(sentenceResultLimit, filteredSentences.length)} / {sentencePacksIncomplete ? "已载入 " : ""}{filteredSentences.length} 句</p>''')
p.write_text(s)
with Path('app/globals.css').open('a') as f:
    f.write('''\n/* Keep recovery and reload choices reachable on narrow phones. */
.sentence-load-error{flex-wrap:wrap}
.sentence-load-error>span{flex:1 1 220px}
.sentence-load-actions{display:flex;flex-wrap:wrap;gap:8px;max-width:100%}
.sentence-load-actions button{white-space:normal;min-height:44px;flex:1 1 auto}
''')
shutil.copyfile('.audit/browser-recovery.mjs', 'scripts/browser-recovery.mjs')
p = Path('package.json')
pkg = json.loads(p.read_text())
pkg['scripts']['test:browser'] += ' && node scripts/browser-recovery.mjs'
p.write_text(json.dumps(pkg, ensure_ascii=False, indent=2) + '\n')
with Path('TESTING.md').open('a') as f:
    f.write('''\n\n## Failed requests and in-page recovery\n\n`test:browser` also runs `scripts/browser-recovery.mjs` in Chromium and WebKit. Local request interception rejects missing sentence packs and verifies that search, favorites and reinforcement lists do not claim definitive absence; partial result counts disclose their coverage; retry preserves the document, query and learning records; and already loaded practice still resumes after reload. Complete genuinely empty searches and returning to a loaded selection remain covered. Recovery controls are checked at 320 CSS pixels. The full-document reload action remains available for cached dynamic-import failures. These tests use synthetic records, never the production site's storage. No learning identifiers, local-storage keys, backup format or locked dependency versions change.\n''')
print('Applied truthful incomplete-list states and non-destructive in-page retry.')
