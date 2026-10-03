import { openSetupDetails, selectSentenceMethod, resumePausedSentence } from './browser-disclosures.mjs';
import { navigate } from './browser-navigation.mjs';
import {assertSentenceCardGeometry} from './sentence-card-geometry.mjs';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
if(!process.env.PLAYWRIGHT_MODULE)throw Error('Set PLAYWRIGHT_MODULE; see TESTING.md.');
const pw=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const origin=process.env.BROWSER_TEST_URL||'http://127.0.0.1:4173';
if(!['localhost','127.0.0.1','[::1]'].includes(new URL(origin).hostname))throw Error('Synthetic sentence tests must remain local.');
const key='wordflow-sentence-active-session-v1';const results=[];
async function ready(page){await page.goto(origin,{waitUntil:'domcontentloaded'});await page.locator('.bottom-nav').waitFor();}
const nav=navigate;
async function begin(page,{mode='英文卡片',band='短句'}={}){await ready(page);await nav(page,'句子');await selectSentenceMethod(page,mode);await page.locator('.sentence-band-switch button').filter({hasText:band}).click();const start=page.getByRole('button',{name:'开始学习句子',exact:true});await page.waitForFunction(()=>!document.querySelector('.sentence-page .setup-start').disabled);await start.click();await page.locator('.sentence-study-card').waitFor();}
const log=page=>page.evaluate(()=>window.__sentenceSpeech.log);
const stored=page=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)),key);
const exit=page=>page.getByRole('button',{name:'返回句库设置并保留进度',exact:true}).click();
async function openSentenceLookup(page,mode='英文卡片'){
 await ready(page);await nav(page,'句子');await selectSentenceMethod(page,mode);
 await openSetupDetails(page,'.sentence-find');await page.getByRole('searchbox',{name:'搜索长短句',exact:true}).fill('you');
 const result=page.locator('.sentence-result-list button[data-sentence-id]').first();await result.waitFor();await result.click();
 await page.locator('.sentence-study-card').waitFor();
 await page.waitForFunction(key=>JSON.parse(localStorage.getItem(key)||'null')?.kind==='lookup',key);
 const snapshot=await stored(page);assert.equal(snapshot.sentenceIds.length,1);assert.equal(snapshot.band,'short');return snapshot;
}
async function finishSequence(page,from){
 await page.waitForFunction(n=>window.__sentenceSpeech.log.length===n,from+1);
 const english=await page.locator('.sentence-english').innerText(),chinese=await page.locator('.sentence-translation').innerText();
 for(let i=0;i<4;i++)await page.evaluate(()=>window.__sentenceSpeech.end());
 const items=(await log(page)).slice(from);assert.deepEqual(items.map(u=>u.text),[english,english,english,chinese]);assert.deepEqual(items.map(u=>u.lang),['en-US','en-US','en-US','zh-CN']);
 assert.equal(items[0].gesture,true);return items;
}
async function tapUncovered(page,name){
 const button=page.getByRole('button',{name,exact:true});
 const rect=await button.boundingBox();assert.ok(rect&&rect.y>=0&&rect.y+rect.height<=page.viewportSize().height,`${name} must be on screen`);
 assert.equal(await button.evaluate(el=>{const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return hit===el||el.contains(hit);}),true,`${name} must receive a direct coordinate tap`);
 await page.touchscreen.tap(rect.x+rect.width/2,rect.y+rect.height/2);
}
async function sentenceToolbarClear(page){
 await page.waitForFunction(()=>[...document.querySelectorAll('.sentence-card-actions button')].every(button=>{const r=button.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return hit===button||button.contains(hit);}));
 const geometry=await page.evaluate(()=>{const actions=document.querySelector('.sentence-card-actions').getBoundingClientRect(),stack=document.querySelector('.status-toast-stack').getBoundingClientRect();return {actionsTop:actions.top,stackBottom:stack.bottom,overflow:document.documentElement.scrollWidth>innerWidth+1};});
 assert.equal(geometry.overflow,false);assert.ok(geometry.stackBottom<=geometry.actionsTop-4,JSON.stringify(geometry));
}
for(const engine of ['chromium','webkit']){
 const browser=await pw[engine].launch({headless:true});
 async function check(name,body,{seed=null,width=390,height=844}={}){
  const context=await browser.newContext({viewport:{width,height},hasTouch:true,serviceWorkers:'block'});
  await context.addInitScript(({seed,key})=>{
   if(seed&&!sessionStorage.getItem('sentence-daily-seed')){sessionStorage.setItem('sentence-daily-seed','1');localStorage.setItem(key,JSON.stringify(seed));}
   const state={log:[],all:[],active:null,gesture:false,activated:false,fail:false,end(){const u=this.active;this.active=null;u?.onend?.();}};window.__sentenceSpeech=state;
   Object.defineProperty(navigator,'userActivation',{configurable:true,value:{get hasBeenActive(){return state.activated;},get isActive(){return state.gesture;}}});
   for(const e of ['click','touchend','keydown']){document.addEventListener(e,()=>{state.gesture=true;state.activated=true;},true);window.addEventListener(e,()=>{state.gesture=false;});}
   Object.defineProperty(window,'SpeechSynthesisUtterance',{configurable:true,value:class{constructor(text){this.text=text;}}});
   Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{paused:false,getVoices(){return[{lang:'en-US',name:'English'},{lang:'zh-CN',name:'Chinese'}];},cancel(){state.active=null;},resume(){},speak(u){state.log.push({text:u.text,lang:u.lang,gesture:state.gesture});state.all.push(u);state.active=u;if(state.fail)u.onerror?.({error:'not-allowed'});else u.onstart?.();}}});
  },{seed,key});
  const page=await context.newPage();page.setDefaultTimeout(12000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{await body(page,context);assert.deepEqual(errors,[]);results.push({engine,name,status:'PASS'});}catch(e){results.push({engine,name,status:'FAIL',error:String(e),body:(await page.locator('body').innerText().catch(()=>'' )).slice(-2200),errors});}
  console.log(JSON.stringify(results.at(-1)));await context.close();
 }
 if(process.env.SENTENCE_BASELINE){
  await check('record-reported-problems',async page=>{await begin(page);console.log('SENTENCE_BASELINE',JSON.stringify({engine,utterances:(await log(page)).length,translationRequiresClick:await page.getByRole('button',{name:'点击显示中文翻译',exact:true}).count()}));await exit(page);await page.getByRole('button',{name:'开始学习句子',exact:true}).click();console.log('RESTART_BASELINE',JSON.stringify({engine,discardPrompt:await page.locator('#discard-title').count()}));});await browser.close();continue;
 }
 for(const band of ['短句','常用句','长句'])await check(`${band}-visible-translation-and-en-three-zh-once`,async page=>{await begin(page,{band});await finishSequence(page,0);assert.equal(await page.getByText('点击显示中文翻译',{exact:true}).count(),0);assert.equal(await page.locator('.sentence-translation[lang="zh-CN"]').count(),1);assert.deepEqual((await stored(page)).ratings,{});assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('wordflow-days')||'[]').length),0);});
 await check('exit-and-start-repeatedly-resumes-without-dialog-or-new-rotation',async page=>{
  await begin(page);await page.getByRole('button',{name:'下一句 ›',exact:true}).click();const before=await stored(page),rotation=await page.evaluate(()=>localStorage.getItem('wordflow-practice-rotation-v1'));
  for(let i=0;i<3;i++){await exit(page);await page.getByRole('button',{name:'开始学习句子',exact:true}).click();await page.locator('.sentence-study-card').waitFor();assert.equal(await page.locator('#discard-title').count(),0);assert.deepEqual(await stored(page),before);}
  assert.equal(await page.evaluate(()=>localStorage.getItem('wordflow-practice-rotation-v1')),rotation);
 });
 for(const reload of [false,true])await check(`searched-single-sentence-cannot-replace-the-normal-range-${reload?'after-reload':'same-visit'}`,async page=>{
  await openSentenceLookup(page);if(reload){await page.reload();await page.locator('.sentence-study-card').waitFor();assert.equal((await stored(page)).kind,'lookup');}
  await exit(page);await page.getByRole('button',{name:'开始学习句子',exact:true}).click();await page.locator('.sentence-study-card').waitFor();
  await page.waitForFunction(key=>JSON.parse(localStorage.getItem(key)||'null')?.continuous===true,key);
  const session=await stored(page);assert.equal(session.kind,'group');assert.ok(session.sentenceIds.length>20);assert.deepEqual(session.ratings,{});assert.equal(await page.locator('#discard-title').count(),0);
  assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('wordflow-days')||'[]')),[],'Looking up and starting a range must not award learning days');
 });
 await check('explicit-searched-sentence-continuation-stays-single-and-keeps-recall-hidden',async page=>{
  const before=await openSentenceLookup(page,'看中文说英文');assert.equal(await page.locator('.sentence-english').count(),0);assert.equal((await log(page)).length,0);
  await exit(page);await resumePausedSentence(page);await page.locator('.sentence-study-card').waitFor();assert.deepEqual(await stored(page),before);
  assert.equal(await page.locator('.sentence-english').count(),0);assert.equal((await log(page)).length,0);
 });
 await check('unmarked-legacy-one-item-practice-retains-normal-and-explicit-continuation',async page=>{
  await page.goto(origin,{waitUntil:'domcontentloaded'});await page.locator('.sentence-study-card').waitFor();const before=await stored(page);
  for(const explicit of [false,true]){await exit(page);if(explicit)await resumePausedSentence(page);else await page.getByRole('button',{name:'开始学习句子',exact:true}).click();await page.locator('.sentence-study-card').waitFor();assert.deepEqual(await stored(page),before);assert.equal((await stored(page)).kind,undefined);assert.equal(await page.locator('#discard-title').count(),0);}
 },{seed:{version:1,updatedAt:Date.now(),band:'short',category:'all',count:10,mode:'speak',sentenceIds:[1],index:0,ratings:{}}});
 await check('unrated-first-card-can-change-settings-without-discard-warning',async page=>{await begin(page);await exit(page);await openSetupDetails(page,'.sentence-range');await page.locator('.sentence-band-switch button').filter({hasText:'常用句'}).click();await page.waitForFunction(()=>!document.querySelector('.sentence-page .setup-start').disabled);await page.getByRole('button',{name:'开始学习句子',exact:true}).click();await page.locator('.sentence-study-card').waitFor();assert.equal(await page.locator('#discard-title').count(),0);const session=await stored(page);assert.equal(session.continuous,true);assert.ok(session.sentenceIds.length>20);assert.ok(session.sentenceIds.every(id=>id>1000&&id<=2000));});
 await check('real-progress-still-protected-for-a-changed-learning-range',async page=>{await begin(page);await page.locator('.learn-actions .secondary-action').click();await exit(page);const before=await stored(page);await openSetupDetails(page,'.sentence-range');await page.locator('.sentence-band-switch button').filter({hasText:'常用句'}).click();await page.waitForFunction(()=>!document.querySelector('.sentence-page .setup-start').disabled);await page.getByRole('button',{name:'开始学习句子',exact:true}).click();await page.locator('#discard-title').waitFor();await page.getByRole('button',{name:'保留进度',exact:true}).click();assert.deepEqual(await stored(page),before);await resumePausedSentence(page);await page.locator('.sentence-study-card').waitFor();assert.equal((await stored(page)).index,before.index);});
 await check('next-previous-known-difficult-and-swipe-own-their-current-audio',async page=>{
  await begin(page);await finishSequence(page,0);
  for(const label of ['下一句 ›','‹ 上一句','我学会了','还不熟悉']){await page.waitForTimeout(380);const before=(await log(page)).length;await page.getByRole('button',{name:label,exact:true}).click();await finishSequence(page,before);}
  const before=(await log(page)).length;await page.locator('.sentence-study-card').evaluate(card=>{const touch=x=>({identifier:1,clientX:x,clientY:250});for(const [name,x]of[['touchstart',270],['touchend',50]]){const e=new Event(name,{bubbles:true});Object.defineProperty(e,'touches',{value:name==='touchstart'?[touch(x)]:[]});Object.defineProperty(e,'changedTouches',{value:[touch(x)]});card.dispatchEvent(e);}});await finishSequence(page,before);
 });
 await check('quick-next-cancels-old-chinese-and-late-callbacks',async page=>{await begin(page);await page.getByRole('button',{name:'下一句 ›',exact:true}).click();await page.evaluate(()=>{const u=window.__sentenceSpeech.all[0];u.onend();u.onerror({error:'interrupted'});u.onstart();});await finishSequence(page,1);});
 await check('bookmark-does-not-restart-completed-sequence-or-rate-card',async page=>{await begin(page);await finishSequence(page,0);await page.getByRole('button',{name:'收藏句子',exact:true}).click();await page.waitForTimeout(120);assert.equal((await log(page)).length,4);assert.deepEqual((await stored(page)).ratings,{});});
 await check('minimal-card-replay-and-exit-cancel-old-sequences',async page=>{
  await begin(page);assert.equal(await page.locator('.bottom-nav,.sentence-auto-controls,.session-progress,.card-count,.sentence-source,.sentence-learn-page h1').count(),0);
  assert.doesNotMatch(await page.locator('.sentence-learn-page').innerText(),/句子卡片|短句|已标记|英文三遍|中文一遍|来源|自动朗读|停止朗读/);
  const before=await stored(page);await page.getByRole('button',{name:'重播本句',exact:true}).click();await page.evaluate(()=>window.__sentenceSpeech.all[0].onend?.());await finishSequence(page,1);assert.deepEqual(await stored(page),before);
  await page.getByRole('button',{name:'重播本句',exact:true}).click();const n=(await log(page)).length;await exit(page);await page.evaluate(()=>window.__sentenceSpeech.all.forEach(u=>u.onend?.()));assert.equal((await log(page)).length,n);assert.deepEqual(await stored(page),before);
  await page.locator('.setup-source>summary').click();assert.equal(await page.locator('.sentence-source a').isVisible(),true,'Attribution remains available after exiting the card');
 });
 await check('leaving-hidden-and-restored-pages-do-not-spawn-background-speech',async page=>{await begin(page);await nav(page,'今天');const n=(await log(page)).length;await page.evaluate(()=>window.__sentenceSpeech.all.forEach(u=>u.onend?.()));assert.equal((await log(page)).length,n);await nav(page,'句子');assert.equal((await log(page)).length,n);await page.getByRole('button',{name:'开始学习句子',exact:true}).click();await page.locator('.sentence-study-card').waitFor();assert.equal((await log(page)).at(-1).gesture,true);await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));window.__sentenceSpeech.all.forEach(u=>u.onend?.());});assert.equal(await page.evaluate(()=>window.__sentenceSpeech.active),null);});
 await check('reload-retains-current-records-with-a-working-gesture-replay',async page=>{await begin(page);await page.getByRole('button',{name:'下一句 ›',exact:true}).click();const before=await stored(page);await page.reload();await page.locator('.sentence-study-card').waitFor();assert.equal((await log(page)).length,0);assert.deepEqual(await stored(page),before);await page.getByRole('button',{name:/重播本句/}).click();await finishSequence(page,0);});
 await check('speaking-first-mode-never-reveals-or-auto-reads-English',async page=>{await begin(page,{mode:'看中文说英文'});assert.equal((await log(page)).length,0);assert.equal(await page.locator('.sentence-english').count(),0);await page.getByRole('button',{name:'我说好了，查看英文答案',exact:true}).click();assert.equal((await log(page)).length,0);await page.getByRole('button',{name:'我学会了',exact:true}).click();assert.equal(await page.locator('.sentence-english').count(),0);assert.equal((await log(page)).length,0);});
 await check('blocked-audio-keeps-visible-text-and-progress-usable',async page=>{await begin(page);await page.evaluate(()=>window.__sentenceSpeech.fail=true);await page.getByRole('button',{name:'下一句 ›',exact:true}).click();assert.ok(await page.locator('.sentence-translation').innerText());assert.deepEqual((await stored(page)).ratings,{});await page.evaluate(()=>window.__sentenceSpeech.fail=false);const n=(await log(page)).length;await page.getByRole('button',{name:/重播本句/}).click();await finishSequence(page,n);});
 for(const size of [{width:320,height:568},{width:390,height:844},{width:430,height:932}])await check(`bilingual-text-stays-together-with-thumb-replay-${size.width}`,async page=>{
  await begin(page);console.log('SENTENCE_CARD_GEOMETRY',JSON.stringify({engine,...await assertSentenceCardGeometry(page)}));
  const before=await stored(page),n=(await log(page)).length;await tapUncovered(page,'重播本句');await finishSequence(page,n);
  assert.deepEqual(await stored(page),before,'Replay must preserve the card, position and ratings');
  await tapUncovered(page,'下一句 ›');await page.waitForFunction(({key,index})=>JSON.parse(localStorage.getItem(key)).index===index+1,{key,index:before.index});
  await assertSentenceCardGeometry(page);
 },size);
 await check('recall-reveal-and-manual-audio-share-the-bottom-thumb-toolbar',async page=>{
  await begin(page,{mode:'看中文说英文'});const before=await stored(page);
  assert.equal(await page.getByRole('button',{name:'播放英文',exact:true}).isDisabled(),true);
  await tapUncovered(page,'播放英文');assert.equal((await log(page)).length,0);assert.equal(await page.locator('.sentence-english').count(),0);assert.deepEqual(await stored(page),before);
  await tapUncovered(page,'我说好了，查看英文答案');await page.locator('.speak-answer').waitFor();assert.equal((await log(page)).length,0);
  await assertSentenceCardGeometry(page,{recall:true});const revealed=await stored(page);await tapUncovered(page,'播放英文');
  assert.equal((await log(page)).length,1);assert.equal((await log(page))[0].text,await page.locator('.sentence-english').innerText());assert.deepEqual(await stored(page),revealed);
 });
 for(const size of [{width:320,height:568},{width:390,height:844}])await check(`stacked-warnings-preserve-coordinate-sentence-navigation-${size.width}`,async page=>{
  await begin(page);await page.evaluate(()=>{window.__sentenceSpeech.fail=true;window.dispatchEvent(new CustomEvent('english-flow-speech-error',{detail:'chinese-unavailable'}));window.dispatchEvent(new Event('english-flow-offline-cache-error'));window.dispatchEvent(new Event('offline'));});
  await page.getByRole('button',{name:'关闭语音提示',exact:true}).waitFor();await page.getByRole('button',{name:'关闭离线保存提示',exact:true}).waitFor();await page.locator('.offline-status').waitFor();await sentenceToolbarClear(page);
  const before=await stored(page);await tapUncovered(page,'下一句 ›');await page.waitForFunction(({key,index})=>JSON.parse(localStorage.getItem(key)).index===index+1,{key,index:before.index});await sentenceToolbarClear(page);
  await tapUncovered(page,'‹ 上一句');await page.waitForFunction(({key,index})=>JSON.parse(localStorage.getItem(key)).index===index,{key,index:before.index});await sentenceToolbarClear(page);assert.deepEqual((await stored(page)).ratings,before.ratings);
  await tapUncovered(page,'关闭语音提示');await page.getByRole('button',{name:'关闭语音提示',exact:true}).waitFor({state:'hidden'});await sentenceToolbarClear(page);
  await tapUncovered(page,'关闭离线保存提示');await page.getByRole('button',{name:'关闭离线保存提示',exact:true}).waitFor({state:'hidden'});await sentenceToolbarClear(page);
  await page.evaluate(()=>{window.__sentenceSpeech.fail=false;window.dispatchEvent(new Event('online'));});await page.locator('.status-toast-stack').waitFor({state:'hidden'});
 },size);
 for(const size of [{width:320,height:568},{width:390,height:844},{width:844,height:390}])await check(`long-sentence-full-content-and-actions-reachable-${size.width}`,async page=>{
  await begin(page,{band:'长句'});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.equal(await page.locator('.bottom-nav').count(),0);
  for(const name of ['返回句库设置并保留进度','慢速播放','重播本句','收藏句子']){const button=page.getByRole('button',{name,exact:true});await button.scrollIntoViewIfNeeded();const r=await button.boundingBox();assert.ok(r.width>=44&&r.height>=44);}
  const translation=page.locator('.sentence-translation');await translation.scrollIntoViewIfNeeded();assert.ok(await translation.innerText());
  assert.equal(await translation.evaluate(el=>{const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.x+8,r.y+r.height/2);return hit===el||el.contains(hit);}),true,'Translation must be readable above the toolbar');
  const before=await stored(page);await tapUncovered(page,'下一句 ›');await page.waitForFunction(({key,index})=>JSON.parse(localStorage.getItem(key)).index===index+1,{key,index:before.index});assert.equal(await page.locator('.sentence-study-card').evaluate(el=>el.scrollTop),0);
 },size);
 await check('large-text-speaking-answer-scrolls-within-card-and-next-resets-recall',async page=>{
  await begin(page,{mode:'看中文说英文',band:'长句'});await page.addStyleTag({content:'html{font-size:32px!important}'});
  assert.equal(await page.getByRole('button',{name:'慢速播放',exact:true}).isDisabled(),true);assert.equal((await log(page)).length,0);
  await page.getByRole('button',{name:'我说好了，查看英文答案',exact:true}).click();const answer=page.locator('.speak-answer');await answer.waitFor();assert.equal((await log(page)).length,0);assert.equal(await answer.evaluate(el=>document.activeElement===el),true);
  await page.locator('.sentence-study-card').hover();
  await page.evaluate(()=>{window.__sentenceWheelComplete=false;document.querySelector('.sentence-study-card').addEventListener('scrollend',()=>{window.__sentenceWheelComplete=true;},{once:true});});
  await page.mouse.wheel(0,1200);await page.waitForFunction(()=>window.__sentenceWheelComplete&&document.querySelector('.sentence-study-card').scrollTop>0);
  assert.ok(await page.locator('.sentence-study-card').evaluate(el=>el.scrollTop>0),'Large text must scroll within the card');const position=await page.locator('.sentence-study-card').evaluate(el=>el.scrollTop);await tapUncovered(page,'播放英文');
  assert.equal((await log(page)).length,1);assert.equal((await log(page))[0].text,await page.locator('.sentence-english').innerText());assert.equal(await page.locator('.sentence-study-card').evaluate(el=>el.scrollTop),position,'Replaying the same answer must not reset reading');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await tapUncovered(page,'下一句 ›');await page.locator('.speak-answer').waitFor({state:'hidden'});assert.equal(await page.locator('.sentence-study-card').evaluate(el=>el.scrollTop),0);assert.equal((await log(page)).length,1);assert.equal(await page.getByRole('button',{name:'慢速播放',exact:true}).isDisabled(),true);
 },{width:320,height:568});
 await browser.close();
}
const failed=results.filter(r=>r.status==='FAIL').length;console.log('SENTENCE_DAILY_SUMMARY',JSON.stringify({passed:results.length-failed,failed,total:results.length,instrumentedSpeech:true}));if(failed)process.exitCode=1;
