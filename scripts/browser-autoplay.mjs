import { settleLearningStorage } from './storage-settlement-checks.mjs';
import { openSetupDetails } from './browser-disclosures.mjs';
import { navigate } from './browser-navigation.mjs';
import {verifySpeechRecovery} from './speech-recovery-checks.mjs';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
if (!process.env.PLAYWRIGHT_MODULE) throw new Error('Set PLAYWRIGHT_MODULE; see TESTING.md.');
const playwright=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const origin=process.env.BROWSER_TEST_URL||'http://127.0.0.1:4173';
if(!['localhost','127.0.0.1','[::1]'].includes(new URL(origin).hostname)) throw Error('Synthetic learning records must never be used against production.');
const results=[];
const key='wordflow-active-session-v1';
const snapshot=()=>({version:1,kind:'group',updatedAt:Date.now(),path:'frequency',mode:'test',wordIds:[1],index:0,ratings:{},stage:'cards',quizIndex:0,quizAnswer:'',quizFeedback:null,quizResults:[]});
const legacyFree=()=>({...snapshot(),mode:'free',wordIds:Array.from({length:10},(_,i)=>i+22)});
async function ready(page){await page.goto(origin,{waitUntil:'domcontentloaded'});await page.locator('.bottom-nav, .immersive-learning, .quiz-page').first().waitFor({timeout:30000});}
async function begin(page){
  await ready(page);await navigate(page,'单词');
  await page.getByRole('button',{name:'开始学习',exact:true}).click();
  await page.locator('.word-card').waitFor();
}
const logs=page=>page.evaluate(()=>window.__speech.log);
const finish=page=>page.evaluate(()=>window.__speech.end());
async function count(page,n){await page.waitForFunction(n=>window.__speech.log.length===n,n);}
for(const engine of ['chromium','webkit']){
  const browser=await playwright[engine].launch({headless:true});
  async function check(name,action,initial=null){
    const context=await browser.newContext({viewport:{width:320,height:780},hasTouch:true,serviceWorkers:'block'});
    await context.addInitScript(({initial,key})=>{
      if(initial&&!sessionStorage.getItem('autoplay-seeded')){sessionStorage.setItem('autoplay-seeded','1');localStorage.setItem(key,JSON.stringify(initial));}
      const state={log:[],utterances:[],active:null,gesture:false,activated:false,fail:false,end(){const u=this.active;this.active=null;u?.onend?.();}};
      window.__speech=state;
      Object.defineProperty(navigator,'userActivation',{configurable:true,value:{
        get hasBeenActive(){return state.activated;},get isActive(){return state.gesture;}
      }});
      for(const event of ['click','touchend','keydown']){
        document.addEventListener(event,()=>{state.gesture=true;state.activated=true;},true);
        window.addEventListener(event,()=>{state.gesture=false;});
      }
      Object.defineProperty(window,'SpeechSynthesisUtterance',{configurable:true,value:class{constructor(text){this.text=text;}}});
      Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{
        paused:false,getVoices(){return [];},cancel(){state.active=null;},resume(){this.paused=false;},pause(){this.paused=true;},
        speak(u){state.utterances.push(u);state.log.push({text:u.text,rate:u.rate,gesture:state.gesture});state.active=u;if(state.fail){u.onerror?.({error:'not-allowed'});}else u.onstart?.();}
      }});
    },{initial,key});
    const page=await context.newPage();page.setDefaultTimeout(12000);
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    try{await action(page,context);assert.deepEqual(errors,[]);results.push({engine,name,status:'PASS'});}
    catch(e){results.push({engine,name,status:'FAIL',error:String(e),body:(await page.locator('body').innerText().catch(()=>'' )).slice(0,1600),errors});}
    console.log(JSON.stringify(results.at(-1)));await context.close();
  }
  await check('first-continuous-card-full-example-exactly-three-and-no-false-progress',async page=>{
    await begin(page);await count(page,1);
    const example=await page.locator('.example-box p').innerText();
    assert.equal((await logs(page))[0].text,example);assert.equal((await logs(page))[0].gesture,true,'first speech starts in a real input handler');
    await finish(page);await count(page,2);await finish(page);await count(page,3);await finish(page);
    await page.waitForTimeout(180);assert.deepEqual((await logs(page)).map(u=>u.text),Array(3).fill(example));
    await settleLearningStorage(page);
    const stored=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),key);
    assert.equal(stored.continuous,true);assert.ok(stored.wordIds.length>20);assert.deepEqual(stored.ratings,{});
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('wordflow-days')||'[]').length),0);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    assert.equal(await page.locator('.bottom-nav, .word-auto-controls, .card-count, .session-progress').count(),0);
    for(const button of await page.locator('.word-card button').all()) assert.ok((await button.boundingBox()).height>=44);
  });
  await check('next-previous-and-rating-cancel-old-example-and-start-new',async page=>{
    await begin(page);await count(page,1);
    await page.locator('[aria-label="切换词卡"] button').last().click();await count(page,2);
    const next=await page.locator('.example-box p').innerText();assert.equal((await logs(page))[1].text,next);
    await page.evaluate(()=>{window.__speech.utterances[0].onend();window.__speech.utterances[0].onerror({error:'interrupted'});});
    assert.equal((await logs(page)).length,2);
    await page.locator('[aria-label="切换词卡"] button').first().click();await count(page,3);
    await page.locator('.learn-actions .primary-action').click();await count(page,4);
    assert.equal((await logs(page))[3].text,next);
    await finish(page);await finish(page);await finish(page);assert.equal((await logs(page)).length,6);
  });
  await check('horizontal-swipe-starts-current-example-without-old-callbacks',async page=>{
    await begin(page);await count(page,1);
    await page.locator('.word-card').evaluate(card=>{
      const touch=(x)=>({identifier:1,clientX:x,clientY:260});
      const start=new Event('touchstart',{bubbles:true});Object.defineProperty(start,'touches',{value:[touch(270)]});card.dispatchEvent(start);
      const end=new Event('touchend',{bubbles:true});Object.defineProperty(end,'touches',{value:[]});Object.defineProperty(end,'changedTouches',{value:[touch(40)]});card.dispatchEvent(end);
    });
    await count(page,2);assert.equal((await logs(page))[1].text,await page.locator('.example-box p').innerText());
    await page.evaluate(()=>window.__speech.utterances[0].onend());assert.equal((await logs(page)).length,2);
  });
  await check('pause-and-genuine-replacement-cancel-preserve-current-card-and-speech',async page=>{
    await begin(page);await page.locator('.learn-actions .primary-action').click();await count(page,2);
    await settleLearningStorage(page);
    const saved=await page.evaluate(key=>localStorage.getItem(key),key);
    await page.getByRole('button',{name:'退出学习并保留进度',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.__speech.active),null);
    await page.evaluate(()=>window.__speech.utterances[1].onend());assert.equal((await logs(page)).length,2);
    await openSetupDetails(page,'.word-range');await page.locator('.scene-list button').first().click();
    await page.getByRole('button',{name:'开始学习',exact:true}).click();
    await page.locator('[role="dialog"], [role="alertdialog"]').waitFor();
    await page.keyboard.press('Escape');assert.equal(await page.evaluate(key=>localStorage.getItem(key),key),saved);
    await page.locator('.path-card').click();await page.getByRole('button',{name:'开始学习',exact:true}).click();
    await page.locator('.word-card').waitFor();await count(page,3);
    assert.equal((await logs(page))[2].gesture,true);assert.equal((await logs(page))[2].text,await page.locator('.example-box p').innerText());
    assert.equal(await page.evaluate(key=>localStorage.getItem(key),key),saved);
  });
  await check('manual-word-audio-interrupts-repetition-without-restarting-it',async page=>{
    await begin(page);await count(page,1);
    const word=await page.locator('.word-heading h2').innerText();
    await page.locator('.word-card .sound-button').click();await count(page,2);assert.equal((await logs(page))[1].text,word);
    await page.evaluate(()=>window.__speech.utterances[0].onend());await finish(page);await page.waitForTimeout(160);
    assert.equal((await logs(page)).length,2);
    await page.locator('[aria-label="切换词卡"] button').last().click();await count(page,3);
  });
  await check('manual-example-replay-is-single-and-next-keeps-automatic-three',async page=>{
    await begin(page);await count(page,1);
    const example=await page.locator('.example-box p').innerText();
    await page.getByRole('button',{name:'播放场景句子',exact:true}).click();await count(page,2);
    assert.equal((await logs(page))[1].text,example);assert.equal((await logs(page))[1].gesture,true);
    await page.evaluate(()=>window.__speech.utterances[0].onend());await finish(page);await page.waitForTimeout(160);
    assert.equal((await logs(page)).length,2);
    await page.locator('[aria-label="切换词卡"] button').last().click();await count(page,3);
    const next=await page.locator('.example-box p').innerText();
    await finish(page);await finish(page);await finish(page);
    assert.deepEqual((await logs(page)).slice(2).map(u=>u.text),Array(3).fill(next));
  });
  await check('leaving-module-stops-queue-and-resuming-starts-from-current-card',async page=>{
    await begin(page);await count(page,1);await navigate(page,'句子');
    assert.equal(await page.evaluate(()=>window.__speech.active),null);
    await page.evaluate(()=>window.__speech.utterances[0].onend());assert.equal((await logs(page)).length,1);
    await navigate(page,'单词');await page.getByRole('button',{name:'开始学习',exact:true}).click();await count(page,2);
  });
  await check('legacy-entering-quiz-cancels-manual-audio-without-reading-answer',async page=>{
    await ready(page);await page.getByRole('button',{name:'播放场景句子',exact:true}).click();await count(page,1);
    const before=(await logs(page)).length;
    await page.locator('.learn-actions .primary-action').click();await page.locator('.quiz-page').waitFor();
    assert.equal(await page.evaluate(()=>window.__speech.active),null);
    await page.evaluate(()=>window.__speech.utterances.forEach(u=>u.onend?.()));
    assert.equal((await logs(page)).length,before);assert.equal(await page.locator('.word-auto-controls').count(),0);
  },snapshot());
  await check('hidden-document-and-pagehide-stop-all-repeats',async page=>{
    await begin(page);await count(page,1);
    await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));window.__speech.utterances[0].onend();});
    assert.equal((await logs(page)).length,1);assert.equal(await page.evaluate(()=>window.__speech.active),null);
    await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});
    await page.locator('[aria-label="切换词卡"] button').last().click();await count(page,2);
    await page.evaluate(()=>{window.dispatchEvent(new Event('pagehide'));window.__speech.utterances[1].onend();});assert.equal((await logs(page)).length,2);
  });
  await check('restored-unactivated-card-offers-working-manual-example-audio',async page=>{
    await ready(page);await page.locator('.word-card').waitFor();assert.equal((await logs(page)).length,0);
    await page.getByRole('button',{name:'播放场景句子',exact:true}).click();await count(page,1);
    assert.equal((await logs(page))[0].gesture,true);await finish(page);await page.waitForTimeout(160);assert.equal((await logs(page)).length,1);
  },legacyFree());
  await check('legacy-ten-word-group-remains-immersive-and-next-speaks-three',async page=>{
    await ready(page);await page.locator('.word-card').waitFor();
    assert.equal(await page.locator('.word-auto-controls, .bottom-nav, .card-count, .session-progress').count(),0);
    await page.locator('[aria-label="切换词卡"] button').last().click();await count(page,1);
    assert.equal((await logs(page))[0].gesture,true);
    const text=await page.locator('.example-box p').innerText();
    await finish(page);await finish(page);await finish(page);
    assert.deepEqual((await logs(page)).map(u=>u.text),[text,text,text]);
    await settleLearningStorage(page);
    assert.deepEqual(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).ratings,key),{});
  },{...legacyFree(),kind:undefined});
  for(const destination of ['首页','进度'])await check(`resuming-continuous-session-after-${destination}-starts-in-click-not-effect`,async page=>{
    await begin(page);await page.locator('.learn-actions .primary-action').click();await count(page,2);
    await settleLearningStorage(page);
    const saved=await page.evaluate(key=>localStorage.getItem(key),key);
    await navigate(page,destination);assert.equal(await page.evaluate(()=>window.__speech.active),null);
    await navigate(page,'单词');await page.getByRole('button',{name:'开始学习',exact:true}).click();await count(page,3);
    assert.equal((await logs(page))[2].gesture,true);assert.equal(await page.evaluate(key=>localStorage.getItem(key),key),saved);
  });
  await check('scene-ranges-and-single-word-lookups-keep-manual-audio',async page=>{
    await ready(page);await navigate(page,'单词');await openSetupDetails(page,'.word-range');await page.locator('.scene-list button').first().click();
    await page.getByRole('button',{name:'开始学习',exact:true}).click();await page.locator('.word-card').waitFor();assert.equal((await logs(page)).length,0);
    await page.getByRole('button',{name:'退出学习并保留进度',exact:true}).click();
    await openSetupDetails(page,'.word-find');await page.locator('.library-list button').first().click();
    await page.locator('.word-card').waitFor();assert.equal((await logs(page)).length,0);assert.equal(await page.locator('.word-auto-controls').count(),0);
  });
  await check('blocked-autoplay-does-not-rate-words-and-manual-example-retry-works',async page=>{
    await ready(page);await page.evaluate(()=>{window.__speech.fail=true;});await navigate(page,'单词');
    await page.getByRole('button',{name:'开始学习',exact:true}).click();await page.locator('.word-card').waitFor();
    assert.equal((await logs(page)).length,1);
    await settleLearningStorage(page);
    assert.deepEqual(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).ratings,key),{});
    await page.evaluate(()=>{window.__speech.fail=false;});await page.getByRole('button',{name:'播放场景句子',exact:true}).click();await count(page,2);
  });
  await browser.close();
}
const failed=results.filter(r=>r.status==='FAIL').length;
console.log('AUTOPLAY_BROWSER_SUMMARY',JSON.stringify({passed:results.length-failed,failed,total:results.length,instrumentedSpeech:true}));
if(failed) process.exitCode=1;
await verifySpeechRecovery(playwright,origin);
