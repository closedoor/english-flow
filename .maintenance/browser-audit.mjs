import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const playwright = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const origin = 'http://127.0.0.1:4173';
const results = [];
const keys = { word: 'wordflow-active-session-v1', mastered: 'wordflow-ngsl-mastered-v1', difficult: 'wordflow-ngsl-difficult-v1', sentence: 'wordflow-sentence-active-session-v1', pattern: 'wordflow-pattern-active-session-v1', reading: 'wordflow-reading-answers-v1' };
await mkdir('/tmp/english-flow-evidence', { recursive: true });
async function ready(page) {
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.locator('.bottom-nav').waitFor({ timeout: 30000 });
}
async function nav(page, label) {
  await page.locator('.bottom-nav button').filter({ hasText: label }).click();
}
async function stored(page, key) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key) || 'null'), key);
}
async function persisted(page, key, predicate) {
  await page.waitForFunction(({key, predicate}) => {
    const value = JSON.parse(localStorage.getItem(key) || 'null');
    return new Function('value', `return (${predicate})(value)`)(value);
  }, { key, predicate: String(predicate) });
  return stored(page, key);
}
function quizSnapshot() {
  return {version:1, kind:'group', updatedAt:Date.now(), path:'frequency', mode:'test', wordIds:[1,2,3], index:2, ratings:{1:'known',2:'known',3:'known'}, stage:'quiz', quizIndex:0, quizAnswer:'', quizFeedback:null, quizResults:[]};
}
for (const engine of ['chromium', 'webkit']) {
  const browser = await playwright[engine].launch({ headless: true });
  async function check(name, run, initial = {}) {
    const context = await browser.newContext({ viewport: {width:320,height:740}, hasTouch:true, acceptDownloads:true });
    await context.addInitScript(values => {
      for (const [key,value] of Object.entries(values)) localStorage.setItem(key, JSON.stringify(value));
    }, initial);
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    try {
      await run(page, context);
      assert.deepEqual(errors, [], 'Uncaught browser errors');
      results.push({engine,name,status:'PASS'});
      console.log(JSON.stringify(results.at(-1)));
    } catch (error) {
      const detail = {engine,name,status:'FAIL',error:String(error),stack:error.stack,body:await page.locator('body').innerText().catch(()=>''),pageErrors:errors};
      results.push(detail);
      console.log(JSON.stringify(detail));
      await page.screenshot({path:`/tmp/english-flow-evidence/${engine}-${name}.png`,fullPage:true}).catch(()=>{});
    } finally { await context.close(); }
  }
  await check('all-modules-and-widths', async page => {
    await ready(page);
    assert.equal(await page.title(),'词流英语');
    for (const width of [320,375,390,480,1280]) {
      await page.setViewportSize({width,height:800});
      for (const label of ['今天','学习','句库','阅读','复习','进度']) {
        await nav(page,label);
        await page.locator('.page h1').first().waitFor();
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1), `${label} overflows at ${width}px`);
      }
    }
  });
  await check('word-progress-reload', async page => {
    await ready(page); await nav(page,'学习');
    await page.getByRole('button',{name:'自由学习',exact:false}).click();
    await page.getByRole('button',{name:'开始这组学习',exact:true}).click();
    await page.locator('.word-heading h2').waitFor();
    await page.locator('.learn-actions .secondary-action').click();
    await persisted(page,keys.word,v=>v && Object.keys(v.ratings).length===1);
    await page.waitForTimeout(380);
    await page.locator('.learn-actions .primary-action').click();
    const before = await persisted(page,keys.word,v=>v && Object.keys(v.ratings).length===2);
    const word = await page.locator('.word-heading h2').innerText();
    await page.reload(); await page.locator('.word-heading h2').waitFor();
    assert.equal(await page.locator('.word-heading h2').innerText(),word);
    const after=await stored(page,keys.word);
    assert.deepEqual(after.wordIds,before.wordIds);
    assert.deepEqual(after.ratings,before.ratings);
  });
  await check('quiz-recall-and-resume', async page => {
    await ready(page);
    await page.locator('.quiz-skip').click();
    await persisted(page,keys.word,v=>v?.quizResults?.length===1);
    await page.getByRole('button',{name:'下一题',exact:true}).click();
    await persisted(page,keys.word,v=>v?.quizIndex===1);
    await page.reload(); await page.locator('.quiz-count').waitFor();
    assert.equal(await page.locator('.quiz-count').innerText(),'2/3');
    await page.locator('.quiz-skip').click();
    await page.getByRole('button',{name:'下一题',exact:true}).click();
    await page.locator('.quiz-skip').click();
    await page.getByRole('button',{name:'查看结果',exact:true}).click();
    await page.locator('.result-page').waitFor();
    assert.equal(await page.locator('.result-mistakes button').count(),3);
  }, {[keys.word]:quizSnapshot()});
  await check('quiz-header-no-overlap', async page => {
    await ready(page);
    const boxes = await page.locator('.quiz-page .compact-header').evaluate(header => [...header.children].map(child=>{const r=child.getBoundingClientRect();return {left:r.left,right:r.right,text:child.textContent};}));
    assert.ok(boxes[0].right<=boxes[1].left+1,JSON.stringify(boxes));
    assert.ok(boxes[1].right<=boxes[2].left+1,JSON.stringify(boxes));
  }, {[keys.word]:quizSnapshot()});
  await check('reading-answer-and-backup', async page => {
    await ready(page); await nav(page,'阅读');
    await page.locator('.reading-card').first().click();
    await page.locator('.reading-question-options button').first().click();
    await persisted(page,keys.reading,v=>v && Object.keys(v).length===1);
    await page.locator('.translation-toggle').click();
    await page.locator('.reading-translation').waitFor();
    const answer=await stored(page,keys.reading);
    await page.reload(); await page.locator('.bottom-nav').waitFor();
    assert.deepEqual(await stored(page,keys.reading),answer);
    await nav(page,'进度');
    const pending=page.waitForEvent('download');
    await page.getByRole('button',{name:'导出备份',exact:true}).click();
    const download=await pending;
    const filepath=await download.path();
    const backup=JSON.parse(await readFile(filepath,'utf8'));
    assert.equal(backup.formatVersion,1);
    assert.deepEqual(backup.data[keys.reading],answer);
    await page.locator('input[type=file]').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});
    await page.locator('.restore-dialog').waitFor();
    await page.locator('.restore-confirm').click();
    await page.waitForLoadState('domcontentloaded');
    await page.locator('.bottom-nav').waitFor();
    assert.deepEqual(await stored(page,keys.reading),answer);
  });
  await check('invalid-backup-preserves-progress', async page => {
    await ready(page); await nav(page,'进度');
    const before=await page.evaluate(()=>({...localStorage}));
    await page.locator('input[type=file]').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{broken')});
    await page.locator('.backup-notice.error').waitFor();
    assert.equal(await page.locator('.restore-dialog').count(),0);
    assert.deepEqual(await page.evaluate(()=>({...localStorage})),before);
  });
  await check('review-undo', async page => {
    await ready(page); await nav(page,'复习');
    await page.getByRole('button',{name:'生词本',exact:false}).click();
    await page.locator('.review-reveal').click();
    await page.getByRole('button',{name:'这个词已经会了',exact:true}).click();
    await page.locator('.review-undo button').click();
    await page.locator('.review-card h2').waitFor();
    assert.ok((await stored(page,keys.difficult)).includes(1));
  }, {[keys.difficult]:[1]});
  await check('sentence-speaking-reload', async page => {
    await ready(page);
    await page.getByRole('button',{name:'看中文说英文',exact:false}).click();
    await page.locator('.sentence-setup-page .sticky-start, .sentence-setup-page .full-button, .sentence-setup .sticky-start').count().then(n=>console.log('SENTENCE_START_HINT',n));
    console.log('SENTENCE_BUTTONS',JSON.stringify(await page.locator('.page button').allTextContents()));
    const start=page.getByRole('button',{name:/开始.*学习|开始.*练习/}).last();
    await start.click();
    await page.locator('.speak-prompt').waitFor();
    assert.equal(await page.locator('.speak-answer').count(),0);
    await page.locator('.reveal-answer').click();
    await page.locator('.speak-answer').waitFor();
    await page.locator('.learn-actions .secondary-action').click();
    const before=await persisted(page,keys.sentence,v=>v && Object.keys(v.ratings).length===1);
    await page.reload(); await page.locator('.speak-prompt').waitFor();
    assert.deepEqual((await stored(page,keys.sentence)).ratings,before.ratings);
    assert.equal(await page.locator('.speak-answer').count(),0);
  });
  await check('pattern-drill-reload', async page => {
    await ready(page); await page.getByRole('button',{name:'核心句型替换',exact:false}).click();
    console.log('PATTERN_BUTTONS',JSON.stringify(await page.locator('.page button').allTextContents()));
    await page.getByRole('button',{name:/开始.*学习|开始.*练习/}).last().click();
    await page.locator('.pattern-prompt').waitFor();
    await page.locator('.reveal-answer').click();
    await page.locator('.pattern-answer').waitFor();
    await page.locator('.pattern-drill-pager button').last().click();
    await persisted(page,keys.pattern,v=>v?.drillIndex===1);
    await page.reload(); await page.locator('.pattern-drill-count').waitFor();
    assert.equal((await stored(page,keys.pattern)).drillIndex,1);
    assert.equal(await page.locator('.pattern-answer').count(),0);
  });
  await check('blocked-storage-usable', async (page,context) => {
    await context.addInitScript(()=>{Storage.prototype.setItem=function(){throw new DOMException('Blocked','QuotaExceededError');};});
    await ready(page); await nav(page,'学习');
    await page.locator('.storage-warning').waitFor();
    await page.getByRole('button',{name:'开始这组学习',exact:true}).click();
    await page.locator('.word-heading h2').waitFor();
    await page.locator('.learn-actions .secondary-action').click();
    assert.ok((await page.locator('.card-count').innerText()).includes('已标记 1'));
  });
  await check('two-windows-preserve-latest', async (page,context) => {
    await ready(page);
    const other=await context.newPage(); other.setDefaultTimeout(12000); await ready(other);
    await nav(page,'学习');
    await page.getByRole('button',{name:'开始这组学习',exact:true}).click();
    await page.locator('.learn-actions .secondary-action').click();
    await other.locator('.sync-dialog').waitFor();
    assert.equal(await other.locator('.sync-dialog').isVisible(),true);
    assert.equal((await stored(page,keys.word)).ratings[1],'difficult');
    await other.close();
  });
  await check('offline-reload-all-modules', async (page,context) => {
    await ready(page);
    await nav(page,'句库');
    await page.waitForFunction(()=>performance.getEntriesByType('resource').some(x=>x.name.includes('tatoeba-sentences-1')));
    await nav(page,'阅读'); await page.locator('.reading-card').first().waitFor();
    await page.evaluate(()=>navigator.serviceWorker.ready);
    await page.reload(); await page.locator('.bottom-nav').waitFor();
    await page.waitForFunction(()=>Boolean(navigator.serviceWorker.controller));
    await context.setOffline(true);
    await page.reload({waitUntil:'domcontentloaded'}); await page.locator('.bottom-nav').waitFor({timeout:30000});
    for (const label of ['学习','句库','阅读','复习','进度']) {
      await nav(page,label); await page.locator('.page h1').first().waitFor();
    }
    await nav(page,'阅读'); await page.locator('.reading-card').first().click();
    await page.locator('.reading-text').waitFor();
  });
  await browser.close();
}
console.log('BROWSER_AUDIT_SUMMARY',JSON.stringify({passed:results.filter(x=>x.status==='PASS').length,failed:results.filter(x=>x.status==='FAIL').length,total:results.length}));
if (results.some(x=>x.status==='FAIL')) process.exitCode=1;
