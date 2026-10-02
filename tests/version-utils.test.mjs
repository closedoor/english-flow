import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../app/version-utils.ts',import.meta.url),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {isAppDocument,isPublishedVersion,versionReloadUrl,versionPreflightUrl,isSnapshotPersisted}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const origin='https://english-flow-mwnn.onrender.com';
const valid={app:'english-flow',title:'词流英语',origin,commit:'a'.repeat(40)};
test('version checks validate the application, origin and full commit identity',()=>{
 assert.ok(isPublishedVersion(valid,origin));
 for(const value of [null,[],{...valid,app:'other'},{...valid,origin:'https://other.test'},{...valid,commit:'abc'},{...valid,title:'other'}])assert.equal(isPublishedVersion(value,origin),false);
});
function documentFixture({title='词流英语',identities=[valid.commit],scripts=[]}={}){
 const element=attributes=>({getAttribute:name=>attributes[name]??null,textContent:attributes.text??''});
 return {title,querySelectorAll:selector=>selector==='meta[name="english-flow-build"]'
  ?identities.map(content=>element({content})):scripts.map(element)};
}
test('explicit update documents require one matching identity and a runnable same-origin app entry',()=>{
 for(const entry of [
  {src:'/assets/app.js',type:'module'},
  {src:origin+'/assets/app.js'},
  {src:'assets/app.js',type:'application/javascript'},
  {text:'import("/assets/app.js");',type:'module'},
  {text:" import ( '/assets/app.js' ) "},
 ])assert.equal(isAppDocument(documentFixture({scripts:[entry]}),valid.commit,origin),true);
 const appEntry={src:'/assets/app.js',type:'module'};
 for(const document of [
  documentFixture(),
  documentFixture({identities:[],scripts:[appEntry]}),
  documentFixture({identities:[valid.commit,valid.commit],scripts:[appEntry]}),
  documentFixture({identities:['b'.repeat(40)],scripts:[appEntry]}),
  documentFixture({title:'Update pending',scripts:[appEntry]}),
  ...[
   {src:'https://other.test/assets/app.js',type:'module'},
   {src:'/app.js',type:'module'},
   {src:'/assets/app.css',type:'module'},
   {src:'/assets/app.js',type:'application/json'},
   {src:'/assets/app.js',type:'text/plain'},
   {text:'import("https://other.test/assets/app.js")',type:'module'},
   {text:'import("/assets/app.js"); updatePending();',type:'module'},
  ].map(entry=>documentFixture({scripts:[entry]})),
 ])assert.equal(isAppDocument(document,valid.commit,origin),false);
 assert.equal(isAppDocument(documentFixture({scripts:[appEntry]}),'abc',origin),false);
});
test('explicit update navigation retains the origin and replaces rather than stacks version queries',()=>{
 const href=versionReloadUrl(origin+'/?test=1&ef-update=old#learn',valid.commit);
 assert.equal(new URL(href).origin,origin);assert.equal(new URL(href).searchParams.get('test'),'1');assert.equal(new URL(href).searchParams.getAll('ef-update').length,1);assert.equal(new URL(href).hash,'#learn');
 assert.throws(()=>versionReloadUrl(origin,'invalid'));
});
test('every explicit preflight attempt has a different URL while retaining the release and same-origin navigation',()=>{
 const first=versionPreflightUrl(origin+'/?test=1&ef-preflight=previous#learn',valid.commit,'same-clock-1');
 const retry=versionPreflightUrl(first,valid.commit,'same-clock-2');
 assert.notEqual(first,retry);assert.equal(new URL(retry).origin,origin);
 assert.equal(new URL(retry).searchParams.get('ef-update'),valid.commit);
 assert.equal(new URL(retry).searchParams.getAll('ef-preflight').length,1);
 assert.equal(new URL(retry).searchParams.get('ef-preflight'),'same-clock-2');
 assert.equal(new URL(retry).searchParams.get('test'),'1');assert.equal(new URL(retry).hash,'#learn');
 for(const nonce of ['', 'invalid space', 'x'.repeat(129)])assert.throws(()=>versionPreflightUrl(origin,valid.commit,nonce));
});
test('reload verification accepts saved records and missing empty optional values without mutation',()=>{
 const values={words:'[1,2]',session:'{"index":3}'};
 assert.ok(isSnapshotPersisted({getItem:key=>values[key]??null},{words:[1,2],session:{index:3},empty:[],optional:null,settings:{}}));
 assert.deepEqual(values,{words:'[1,2]',session:'{"index":3}'});
});
test('unsaved progress, corrupt storage, blocked reads and a newer competing window prevent reload',()=>{
 for(const getItem of [()=>null,()=>'{bad',()=>'[9]',()=>{throw Error('blocked');}])assert.equal(isSnapshotPersisted({getItem},{words:[1,2]}),false);
});
test('build embeds the client commit and the worker never serves a cached version probe',async()=>{
 const build=await readFile(new URL('../scripts/build-render.mjs',import.meta.url),'utf8');
 const sw=await readFile(new URL('../public/sw.js',import.meta.url),'utf8');
 const layout=await readFile(new URL('../app/layout.tsx',import.meta.url),'utf8');
 assert.match(build,/VITE_ENGLISH_FLOW_BUILD_COMMIT: await resolveBuildCommit/);assert.match(layout,/"english-flow-build": APP_BUILD_COMMIT/);
 assert.ok(sw.indexOf('url.pathname === "/build-info.json"')<sw.indexOf('event.request.mode === "navigate"'));
 assert.doesNotMatch(sw,/skipWaiting\(/,'upgrades must not force-take-over open learning windows');
});
