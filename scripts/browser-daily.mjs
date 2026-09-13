import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';

if (!process.env.PLAYWRIGHT_MODULE) throw new Error('PLAYWRIGHT_MODULE is required; see TESTING.md.');
const playwright = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const origin = process.env.BROWSER_TEST_URL || 'http://127.0.0.1:4173';
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname)) throw new Error('Daily-use fixtures must never run on a production origin.');
const evidence = process.env.BROWSER_EVIDENCE_DIR || path.join(os.tmpdir(), 'english-flow-evidence');
await mkdir(evidence, { recursive: true });
const results = [];
const keys = {
  word: 'wordflow-active-session-v1', mastered: 'wordflow-ngsl-mastered-v1', difficult: 'wordflow-ngsl-difficult-v1',
  schedule: 'wordflow-ngsl-schedule-v1', days: 'wordflow-days', readings: 'wordflow-reading-completed-v1', answers: 'wordflow-reading-answers-v1',
};
const quizSnapshot = () => ({ version: 1, kind: 'group', updatedAt: Date.now(), path: 'frequency', mode: 'test', wordIds: [1,2,3], index: 2, ratings: {1:'known',2:'known',3:'known'}, stage: 'quiz', quizIndex: 0, quizAnswer: '', quizFeedback: null, quizResults: [] });
const stored = (page, key) => page.evaluate(key => JSON.parse(localStorage.getItem(key) || 'null'), key);
async function ready(page) {
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.locator('.bottom-nav, .quiz-page').first().waitFor({ timeout: 30_000 });
}
async function nav(page, label) { await page.locator('.bottom-nav button').filter({ hasText: label }).click(); }
async function waitSnapshot(page, field, value) {
  await page.waitForFunction(({key,field,value}) => JSON.parse(localStorage.getItem(key) || 'null')?.[field] === value, {key:keys.word,field,value});
}
async function keyEvent(input, properties) {
  return input.evaluate((element, properties) => {
    const event = new KeyboardEvent('keydown', {key:'Enter',code:'Enter',bubbles:true,cancelable:true,...properties});
    if (properties.keyCode !== undefined) Object.defineProperty(event,'keyCode',{value:properties.keyCode});
    return element.dispatchEvent(event);
  }, properties);
}

