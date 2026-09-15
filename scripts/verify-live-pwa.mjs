import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
if(!process.env.PLAYWRIGHT_MODULE)throw Error('Set PLAYWRIGHT_MODULE to the isolated Playwright installation.');
const pw=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const base=new URL(process.env.PRODUCTION_URL||'https://english-flow-mwnn.onrender.com/');
if(!['https://english-flow-mwnn.onrender.com','http://127.0.0.1:4173','http://localhost:4173'].includes(base.origin))throw Error('Only the official static site or local rehearsal is allowed.');
const expected=process.env.EXPECTED_COMMIT;
assert.match(expected||'',/^[0-9a-f]{40}$/);
const mimeResponse=await fetch(new URL('/manifest.webmanifest',base),{cache:'no-store',signal:AbortSignal.timeout(12000)});
console.log('LIVE_MANIFEST_HEADER',mimeResponse.status,mimeResponse.headers.get('content-type'));
for(const name of ['chromium','webkit']){
  const browser=await pw[name].launch({headless:true});
  // Brand-new isolated profile, never an existing learner's browser or account.
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,serviceWorkers:'allow'});
  await context.addInitScript(()=>{
    const state={log:[],active:null,gesture:false,end(){const u=this.active;this.active=null;u?.onend?.();}};
    window.__pwaSpeech=state;
    for(const event of ['click','touchend','keydown']){document.addEventListener(event,()=>{state.gesture=true;},true);window.addEventListener(event,()=>{state.gesture=false;});}
    Object.defineProperty(window,'SpeechSynthesisUtterance',{configurable:true,value:class{constructor(text){this.text=text;}}});
    Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{paused:false,getVoices(){return[];},cancel(){state.active=null;},resume(){this.paused=false;},speak(u){state.log.push({text:u.text,gesture:state.gesture});state.active=u;u.onstart?.();}}});
  });
  const page=await context.newPage();page.setDefaultTimeout(30000);const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  try{
    const url=new URL('/',base);url.searchParams.set('ef-update',expected);
    const response=await page.goto(url.href,{waitUntil:'domcontentloaded',timeout:45000});
    assert.equal(response.status(),200);assert.equal(await page.title(),'词流英语');
    assert.equal(await page.locator('meta[name="english-flow-build"]').getAttribute('content'),expected);
    await page.locator('.bottom-nav').waitFor();
    await page.waitForFunction(async()=>{
      const registration=await navigator.serviceWorker.getRegistration();
      return registration?.active?.state==='activated'&&!!navigator.serviceWorker.controller;
    },null,{timeout:30000});
    const cached=await page.evaluate(async()=>{
      const names=(await caches.keys()).filter(name=>name.startsWith('wordflow-ngsl-')&&!name.endsWith('-staging'));
      for(const name of names){const response=await(await caches.open(name)).match('/manifest.webmanifest');if(response)return{cache:name,type:response.headers.get('content-type'),manifest:await response.json()};}
      return null;
    });
    assert.ok(cached,'The real worker must complete its app-shell cache, not merely register');
    assert.match(cached.type,/json|manifest/);assert.equal(cached.manifest.name,'词流英语');
    await page.locator('.bottom-nav button').filter({hasText:'学习'}).click();
    await page.getByRole('button',{name:'自由学习',exact:false}).click();
    await page.getByRole('button',{name:'10 个',exact:true}).click();
    await page.getByRole('button',{name:'开始这组学习',exact:true}).click();
    await page.locator('.word-card').waitFor();
    await page.getByRole('button',{name:'自动例句三遍：开',exact:true}).waitFor();
    assert.ok((await page.locator('.word-auto-build').innerText()).includes(expected.slice(0,7)));
    const checks=[];
    for(const action of ['first','next','known','difficult']){
      const before=await page.evaluate(()=>window.__pwaSpeech.log.length);
      if(action==='next')await page.getByRole('button',{name:'下一张 ›',exact:true}).click();
      if(action==='known')await page.getByRole('button',{name:'我学会了',exact:true}).click();
      if(action==='difficult'){await page.waitForTimeout(400);await page.getByRole('button',{name:'还不熟悉',exact:true}).click();}
      const from=action==='first'?0:before;
      await page.waitForFunction(n=>window.__pwaSpeech.log.length===n,from+1);
      const example=await page.locator('.example-box p').innerText();
      for(let i=0;i<3;i++)await page.evaluate(()=>window.__pwaSpeech.end());
      const utterances=await page.evaluate(from=>window.__pwaSpeech.log.slice(from),from);
      assert.deepEqual(utterances.map(item=>item.text),[example,example,example]);assert.equal(utterances[0].gesture,true);
      checks.push({action,example,repeats:utterances.length});
    }
    const snapshot=await page.evaluate(()=>localStorage.getItem('wordflow-active-session-v1'));
    await page.reload();await page.locator('.word-card').waitFor();
    assert.equal(await page.evaluate(()=>localStorage.getItem('wordflow-active-session-v1')),snapshot);
    assert.ok((await page.locator('.word-auto-build').innerText()).includes(expected.slice(0,7)));
    assert.deepEqual(errors,[]);
    console.log('LIVE_PWA_PASS',JSON.stringify({engine:name,commit:expected,workerActivated:true,manifestCache:cached.cache,cachedManifestType:cached.type,checks,reloadProgressPreserved:true,instrumentedSpeech:true}));
  }catch(error){
    console.error('LIVE_PWA_FAIL',JSON.stringify({engine:name,error:String(error),url:page.url(),registrations:await page.evaluate(async()=>(await navigator.serviceWorker.getRegistrations()).map(r=>({active:r.active?.state,waiting:r.waiting?.state,installing:r.installing?.state}))).catch(()=>[]),errors}));
    process.exitCode=1;
  }finally{await context.close();await browser.close();}
}
