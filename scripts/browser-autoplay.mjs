import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
if (!process.env.PLAYWRIGHT_MODULE) throw new Error('Set PLAYWRIGHT_MODULE; see TESTING.md.');
const playwright=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const origin=process.env.BROWSER_TEST_URL||'http://127.0.0.1:4173';
if(!['localhost','127.0.0.1','[::1]'].includes(new URL(origin).hostname)) throw Error('Synthetic learning records must never be used against production.');
const results=[];
const key='wordflow-active-session-v1';
const snapshot=()=>({version:1,kind:'group',updatedAt:Date.now(),path:'frequency',mode:'test',wordIds:[1],index:0,ratings:{},stage:'cards',quizIndex:0,quizAnswer:'',quizFeedback:null,quizResults:[]});
async function ready(page){await page.goto(origin,{waitUntil:'domcontentloaded'});await page.locator('.bottom-nav').waitFor({timeout:30000});}
async function nav(page,label){await page.locator('.bottom-nav button').filter({hasText:label}).click();}
async function begin(page,count=10,mode='自由学习'){
  await ready(page);await nav(page,'学习');
  await page.getByRole('button',{name:mode,exact:false}).click();
  await page.getByRole('button',{name:`${count} 个`,exact:true}).click();
  await page.getByRole('button',{name:'开始这组学习',exact:true}).click();
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
  await check('first-card-full-example-exactly-three-and-no-false-progress',async page=>{
    await begin(page);await count(page,1);
    const example=await page.locator('.example-box p').innerText();
    assert.equal((await logs(page))[0].text,example);assert.equal((await logs(page))[0].gesture,true,'first speech starts in a real input handler');
    await finish(page);await count(page,2);await finish(page);await count(page,3);await finish(page);
    await page.waitForTimeout(180);assert.deepEqual((await logs(page)).map(u=>u.text),Array(3).fill(example));
    const stored=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),key);
    assert.deepEqual(stored.ratings,{});assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('wordflow-days')||'[]').length),0);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    for(const button of await page.locator('.word-auto-controls button').all()) assert.ok((await button.boundingBox()).height>=44);
  });
  await check('next-previous-and-rating-cancel-old-example-and-start-new',async page=>{
    await begin(page,20);await count(page,1);
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
  await check('confirmation-dialog-stops-audio-and-cancel-resumes-current-card',async page=>{
    await begin(page);await page.locator('.learn-actions .primary-action').click();await count(page,2);
    await page.getByRole('button',{name:'退出本组',exact:true}).click();
    await page.locator('[role="dialog"], [role="alertdialog"]').waitFor();
    assert.equal(await page.evaluate(()=>window.__speech.active),null);
    await page.evaluate(()=>window.__speech.utterances[1].onend());assert.equal((await logs(page)).length,2);
    await page.keyboard.press('Escape');await count(page,3);
    assert.equal((await logs(page))[2].text,await page.locator('.example-box p').innerText());
  });
  await check('manual-audio-interrupts-repetition-without-restarting-it',async page=>{
    await begin(page);await count(page,1);
    const word=await page.locator('.word-heading h2').innerText();
    await page.locator('.word-card .sound-button').click();await count(page,2);assert.equal((await logs(page))[1].text,word);
    await page.evaluate(()=>window.__speech.utterances[0].onend());await finish(page);await page.waitForTimeout(160);
    assert.equal((await logs(page)).length,2);
    await page.locator('[aria-label="切换词卡"] button').last().click();await count(page,3);
  });
  await check('automatic-toggle-and-explicit-replay-remain-usable',async page=>{
    await begin(page);await count(page,1);
    await page.getByRole('button',{name:'自动例句三遍：开',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.__speech.active),null);
    await page.locator('[aria-label="切换词卡"] button').last().click();assert.equal((await logs(page)).length,1);
    await page.getByRole('button',{name:'自动例句三遍：关',exact:true}).click();await count(page,2);
    await finish(page);await finish(page);await finish(page);assert.equal((await logs(page)).length,4);
    await page.getByRole('button',{name:'重播三遍',exact:true}).click();await count(page,5);
    await finish(page);await finish(page);await finish(page);assert.equal((await logs(page)).length,7);
  });
  await check('leaving-module-stops-queue-and-does-not-speak-in-other-tabs',async page=>{
    await begin(page);await count(page,1);await nav(page,'句库');
    assert.equal(await page.evaluate(()=>window.__speech.active),null);
    await page.evaluate(()=>window.__speech.utterances[0].onend());assert.equal((await logs(page)).length,1);
    await nav(page,'学习');await count(page,2);
  });
  await check('entering-quiz-cancels-repeat-without-reading-answer',async page=>{
    await ready(page);await page.getByRole('button',{name:'重播三遍',exact:true}).click();
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
    await page.getByRole('button',{name:'重播三遍',exact:true}).click();await count(page,2);
    await page.evaluate(()=>{window.dispatchEvent(new Event('pagehide'));window.__speech.utterances[1].onend();});assert.equal((await logs(page)).length,2);
  });
  await check('restored-unactivated-card-offers-a-working-explicit-replay',async page=>{
    await ready(page);assert.equal((await logs(page)).length,0);
    await page.getByRole('button',{name:'重播三遍',exact:true}).click();await count(page,1);
    assert.equal((await logs(page))[0].gesture,true);
  },snapshot());
  await check('legacy-ten-word-group-shows-settings-after-actions-and-next-speaks-three',async page=>{
    await ready(page);await page.locator('.word-auto-controls').waitFor();
    assert.ok(await page.locator('.word-auto-controls').evaluate(el => Boolean(document.querySelector('.learn-actions').compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)));
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
  await check('scene-groups-and-single-word-lookups-keep-manual-audio',async page=>{
    await ready(page);await nav(page,'学习');await page.locator('.scene-list button').first().click();
    await page.getByRole('button',{name:'开始这组学习',exact:true}).click();await page.locator('.word-card').waitFor();assert.equal((await logs(page)).length,0);
    await page.getByRole('button',{name:'退出本组',exact:true}).click();await page.locator('.library-list button').first().click();
    await page.locator('.word-card').waitFor();assert.equal((await logs(page)).length,0);assert.equal(await page.locator('.word-auto-controls').count(),0);
  });
  await check('blocked-autoplay-does-not-rate-words-and-manual-retry-works',async page=>{
    await ready(page);await page.evaluate(()=>{window.__speech.fail=true;});await nav(page,'学习');
    await page.getByRole('button',{name:'开始这组学习',exact:true}).click();await page.locator('.word-card').waitFor();
    assert.equal((await logs(page)).length,1);
    assert.deepEqual(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).ratings,key),{});
    await page.evaluate(()=>{window.__speech.fail=false;});await page.getByRole('button',{name:'重播三遍',exact:true}).click();await count(page,2);
  });
  await browser.close();
}
const failed=results.filter(r=>r.status==='FAIL').length;
console.log('AUTOPLAY_BROWSER_SUMMARY',JSON.stringify({passed:results.length-failed,failed,total:results.length,instrumentedSpeech:true}));
if(failed) process.exitCode=1;
