import assert from 'node:assert/strict';
import {navigate} from './browser-navigation.mjs';
import {openSetupDetails} from './browser-disclosures.mjs';

// Delay only the first frame scheduled by the visible return click. Other
// frames and native cancellation still run, including a subsequent navigation.
async function delayReturn(page,label){
 await page.evaluate(label=>{
  const request=window.requestAnimationFrame.bind(window),cancel=window.cancelAnimationFrame.bind(window);
  const state={armed:false,callback:null,canceled:false,id:-1};
  const arm=event=>{if(event.target instanceof Element&&event.target.closest(`button[aria-label="${label}"]`))state.armed=true;};
  window.addEventListener('click',arm,true);
  window.requestAnimationFrame=callback=>{
   if(state.armed&&!state.callback&&!state.canceled){state.armed=false;state.callback=callback;return state.id;}
   return request(callback);
  };
  window.cancelAnimationFrame=id=>{if(id===state.id){state.canceled=true;state.callback=null;}else cancel(id);};
  state.release=()=>{
   window.requestAnimationFrame=request;window.cancelAnimationFrame=cancel;window.removeEventListener('click',arm,true);
   const callback=state.callback;state.callback=null;
   return new Promise(resolve=>request(time=>{callback?.(time);resolve();}));
  };
  window.__lookupReturnFrame=state;
 },label);
 await page.getByRole('button',{name:label,exact:true}).click();
 await page.waitForFunction(()=>Boolean(window.__lookupReturnFrame?.callback));
}

export async function scrollVisibleResultList(page,selector){
 const before=await page.evaluate(selector=>{
  const element=document.querySelector(selector),bounds=element.getBoundingClientRect();
  const left=Math.max(8,bounds.left+8),right=Math.min(innerWidth-8,bounds.right-8);
  const top=Math.max(8,bounds.top+8),bottom=Math.min(innerHeight-8,bounds.bottom-8);
  let point=null;
  if(right>left&&bottom>top){
   for(const yRatio of [.5,.25,.75,.1,.9]){
    for(const xRatio of [.5,.25,.75]){
     const x=left+(right-left)*xRatio,y=top+(bottom-top)*yRatio;
     const hit=document.elementFromPoint(x,y);
     if(hit&&element.contains(hit)){point={x,y};break;}
    }
    if(point)break;
   }
  }
  return {scrollTop:element.scrollTop,maximum:element.scrollHeight-element.clientHeight,point};
 },selector);
 assert.ok(before.maximum>1&&before.point,`A scrollable, unobscured result-list point is required: ${JSON.stringify(before)}`);
 await page.mouse.move(before.point.x,before.point.y);
 assert.equal(await page.evaluate(({selector,point})=>{
  const element=document.querySelector(selector),hit=document.elementFromPoint(point.x,point.y);
  return Boolean(hit&&element.contains(hit));
 },{selector,point:before.point}),true,'The wheel target must still hit the visible result list');
 await page.mouse.wheel(0,before.scrollTop>=before.maximum-1?-180:180);
 await page.waitForFunction(({selector,scrollTop})=>Math.abs(document.querySelector(selector).scrollTop-scrollTop)>1,{selector,scrollTop:before.scrollTop},{timeout:5000});
 // Native wheel animation and scrollend delivery differ across engines. Require
 // real movement, then four stable native frames before comparing positions.
 await page.evaluate(selector=>new Promise((resolve,reject)=>{
  const element=document.querySelector(selector);let previous=element.scrollTop,stable=0,frame=0;
  const deadline=setTimeout(()=>{cancelAnimationFrame(frame);reject(new Error('Native result-list scroll did not settle'));},5000);
  const sample=()=>{
   const next=element.scrollTop;stable=next===previous?stable+1:0;previous=next;
   if(stable>=4){clearTimeout(deadline);resolve();return;}
   frame=requestAnimationFrame(sample);
  };
  frame=requestAnimationFrame(sample);
 }),selector);
 assert.ok(Math.abs(await page.locator(selector).evaluate(element=>element.scrollTop)-before.scrollTop)>1,'The learner must actually scroll before releasing presentation');
}

