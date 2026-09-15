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
 const progress=page=>page.locator('.bottom-nav button').filter({hasText:'进度'}).click();
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
  await page.locator('.bottom-nav button').filter({hasText:'学习'}).click();await page.getByRole('button',{name:'开始这组学习',exact:true}).click();await page.locator('.word-card').waitFor();
 });
 await check('unsaved-or-concurrently-changed-records-block-update','new',async page=>{
  await progress(page);await page.getByRole('button',{name:'更新并保留进度',exact:true}).waitFor();
  await page.evaluate(()=>localStorage.setItem('wordflow-ngsl-mastered-v1','[1,2,3]'));
  await page.getByRole('button',{name:'更新并保留进度',exact:true}).click();await page.getByText('请先到进度页再更新。若有记录尚未保存，请先导出备份；不会强制刷新。',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.__versionDocument),'unchanged');assert.equal(await page.evaluate(()=>localStorage.getItem('wordflow-ngsl-mastered-v1')),'[1,2,3]');
 });
 await check('stale-html-preflight-cannot-discard-current-page','new',async page=>{
  await progress(page);await page.getByRole('button',{name:'更新并保留进度',exact:true}).click();
  await page.getByText('新页面暂未就绪，或有记录尚未保存。已保留当前页面，请稍后重试或先导出备份。',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.__versionDocument),'unchanged');
 });
 await check('new-release-notice-keeps-the-active-word-group','new',async page=>{
  await page.locator('.bottom-nav button').filter({hasText:'学习'}).click();await page.getByRole('button',{name:'开始这组学习',exact:true}).click();await page.locator('.word-card').waitFor();
  assert.ok(await page.getByRole('button',{name:'更新并保留进度',exact:true}).isDisabled());assert.equal(await page.locator('.word-auto-controls').count(),1);assert.equal(await page.evaluate(()=>window.__versionDocument),'unchanged');
 });
 await browser.close();
}
const failed=results.filter(x=>x.status==='FAIL').length;console.log('VERSION_BROWSER_SUMMARY',JSON.stringify({passed:results.length-failed,failed,total:results.length}));if(failed)process.exitCode=1;
