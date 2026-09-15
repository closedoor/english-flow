import assert from 'node:assert/strict';
import {chromium,webkit} from '/tmp/ef-delivery/node_modules/playwright/index.mjs';
const expected='cfd3aa27ae44b21a5bca334ade86f8140966cb7f';
const current='https://english-flow-mwnn.onrender.com';
const old='https://english-flow.iscream95.chatgpt.site';
for(const base of [current,old]) {
  for(const path of ['/', '/build-info.json', '/manifest.webmanifest']) {
    try {const r=await fetch(base+path,{cache:'no-store',signal:AbortSignal.timeout(12000)});const text=await r.text();console.log('ORIGIN_PROBE',JSON.stringify({base,path,status:r.status,url:r.url,contentType:r.headers.get('content-type'),title:text.match(/<title>(.*?)<\/title>/s)?.[1],text:path!=='/'?text.slice(0,650):undefined,build:text.match(/name="english-flow-build"[^>]*content="([^"]+)/)?.[1],autoplaySource:text.includes('自动例句三遍')}));} catch(e){console.log('ORIGIN_PROBE_FAILED',JSON.stringify({base,path,error:String(e)}));}
  }
}
for(const [name,engine] of [['chromium',chromium],['webkit',webkit]]) {
  const browser=await engine.launch({headless:true});
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,serviceWorkers:'allow'});
  // A fresh private test context only. There is no account login or server-side
  // learning store. No existing learner's browser, data or backup is accessed.
  await context.addInitScript(()=>{
    const state={log:[],active:null,gesture:false,activated:false,end(){const u=this.active;this.active=null;u?.onend?.();}};
    window.__deliverySpeech=state;
    for(const event of ['click','touchend','keydown']) {document.addEventListener(event,()=>{state.gesture=true;state.activated=true;},true);window.addEventListener(event,()=>{state.gesture=false;});}
    Object.defineProperty(window,'SpeechSynthesisUtterance',{configurable:true,value:class{constructor(text){this.text=text;}}});
    Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{paused:false,getVoices(){return[];},cancel(){state.active=null;},resume(){this.paused=false;},speak(u){state.log.push({text:u.text,gesture:state.gesture,rate:u.rate});state.active=u;u.onstart?.();}}});
  });
  const page=await context.newPage();page.setDefaultTimeout(20000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  try {
    const r=await page.goto(current+'/?ef-update='+expected,{waitUntil:'domcontentloaded',timeout:45000});assert.equal(r.status(),200);
    await page.locator('.bottom-nav').waitFor();
    assert.equal(await page.title(),'词流英语');
    assert.equal(await page.locator('meta[name="english-flow-build"]').getAttribute('content'),expected);
    await page.locator('.bottom-nav button').filter({hasText:'学习'}).click();
    await page.getByRole('button',{name:'自由学习',exact:false}).click();
    await page.getByRole('button',{name:'10 个',exact:true}).click();
    await page.getByRole('button',{name:'开始这组学习',exact:true}).click();
    await page.locator('.word-card').waitFor();
    assert.equal(await page.getByRole('button',{name:'自动例句三遍：开',exact:true}).count(),1);
    const checks=[];
    for(const action of ['first','next','known','difficult']) {
      const before=await page.evaluate(()=>window.__deliverySpeech.log.length);
      if(action==='next')await page.getByRole('button',{name:'下一张 ›',exact:true}).click();
      if(action==='known')await page.getByRole('button',{name:'我学会了',exact:true}).click();
      if(action==='difficult'){await page.waitForTimeout(400);await page.getByRole('button',{name:'还不熟悉',exact:true}).click();}
      const text=await page.locator('.example-box p').innerText();
      const from=action==='first'?0:before;
      await page.waitForFunction(n=>window.__deliverySpeech.log.length===n,from+1);
      for(let i=0;i<3;i++)await page.evaluate(()=>window.__deliverySpeech.end());
      const logged=await page.evaluate(from=>window.__deliverySpeech.log.slice(from),from);
      assert.deepEqual(logged.map(u=>u.text),[text,text,text]);assert.equal(logged[0].gesture,true);
      checks.push({action,text,utterances:logged.length,firstInsideGesture:logged[0].gesture});
    }
    const info={engine:name,origin:new URL(page.url()).origin,url:page.url(),build:await page.locator('.word-auto-build').innerText(),controls:await page.locator('.word-auto-controls').innerText(),checks,errors,instrumentedSpeech:true};
    assert.deepEqual(errors,[]);console.log('LIVE_RENDER_UI_PASS',JSON.stringify(info));
    await page.reload();await page.locator('.word-card').waitFor();assert.equal(await page.locator('.word-auto-build').innerText(),'例句三遍版 · cfd3aa2');
    console.log('LIVE_RENDER_RELOAD_PASS',name);
  }catch(e){console.log('LIVE_RENDER_UI_FAIL',JSON.stringify({engine:name,error:String(e),url:page.url(),body:(await page.locator('body').innerText().catch(()=>'' )).slice(0,1500),errors}));process.exitCode=1;}
  await context.close();await browser.close();
}
