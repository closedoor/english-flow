import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const pw=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const oldRoot='/tmp/english-flow-before',newRoot=path.resolve('dist/client');
const meta=JSON.parse(await readFile(path.join(newRoot,'build-info.json'),'utf8'));
const origin='http://127.0.0.1:4189';let released=false;
const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon','.txt':'text/plain'};
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,origin);const relative=decodeURIComponent(url.pathname).replace(/^\/+/, '')||'index.html';
  if(relative.split('/').includes('..')){res.writeHead(403);res.end();return;}
  const root=released?newRoot:oldRoot;
  let body=await readFile(path.join(root,relative));
  if(relative==='build-info.json'){const data=JSON.parse(body);data.origin=origin;body=Buffer.from(JSON.stringify(data));}
  res.writeHead(200,{'content-type':mime[path.extname(relative)]||'application/octet-stream','cache-control':'no-store'});res.end(body);
 }catch{res.writeHead(404);res.end('Not found');}
});await new Promise(r=>server.listen(4189,'127.0.0.1',r));
const browser=await pw.chromium.launch({headless:true});
try{
 const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true});
 const saved={version:1,updatedAt:Date.now(),path:'frequency',mode:'free',wordIds:Array.from({length:10},(_,i)=>i+22),index:0,ratings:{},stage:'cards',quizIndex:0,quizAnswer:'',quizFeedback:null,quizResults:[]};
 await context.addInitScript(saved=>{
  if(!sessionStorage.getItem('seeded')){sessionStorage.setItem('seeded','1');localStorage.setItem('wordflow-active-session-v1',JSON.stringify(saved));localStorage.setItem('wordflow-ngsl-mastered-v1','[1,2,3]');}
  window.__spoken=[];window.__active=null;
  Object.defineProperty(navigator,'userActivation',{configurable:true,value:{hasBeenActive:false,isActive:false}});
  Object.defineProperty(window,'SpeechSynthesisUtterance',{configurable:true,value:class{constructor(text){this.text=text;}}});
  Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{paused:false,getVoices(){return[];},cancel(){window.__active=null;},resume(){},speak(u){window.__spoken.push(u.text);window.__active=u;u.onstart?.();}}});
 },saved);
 const page=await context.newPage();page.setDefaultTimeout(15000);await page.goto(origin);await page.locator('.word-card').waitFor({timeout:30000});
 await page.waitForFunction(()=>navigator.serviceWorker.controller!==null,{},{timeout:30000});
 assert.equal(await page.locator('.word-auto-controls').count(),0);
 await page.locator('[aria-label="切换词卡"] button').last().click();assert.deepEqual(await page.evaluate(()=>window.__spoken),[]);
 console.log('REPRODUCED: pre-autoplay installed NGSL ten-word page has no controls and no automatic utterance');
 released=true;await page.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration();await r.update();});
 await page.waitForFunction(async()=>Boolean((await navigator.serviceWorker.getRegistration()).waiting),{},{timeout:30000});
 assert.equal(await page.locator('.word-auto-controls').count(),0);
 console.log('REPRODUCED: server updated and worker waiting, but the already-open page still runs old JavaScript');
 const before=await page.evaluate(()=>JSON.parse(localStorage.getItem('wordflow-active-session-v1')));
 await page.goto(origin+'/?ef-update='+meta.commit);await page.locator('.word-auto-controls').waitFor({timeout:30000});
 assert.equal(await page.locator('meta[name="english-flow-build"]').getAttribute('content'),meta.commit);
 assert.equal(await page.evaluate(()=>localStorage.getItem('wordflow-ngsl-mastered-v1')),'[1,2,3]');
 const after=await page.evaluate(()=>JSON.parse(localStorage.getItem('wordflow-active-session-v1')));
 assert.deepEqual(after.wordIds,before.wordIds);assert.deepEqual(after.ratings,before.ratings);assert.equal(after.index,before.index);
 await page.locator('[aria-label="切换词卡"] button').last().click();const example=await page.locator('.example-box p').innerText();
 for(let i=0;i<3;i++)await page.evaluate(()=>{const u=window.__active;window.__active=null;u?.onend?.();});
 assert.deepEqual(await page.evaluate(()=>window.__spoken),[example,example,example]);
 console.log('INSTALLED_UPGRADE_PASS: actual old-worker/old-document -> new bundle; same ten-word progress; next card full example exactly three utterances');
 await context.close();
}finally{await browser.close();await new Promise(r=>server.close(r));}
