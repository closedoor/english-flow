import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../app/version-utils.ts',import.meta.url),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {isPublishedVersion,versionReloadUrl,isSnapshotPersisted}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const origin='https://english-flow-mwnn.onrender.com';
const valid={app:'english-flow',title:'词流英语',origin,commit:'a'.repeat(40)};
test('version checks validate the application, origin and full commit identity',()=>{
 assert.ok(isPublishedVersion(valid,origin));
 for(const value of [null,[],{...valid,app:'other'},{...valid,origin:'https://other.test'},{...valid,commit:'abc'},{...valid,title:'other'}])assert.equal(isPublishedVersion(value,origin),false);
});
test('explicit update navigation retains the origin and replaces rather than stacks version queries',()=>{
 const href=versionReloadUrl(origin+'/?test=1&ef-update=old#learn',valid.commit);
 assert.equal(new URL(href).origin,origin);assert.equal(new URL(href).searchParams.get('test'),'1');assert.equal(new URL(href).searchParams.getAll('ef-update').length,1);assert.equal(new URL(href).hash,'#learn');
 assert.throws(()=>versionReloadUrl(origin,'invalid'));
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
