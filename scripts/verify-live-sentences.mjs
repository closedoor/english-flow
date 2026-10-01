import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
if(!process.env.PLAYWRIGHT_MODULE)throw Error('Set PLAYWRIGHT_MODULE.');
const pw=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const base=new URL(process.env.PRODUCTION_URL||'https://english-flow-mwnn.onrender.com/');
if(!['https://english-flow-mwnn.onrender.com','http://127.0.0.1:4173','http://localhost:4173'].includes(base.origin))throw Error('Unapproved verification origin.');
const expected=process.env.EXPECTED_COMMIT;assert.match(expected||'',/^[a-f0-9]{40}$/);
for(const engine of ['chromium','webkit']){
 const browser=await pw[engine].launch({headless:true});
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'allow'});
 // This brand-new browser profile has no learner identity or existing records.
 await context.addInitScript(()=>{
  const state={log:[],active:null,gesture:false,end(){const u=this.active;this.active=null;u?.onend?.();}};window.__liveSentence=state;
  document.addEventListener('click',()=>state.gesture=true,true);window.addEventListener('click',()=>state.gesture=false);
  Object.defineProperty(window,'SpeechSynthesisUtterance',{configurable:true,value:class{constructor(text){this.text=text;}}});
  Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{paused:false,getVoices(){return[];},cancel(){state.active=null;},resume(){},speak(u){state.log.push({text:u.text,lang:u.lang,gesture:state.gesture});state.active=u;u.onstart?.();}}});
 });
 const page=await context.newPage();page.setDefaultTimeout(25000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  const url=new URL('/',base);url.searchParams.set('ef-update',expected);const response=await page.goto(url.href,{waitUntil:'domcontentloaded'});assert.equal(response.status(),200);assert.equal(await page.title(),'词流英语');assert.equal(await page.locator('meta[name="english-flow-build"]').getAttribute('content'),expected);
  await page.locator('.bottom-nav').waitFor();await page.locator('.bottom-nav button').filter({hasText:'句子'}).click();await page.waitForFunction(()=>{const b=document.querySelector('.sentence-page .setup-start');return b&&!b.disabled;});await page.getByRole('button',{name:'开始这组学习',exact:true}).click();await page.locator('.sentence-translation').waitFor();
  let offset=0;const checks=[];
  for(const action of ['first','next','known','difficult']){
   if(action==='next')await page.getByRole('button',{name:'下一句 ›',exact:true}).click();
   if(action==='known')await page.getByRole('button',{name:'我学会了',exact:true}).click();
   if(action==='difficult'){await page.waitForTimeout(380);await page.getByRole('button',{name:'还不熟悉',exact:true}).click();}
   await page.waitForFunction(n=>window.__liveSentence.log.length===n,offset+1);
   const english=await page.locator('.sentence-english').innerText(),chinese=await page.locator('.sentence-translation').innerText();
   for(let i=0;i<4;i++)await page.evaluate(()=>window.__liveSentence.end());
   const spoken=await page.evaluate(n=>window.__liveSentence.log.slice(n),offset);assert.deepEqual(spoken.map(u=>u.text),[english,english,english,chinese]);assert.deepEqual(spoken.map(u=>u.lang),['en-US','en-US','en-US','zh-CN']);assert.equal(spoken[0].gesture,true);offset+=4;checks.push({action,englishRepeats:3,chineseRepeats:1,translationVisible:true});
  }
  const snapshot=await page.evaluate(()=>localStorage.getItem('wordflow-sentence-active-session-v1'));
  for(let i=0;i<2;i++){await page.getByRole('button',{name:'返回句库设置并保留进度',exact:true}).click();await page.getByRole('button',{name:'开始这组学习',exact:true}).click();await page.locator('.sentence-study-card').waitFor();assert.equal(await page.locator('#discard-title').count(),0);assert.equal(await page.evaluate(()=>localStorage.getItem('wordflow-sentence-active-session-v1')),snapshot);}
  assert.deepEqual(errors,[]);console.log('LIVE_SENTENCE_PASS',JSON.stringify({engine,commit:expected,checks,resumeWithoutDialog:true,progressPreserved:true,instrumentedSpeech:true}));
 }catch(error){console.error('LIVE_SENTENCE_FAIL',JSON.stringify({engine,commit:expected,error:String(error),errors}));process.exitCode=1;}
 finally{await context.close();await browser.close();}
}
