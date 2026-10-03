import { navigate } from './browser-navigation.mjs';
import { settleLearningStorage } from './storage-settlement-checks.mjs';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const pw=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const origin=process.env.BROWSER_TEST_URL||'http://127.0.0.1:4173';
if(!['127.0.0.1','localhost','[::1]'].includes(new URL(origin).hostname))throw Error('Local-only regression');
const meta=await (await fetch(origin+'/build-info.json')).json();
const later='f'.repeat(40)===meta.commit?'e'.repeat(40):'f'.repeat(40);
const results=[];
for(const engine of ['chromium','webkit']){
 const browser=await pw[engine].launch({headless:true});
 async function check(name,mode,action){
  const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
  await context.route('**/build-info.json?*',route=> mode==='error'?route.abort():route.fulfill({json:{...meta,commit:mode==='current'?meta.commit:later,origin}}));
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(12000);
  await page.goto(origin);await page.locator('.bottom-nav').waitFor({timeout:30000});
  await page.evaluate(()=>{window.__versionDocument='unchanged';});
  try{await action(page);assert.deepEqual(errors,[]);results.push({engine,name,status:'PASS'});}catch(e){results.push({engine,name,status:'FAIL',error:String(e),body:(await page.locator('body').innerText()).slice(-1600)});}
  console.log(JSON.stringify(results.at(-1)));await context.close();
 }
 const progress=page=>navigate(page,'进度');
 await check('running-client-version-matches-built-document','current',async page=>{
  await progress(page);assert.equal(await page.locator('meta[name="english-flow-build"]').getAttribute('content'),meta.commit);
  await page.getByText('当前已是最新版',{exact:true}).waitFor();assert.ok((await page.locator('.app-version-panel').innerText()).includes(meta.commit.slice(0,7)));
 });
 await check('new-release-does-not-reload-an-open-document','new',async page=>{
  await page.getByText('发现新版本，当前学习不会被打断。',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.__versionDocument),'unchanged');
  assert.ok(await page.getByRole('button',{name:'更新并保留进度',exact:true}).isDisabled());
 });
 await check('failed-version-check-leaves-learning-usable','error',async page=>{
  await progress(page);await page.getByText('暂时无法检查更新；当前学习和记录不受影响。',{exact:true}).waitFor();
  await navigate(page,'单词');await page.getByRole('button',{name:/^开始学习(?:句子)?$/,exact:true}).click();await page.locator('.word-card').waitFor();
 });
 await check('unsaved-or-concurrently-changed-records-block-update','new',async page=>{
  await progress(page);await page.getByRole('button',{name:'更新并保留进度',exact:true}).waitFor();
  await page.evaluate(()=>localStorage.setItem('wordflow-ngsl-mastered-v1','[1,2,3]'));
  await page.getByRole('button',{name:'更新并保留进度',exact:true}).click();await page.getByText('请先到首页的“记录与设置”再更新。若有记录尚未保存，请先导出备份；不会强制刷新。',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.__versionDocument),'unchanged');assert.equal(await page.evaluate(()=>localStorage.getItem('wordflow-ngsl-mastered-v1')),'[1,2,3]');
 });
 await check('stale-html-preflight-cannot-discard-current-page','new',async page=>{
  await progress(page);await page.getByRole('button',{name:'更新并保留进度',exact:true}).click();
  await page.getByText('新页面暂未就绪，或有记录尚未保存。已保留当前页面，请稍后重试或先导出备份。',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.__versionDocument),'unchanged');
 });
 await check('retrying-stale-update-html-uses-a-new-url-for-legacy-workers','new',async page=>{
  const attempts=[];
  await page.context().route(url=>url.origin===origin&&url.pathname==='/'&&url.searchParams.get('ef-update')===later,async route=>{
   attempts.push(route.request().url());
   await page.evaluate(count=>{window.__preflightAttempts=count;},attempts.length);
   await route.fulfill({contentType:'text/html',body:`<!doctype html><title>词流英语</title><meta name="english-flow-build" content="${meta.commit}">`});
  });
  await progress(page);
  await settleLearningStorage(page);
  const before=await page.evaluate(()=>({...localStorage}));
  for(let attempt=1;attempt<=2;attempt++){
   await page.getByRole('button',{name:'更新并保留进度',exact:true}).click();
   await page.waitForFunction(count=>window.__preflightAttempts===count&&![...document.querySelectorAll('.app-version-actions button')].some(button=>button.textContent==='正在准备更新…'),attempt);
   await page.getByText('新页面暂未就绪，或有记录尚未保存。已保留当前页面，请稍后重试或先导出备份。',{exact:true}).waitFor();
  }
  assert.equal(attempts.length,2);assert.notEqual(attempts[0],attempts[1]);
  for(const href of attempts){const url=new URL(href);assert.equal(url.origin,origin);assert.equal(url.searchParams.get('ef-update'),later);assert.ok(url.searchParams.get('ef-preflight'));}
  assert.deepEqual(await page.evaluate(()=>({...localStorage})),before);
  assert.equal(await page.evaluate(()=>window.__versionDocument),'unchanged');
 });
 await check('matching-incomplete-update-documents-retain-learning-and-valid-retry-navigates','new',async page=>{
  // A future release and its failed documents are simulated. Retain the real
  // current entry/assets so the accepted retry can actually run the same app.
  const futureHtml=(await (await fetch(origin)).text()).replaceAll(meta.commit,later);
  const identity=`<title>词流英语</title><meta name="english-flow-build" content="${later}">`;
  const invalidDocuments=[
   `<!doctype html>${identity}<h1>Update pending</h1>`,
   `<!doctype html>${identity}<script type="application/json" src="/assets/future.js"></script>`,
   `<!doctype html>${identity}<script type="module" src="https://other.test/assets/future.js"></script>`,
   futureHtml.replace('</head>',`<meta name="english-flow-build" content="${later}"></head>`),
  ];
  let attempt=0;let navigations=0;
  await page.context().route(url=>url.origin===origin&&url.pathname==='/'&&url.searchParams.get('ef-update')===later,async route=>{
   if(route.request().isNavigationRequest())navigations+=1;
   else attempt+=1;
   await route.fulfill({contentType:'text/html',body:invalidDocuments[attempt-1]??futureHtml});
  });
  await navigate(page,'单词');await page.getByRole('button',{name:/^开始学习(?:句子)?$/,exact:true}).click();
  await page.locator('.word-card').waitFor();await page.locator('.learn-actions .primary-action').click();
  await progress(page);
  await settleLearningStorage(page);
  const before=await page.evaluate(()=>({...localStorage}));
  assert.ok(JSON.parse(before['wordflow-active-session-v1']).index>0,'A real paused learning position must survive failed updates');
  for(let index=0;index<invalidDocuments.length;index++){
   await page.getByRole('button',{name:'更新并保留进度',exact:true}).click();
   await page.getByRole('button',{name:'更新并保留进度',exact:true}).waitFor();
   await page.getByText('新页面暂未就绪，或有记录尚未保存。已保留当前页面，请稍后重试或先导出备份。',{exact:true}).waitFor();
   assert.equal(attempt,index+1);assert.equal(navigations,0);
   assert.equal(await page.evaluate(()=>window.__versionDocument),'unchanged');
   assert.deepEqual(await page.evaluate(()=>({...localStorage})),before);
  }
  await Promise.all([
   page.waitForURL(url=>url.searchParams.get('ef-update')===later),
   page.getByRole('button',{name:'更新并保留进度',exact:true}).click(),
  ]);
  await page.locator('.word-card').waitFor({timeout:30000});
  assert.equal(navigations,1);assert.equal(await page.evaluate(()=>window.__versionDocument),undefined);
  assert.deepEqual(await page.evaluate(()=>({...localStorage})),before,'Accepted retry restores all saved learning records');
 });
 await check('new-release-notice-keeps-the-active-word-group','new',async page=>{
  await navigate(page,'单词');await page.getByRole('button',{name:/^开始学习(?:句子)?$/,exact:true}).click();await page.locator('.word-card').waitFor();
  assert.ok(await page.getByRole('button',{name:'更新并保留进度',exact:true}).isDisabled());assert.equal(await page.locator('.immersive-learning').count(),1);assert.equal(await page.locator('.bottom-nav').count(),0);assert.equal(await page.evaluate(()=>window.__versionDocument),'unchanged');
 });
 await check('reset-progress-keeps-version-update-snapshot-consistent','new',async page=>{
  await navigate(page,'单词');
  await page.getByRole('button',{name:/^开始学习(?:句子)?$/,exact:true}).click();
  await page.locator('.word-card').waitFor();
  await progress(page);
  await page.getByRole('button',{name:'重置',exact:true}).click();
  await page.getByRole('button',{name:'确认重置',exact:true}).click();
  await page.waitForFunction(()=>localStorage.getItem('wordflow-practice-rotation-v1')==='{"word":0,"sentence":0,"pattern":0}');
  await page.getByRole('button',{name:'更新并保留进度',exact:true}).click();
  await page.getByText('新页面暂未就绪，或有记录尚未保存。已保留当前页面，请稍后重试或先导出备份。',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.__versionDocument),'unchanged','Stale HTML still cannot replace the current page');
  assert.equal(await page.getByText('请先到首页的“记录与设置”再更新。若有记录尚未保存，请先导出备份；不会强制刷新。',{exact:true}).count(),0,'Reset must not invent an unsaved record');
 });
 await browser.close();
}
const failed=results.filter(x=>x.status==='FAIL').length;console.log('VERSION_BROWSER_SUMMARY',JSON.stringify({passed:results.length-failed,failed,total:results.length}));if(failed)process.exitCode=1;
