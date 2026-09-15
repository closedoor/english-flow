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
async function verifyTopStart(page, module) {
  await page.waitForFunction(() => window.scrollY === 0);
  const metrics = await page.locator('.setup-start').evaluate(button => {
    const r = button.getBoundingClientRect();
    const section = button.closest('section');
    const header = section.querySelector('header').getBoundingClientRect();
    const firstOption = section.querySelector('.setup-block').getBoundingClientRect();
    return {top:r.top,bottom:r.bottom,height:r.height,headerBottom:header.bottom,firstOptionTop:firstOption.top,navTop:document.querySelector('.bottom-nav').getBoundingClientRect().top,hit:button.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)),count:section.querySelectorAll('.setup-start').length};
  });
  assert.equal(metrics.count, 1);
  assert.ok(metrics.top >= metrics.headerBottom && metrics.top < 260);
  assert.ok(metrics.bottom < metrics.firstOptionTop && metrics.bottom < metrics.navTop);
  assert.ok(metrics.height >= 44 && metrics.hit);
  console.log('LIVE_SETUP_START_PASS', JSON.stringify({module,commit:expected,...metrics}));
}
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
    // Resolve the asynchronous registration lookup in Node, rather than
    // allowing a truthy Promise or an installing worker to satisfy a poll.
    const deadline=Date.now()+30000;
    let workerReady=false;
    while(Date.now()<deadline){
      workerReady=await page.evaluate(async()=>{
        const registration=await navigator.serviceWorker.getRegistration();
        return Boolean(registration?.active?.state==='activated'&&navigator.serviceWorker.controller?.state==='activated');
      });
      if(workerReady)break;
      await page.waitForTimeout(150);
    }
    assert.equal(workerReady,true,'The live worker must actually activate and control the page');
    const cached=await page.evaluate(async()=>{
      const names=(await caches.keys()).filter(name=>name.startsWith('wordflow-ngsl-')&&!name.endsWith('-staging'));
      for(const name of names){const response=await(await caches.open(name)).match('/manifest.webmanifest');if(response)return{cache:name,type:response.headers.get('content-type'),manifest:await response.json()};}
      return null;
    });
    assert.ok(cached,'The real worker must complete its app-shell cache, not merely register');
    assert.match(cached.type,/json|manifest/);assert.equal(cached.manifest.name,'词流英语');
    await page.locator('.bottom-nav button').filter({hasText:'学习'}).click();
    await verifyTopStart(page, 'learn');
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
    await page.locator('.bottom-nav button').filter({hasText:'句库'}).click();
    await page.waitForFunction(() => { const button=document.querySelector('.sentence-page .setup-start'); return button && !button.disabled; });
    await verifyTopStart(page, 'sentences');
    const startBox = await page.locator('.setup-start').boundingBox();
    await page.mouse.click(startBox.x+startBox.width/2, startBox.y+startBox.height/2);
    await page.locator('.sentence-study-card').waitFor();
    assert.equal(await page.evaluate(()=>localStorage.getItem('wordflow-active-session-v1')),snapshot);
    assert.deepEqual(errors,[]);
    console.log('LIVE_PWA_PASS',JSON.stringify({engine:name,commit:expected,workerActivated:true,manifestCache:cached.cache,cachedManifestType:cached.type,checks,reloadProgressPreserved:true,instrumentedSpeech:true}));
  }catch(error){
    console.error('LIVE_PWA_FAIL',JSON.stringify({engine:name,error:String(error),url:page.url(),registrations:await page.evaluate(async()=>(await navigator.serviceWorker.getRegistrations()).map(r=>({active:r.active?.state,waiting:r.waiting?.state,installing:r.installing?.state}))).catch(()=>[]),errors}));
    process.exitCode=1;
  }finally{await context.close();await browser.close();}
}
