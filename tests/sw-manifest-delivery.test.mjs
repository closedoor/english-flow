import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../public/sw.js',import.meta.url),'utf8');
const origin='https://english-flow.test';
const manifest={name:'词流英语',start_url:'/',scope:'/',icons:[{src:'/icon-192.png'},{src:'/icon-512.png'}]};
function harness({type='binary/octet-stream',body=JSON.stringify(manifest)}={}){
  const stores=new Map(),events=new Map();
  const key=request=>new URL(request instanceof Request?request.url:String(request),origin).href;
  const caches={async open(name){if(!stores.has(name))stores.set(name,new Map());const values=stores.get(name);return{async match(r){return values.get(key(r))?.clone();},async put(r,v){values.set(key(r),v.clone());},async delete(r){return values.delete(key(r));},async keys(){return[...values.keys()].map(url=>new Request(url));}};},async keys(){return[...stores.keys()];},async delete(name){return stores.delete(name);}};
  const self={location:new URL(origin),clients:{async claim(){}},addEventListener(name,fn){events.set(name,fn);}};
  const fetch=async request=>{const path=new URL(key(request)).pathname;if(path==='/manifest.webmanifest')return new Response(body,{headers:{'content-type':type}});const mime=path==='/'?'text/html':path.endsWith('.png')?'image/png':path.endsWith('.ico')?'image/x-icon':'text/javascript';return new Response(path==='/'?'<title>词流英语</title>':'asset',{headers:{'content-type':mime}});};
  const context=vm.createContext({self,caches,fetch,URL,Request,Response,AbortController,setTimeout,clearTimeout,console});
  vm.runInContext(source,context);
  const normalize=vm.runInContext('normalizeManifestResponse',context),matches=vm.runInContext('responseMatchesRequest',context);
  const event=async name=>{let pending;events.get(name)({waitUntil(value){pending=value;}});await pending;};
  return{caches,stores,normalize,matches,event};
}
test('binary and application octet-stream manifests install and activate a complete usable shell',async()=>{
  for(const type of ['binary/octet-stream','application/octet-stream; charset=utf-8']){
    const h=harness({type});await h.event('install');await h.event('activate');
    const cached=await(await h.caches.open('wordflow-ngsl-v34-local')).match('/manifest.webmanifest');
    assert.equal(cached.status,200);assert.match(cached.headers.get('content-type'),/application\/manifest\+json/);assert.deepEqual(await cached.json(),manifest);
    assert.equal((await h.caches.keys()).some(name=>name.endsWith('-staging')),false);
  }
});
test('malformed binary manifests do not replace the previous complete offline shell',async()=>{
  for(const body of ['<html>error</html>','{broken','null',JSON.stringify({...manifest,name:'Another app'}),JSON.stringify({...manifest,scope:'/other/'}),JSON.stringify({...manifest,icons:[{src:'https://other.test/icon.png'},{src:'/icon.png'}]})]){
    const h=harness({body});const old=await h.caches.open('wordflow-ngsl-old');await old.put('/',new Response('old working shell'));
    await assert.rejects(h.event('install'),/Unable to cache/);assert.equal(await(await old.match('/')).text(),'old working shell');
    assert.equal((await h.caches.keys()).some(name=>name.endsWith('-staging')),false);
  }
});
test('MIME normalization is restricted to the exact same-origin manifest, not scripts or error pages',async()=>{
  const h=harness();
  for(const [path,type] of [['/assets/main.js','binary/octet-stream'],['/assets/main.css','application/octet-stream'],['/other.webmanifest','binary/octet-stream'],['https://elsewhere.test/manifest.webmanifest','binary/octet-stream'],['/manifest.webmanifest','text/html']]){
    const original=new Response(JSON.stringify(manifest),{headers:{'content-type':type}});assert.equal(await h.normalize(path,original),original);
  }
  assert.equal(h.matches('/assets/main.js',new Response('alert(1)',{headers:{'content-type':'binary/octet-stream'}})),false);
});
test('valid normal MIME is unchanged and non-200 or oversized responses are never reclassified',async()=>{
  const h=harness();
  for(const original of [new Response(JSON.stringify(manifest),{headers:{'content-type':'application/manifest+json'}}),new Response(JSON.stringify(manifest),{status:503,headers:{'content-type':'binary/octet-stream'}}),new Response(' '.repeat(64001),{headers:{'content-type':'binary/octet-stream'}})])assert.equal(await h.normalize('/manifest.webmanifest',original),original);
});
test('normalized cached manifests keep original JSON and remove invalid transport metadata',async()=>{
  const h=harness();const text=JSON.stringify(manifest,null,2);
  const repaired=await h.normalize('/manifest.webmanifest',new Response(text,{headers:{'content-type':'binary/octet-stream','content-encoding':'gzip','content-length':'12','cache-control':'no-cache'}}));
  assert.equal(await repaired.text(),text);assert.equal(repaired.headers.has('content-encoding'),false);assert.equal(repaired.headers.has('content-length'),false);assert.equal(repaired.headers.get('cache-control'),'no-cache');
});
