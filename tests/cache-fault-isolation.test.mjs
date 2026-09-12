import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
const source = await readFile(new URL('../app/content-loader.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {fetchJsonWithRecovery,CONTENT_REVISION} = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const current = `english-flow-content-${CONTENT_REVISION}`;
const url = `/data/test.json?rev=${CONTENT_REVISION}`;
const valid = value => Array.isArray(value) && value.every(Number.isInteger);
function fixture() {
  const stores = new Map();
  const caches = {
    async open(name) {
      if (!stores.has(name)) {
        const entries = new Map();
        stores.set(name, {
          async match(key) { return entries.get(String(key))?.clone(); },
          async put(key,response) { entries.set(String(key),response.clone()); },
          async delete(key) { return entries.delete(String(key)); },
          async keys() { return [...entries.keys()]; },
        });
      }
      return stores.get(name);
    },
    async keys() { return [...stores.keys()]; },
    async match(key) {
      for (const cache of stores.values()) { const saved=await cache.match(key); if(saved) return saved; }
    },
    async delete(name) { return stores.delete(name); },
  };
  return caches;
}
async function run(caches, action, online=false, fetchImpl=async()=>{throw new Error('Unexpected network');}) {
  const values={window:Object.assign(new EventTarget(),{setTimeout,clearTimeout}),navigator:{onLine:online},caches,fetch:fetchImpl};
  const old=new Map(Object.keys(values).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(values)) Object.defineProperty(globalThis,key,{value,configurable:true});
  try { return await action(values.window); } finally {
    for(const [key,descriptor] of old) { if(descriptor) Object.defineProperty(globalThis,key,descriptor); else delete globalThis[key]; }
  }
}
async function olderCopy(caches) {
  const cache=await caches.open('english-flow-content-v1');
  await cache.put('/data/test.json?rev=v1',new Response('[1,2]'));
  return cache;
}
test('one unavailable newer cache cannot hide an older valid offline pack',async()=>{
  const caches=fixture(); await olderCopy(caches); await caches.open('english-flow-content-v2');
  const open=caches.open.bind(caches); caches.open=async name=>{if(name==='english-flow-content-v2') throw new Error('Cache unavailable'); return open(name);};
  assert.deepEqual(await run(caches,()=>fetchJsonWithRecovery(url,valid)),[1,2]);
});
test('one rejected cache lookup cannot hide a valid unversioned entry in the same cache',async()=>{
  const caches=fixture(); const cache=await caches.open('english-flow-content-v2');
  await cache.put('/data/test.json',new Response('[2,3]'));
  const match=cache.match.bind(cache); cache.match=async key=>{if(String(key).includes('?rev=')) throw new Error('Lookup failed'); return match(key);};
  assert.deepEqual(await run(caches,()=>fetchJsonWithRecovery(url,valid)),[2,3]);
});
test('failed cache enumeration still permits the old shell fallback',async()=>{
  const caches=fixture(); const shell=await caches.open('wordflow-ngsl-v17');
  await shell.put('/data/test.json',new Response('[7,8]')); caches.keys=async()=>{throw new Error('Enumeration failed');};
  assert.deepEqual(await run(caches,()=>fetchJsonWithRecovery(url,valid)),[7,8]);
});
test('invalid cached JSON and failed cleanup do not block the next valid revision',async()=>{
  const caches=fixture(); await olderCopy(caches); const bad=await caches.open('english-flow-content-v2');
  await bad.put('/data/test.json?rev=v2',new Response('{broken')); bad.delete=async()=>{throw new Error('Cleanup denied');};
  assert.deepEqual(await run(caches,()=>fetchJsonWithRecovery(url,valid)),[1,2]);
});
test('an unreadable current cache does not block validated legacy recovery',async()=>{
  const caches=fixture(); await olderCopy(caches); const open=caches.open.bind(caches);
  caches.open=async name=>{if(name===current) throw new Error('Current cache failed'); return open(name);};
  assert.deepEqual(await run(caches,()=>fetchJsonWithRecovery(url,valid)),[1,2]);
});
test('total cache failure still returns valid online data and reports missing offline persistence',async()=>{
  const caches={open:async()=>{throw new Error('Blocked');},keys:async()=>{throw new Error('Blocked');},match:async()=>{throw new Error('Blocked');}};
  let warnings=0;
  const value=await run(caches,async window=>{window.addEventListener('english-flow-offline-cache-error',()=>warnings++);return fetchJsonWithRecovery(url,valid);},true,async()=>new Response('[9,10]'));
  assert.deepEqual(value,[9,10]); assert.equal(warnings,1);
});
test('total cache failure while offline fails without issuing network requests',async()=>{
  const caches={open:async()=>{throw new Error('Blocked');},keys:async()=>{throw new Error('Blocked');},match:async()=>{throw new Error('Blocked');}};
  let fetches=0;
  await assert.rejects(run(caches,()=>fetchJsonWithRecovery(url,valid),false,async()=>{fetches++; throw new Error('Offline');}));
  assert.equal(fetches,0);
});
