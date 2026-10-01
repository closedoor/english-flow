import { openSetupDetails } from './browser-disclosures.mjs';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
if(!process.env.PLAYWRIGHT_MODULE) throw Error('Set PLAYWRIGHT_MODULE; see TESTING.md.');
const pw=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const origin=process.env.BROWSER_TEST_URL||'http://127.0.0.1:4173';
if(!['localhost','127.0.0.1','[::1]'].includes(new URL(origin).hostname)) throw Error('Synthetic setup records must stay on a local origin.');
const results=[];
const wordKey='wordflow-active-session-v1',sentenceKey='wordflow-sentence-active-session-v1',patternKey='wordflow-pattern-active-session-v1';
const patternStartLabel='开始句型替换练习';
const start=(page,label='开始这组学习')=>page.getByRole('button',{name:label,exact:true});
const nav=(page,text)=>page.locator('.bottom-nav button').filter({hasText:text}).click();
const saved=(page,key)=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)||'null'),key);
async function ready(page){await page.goto(origin,{waitUntil:'domcontentloaded'});await page.locator('.bottom-nav').waitFor();}
async function enabled(page,label='开始这组学习'){await page.waitForFunction(label=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent===label);return b&&!b.disabled;},label);}
async function topStart(page,label='开始这组学习'){
  assert.equal(await start(page,label).count(),1);
  const m=await start(page,label).evaluate(button=>{
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
async function tapStart(page,label='开始这组学习'){const m=await topStart(page,label);await page.mouse.click(m.x+m.width/2,m.y+m.height/2);}
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
      for(const tabLabel of ['单词','句子']){await nav(page,tabLabel);await enabled(page);console.log('SETUP_START_BASELINE',JSON.stringify({engine,tabLabel,...await topStart(page)}));}
      await page.getByRole('button',{name:'核心句型',exact:true}).click();await enabled(page,patternStartLabel);
      console.log('SETUP_START_BASELINE',JSON.stringify({engine,tabLabel:'核心句型',...await topStart(page,patternStartLabel)}));
    });
    await browser.close();continue;
  }
  for(const [label,width,height,largeText] of [['small-phone',320,568,false],['compact-phone',375,667,false],['browser-bars',390,700,false],['reported-phone',390,844,false],['large-text',430,932,true],['desktop',1280,900,false]]){
    await check(`${label}-all-three-module-starts-directly-tappable`,async page=>{
      await nav(page,'单词');await tapStart(page);await page.locator('.word-card').waitFor();
      assert.equal((await saved(page,wordKey)).wordIds.length,10);
      await nav(page,'句子');await enabled(page);await tapStart(page);await page.locator('.sentence-study-card').waitFor();
      assert.equal((await saved(page,sentenceKey)).sentenceIds.length,10);
      await page.getByRole('button',{name:'返回句库设置并保留进度',exact:true}).click();
      await page.getByRole('button',{name:'核心句型',exact:true}).click();await enabled(page,patternStartLabel);
      await tapStart(page,patternStartLabel);await page.locator('.pattern-prompt').waitFor();
      assert.equal((await saved(page,patternKey)).patternIds.length,10);
      assert.equal(await page.locator('.pattern-answer').count(),0);
    },{width,height},largeText);
  }
  await check('top-word-start-uses-restored-twenty-word-free-choices',async page=>{
    await nav(page,'单词');await page.getByRole('button',{name:'自由学习',exact:false}).click();
    await page.getByRole('button',{name:'20 个',exact:true}).click();
    await page.reload();await page.locator('.bottom-nav').waitFor();await nav(page,'单词');
    assert.match(await page.locator('#word-session-choice').innerText(),/20 个/);
    await tapStart(page);await page.locator('.word-card').waitFor();
    const session=await saved(page,wordKey);assert.equal(session.mode,'free');assert.equal(session.path,'frequency');assert.equal(session.wordIds.length,20);
  });
  await check('top-sentence-start-uses-selected-mode-length-and-count',async page=>{
    await nav(page,'句子');await enabled(page);
    await page.locator('.sentence-mode-grid button').filter({hasText:'看中文说英文'}).click();
    await page.getByRole('button',{name:'20 句',exact:true}).click();
    await openSetupDetails(page, '.sentence-range');
    await page.locator('.sentence-band-switch button').nth(1).click();await enabled(page);
    await page.evaluate(()=>window.scrollTo(0,0));
    const summary=await page.locator('#sentence-session-choice').innerText();assert.match(summary,/看中文说英文/);assert.match(summary,/常用句/);assert.match(summary,/20 句/);
    await tapStart(page);await page.locator('.speak-prompt').waitFor();
    const session=await saved(page,sentenceKey);assert.equal(session.sentenceIds.length,20);assert.ok(session.sentenceIds.every(id=>id>1000&&id<=2000));
  });
  await check('top-sentence-start-stays-disabled-until-selected-pack-arrives',async(page,context)=>{
    await nav(page,'句子');await enabled(page);
    let release;const gate=new Promise(resolve=>{release=resolve;});
    await context.route(/tatoeba-sentences-2\.json/,async route=>{await gate;await route.continue().catch(()=>{});});
    try{
      const request=page.waitForRequest(r=>r.url().includes('tatoeba-sentences-2.json'));
      await openSetupDetails(page, '.sentence-range');
      await page.locator('.sentence-band-switch button').nth(1).click();await request;
      await page.evaluate(()=>window.scrollTo(0,0));
      assert.equal(await start(page).isDisabled(),true);
      const before=await saved(page,sentenceKey);await tapStart(page);assert.deepEqual(await saved(page,sentenceKey),before);
      release();await enabled(page);await tapStart(page);await page.locator('.sentence-study-card').waitFor();
    }finally{release();}
  });
  await check('top-start-resumes-same-sentence-and-protects-explicit-replacement',async page=>{
    await nav(page,'句子');await enabled(page);await tapStart(page);await page.locator('.sentence-study-card').waitFor();
    await page.locator('.learn-actions .secondary-action').click();
    await page.getByRole('button',{name:'返回句库设置并保留进度',exact:true}).click();await enabled(page);
    const before=await saved(page,sentenceKey);
    await tapStart(page);await page.locator('.sentence-study-card').waitFor();
    assert.equal(await page.locator('[aria-modal="true"]').count(),0);
    const after=await saved(page,sentenceKey);assert.deepEqual(after.sentenceIds,before.sentenceIds);assert.deepEqual(after.ratings,before.ratings);assert.equal(after.index,before.index);
    await page.getByRole('button',{name:'返回句库设置并保留进度',exact:true}).click();
    await page.getByRole('button',{name:'另开新一组',exact:true}).click();await page.locator('[aria-modal="true"]').waitFor();
    await page.keyboard.press('Escape');assert.deepEqual((await saved(page,sentenceKey)).ratings,before.ratings);
  });
  await check('top-pattern-start-uses-selected-scene-with-hidden-recall-answer',async page=>{
    await nav(page,'句子');await page.getByRole('button',{name:'核心句型',exact:true}).click();
    await openSetupDetails(page, '.pattern-range');
    await page.locator('.pattern-category-grid button').filter({hasText:'购物'}).click();
    await page.evaluate(()=>window.scrollTo(0,0));await enabled(page,patternStartLabel);
    assert.match(await page.locator('#pattern-session-choice').innerText(),/购物/);
    await tapStart(page,patternStartLabel);await page.locator('.pattern-prompt').waitFor();
    const session=await saved(page,patternKey);assert.equal(session.category,'shopping');
    assert.equal(session.index,0);assert.equal(session.drillIndex,0);assert.deepEqual(session.ratings,{});
    assert.equal(await page.locator('.pattern-answer').count(),0);
    assert.equal(await page.getByRole('button',{name:'慢速播放',exact:true}).isDisabled(),true);
  });
  await check('top-pattern-start-retains-substitution-and-protects-changed-scene',async page=>{
    await nav(page,'句子');await page.getByRole('button',{name:'核心句型',exact:true}).click();
    await tapStart(page,patternStartLabel);await page.locator('.pattern-prompt').waitFor();
    await page.getByRole('button',{name:'我说好了，查看参考答案',exact:true}).click();
    await page.getByRole('button',{name:'下一组 ›',exact:true}).click();
    await page.waitForFunction(key=>JSON.parse(localStorage.getItem(key))?.drillIndex===1,patternKey);
    const before=await saved(page,patternKey),rotation=await page.evaluate(()=>localStorage.getItem('wordflow-practice-rotation-v1'));
    await page.getByRole('button',{name:'返回句型设置并保留进度',exact:true}).click();
    await tapStart(page,patternStartLabel);await page.locator('.pattern-prompt').waitFor();
    assert.equal(await page.locator('[aria-modal="true"]').count(),0);
    assert.deepEqual(await saved(page,patternKey),before);
    assert.equal(await page.locator('.pattern-answer').count(),0);
    assert.equal(await page.evaluate(()=>localStorage.getItem('wordflow-practice-rotation-v1')),rotation);
    await page.getByRole('button',{name:'返回句型设置并保留进度',exact:true}).click();
    await openSetupDetails(page, '.pattern-range');
    await page.locator('.pattern-category-grid button').filter({hasText:'出行'}).click();
    await page.evaluate(()=>window.scrollTo(0,0));
    await tapStart(page,patternStartLabel);await page.locator('[aria-modal="true"]').waitFor();
    await page.getByRole('button',{name:'保留进度',exact:true}).click();
    assert.deepEqual(await saved(page,patternKey),before);
    await tapStart(page,patternStartLabel);
    await page.getByRole('button',{name:'结束并开始新练习',exact:true}).click();await page.locator('.pattern-prompt').waitFor();
    assert.equal((await saved(page,patternKey)).category,'travel');
    assert.equal(await page.locator('.pattern-answer').count(),0);
  });
  for(const [name,width,height,largeText] of [['small',320,568,false],['phone',390,844,false],['large-text',430,932,true]]){
    await check(`simple-setup-${name}-keeps-secondary-tools-folded-and-all-three-methods-reachable`,async page=>{
      await nav(page,'单词');
      assert.equal(await page.locator('h1').innerText(),'单词');
      for(const selector of ['.word-range','.word-find'])assert.equal(await page.locator(selector).evaluate(e=>e.open),false);
      assert.equal(await page.locator('.scene-list button').first().isVisible(),false);
      assert.equal(await page.getByRole('searchbox',{name:'搜索词库'}).isVisible(),false);
      await topStart(page);
      const summary=page.locator('.word-range>summary');await summary.focus();await page.keyboard.press('Enter');
      await page.locator('.scene-list button').first().waitFor();
      await page.locator('.scene-list button').first().click();
      assert.match(await page.locator('#word-session-choice').innerText(),/日常/);
      await summary.click();assert.equal(await page.locator('.word-range').evaluate(e=>e.open),false);
      await openSetupDetails(page,'.word-find');await page.getByRole('searchbox',{name:'搜索词库'}).fill('the');
      await page.locator('.library-list button').first().waitFor();
      await page.locator('.word-find>summary').click();await openSetupDetails(page,'.word-find');
      assert.equal(await page.getByRole('searchbox',{name:'搜索词库'}).inputValue(),'the');
      await nav(page,'句子');await enabled(page);
      assert.equal(await page.locator('h1').innerText(),'句子');
      for(const selector of ['.sentence-range','.sentence-find'])assert.equal(await page.locator(selector).evaluate(e=>e.open),false);
      assert.equal(await page.locator('.sentence-section-switch').count(),0,'Practice choices have one level');
      assert.equal(await page.locator('.practice-methods button').count(),3);
      assert.equal(await page.locator('.practice-methods button[aria-pressed="true"]').count(),1);
      await page.locator('.practice-methods button').filter({hasText:'看中文说英文'}).click();
      assert.match(await page.locator('#sentence-session-choice').innerText(),/看中文说英文/);
      await page.getByRole('button',{name:'核心句型',exact:true}).click();
      assert.equal(await page.locator('h1').innerText(),'句子');
      assert.equal(await page.locator('.practice-methods button[aria-pressed="true"]').count(),1);
      assert.equal(await page.locator('.pattern-preview-list').isVisible(),false);
      await page.locator('.pattern-preview>summary').click();await page.locator('.pattern-preview-list').waitFor();
      assert.equal(await page.locator('.pattern-preview-list>div').count(),6);
      await page.locator('.practice-methods button').filter({hasText:'英文卡片'}).click();
      await openSetupDetails(page,'.sentence-find');await page.locator('.sentence-summary button').last().click();
      await page.getByText('还没有收藏句子。学习时点 ☆ 就能在这里找到。',{exact:true}).waitFor();
      await page.locator('.browser-switch').click();await page.getByRole('searchbox',{name:'搜索长短句'}).fill('I');
      await page.locator('.sentence-result-list button[data-sentence-id]').first().waitFor();
      await page.locator('.setup-source>summary').click();assert.equal(await page.getByRole('link',{name:'Tatoeba 数据与授权'}).isVisible(),true);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
      for(const selector of ['.setup-disclosure>summary','.practice-methods button']){
        for(const target of await page.locator(selector).all())assert.ok(await target.evaluate(e=>e.getBoundingClientRect().height>=44));
      }
    },{width,height},largeText);
  }
  await check('switching-the-three-methods-preserves-both-paused-sessions-and-real-replacement-guards',async page=>{
    await nav(page,'句子');await enabled(page);await start(page).click();await page.locator('.sentence-study-card').waitFor();
    await page.locator('.learn-actions .secondary-action').click();
    await page.waitForFunction(key=>Object.keys(JSON.parse(localStorage.getItem(key)).ratings).length===1,sentenceKey);
    const sentence=await saved(page,sentenceKey);
    await page.getByRole('button',{name:'返回句库设置并保留进度',exact:true}).click();
    await page.getByRole('button',{name:'核心句型',exact:true}).click();await start(page,patternStartLabel).click();
    await page.getByRole('button',{name:'我说好了，查看参考答案',exact:true}).click();
    await page.getByRole('button',{name:'下一组 ›',exact:true}).click();
    await page.waitForFunction(key=>JSON.parse(localStorage.getItem(key)).drillIndex===1,patternKey);
    const pattern=await saved(page,patternKey);
    await page.getByRole('button',{name:'返回句型设置并保留进度',exact:true}).click();
    await page.locator('.practice-methods button').filter({hasText:'看中文说英文'}).click();
    assert.deepEqual(await saved(page,sentenceKey),sentence);assert.deepEqual(await saved(page,patternKey),pattern);
    await start(page).click();await page.locator('#discard-title').waitFor();
    await page.getByRole('button',{name:'保留进度',exact:true}).click();
    assert.deepEqual(await saved(page,sentenceKey),sentence);assert.deepEqual(await saved(page,patternKey),pattern);
    await page.locator('.resume-session-card').click();await page.locator('.sentence-study-card').waitFor();
    assert.equal(await page.locator('.speak-prompt').count(),0,'Resume uses the saved listening mode');
    assert.deepEqual(await saved(page,sentenceKey),sentence);
    await page.getByRole('button',{name:'返回句库设置并保留进度',exact:true}).click();
    await page.getByRole('button',{name:'核心句型',exact:true}).click();await page.locator('.resume-session-card').click();
    await page.locator('.pattern-prompt').waitFor();assert.equal(await page.locator('.pattern-answer').count(),0);
    assert.deepEqual(await saved(page,patternKey),pattern);assert.deepEqual(await saved(page,sentenceKey),sentence);
  });
  await check('choosing-a-new-method-after-a-lookup-shows-setup-at-the-top-instead-of-the-old-result',async page=>{
    await nav(page,'句子');await enabled(page);await openSetupDetails(page,'.sentence-find');
    await page.getByRole('searchbox',{name:'搜索长短句'}).fill('I');
    const result=page.locator('.sentence-result-list button[data-sentence-id]').nth(5);
    await result.click();await page.locator('.sentence-study-card').waitFor();
    const before=await saved(page,sentenceKey);
    await nav(page,'今天');
    await page.locator('.quick-practice-grid button').filter({hasText:'核心句型替换'}).click();
    await page.locator('.practice-methods button').filter({hasText:'看中文说英文'}).click();
    await page.waitForFunction(()=>scrollY===0);
    await topStart(page);
    assert.deepEqual(await saved(page,sentenceKey),before);
    assert.equal(await page.getByRole('searchbox',{name:'搜索长短句'}).inputValue(),'I','Keep the query available under its own disclosure');
    assert.equal(await page.locator('button[data-sentence-id]:focus').count(),0);
  });
  await browser.close();
}
const failed=results.filter(r=>r.status==='FAIL').length;
console.log('SETUP_START_SUMMARY',JSON.stringify({passed:results.length-failed,failed,total:results.length}));
if(failed)process.exitCode=1;
