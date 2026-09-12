import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
if(!process.env.PLAYWRIGHT_MODULE) throw new Error('Set PLAYWRIGHT_MODULE; see TESTING.md.');
const playwright=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const origin=process.env.BROWSER_TEST_URL || 'http://127.0.0.1:4173';
if(!['localhost','127.0.0.1','[::1]'].includes(new URL(origin).hostname)) throw new Error('Synthetic network tests must use a local origin.');
const corrections=await readFile(new URL('../app/sentence-data.ts',import.meta.url),'utf8');
const correctedIds=new Set([...corrections.matchAll(/\b(\d+)\s*:/g)].map(match=>Number(match[1])));
const medium=JSON.parse(await readFile(new URL('../public/data/tatoeba-sentences-2.json',import.meta.url),'utf8'));
const target=medium.find(item=>!correctedIds.has(item.id));
assert.ok(target,'Need an unchanged medium-length corpus fixture');
const results=[];
for(const engine of ['chromium','webkit']) {
  const browser=await playwright[engine].launch({headless:true});
  async function check(name,body) {
    const context=await browser.newContext({viewport:{width:375,height:812},hasTouch:true,serviceWorkers:'block'});
    const page=await context.newPage(); page.setDefaultTimeout(12000);
    const errors=[]; page.on('pageerror',error=>errors.push(error.message));
    try {
      await page.goto(origin,{waitUntil:'domcontentloaded'});
      await page.locator('.bottom-nav').waitFor();
      await page.locator('.bottom-nav button').filter({hasText:'句库'}).click();
      await page.waitForFunction(()=>{const start=document.querySelector('.sentence-page .sticky-start');return start && !start.disabled;});
      await body(page,context);
      assert.deepEqual(errors,[],'Uncaught page errors');
      results.push({engine,name,status:'PASS'});
    } catch(error) {
      results.push({engine,name,status:'FAIL',error:String(error),body:(await page.locator('body').innerText().catch(()=>'' )).slice(-1700),pageErrors:errors});
    } finally { await context.close(); }
    console.log(JSON.stringify(results.at(-1)));
  }
  async function slowSearch(page,context,term='I',blockBoth=true) {
    await context.route(blockBoth ? /tatoeba-sentences-[23]\.json/ : /tatoeba-sentences-3\.json/,()=>{});
    const started=page.waitForRequest(request=>request.url().includes('tatoeba-sentences-3.json'));
    await page.getByRole('searchbox',{name:'搜索长短句'}).fill(term);
    await started;
  }
  await check('loaded-search-results-remain-usable-during-slow-packs',async(page,context)=>{
    await slowSearch(page,context);
    await page.locator('.sentence-result-list button[data-sentence-id]').first().waitFor({timeout:2500});
    await page.getByText('其余句库仍在加载，先显示已载入的结果。',{exact:true}).waitFor({timeout:1000});
    const sentenceId=Number(await page.locator('.sentence-result-list button[data-sentence-id]').first().getAttribute('data-sentence-id'));
    await page.locator('.sentence-result-list button[data-sentence-id]').first().click();
    await page.locator('.sentence-study-card').waitFor();
    const ids=await page.evaluate(()=>JSON.parse(localStorage.getItem('wordflow-sentence-active-session-v1')).sentenceIds);
    assert.deepEqual(ids,[sentenceId]);
  });
  await check('selected-pack-can-start-while-global-search-is-loading',async(page,context)=>{
    await slowSearch(page,context);
    const start=page.getByRole('button',{name:'开始这组学习',exact:true});
    assert.equal(await start.isEnabled(),true,'A loaded short pack must not be blocked by unrelated slow packs');
    await start.click(); await page.locator('.sentence-study-card').waitFor();
    await page.locator('.learn-actions .secondary-action').click();
    await page.waitForFunction(()=>Object.keys(JSON.parse(localStorage.getItem('wordflow-sentence-active-session-v1')||'{}').ratings||{}).length===1);
    const before=await page.evaluate(()=>JSON.parse(localStorage.getItem('wordflow-sentence-active-session-v1')));
    assert.equal(before.sentenceIds.length,10); assert.ok(before.sentenceIds.every(id=>id<=1000));
    await page.reload({waitUntil:'domcontentloaded'}); await page.locator('.sentence-study-card').waitFor();
    const after=await page.evaluate(()=>JSON.parse(localStorage.getItem('wordflow-sentence-active-session-v1')));
    assert.deepEqual(after.sentenceIds,before.sentenceIds); assert.deepEqual(after.ratings,before.ratings);
  });
  await check('newly-arrived-pack-is-published-before-the-slowest-pack',async(page,context)=>{
    const mediumResponse=page.waitForResponse(response=>response.url().includes('tatoeba-sentences-2.json') && response.status()===200);
    await slowSearch(page,context,target.text,false); await mediumResponse;
    const result=page.locator(`.sentence-result-list button[data-sentence-id="${target.id}"]`);
    await result.waitFor({timeout:2500}); await result.click();
    await page.locator('.sentence-study-card').waitFor();
    assert.equal(await page.locator('.sentence-english').innerText(),target.text);
  });
  await check('unfinished-empty-search-does-not-claim-no-match',async(page,context)=>{
    await slowSearch(page,context,'qzxv_unmatched_example_731');
    await page.getByText('正在加载完整句库…',{exact:true}).waitFor();
    assert.equal(await page.getByText('没有找到相关句子，请换一个关键词。',{exact:true}).count(),0);
  });
  await browser.close();
}
console.log('NETWORK_BROWSER_SUMMARY',JSON.stringify({passed:results.filter(row=>row.status==='PASS').length,failed:results.filter(row=>row.status==='FAIL').length,total:results.length}));
if(results.some(row=>row.status==='FAIL')) process.exitCode=1;
