import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const page=await readFile(new URL('../app/page.tsx',import.meta.url),'utf8');
const start=page.lastIndexOf('  useEffect(() => {',page.indexOf('// A shorter new article can clamp scroll'));
const end=page.indexOf('\n\n  useEffect(() => {',start+1);
assert.ok(start>=0&&end>start,'Extract the actual navigation effect');
const js=ts.transpileModule(page.slice(start,end),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;

function fixture(kind){
 const frames=new Map(),listeners=new Map(),list={scrollTop:0};let frameId=0,cleanup;
 const document={body:{name:'body'},activeElement:null};document.activeElement=document.body;
 const result={name:'original-result',focus(){document.activeElement=this;}};
 const browser={querySelector(selector){return selector.includes('button')?result:list;},focus(){document.activeElement=this;},scrollIntoView(){window.scrollY=500;}};
 const origin={id:15,scrollY:500,listScrollTop:100};
 const state={hydrated:true,tab:kind==='word'?'learn':'sentences',learnStage:'setup',sentenceSection:'library',sentenceStage:'setup',readingId:null,index:0,patternDrillIndex:0,patternIndex:0,patternStage:'setup',quizIndex:0,readingLevel:1,readingNavigation:0,reviewIndex:0,reviewView:'due',sentenceIndex:0,
  readingPositionReadyRef:{current:false},readingPositionRef:{current:new Map()},wordBrowserReturnRef:{current:kind==='word'},wordBrowserOriginRef:{current:kind==='word'?origin:null},sentenceBrowserOriginRef:{current:kind==='sentence'?origin:null},wordBrowserRef:{current:browser},sentenceBrowserRef:{current:browser}};
 const window={scrollY:0,scrollTo({top}){this.scrollY=top;},requestAnimationFrame(fn){frames.set(++frameId,fn);return frameId;},cancelAnimationFrame(id){frames.delete(id);},
  addEventListener(name,fn){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn);},removeEventListener(name,fn){listeners.get(name)?.delete(fn);}};
 const context=vm.createContext({...state,window,document,useEffect(fn){cleanup=fn();}});
 function render(next={}){cleanup?.();Object.assign(context,next);vm.runInContext(js,context);}
 function flush(){for(const [id,fn]of [...frames]){frames.delete(id);fn();}}
 function event(name){for(const fn of [...(listeners.get(name)||[])])fn();}
 function listenerCount(){return [...listeners.values()].reduce((sum,set)=>sum+set.size,0);}
 render();return{context,document,result,window,list,render,flush,event,listenerCount,cleanup:()=>cleanup?.(),frames};
}

for(const kind of ['word','sentence']){
 test(`${kind} lookup return restores its original result when the learner has not acted`,()=>{
  const app=fixture(kind);app.flush();
  assert.equal(app.document.activeElement,app.result);assert.equal(app.window.scrollY,500);assert.equal(app.list.scrollTop,100);
  assert.equal(app.listenerCount(),0,'No pending interaction observers remain after presentation');
 });
 test(`${kind} delayed return preserves newly focused search, viewport and result position`,()=>{
  const app=fixture(kind),search={name:'search',value:'new query'};
  app.document.activeElement=search;app.window.scrollY=250;app.list.scrollTop=30;app.flush();
  assert.equal(app.document.activeElement,search);assert.equal(app.window.scrollY,250);assert.equal(app.list.scrollTop,30);
  assert.equal(search.value,'new query');assert.equal(app.listenerCount(),0);
  assert.equal(kind==='word'?app.context.wordBrowserOriginRef.current:app.context.sentenceBrowserOriginRef.current,null,'The superseded return is consumed');
 });
 test(`${kind} delayed return respects scrolling and pending pointer, keyboard and touch actions`,()=>{
  for(const action of ['document-scroll','list-scroll','wheel','touchmove','pointerdown','keydown']){
   const app=fixture(kind);if(action==='document-scroll')app.window.scrollY=250;else if(action==='list-scroll')app.list.scrollTop=30;else app.event(action);
   const before={focus:app.document.activeElement,top:app.window.scrollY,list:app.list.scrollTop};app.flush();
   assert.equal(app.document.activeElement,before.focus,action);assert.equal(app.window.scrollY,before.top,action);assert.equal(app.list.scrollTop,before.list,action);
   assert.equal(app.listenerCount(),0,action);
  }
 });
 test(`${kind} leaving setup cancels the old frame and its interaction observers`,()=>{
  const app=fixture(kind);app.render({tab:'home'});app.flush();
  assert.equal(app.document.activeElement,app.document.body);assert.equal(app.window.scrollY,0);assert.equal(app.list.scrollTop,0);
  assert.equal(app.listenerCount(),0);assert.equal(app.frames.size,0);
 });
}