for (const engine of ['chromium','webkit']) {
  const browser = await playwright[engine].launch({headless:true});
  async function check(name, body, initial = {}) {
    const context = await browser.newContext({viewport:{width:375,height:812},hasTouch:true,acceptDownloads:true,serviceWorkers:'block'});
    await context.addInitScript(values => {
      if (sessionStorage.getItem('english-flow-daily-seeded')) return;
      sessionStorage.setItem('english-flow-daily-seeded','1');
      for (const [key,value] of Object.entries(values)) localStorage.setItem(key,JSON.stringify(value));
    },initial);
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await body(page,context);
      assert.deepEqual(errors,[],'Uncaught browser errors');
      results.push({engine,name,status:'PASS'});
    } catch (error) {
      results.push({engine,name,status:'FAIL',error:String(error),pageErrors:errors,body:(await page.locator('body').innerText().catch(()=>'' )).slice(-2000)});
      await page.screenshot({path:path.join(evidence,`${engine}-daily-${name}.png`),fullPage:true}).catch(()=>{});
    } finally { await context.close(); }
    console.log(JSON.stringify(results.at(-1)));
  }

  await check('ime-confirmation-never-submits-unfinished-answer',async page=>{
    await ready(page);
    const input=page.locator('.quiz-page input');
    await input.fill('unfinished');
    await waitSnapshot(page,'quizAnswer','unfinished');
    await keyEvent(input,{isComposing:true,keyCode:13});
    assert.equal(await page.locator('.feedback-box').count(),0,'Modern IME composition must not submit');
    await keyEvent(input,{isComposing:false,keyCode:229});
    await page.waitForTimeout(60);
    assert.equal(await page.locator('.feedback-box').count(),0,'Legacy IME confirmation must not submit');
    assert.deepEqual((await stored(page,keys.word)).quizResults,[]);
    assert.deepEqual(await stored(page,keys.difficult),[]);
    await input.fill('the');
    await input.press('Enter');
    await page.locator('.feedback-box').waitFor();
    assert.equal((await stored(page,keys.word)).quizResults.length,1,'A separate real Enter must still submit');
  },{[keys.word]:quizSnapshot()});

  await check('held-enter-does-not-submit-or-advance-but-fresh-enter-works',async page=>{
    await ready(page);
    const input=page.locator('.quiz-page input');
    await input.fill('the');
    await keyEvent(input,{repeat:true,keyCode:13});
    await page.waitForTimeout(60);
    assert.equal(await page.locator('.feedback-box').count(),0,'Repeated keydown must not submit an answer');
    await input.press('Enter');
    await page.locator('.feedback-box').waitFor();
    const next=page.getByRole('button',{name:'下一题',exact:true});
    assert.equal(await keyEvent(next,{repeat:true,keyCode:13}),false,'Repeated Enter default click must be canceled');
    assert.equal((await stored(page,keys.word)).quizIndex,0);
    await next.press('Enter');
    await waitSnapshot(page,'quizIndex',1);
  },{[keys.word]:quizSnapshot()});

  if (!process.env.DAILY_PROBE_ONLY) {
    await check('stalled-cache-read-keeps-online-startup-and-progress-usable',async(page,context)=>{
      await context.addInitScript(()=>{
        const open=CacheStorage.prototype.open;
        let first=true;
        CacheStorage.prototype.open=function(name){
          if(first && name.startsWith('english-flow-content-')){first=false;return new Promise(()=>{});}
          return open.call(this,name);
        };
      });
      await ready(page);
      assert.deepEqual(await stored(page,keys.mastered),[1,2]);
      assert.deepEqual(await stored(page,keys.difficult),[3]);
      await nav(page,'学习');
      await page.getByRole('button',{name:'自由学习',exact:false}).click();
      await page.getByRole('button',{name:'开始这组学习',exact:true}).click();
      await page.locator('.word-heading h2').waitFor();
    },{[keys.mastered]:[1,2],[keys.difficult]:[3]});

    await check('stalled-cache-write-keeps-learning-usable-and-discloses-offline-limit',async(page,context)=>{
      await context.addInitScript(()=>{
        const put=Cache.prototype.put;
        Cache.prototype.put=function(request,response){
          const url=typeof request==='string'?request:request.url;
          if(url.includes('/data/ngsl-words-'))return new Promise(()=>{});
          return put.call(this,request,response);
        };
      });
      await ready(page);
      await page.locator('.offline-cache-warning').waitFor();
      await nav(page,'学习');
      await page.getByRole('button',{name:'自由学习',exact:false}).click();
      await page.getByRole('button',{name:'开始这组学习',exact:true}).click();
      await page.locator('.learn-actions .primary-action').click();
      await page.waitForFunction(key=>JSON.parse(localStorage.getItem(key)||'null')?.ratings?.[1]==='known',keys.word);
      assert.ok((await stored(page,keys.mastered)).includes(1));
    });

    await check('repeated-tab-switches-and-late-content-do-not-change-learning-records',async(page,context)=>{
      await context.route(/tatoeba-sentences-[123]\.json/,async route=>{
        await new Promise(resolve=>setTimeout(resolve,450));
        await route.continue().catch(()=>{});
      });
      await ready(page);
      const before=await page.evaluate(()=>({...localStorage}));
      for(let cycle=0;cycle<6;cycle++){
        for(const label of ['句库','阅读','今天','学习','复习','进度'])await nav(page,label);
      }
      await nav(page,'句库');
      await page.waitForFunction(()=>{const button=document.querySelector('.sentence-page .sticky-start');return button && !button.disabled;});
      assert.deepEqual(await page.evaluate(()=>({...localStorage})),before,'Browsing must not create learning activity or overwrite progress');
      assert.equal(await page.locator('.sync-dialog').count(),0);
    },{[keys.mastered]:[1,2],[keys.difficult]:[3]});

    await check('complete-ten-word-session-pause-resume-and-retry-only-mistakes',async page=>{
      await ready(page);await nav(page,'学习');
      await page.locator('.mode-grid button').last().click();
      await page.getByRole('button',{name:'开始这组学习',exact:true}).click();
      const expected=[];
      for(let index=0;index<10;index++){
        await page.locator('.word-heading h2').waitFor();
        expected.push(await page.locator('.word-heading').evaluate(heading=>({
          answer:heading.querySelector('small')?.textContent.replace(/^句中形式：/,'')||heading.querySelector('h2').textContent,
        })));
        await page.locator('.learn-actions .primary-action').click();
        if(index<9)await page.waitForTimeout(380);
      }
      await page.locator('.quiz-page').waitFor();
      const original=(await stored(page,keys.word)).wordIds;
      for(let index=0;index<10;index++){
        assert.equal(await page.locator('.quiz-count').innerText(),`${index+1}/10`);
        if(index===4){
          await page.locator('.quiz-page input').fill('unfinished draft');
          await waitSnapshot(page,'quizAnswer','unfinished draft');
          await page.getByRole('button',{name:'暂停考试并保留进度',exact:true}).click();
          await page.reload();
          await page.locator('.quiz-page').waitFor();
          assert.equal(await page.locator('.quiz-page input').inputValue(),'unfinished draft');
          assert.equal((await stored(page,keys.word)).quizResults.length,4);
        }
        if(index%3===1)await page.locator('.quiz-skip').click();
        else {await page.locator('.quiz-page input').fill(expected[index].answer);await page.getByRole('button',{name:'提交答案',exact:true}).click();}
        await page.locator('.feedback-box').waitFor();
        await page.getByRole('button',{name:index===9?'查看结果':'下一题',exact:true}).click();
      }
      await page.locator('.result-page').waitFor();
      assert.equal(await page.locator('.result-mistakes button').count(),3);
      assert.match(await page.locator('.result-page').innerText(),/答对 7 \/ 10/);
      assert.equal(await stored(page,keys.word),null,'Completed sessions must not resume as unfinished');
      await page.getByRole('button',{name:'再练这 3 个错词',exact:true}).click();
      await page.locator('.word-heading h2').waitFor();
      const retry=await stored(page,keys.word);
      assert.deepEqual(retry.wordIds,[original[1],original[4],original[7]]);
      assert.deepEqual(retry.ratings,{});
    });

    const large={
      [keys.mastered]:Array.from({length:1800},(_,i)=>i+1),
      [keys.difficult]:Array.from({length:200},(_,i)=>i+1801),
      [keys.schedule]:Object.fromEntries(Array.from({length:2000},(_,i)=>[i+1,{due:Date.now()+86400000,stage:Math.min(i%6,5)}])),
      [keys.days]:Array.from({length:365},(_,i)=>new Date(Date.now()-i*86400000).toISOString().slice(0,10)).sort(),
      [keys.readings]:Array.from({length:12},(_,i)=>`r${i+1}`),
      [keys.answers]:{r1:0,r2:2,r3:1},
    };
    await check('year-of-learning-and-two-thousand-word-records-backup-roundtrip',async page=>{
      await ready(page);await nav(page,'进度');
      const before=await page.evaluate(()=>({...localStorage}));
      const pending=page.waitForEvent('download');
      await page.getByRole('button',{name:'导出备份',exact:true}).click();
      const download=await pending;
      const backup=JSON.parse(await readFile(await download.path(),'utf8'));
      assert.equal(backup.formatVersion,1);
      for(const [key,value] of Object.entries(large))assert.deepEqual(backup.data[key],value);
      await page.locator('input[type=file]').setInputFiles({name:'year-backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});
      await page.locator('.restore-dialog').waitFor();
      await Promise.all([page.waitForEvent('domcontentloaded'),page.locator('.restore-confirm').click()]);
      await page.locator('.bottom-nav').waitFor();
      assert.deepEqual(await page.evaluate(()=>({...localStorage})),before);
    },large);
  }
  await browser.close();
}
const summary={passed:results.filter(item=>item.status==='PASS').length,failed:results.filter(item=>item.status==='FAIL').length,total:results.length};
console.log('DAILY_BROWSER_SUMMARY',JSON.stringify(summary));
if(summary.failed)process.exitCode=1;
