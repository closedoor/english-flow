from pathlib import Path
p=Path('.audit/apply-visible-autoplay.py');s=p.read_text()
s=s.replace("s=once(s,'  title: \"词流英语\",','  title: \"词流英语\",\\n  other: { \"english-flow-build\": APP_BUILD_COMMIT },')", "s=s.replace('  title: \"词流英语\",','  title: \"词流英语\",\\n  other: { \"english-flow-build\": APP_BUILD_COMMIT },',1)")
s=s.replace("r'      \\{sessionPath === \"frequency\" && wordSessionKind === \"group\" && .*?\\n',part", "r'      \\{sessionPath === \"frequency\" && wordSessionKind === \"group\" && [\\s\\S]*?      </div>}\\n',part")
p.write_text(s)
p=Path('scripts/browser-autoplay.mjs');s=p.read_text();needle="  await check('scene-groups-and-single-word-lookups-keep-manual-audio'"
extra='''  await check('legacy-ten-word-group-shows-controls-before-card-and-next-speaks-three',async page=>{
    await ready(page);await page.locator('.word-auto-controls').waitFor();
    assert.ok((await page.locator('.word-auto-controls').boundingBox()).y < (await page.locator('.word-card').boundingBox()).y);
    await page.locator('[aria-label="切换词卡"] button').last().click();await count(page,1);
    assert.equal((await logs(page))[0].gesture,true);
    const text=await page.locator('.example-box p').innerText();
    await finish(page);await finish(page);await finish(page);
    assert.deepEqual((await logs(page)).map(u=>u.text),[text,text,text]);
    assert.deepEqual(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).ratings,key),{});
  },{...snapshot(),kind:undefined,mode:'free',wordIds:Array.from({length:10},(_,i)=>i+22)});
  await check('resuming-restored-group-from-home-starts-in-click-not-effect',async page=>{
    await ready(page);await nav(page,'今天');
    await page.locator('.hero-card').click();await count(page,1);
    assert.equal((await logs(page))[0].gesture,true);
  },snapshot());
  await check('resuming-restored-group-from-navigation-starts-in-click-not-effect',async page=>{
    await ready(page);await nav(page,'进度');await nav(page,'学习');await count(page,1);
    assert.equal((await logs(page))[0].gesture,true);
  },snapshot());
'''
assert s.count(needle)==1;s=s.replace(needle,extra+needle);p.write_text(s)
# These source guards still check the complete lifecycle contract; runtime
# worker and browser assertions are retained unchanged.
p=Path('tests/pwa-assets.test.mjs');s=p.read_text()
for a,b in [(r'fetchWithTimeout\(event\.request, NAVIGATION_TIMEOUT\)',r'fetchWithTimeout\(event\.request, url\.searchParams\.has\("ef-update"\) \? 12_000 : NAVIGATION_TIMEOUT\)'),(r'serviceWorker\.register\("\/sw\.js"\)\.then\(cacheLoadedPageAssets\)',r'serviceWorker\.register\("\/sw\.js", \{ updateViaCache: "none" \}\)\.then\(cacheLoadedPageAssets\)')]:
 assert s.count(a)==1,a;s=s.replace(a,b)
p.write_text(s)
p=Path('tests/session-selection.test.mjs');s=p.read_text();a=r'hasOngoingSession \? setTab\("learn"\) : startSession\(\)';b=r'if \(hasOngoingSession\) \{ if \(learnStage === "cards"\) playAutomaticWordExample\(current\); setTab\("learn"\); \} else startSession\(\)';assert s.count(a)==1;s=s.replace(a,b);p.write_text(s)
p=Path('TESTING.md');p.write_text(p.read_text()+'''

## Installed-user NGSL autoplay and release identity

The running bundle and its HTML carry the same full build commit, independently of fetched build-info.json. NGSL auto-example controls are above the word card and show a short release ID. Ten-word legacy saved groups lacking the optional kind field are covered, as are synchronous first-input resumes from Home and the learning navigation tab. Existing end-event-based three-repeat playback, manual interruption and quiz exclusion remain in force.

A version notice checks uncached server metadata on visible startup and periodically/on return to the app. It does not replace an already-open document automatically or force a waiting worker to control old pages. Updates require explicit action from Progress, successful read-only comparison of all in-memory learning records with persisted data, and a matching fresh HTML commit. Failed/offline/stale probes and unsaved/concurrent records keep the current document. Learning IDs, local storage keys, backup format and locked dependencies are unchanged.

Browser version checks cover current/new/failed probes, unchanged running documents, active learning, concurrent storage and stale HTML preflight in Chromium and WebKit. A separate migration audit builds the actual pre-autoplay release, installs its real Chromium Service Worker, publishes the repaired build at the same local origin, reproduces a waiting worker with the old UI, then verifies explicit same-origin reload preserves the ten-word session and supports exactly three complete example utterances. Speech callbacks are instrumented; this is not physical iPhone or Bluetooth audio acceptance.
''')
