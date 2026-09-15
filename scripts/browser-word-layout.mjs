import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const pw=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const origin=process.env.BROWSER_TEST_URL||'http://127.0.0.1:4173';
assert.ok(['127.0.0.1','localhost','[::1]'].includes(new URL(origin).hostname),'Synthetic records are local-only');
const baseline=process.env.WORD_LAYOUT_BASELINE==='1';
const results=[];
const selectors=['.sentence-pager button:first-child','.sentence-pager button:last-child','.learn-actions button:first-child','.learn-actions button:last-child'];
async function geometry(page){return page.evaluate(selectors=>{
 const nav=document.querySelector('.bottom-nav').getBoundingClientRect();
 return {scrollY,viewport:innerHeight,navTop:nav.top,overflow:document.documentElement.scrollWidth>innerWidth+1,
 buttons:selectors.map(selector=>{const el=document.querySelector('.learn-page '+selector),r=el.getBoundingClientRect();const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {selector,x:r.x,y:r.y,width:r.width,height:r.height,hit:hit===el||el.contains(hit)};}),
 settingsAfterActions:Boolean(document.querySelector('.learn-actions').compareDocumentPosition(document.querySelector('.word-auto-controls'))&Node.DOCUMENT_POSITION_FOLLOWING)};
},selectors);}
async function assertActions(page){const m=await geometry(page);assert.equal(m.overflow,false);assert.equal(m.settingsAfterActions,true);
 for(const b of m.buttons){assert.ok(b.y>=0&&b.y+b.height<=m.navTop+1,JSON.stringify(m));assert.ok(b.width>=44&&b.height>=44,JSON.stringify(b));assert.equal(b.hit,true,JSON.stringify(m));}return m;}
async function tap(page,selector){const r=await page.locator('.learn-page '+selector).boundingBox();await page.touchscreen.tap(r.x+r.width/2,r.y+r.height/2);}
async function finishThree(page,from){for(let i=0;i<3;i++)await page.evaluate(()=>window.__layoutSpeech.end());const text=await page.locator('.example-box p').innerText();assert.deepEqual(await page.evaluate(from=>window.__layoutSpeech.log.slice(from),from),[text,text,text]);}
for(const engine of baseline?['chromium']:['chromium','webkit']){
 const browser=await pw[engine].launch({headless:true});
 const cases=baseline?[{name:'reported-phone-before-fix',width:390,height:844}]:[
  {name:'small-phone',width:320,height:568},{name:'compact-phone',width:375,height:667},
  {name:'browser-bars',width:390,height:650},{name:'reported-phone-ten-cards',width:390,height:844,ten:true},
  {name:'large-phone',width:430,height:932},{name:'large-text-and-safe-area',width:390,height:844,stress:true},
  {name:'landscape-normal-flow',width:844,height:390,flow:true},{name:'desktop-normal-flow',width:1280,height:900,flow:true}];
 for(const item of cases){
  const context=await browser.newContext({viewport:{width:item.width,height:item.height},hasTouch:true,serviceWorkers:'block'});
  await context.addInitScript(()=>{
   const s={log:[],active:null,end(){const u=this.active;this.active=null;u?.onend?.();}};window.__layoutSpeech=s;
   Object.defineProperty(window,'SpeechSynthesisUtterance',{configurable:true,value:class{constructor(text){this.text=text;}}});
   Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{paused:false,getVoices(){return[];},cancel(){s.active=null;},resume(){this.paused=false;},speak(u){s.log.push(u.text);s.active=u;u.onstart?.();}}});
  });
  const page=await context.newPage();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{
   await page.goto(origin);await page.locator('.bottom-nav').waitFor({timeout:30000});
   await page.locator('.bottom-nav button').filter({hasText:'学习'}).click();
   await page.getByRole('button',{name:'自由学习',exact:false}).click();
   await page.getByRole('button',{name:'10 个',exact:true}).click();
   await page.getByRole('button',{name:'开始这组学习',exact:true}).click();await page.locator('.word-card').waitFor();
   if(baseline){console.log('LAYOUT_BASELINE',JSON.stringify(await geometry(page)));continue;}
   await page.waitForTimeout(200);
   if(item.stress)await page.addStyleTag({content:'html{font-size:24px}.learn-page{padding-top:83px}.bottom-nav{height:108px;padding-bottom:34px}.learn-page>.word-card-actions{bottom:108px}'});
   if(item.flow){assert.notEqual(await page.locator('.word-card-actions').evaluate(el=>getComputedStyle(el).position),'sticky');assert.equal((await geometry(page)).settingsAfterActions,true);}
   else{
    for(let i=0;i<(item.ten?10:3);i++){
     await page.waitForTimeout(360);await assertActions(page);
     assert.ok(await page.evaluate(()=>scrollY<=1),'Card change must not require scrolling to actions');
     const from=await page.evaluate(()=>window.__layoutSpeech.log.length-1);await finishThree(page,from);
     if(i<(item.ten?10:3)-1){const before=await page.locator('.word-heading h2').innerText();await tap(page,selectors[i%3===0?1:i%3===1?3:2]);await page.waitForFunction(before=>document.querySelector('.word-heading h2')?.textContent!==before,before);}
    }
    // Long content must remain readable, while the actions still work at the top.
    await page.locator('.example-box p').evaluate(el=>{el.textContent=('A deliberately long example remains readable without truncation. ').repeat(12);});
    await page.evaluate(()=>scrollTo(0,0));await assertActions(page);
    await page.locator('.example-box small').scrollIntoViewIfNeeded();
    assert.equal(await page.locator('.example-box small').evaluate(el=>{const r=el.getBoundingClientRect();const hit=document.elementFromPoint(r.x+8,r.y+r.height/2);return hit===el||el.contains(hit);}),true,'The final translation must be reachable, not permanently covered');
   }
   // Settings are still accessible below the main flow and can be operated.
   await page.getByRole('button',{name:'重播三遍',exact:true}).scrollIntoViewIfNeeded();
   await page.getByRole('button',{name:'自动例句三遍：开',exact:true}).click();
   await page.getByRole('button',{name:'自动例句三遍：关',exact:true}).waitFor();
   await page.getByRole('button',{name:'自动例句三遍：关',exact:true}).click();
   await page.getByRole('button',{name:'重播三遍',exact:true}).click();
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(errors,[]);
   results.push({engine,name:item.name,status:'PASS'});
  }catch(e){results.push({engine,name:item.name,status:'FAIL',error:String(e),geometry:await geometry(page).catch(()=>null),errors});}
  finally{console.log(JSON.stringify(results.at(-1)||{engine,baseline:true}));await context.close();}
 }
 await browser.close();
}
const failed=results.filter(r=>r.status==='FAIL').length;
console.log('WORD_LAYOUT_SUMMARY',JSON.stringify({passed:results.length-failed,failed,total:results.length}));
if(failed)process.exitCode=1;