export async function verifyLookupReturn(check,origin){
 for(const kind of ['word','sentence']){
  const sentence=kind==='sentence',destination=sentence?'句子':'单词',disclosure=sentence?'.sentence-find':'.word-find';
  const listSelector=sentence?'.sentence-result-list':'.library-list',idAttribute=sentence?'data-sentence-id':'data-word-id';
  const searchName=sentence?'搜索长短句':'搜索词库',query=sentence?'you':'e';
  const exit=sentence?'返回句库设置并保留进度':'返回词库';
  const key=sentence?'wordflow-sentence-active-session-v1':'wordflow-active-session-v1';
  for(const action of ['normal','typing','scrolling','navigate']){
   await check(`${kind}-delayed-lookup-return-${action}`,async page=>{
    await page.goto(origin,{waitUntil:'domcontentloaded'});await page.locator('.bottom-nav').waitFor();await navigate(page,destination);
    await openSetupDetails(page,disclosure);const search=page.getByRole('searchbox',{name:searchName,exact:true});await search.fill(query);
    const list=page.locator(listSelector),target=list.locator(`button[${idAttribute}]`).nth(10);await target.waitFor();
    if(sentence)await page.waitForFunction(()=>!document.querySelector('.sentence-result-list .browser-hint'));
    await target.scrollIntoViewIfNeeded();
    const originPosition=await page.evaluate(selector=>({top:scrollY,list:document.querySelector(selector).scrollTop}),listSelector);
    const id=await target.getAttribute(idAttribute);await target.click();await page.locator(sentence?'.sentence-study-card':'.word-card').waitFor();
    await page.waitForFunction(key=>JSON.parse(localStorage.getItem(key)||'null')?.kind==='lookup',key);
    const records=await page.evaluate(()=>Object.fromEntries(Object.keys(localStorage).filter(key=>key.startsWith('wordflow-')).sort().map(key=>[key,localStorage.getItem(key)])));
    await delayReturn(page,exit);await search.waitFor();
    if(action==='typing'){
     await search.focus();await search.press('End');await page.keyboard.type(' ');
    }else if(action==='scrolling'){
     await list.scrollIntoViewIfNeeded();await scrollVisibleResultList(page,listSelector);
    }else if(action==='navigate'){
     await navigate(page,'首页');await page.locator('.home-page').waitFor();
     await page.waitForFunction(()=>window.__lookupReturnFrame.canceled);
     await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    }
    const beforeRelease=await page.evaluate(selector=>({top:scrollY,list:document.querySelector(selector)?.scrollTop??null}),listSelector);
    await page.evaluate(()=>{window.__lookupReturnFocus=document.activeElement;});
    await page.evaluate(()=>window.__lookupReturnFrame.release());
    if(action==='normal'){
     await page.waitForFunction(({top,list,selector})=>Math.abs(scrollY-top)<=2&&document.querySelector(selector).scrollTop===list,{...originPosition,selector:listSelector});
     assert.equal(await page.locator('button:focus').getAttribute(idAttribute),id,'An untouched return must focus its original result');
    }else{
     assert.equal(await page.evaluate(()=>document.activeElement===window.__lookupReturnFocus),true,'Delayed presentation must preserve the learner\'s newer focus');
     assert.equal(await page.evaluate(()=>scrollY),beforeRelease.top,'Delayed presentation must preserve the learner\'s viewport');
     if(action==='navigate')assert.equal(await page.locator('.home-page').isVisible(),true);
     else assert.equal(await list.evaluate(element=>element.scrollTop),beforeRelease.list);
     if(action==='typing')assert.equal(await search.inputValue(),query+' ');
    }
    assert.deepEqual(await page.evaluate(()=>Object.fromEntries(Object.keys(localStorage).filter(key=>key.startsWith('wordflow-')).sort().map(key=>[key,localStorage.getItem(key)]))),records,'Returning, interacting and navigating must preserve learning records');
   });
  }
 }
}
