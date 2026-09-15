from pathlib import Path
p=Path('.audit/apply-visible-autoplay.py');s=p.read_text()
s=s.replace("s=once(s,'  title: \"词流英语\",','  title: \"词流英语\",\\n  other: { \"english-flow-build\": APP_BUILD_COMMIT },')", "s=s.replace('  title: \"词流英语\",','  title: \"词流英语\",\\n  other: { \"english-flow-build\": APP_BUILD_COMMIT },',1)")
s=s.replace("r'      \\{sessionPath === \"frequency\" && wordSessionKind === \"group\" && .*?\\n',part", "r'      \\{sessionPath === \"frequency\" && wordSessionKind === \"group\" && [\\s\\S]*?      </div>}\\n',part")
p.write_text(s)
# Extend the existing instrumented UI suite with the reported old-group state
# and strict first-input resume cases; this still does not simulate real audio.
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
