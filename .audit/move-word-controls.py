from pathlib import Path

def once(text, old, new):
    assert text.count(old) == 1, (old[:100], text.count(old))
    return text.replace(old, new, 1)

p=Path('app/page.tsx'); s=p.read_text()
start=s.index('  const renderCards ='); end=s.index('  const renderQuiz =',start)
part=s[start:end]
a=part.index('      {sessionPath === "frequency" && wordSessionKind === "group" && <div className="word-auto-controls">')
b=part.index('      <div className="word-card"',a)
controls=part[a:b]
part=part[:a]+part[b:]
a=part.index('      <div className="sentence-pager"')
b=part.index('    </section>',a)
main_controls=part[a:b]
part=part[:a]+'      <div className="word-card-actions">\n'+main_controls+'      </div>\n'+controls+part[b:]
s=s[:start]+part+s[end:]; p.write_text(s)
p=Path('app/globals.css');s=p.read_text()
s=once(s,'.learn-page>.word-auto-controls{margin:8px 0 14px}', '.learn-page>.word-auto-controls{margin:16px 0 0;padding-top:12px;border-top:1px solid var(--line)}')
s+='''

/* Keep repeated study actions reachable; secondary audio settings follow them.
   clip avoids an unscrollable overflow:hidden ancestor trapping sticky controls.
   The toolbar stays in normal flow so long text/settings can scroll fully clear. */
@media (max-width:699px) and (min-height:451px) {
  .phone-stage:has(.learn-page){overflow-x:clip;overflow-y:visible}
  .learn-page>.word-card{min-height:0;padding:18px}
  .learn-page .word-heading{padding:20px 0 18px}
  .learn-page .card-section{padding:12px 2px}
  .learn-page>.word-card-actions{position:sticky;bottom:calc(74px + env(safe-area-inset-bottom));z-index:10;margin-top:10px;padding:8px 0 10px;background:var(--paper);border-top:1px solid var(--line)}
  .word-card-actions>.sentence-pager{margin:0 0 8px}
  .word-card-actions button{min-height:48px}
}
'''; p.write_text(s)
p=Path('scripts/browser-autoplay.mjs');s=p.read_text()
s=once(s,'legacy-ten-word-group-shows-controls-before-card-and-next-speaks-three','legacy-ten-word-group-shows-settings-after-actions-and-next-speaks-three')
s=once(s,'assert.ok((await page.locator(\'.word-auto-controls\').boundingBox()).y < (await page.locator(\'.word-card\').boundingBox()).y);','assert.ok(await page.locator(\'.word-auto-controls\').evaluate(el => Boolean(document.querySelector(\'.learn-actions\').compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)));')
p.write_text(s)
p=Path('package.json');s=once(p.read_text(),'node scripts/browser-version.mjs"','node scripts/browser-version.mjs && node scripts/browser-word-layout.mjs"');p.write_text(s)
p=Path('TESTING.md');s=p.read_text();s=s.replace('NGSL auto-example controls are above the word card and show a short release ID.','NGSL auto-example controls show a short release ID; their final placement is below the primary actions (see mobile word-card layout below).')
s+='''

## Mobile word-card layout: learning before audio settings

Autoplay, replay, help and the release label follow the word card and both primary action rows in DOM order. On portrait-sized mobile viewports the two action rows share one bottom-sticky toolbar above the existing navigation and safe area. The toolbar remains in document flow, without hiding or truncating the example or locking page scrolling. Short landscape viewports and desktop retain normal flow. Only word-card layout and spacing change; the speech handlers, recording rules, IDs, backups, dependency lockfile and deployment settings are unchanged.

`browser-word-layout.mjs` uses Chromium and WebKit at 320x568, 375x667, 390x650, 390x844 and 430x932, plus large-text/simulated-safe-area and desktop/landscape cases. It verifies actual button rectangles and hit targets before direct coordinate taps (no Playwright auto-scroll), repeated card changes with three complete instrumented utterances, footer access, long text, and no horizontal overflow. The reported viewport tests do not claim physical iPhone listening verification.
''';p.write_text(s)
print('Moved all NGSL audio settings below primary actions; added flow-preserving mobile action toolbar. Speech and storage logic untouched.')
