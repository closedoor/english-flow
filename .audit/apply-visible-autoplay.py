from pathlib import Path
import re

def once(s,a,b):
    assert s.count(a)==1, f'Expected one target: {a[:100]} ({s.count(a)})'
    return s.replace(a,b,1)
p=Path('scripts/build-render.mjs');s=p.read_text();s=once(s,'import { spawn }','import { resolveBuildCommit } from "./write-build-info.mjs";\nimport { spawn }');s=once(s,'    VITE_ENGLISH_FLOW_CONTENT_REVISION: contentRevision,','    VITE_ENGLISH_FLOW_CONTENT_REVISION: contentRevision,\n    VITE_ENGLISH_FLOW_BUILD_COMMIT: await resolveBuildCommit({ env: baseEnv }),');p.write_text(s)
p=Path('app/layout.tsx');s=once(p.read_text(),'import "./globals.css";', 'import "./globals.css";\nimport { APP_BUILD_COMMIT } from "./version-utils";');s=once(s,'  title: "词流英语",','  title: "词流英语",\n  other: { "english-flow-build": APP_BUILD_COMMIT },');p.write_text(s)
p=Path('app/page.tsx');s=p.read_text();s=once(s,'import { useEffect, useMemo, useRef, useState } from "react";','import { useEffect, useMemo, useRef, useState } from "react";\nimport VersionNotice from "./version-notice";\nimport { APP_BUILD_COMMIT, isSnapshotPersisted } from "./version-utils";')
s=once(s,'navigator.serviceWorker.register("/sw.js")','navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" })')
# Preserve the existing export implementation/test seam; share its exact snapshot
# field list in the read-only reload guard, never rewrite learning records.
start=s.index('      const snapshot: Record<StorageKey, unknown> = {',s.index('  const exportLearningBackup ='))
end=s.index('\n      };',start)+len('\n      };')
snapshot=s[start:end].replace('      ','    ',1)
guard='''  const canReloadForUpdate = () => {
    if (!hydrated || tab !== "progress" || hasOpenDialog || backupBusy || externalUpdateDetected || storageWriteError) return false;
SNAPSHOT
    try { return isSnapshotPersisted(window.localStorage, snapshot); } catch { return false; }
  };

'''.replace('SNAPSHOT',snapshot)
s=once(s,'  const exportLearningBackup = async () => {',guard+'  const exportLearningBackup = async () => {')
s=once(s,'    {tab === "home" ? renderHome()', '    <VersionNotice showDetails={tab === "progress"} beforeReload={canReloadForUpdate} />\n    {tab === "home" ? renderHome()')
s=once(s,'    wordExampleStartedRef.current = `${word.id}:${word.example}`;','    setSpeechNotice(null);\n    wordExampleStartedRef.current = `${word.id}:${word.example}`;')
s=once(s,'  const replayWordExample = () => {\n    if (!current || document.hidden) return;', '  const replayWordExample = () => {\n    if (!current || document.hidden) return;\n    setSpeechNotice(null);')
s=once(s,'onClick={() => hasOngoingSession ? setTab("learn") : startSession()}', 'onClick={handleHomeStudyClick}')
s=once(s,'  const renderHome = () => (', '  const handleHomeStudyClick = () => {\n    if (hasOngoingSession) { if (learnStage === "cards") playAutomaticWordExample(current); setTab("learn"); } else startSession();\n  };\n\n  const renderHome = () => (')
s=once(s,'onClick={() => setTab(item.id)}', 'onClick={() => { if (item.id === "learn" && tab !== "learn" && learnStage === "cards") playAutomaticWordExample(current); setTab(item.id); }}')
# Put controls before the large word card, where they are actually discoverable
# on an iPhone. Scope is still NGSL grouped learning, never a quiz answer.
start=s.index('  const renderCards =');end=s.index('  const renderQuiz =',start)
part=s[start:end]
match=re.search(r'      \{sessionPath === "frequency" && wordSessionKind === "group" && .*?\n',part)
assert match, 'Autoplay controls found'
controls=match.group(0)
part=part[:match.start()]+part[match.end():]
controls=controls.replace('切换词卡后自动朗读例句三遍。刷新后若没有声音，点一次“重播三遍”。手动播放会结束当前自动朗读。','翻卡自动读三遍；手动播放会中断。').replace('</div>}','<small className="word-auto-build">例句三遍版 · {APP_BUILD_COMMIT.slice(0, 7)}</small></div>}')
part=once(part,'      <div className="word-card"',controls+'      <div className="word-card"')
s=s[:start]+part+s[end:];p.write_text(s)
p=Path('public/sw.js');s=p.read_text();needle='  if (event.request.mode === "navigate") {';s=once(s,needle,'''  // Version probes must describe the server, never the worker's old cache.
  if (url.pathname === "/build-info.json") {
    event.respondWith(fetch(event.request, { cache: "no-store" }).catch(() => Response.error()));
    return;
  }

'''+needle);s=once(s,'const response = await fetchWithTimeout(event.request, NAVIGATION_TIMEOUT);','const response = await fetchWithTimeout(event.request, url.searchParams.has("ef-update") ? 12_000 : NAVIGATION_TIMEOUT);');p.write_text(s)
p=Path('app/globals.css');p.write_text(p.read_text()+'''\n/* Version identity belongs to the running bundle, not cached server metadata. */
.app-version-panel{margin:12px 20px;padding:14px 16px;border:1px solid #c9d8d3;border-radius:16px;background:#edf7f4;color:#19382f;font-size:13px}
.app-version-panel p{margin:6px 0;line-height:1.6}.app-version-panel small{display:block;line-height:1.6}
.app-version-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
.app-version-actions button{min-height:44px;padding:8px 12px;border-radius:10px;background:#fff;border:1px solid #9eb8ad;font-weight:600;color:#184d3c}
.app-version-actions button:disabled{opacity:.55}.word-auto-build{display:block;font-size:11px;color:#526779;margin-top:4px}
.learn-page>.word-auto-controls{margin:8px 0 14px}
''')
p=Path('package.json');s=once(p.read_text(),'node scripts/browser-autoplay.mjs"','node scripts/browser-autoplay.mjs && node scripts/browser-version.mjs"');p.write_text(s)
print('Applied version-visible NGSL autoplay, synchronous resume and safe version checks; records and lockfile unchanged.')
