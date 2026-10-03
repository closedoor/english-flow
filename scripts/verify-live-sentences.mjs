import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {openSetupDetails,selectSentenceMethod} from './browser-disclosures.mjs';
import {navigate} from './browser-navigation.mjs';
import {assertSentenceCardGeometry} from './sentence-card-geometry.mjs';
import {verifySpeechRecovery} from './speech-recovery-checks.mjs';
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
  await page.locator('.bottom-nav').waitFor();await page.locator('.bottom-nav button').filter({hasText:'句子'}).click();await page.waitForFunction(()=>{const b=document.querySelector('.sentence-page .setup-start');return b&&!b.disabled;});await page.getByRole('button',{name:'开始学习句子',exact:true}).click();await page.locator('.sentence-translation').waitFor();
  assert.equal(await page.locator('.bottom-nav,.sentence-auto-controls,.session-progress,.card-count,.sentence-source,.sentence-learn-page h1').count(),0);
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
  const geometry=await assertSentenceCardGeometry(page);const replay=page.getByRole('button',{name:'重播本句',exact:true});const replayRect=await replay.boundingBox();
  const beforeReplay=await page.evaluate(()=>localStorage.getItem('wordflow-sentence-active-session-v1'));
  await page.touchscreen.tap(replayRect.x+replayRect.width/2,replayRect.y+replayRect.height/2);await page.waitForFunction(n=>window.__liveSentence.log.length===n,offset+1);
  const replayEnglish=await page.locator('.sentence-english').innerText(),replayChinese=await page.locator('.sentence-translation').innerText();
  for(let i=0;i<4;i++)await page.evaluate(()=>window.__liveSentence.end());
  assert.deepEqual(await page.evaluate(n=>window.__liveSentence.log.slice(n).map(u=>u.text),offset),[replayEnglish,replayEnglish,replayEnglish,replayChinese]);
  assert.equal(await page.evaluate(()=>localStorage.getItem('wordflow-sentence-active-session-v1')),beforeReplay);
  const snapshot=await page.evaluate(()=>localStorage.getItem('wordflow-sentence-active-session-v1'));
  const session=JSON.parse(snapshot);assert.equal(session.continuous,true);assert.ok(session.sentenceIds.length>20,'Live sentence learning must include the selected range beyond twenty cards');
  for(let i=0;i<2;i++){await page.getByRole('button',{name:'返回句库设置并保留进度',exact:true}).click();await page.getByRole('button',{name:'开始学习句子',exact:true}).click();await page.locator('.sentence-study-card').waitFor();assert.equal(await page.locator('#discard-title').count(),0);assert.equal(await page.evaluate(()=>localStorage.getItem('wordflow-sentence-active-session-v1')),snapshot);}
  await page.getByRole('button',{name:'返回句库设置并保留进度',exact:true}).click();
  assert.equal(await page.locator('.session-choice-summary,.resume-session-card,.setup-footnote').count(),0);
  await selectSentenceMethod(page,'看中文说英文');assert.equal(await page.locator('.sentence-range .practice-methods').isVisible(),true);
  await page.getByRole('button',{name:'开始学习句子',exact:true}).click();await page.locator('#discard-title').waitFor();await page.getByRole('button',{name:'结束并开始新练习',exact:true}).click();await page.locator('.speak-prompt').waitFor();
  const spokenBefore=await page.evaluate(()=>window.__liveSentence.log.length);assert.equal(await page.locator('.sentence-english').count(),0);assert.equal(await page.getByRole('button',{name:'慢速播放',exact:true}).isDisabled(),true);
  assert.equal(await page.getByRole('button',{name:'播放英文',exact:true}).isDisabled(),true);
  assert.equal(await page.locator('.bottom-nav,.sentence-auto-controls,.session-progress,.card-count,.sentence-source,.sentence-learn-page h1').count(),0);
  await page.getByRole('button',{name:'我说好了，查看英文答案',exact:true}).click();await page.locator('.speak-answer').waitFor();assert.equal(await page.evaluate(()=>window.__liveSentence.log.length),spokenBefore);
  const recallGeometry=await assertSentenceCardGeometry(page,{recall:true});
  await page.getByRole('button',{name:'播放英文',exact:true}).click();assert.equal(await page.evaluate(()=>window.__liveSentence.log.length),spokenBefore+1);
  await page.getByRole('button',{name:'下一句 ›',exact:true}).click();assert.equal(await page.locator('.sentence-english').count(),0);assert.equal(await page.evaluate(()=>window.__liveSentence.log.length),spokenBefore+1);
  assert.deepEqual(errors,[]);console.log('LIVE_SENTENCE_PASS',JSON.stringify({engine,commit:expected,checks,resumeWithoutDialog:true,progressPreserved:true,continuousRange:true,immersiveSentenceCards:true,practiceMethodsInsideRange:true,setupSummaryAndProgressHidden:true,recallWithoutAnswerLeak:true,compactBilingualText:true,thumbReplayVerified:true,geometry,recallGeometry,instrumentedSpeech:true}));
 }catch(error){console.error('LIVE_SENTENCE_FAIL',JSON.stringify({engine,commit:expected,error:String(error),errors}));process.exitCode=1;}
 finally{await context.close();}
 const lookupContext=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'allow'});
 // A separate fresh profile tests the deployed query flow without learner data.
 // Speech is deliberately simulated; these checks do not claim physical audio.
 await lookupContext.addInitScript(()=>{
  Object.defineProperty(window,'SpeechSynthesisUtterance',{configurable:true,value:class{constructor(text){this.text=text;}}});
  Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{paused:false,getVoices(){return[];},cancel(){},resume(){},speak(u){u.onstart?.();queueMicrotask(()=>u.onend?.());}}});
 });
 const lookupPage=await lookupContext.newPage();lookupPage.setDefaultTimeout(25000);const lookupErrors=[],lookupScripts=[];
 lookupPage.on('pageerror',error=>lookupErrors.push(error.message));
 lookupPage.on('response',response=>{if(response.request().resourceType()==='script'&&/\.m?js(?:\?|$)/.test(response.url()))lookupScripts.push(response.text().catch(()=>''));});
 const sentenceKey='wordflow-sentence-active-session-v1',savedKey='wordflow-sentence-saved-v1';
 const readSentence=()=>lookupPage.evaluate(key=>JSON.parse(localStorage.getItem(key)||'null'),sentenceKey);
 async function identifyLookupClient(){
  assert.equal(await lookupPage.title(),'词流英语');assert.equal(await lookupPage.locator('meta[name="english-flow-build"]').getAttribute('content'),expected);
  await navigate(lookupPage,'进度');assert.ok((await lookupPage.locator('.app-version-panel').innerText()).includes(`当前版本 ${expected.slice(0,7)}`),'The executing sentence lookup client must report this release');
  assert.ok((await Promise.all(lookupScripts)).some(source=>source.includes(expected)),'A loaded sentence lookup client module must contain the full release identity');
  await navigate(lookupPage,'句子');
 }
 try{
  const url=new URL('/',base);url.searchParams.set('ef-update',expected);const response=await lookupPage.goto(url.href,{waitUntil:'domcontentloaded',timeout:45000});assert.equal(response.status(),200);
  await lookupPage.locator('.bottom-nav').waitFor();await identifyLookupClient();
  await openSetupDetails(lookupPage,'.sentence-find');await lookupPage.getByRole('searchbox',{name:'搜索长短句',exact:true}).fill('you');
  const result=lookupPage.locator('.sentence-result-list button[data-sentence-id]').first();await result.waitFor();await result.click();await lookupPage.locator('.sentence-study-card').waitFor();
  await lookupPage.waitForFunction(key=>JSON.parse(localStorage.getItem(key)||'null')?.kind==='lookup',sentenceKey);
  const lookup=await readSentence();assert.equal(lookup.kind,'lookup');assert.equal(lookup.sentenceIds.length,1);assert.equal(lookup.band,'short');assert.deepEqual(lookup.ratings,{});
  const lookupId=lookup.sentenceIds[0];await lookupPage.getByRole('button',{name:'收藏句子',exact:true}).click();
  await lookupPage.waitForFunction(({key,id})=>JSON.parse(localStorage.getItem(key)||'[]').includes(id),{key:savedKey,id:lookupId});
  lookupScripts.length=0;const reloaded=await lookupPage.reload({waitUntil:'domcontentloaded'});assert.equal(reloaded.status(),200);await lookupPage.locator('.sentence-study-card').waitFor();
  assert.deepEqual(await readSentence(),lookup,'Reload must retain the lookup identity, IDs, position, ratings and timestamp');
  assert.deepEqual(await lookupPage.evaluate(key=>JSON.parse(localStorage.getItem(key)||'[]'),savedKey),[lookupId],'The query bookmark must survive reload');
  await lookupPage.getByRole('button',{name:'返回句库设置并保留进度',exact:true}).click();await identifyLookupClient();
  await lookupPage.waitForFunction(()=>{const button=document.querySelector('.sentence-page .setup-start');return button&&!button.disabled;});await lookupPage.getByRole('button',{name:'开始学习句子',exact:true}).click();await lookupPage.locator('.sentence-study-card').waitFor();
  await lookupPage.waitForFunction(key=>JSON.parse(localStorage.getItem(key)||'null')?.continuous===true,sentenceKey);
  const group=await readSentence();assert.equal(group.kind,'group');assert.equal(group.continuous,true);assert.equal(group.band,'short');assert.equal(group.category,'all');assert.equal(group.sentenceIds.length,1000);assert.equal(new Set(group.sentenceIds).size,1000);assert.ok(group.sentenceIds.every(id=>id>=1&&id<=1000));assert.deepEqual(group.ratings,{});
  assert.equal(await lookupPage.locator('#discard-title').count(),0);assert.deepEqual(await lookupPage.evaluate(key=>JSON.parse(localStorage.getItem(key)||'[]'),savedKey),[lookupId],'Starting the normal range must retain the query bookmark');
  assert.deepEqual(await lookupPage.evaluate(()=>JSON.parse(localStorage.getItem('wordflow-days')||'[]')),[],'Querying, bookmarking and starting must not invent study days');
  assert.deepEqual(lookupErrors,[]);console.log('LIVE_SENTENCE_LOOKUP_PASS',JSON.stringify({engine,commit:expected,clientCommitVerifiedBeforeAndAfterReload:true,lookupIdentityRetainedAfterReload:true,normalStartIncludesFullRange:true,sentenceCount:group.sentenceIds.length,queryBookmarkPreserved:true,discardDialog:false,instrumentedSpeech:true}));
 }catch(error){console.error('LIVE_SENTENCE_LOOKUP_FAIL',JSON.stringify({engine,commit:expected,error:String(error),errors:lookupErrors}));process.exitCode=1;}
 finally{await lookupContext.close();await browser.close();}
}
await verifySpeechRecovery(pw,base.href,expected);
