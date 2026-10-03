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
     await list.scrollIntoViewIfNeeded();const box=await list.boundingBox();
     const scrollEnd=page.evaluate(selector=>new Promise((resolve,reject)=>{
      const element=document.querySelector(selector);
      const deadline=setTimeout(()=>{element.removeEventListener('scrollend',done);reject(new Error('Native result-list scroll did not complete'));},5000);
      const done=()=>{clearTimeout(deadline);element.removeEventListener('scrollend',done);resolve();};
      element.addEventListener('scrollend',done,{once:true});
     }),listSelector);
     await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.wheel(0,180);await scrollEnd;
     assert.ok(await list.evaluate(element=>element.scrollTop>0),'The learner must actually scroll before releasing presentation');
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
