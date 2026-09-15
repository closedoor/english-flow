import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
if(!process.env.PLAYWRIGHT_MODULE) throw Error('Set PLAYWRIGHT_MODULE; see TESTING.md.');
const pw=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const origin=process.env.BROWSER_TEST_URL||'http://127.0.0.1:4173';
if(!['localhost','127.0.0.1','[::1]'].includes(new URL(origin).hostname)) throw Error('Synthetic setup records must stay on a local origin.');
const results=[];
const wordKey='wordflow-active-session-v1',sentenceKey='wordflow-sentence-active-session-v1';
const start=page=>page.getByRole('button',{name:'开始这组学习',exact:true});
const nav=(page,text)=>page.locator('.bottom-nav button').filter({hasText:text}).click();
const saved=(page,key)=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)||'null'),key);
async function ready(page){await page.goto(origin,{waitUntil:'domcontentloaded'});await page.locator('.bottom-nav').waitFor();}
async function enabled(page){await page.waitForFunction(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent==='开始这组学习');return b&&!b.disabled;});}
async function topStart(page){
  assert.equal(await start(page).count(),1);
  const m=await start(page).evaluate(button=>{
    const r=button.getBoundingClientRect(),section=button.closest('section');
    const h=section.querySelector('header').getBoundingClientRect(),options=section.querySelector('.setup-block').getBoundingClientRect();
    return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,headerBottom:h.bottom,optionsTop:options.top,navTop:document.querySelector('.bottom-nav').getBoundingClientRect().top,scrollY,viewport:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,hit:button.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),position:getComputedStyle(button).position};
  });
  if(process.env.SETUP_START_BASELINE==='1')return m;
  assert.ok(m.scrollY<=1,'Opening setup must not require scrolling');
  assert.ok(m.y>=m.headerBottom-1&&m.y<300,'Start must be directly below the header');
  assert.ok(m.bottom<=m.optionsTop&&m.bottom<m.navTop,'Start must precede options and bottom navigation');
  assert.ok(m.height>=44&&m.x>=0&&m.x+m.width<=m.viewport+1&&m.hit,'First-screen button must be an unobstructed touch target');
  assert.equal(m.overflow,false);assert.equal(m.position,'static');
  return m;
}
async function tapStart(page){const m=await topStart(page);await page.mouse.click(m.x+m.width/2,m.y+m.height/2);}
for(const engine of ['chromium','webkit']){
  const browser=await pw[engine].launch({headless:true});
  async function check(name,fn,viewport={width:390,height:844},largeText=false){
    const context=await browser.newContext({viewport,hasTouch:true,serviceWorkers:'block'});
    await context.addInitScript(()=>{
      Object.defineProperty(window,'SpeechSynthesisUtterance',{configurable:true,value:class{constructor(text){this.text=text;}}});
      Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{paused:false,getVoices(){return[];},cancel(){},resume(){this.paused=false;},speak(u){queueMicrotask(()=>{u.onstart?.();u.onend?.();});}}});
    });
    const page=await context.newPage();page.setDefaultTimeout(12000);const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    try{
      await ready(page);
      if(largeText)await page.addStyleTag({content:'html{font-size:20px!important}.page{padding-top:60px!important}'});
      await fn(page,context);assert.deepEqual(errors,[]);
      results.push({engine,name,status:'PASS'});
    }catch(error){results.push({engine,name,status:'FAIL',error:String(error),body:(await page.locator('body').innerText().catch(()=>'' )).slice(0,1800),errors});}
    finally{await context.close();}
    console.log(JSON.stringify(results.at(-1)));
  }
  if(process.env.SETUP_START_BASELINE==='1'){
    await check('before-change-positions',async page=>{
      for(const module of ['学习','句库']){await nav(page,module);await enabled(page);console.log('SETUP_START_BASELINE',JSON.stringify({engine,module,...await topStart(page)}));}
    });
    await browser.close();continue;
  }
  for(const [label,width,height,largeText] of [['small-phone',320,568,false],['compact-phone',375,667,false],['browser-bars',390,700,false],['reported-phone',390,844,false],['large-text',430,932,true],['desktop',1280,900,false]]){
    await check(`${label}-both-module-starts-directly-tappable`,async page=>{
      await nav(page,'学习');await tapStart(page);await page.locator('.word-card').waitFor();
      assert.equal((await saved(page,wordKey)).wordIds.length,10);
      await nav(page,'句库');await enabled(page);await tapStart(page);await page.locator('.sentence-study-card').waitFor();
      assert.equal((await saved(page,sentenceKey)).sentenceIds.length,10);
    },{width,height},largeText);
  }
  await check('top-word-start-uses-restored-twenty-word-free-choices',async page=>{
    await nav(page,'学习');await page.getByRole('button',{name:'自由学习',exact:false}).click();
    await page.getByRole('button',{name:'20 个',exact:true}).click();
    await page.reload();await page.locator('.bottom-nav').waitFor();await nav(page,'学习');
    assert.match(await page.locator('#word-session-choice').innerText(),/20 个/);
    await tapStart(page);await page.locator('.word-card').waitFor();
    const session=await saved(page,wordKey);assert.equal(session.mode,'free');assert.equal(session.path,'frequency');assert.equal(session.wordIds.length,20);
  });
  await check('top-sentence-start-uses-selected-mode-length-and-count',async page=>{
    await nav(page,'句库');await enabled(page);
    await page.locator('.sentence-mode-grid button').last().click();
    await page.getByRole('button',{name:'20 句',exact:true}).click();
    await page.locator('.sentence-band-switch button').nth(1).click();await enabled(page);
    await page.evaluate(()=>window.scrollTo(0,0));
    const summary=await page.locator('#sentence-session-choice').innerText();assert.match(summary,/看中文说英文/);assert.match(summary,/常用句/);assert.match(summary,/20 句/);
    await tapStart(page);await page.locator('.speak-prompt').waitFor();
    const session=await saved(page,sentenceKey);assert.equal(session.sentenceIds.length,20);assert.ok(session.sentenceIds.every(id=>id>1000&&id<=2000));
  });
  await check('top-sentence-start-stays-disabled-until-selected-pack-arrives',async(page,context)=>{
    await nav(page,'句库');await enabled(page);
    let release;const gate=new Promise(resolve=>{release=resolve;});
    await context.route(/tatoeba-sentences-2\.json/,async route=>{await gate;await route.continue().catch(()=>{});});
    try{
      const request=page.waitForRequest(r=>r.url().includes('tatoeba-sentences-2.json'));
      await page.locator('.sentence-band-switch button').nth(1).click();await request;
      await page.evaluate(()=>window.scrollTo(0,0));
      assert.equal(await start(page).isDisabled(),true);
      const before=await saved(page,sentenceKey);await tapStart(page);assert.deepEqual(await saved(page,sentenceKey),before);
      release();await enabled(page);await tapStart(page);await page.locator('.sentence-study-card').waitFor();
    }finally{release();}
  });
  await check('top-start-preserves-paused-sentence-confirmation-and-resume',async page=>{
    await nav(page,'句库');await enabled(page);await tapStart(page);await page.locator('.sentence-study-card').waitFor();
    await page.locator('.learn-actions .secondary-action').click();
    await page.getByRole('button',{name:'返回句库设置并保留进度',exact:true}).click();await enabled(page);
    const before=await saved(page,sentenceKey);
    await tapStart(page);await page.locator('[aria-modal="true"]').waitFor();
    assert.deepEqual((await saved(page,sentenceKey)).ratings,before.ratings);
    await page.keyboard.press('Escape');await page.locator('[aria-modal="true"]').waitFor({state:'hidden'});
    await page.locator('.sentence-page .resume-session-card').click();await page.locator('.sentence-study-card').waitFor();
    const after=await saved(page,sentenceKey);assert.deepEqual(after.sentenceIds,before.sentenceIds);assert.deepEqual(after.ratings,before.ratings);assert.equal(after.index,before.index);
  });
  await browser.close();
}
const failed=results.filter(r=>r.status==='FAIL').length;
console.log('SETUP_START_SUMMARY',JSON.stringify({passed:results.length-failed,failed,total:results.length}));
if(failed)process.exitCode=1;
