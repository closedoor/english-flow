import assert from 'node:assert/strict';

// Speech faults are explicitly injected. The app, gesture, geometry, DOM and
// saved progress are real; this is not an iPhone/headset listening check.
export async function verifySpeechRecovery(playwright,origin,expectedCommit){
  const base=new URL(origin);
  const local=['localhost','127.0.0.1','[::1]'].includes(base.hostname);
  if(!local){assert.equal(base.origin,'https://english-flow-mwnn.onrender.com');assert.match(expectedCommit||'',/^[a-f0-9]{40}$/);}
  const results=[];
  for(const engine of ['chromium','webkit']){
    const browser=await playwright[engine].launch({headless:true});
    async function check(name,action){
      const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,serviceWorkers:local?'block':'allow'});
      await context.addInitScript(()=>{
        const state={attempts:[],started:[],active:null,gesture:false,lateCancel:false,drop:false,failVoices:[],voices:[],cancels:0,apple:false,stallNext:0,failAll:null,
          end(){const u=this.active;this.active=null;synth.pending=false;synth.speaking=false;u?.onend?.();}};
        window.__speechRecovery=state;
        // Only voice-route selection is simulated here. Both rendering engines
        // and real DOM gestures remain unchanged; this is not native iOS audio.
        Object.defineProperty(navigator,'userAgent',{configurable:true,get:()=>state.apple?'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X)':'English Flow isolated speech fixture'});
        document.addEventListener('click',()=>state.gesture=true,true);window.addEventListener('click',()=>state.gesture=false);
        Object.defineProperty(window,'SpeechSynthesisUtterance',{configurable:true,value:class{constructor(text){this.text=text;}}});
        const synth={paused:false,pending:false,speaking:false,getVoices(){return state.voices;},resume(){this.paused=false;},
          cancel(){state.cancels++;state.active=null;this.pending=false;this.speaking=false;
            if(state.lateCancel)setTimeout(()=>{state.active=null;this.pending=false;this.speaking=false;},0);},
          speak(u){state.attempts.push({text:u.text,lang:u.lang,voice:u.voice?.name,gesture:state.gesture});
            if(state.failAll){u.onerror?.({error:state.failAll});return;}
            if(state.failVoices.includes(u.voice?.name)){u.onerror?.({error:'voice-unavailable'});u.onend?.();u.onstart?.();return;}
            if(state.drop)return;
            if(state.stallNext>0){state.stallNext--;state.active=u;this.speaking=true;this.pending=false;return;}
            state.active=u;this.pending=true;
            setTimeout(()=>{if(state.active!==u)return;this.pending=false;this.speaking=true;state.started.push({text:u.text,lang:u.lang,voice:u.voice?.name});u.onstart?.();},30);
          }};
        Object.defineProperty(window,'speechSynthesis',{configurable:true,value:synth});
      });
      const page=await context.newPage();page.setDefaultTimeout(12000);
      const errors=[];page.on('pageerror',e=>errors.push(e.message));
      try{
        const url=new URL('/',base);if(expectedCommit)url.searchParams.set('ef-update',expectedCommit);
        const response=await page.goto(url.href,{waitUntil:'domcontentloaded'});assert.equal(response.status(),200);
        if(expectedCommit){assert.equal(await page.title(),'词流英语');assert.equal(await page.locator('meta[name="english-flow-build"]').getAttribute('content'),expectedCommit);}
        await page.locator('.bottom-nav').waitFor();await action(page);assert.deepEqual(errors,[]);
        results.push({engine,name,status:'PASS'});
      }catch(error){results.push({engine,name,status:'FAIL',error:String(error),errors});}
      finally{await context.close();}
      console.log(local?'SPEECH_RECOVERY_CASE':'LIVE_SPEECH_RECOVERY_CASE',JSON.stringify({...results.at(-1),...(expectedCommit?{commit:expectedCommit}:{}),faultsSimulated:true}));
    }
    async function beginSentence(page){
      await page.locator('.bottom-nav button').filter({hasText:'句子'}).click();
      await page.waitForFunction(()=>{const b=document.querySelector('.sentence-page .setup-start');return b&&!b.disabled;});
      await page.getByRole('button',{name:'开始学习句子',exact:true}).click();await page.locator('.sentence-translation').waitFor();
    }
    async function completeSentence(page,offset){
      const english=await page.locator('.sentence-english').innerText(),chinese=await page.locator('.sentence-translation').innerText();
      for(let i=0;i<4;i++){await page.waitForFunction(n=>window.__speechRecovery.started.length===n,offset+i+1);await page.evaluate(()=>window.__speechRecovery.end());}
      assert.deepEqual(await page.evaluate(n=>window.__speechRecovery.started.slice(n).map(u=>[u.text,u.lang]),offset),[[english,'en-US'],[english,'en-US'],[english,'en-US'],[chinese,'zh-CN']]);
    }
    await check('empty-queue-start-keeps-click-activation-and-completes-three-plus-one',async page=>{
      await page.evaluate(()=>window.__speechRecovery.lateCancel=true);await beginSentence(page);await completeSentence(page,0);
      assert.equal(await page.evaluate(()=>window.__speechRecovery.attempts[0].gesture),true);assert.equal(await page.locator('.speech-warning').count(),0);
    });
    await check('bottom-replay-recovers-a-late-cancel-without-changing-progress',async page=>{
      await beginSentence(page);await page.waitForFunction(()=>window.__speechRecovery.started.length===1);
      const before=await page.evaluate(()=>localStorage.getItem('wordflow-sentence-active-session-v1'));
      await page.evaluate(()=>window.__speechRecovery.lateCancel=true);
      const button=page.getByRole('button',{name:'重播本句',exact:true}),r=await button.boundingBox();
      assert.ok(r.y+r.height<=844);await page.touchscreen.tap(r.x+r.width/2,r.y+r.height/2);
      await completeSentence(page,1);assert.equal(await page.evaluate(()=>localStorage.getItem('wordflow-sentence-active-session-v1')),before);
      assert.equal(await page.locator('.speech-warning').count(),0);
    });
    await check('installed-normalized-English-voice-wins-over-unavailable-network-voice',async page=>{
      await page.evaluate(()=>{const s=window.__speechRecovery;s.voices=[{name:'Network',lang:'en-US',localService:false},{name:'Installed',lang:'en_US',localService:true}];s.failVoices=['Network'];});
      await beginSentence(page);await completeSentence(page,0);
      assert.equal(await page.evaluate(()=>window.__speechRecovery.started[0].voice),'Installed');
    });
    await check('unavailable-installed-voice-falls-back-and-preserves-all-four-utterances',async page=>{
      await page.evaluate(()=>{const s=window.__speechRecovery;s.voices=[{name:'Unavailable',lang:'en-US',localService:true}];s.failVoices=['Unavailable'];});
      await beginSentence(page);await completeSentence(page,0);assert.equal(await page.evaluate(()=>window.__speechRecovery.attempts.length),5);
      assert.equal(await page.locator('.speech-warning').count(),0);
    });
    await check('manual-word-playback-recovers-unavailable-voice-without-rating',async page=>{
      await page.locator('.bottom-nav button').filter({hasText:'单词'}).click();await page.getByRole('button',{name:'开始学习',exact:true}).click();await page.locator('.word-card').waitFor();
      await page.waitForFunction(()=>window.__speechRecovery.started.length===1);
      await page.evaluate(()=>{const s=window.__speechRecovery;s.voices=[{name:'Broken manual voice',lang:'en-US',localService:true}];s.failVoices=['Broken manual voice'];});
      const before=await page.evaluate(()=>localStorage.getItem('wordflow-active-session-v1'));
      await page.getByRole('button',{name:'播放场景句子',exact:true}).click();await page.waitForFunction(()=>window.__speechRecovery.started.length===2);
      assert.equal(await page.evaluate(()=>window.__speechRecovery.started.at(-1).text),await page.locator('.example-box p').innerText());
      assert.equal(await page.evaluate(()=>localStorage.getItem('wordflow-active-session-v1')),before);
    });
    await check('exit-cancels-an-unstarted-replay-recovery',async page=>{
      await beginSentence(page);await page.waitForFunction(()=>window.__speechRecovery.started.length===1);
      await page.evaluate(()=>{window.__speechRecovery.lateCancel=true;window.__speechRecovery.drop=true;});await page.getByRole('button',{name:'重播本句',exact:true}).click();
      await page.getByRole('button',{name:'返回句库设置并保留进度',exact:true}).click();
      const attempts=await page.evaluate(()=>window.__speechRecovery.attempts.length);await page.waitForTimeout(500);
      assert.equal(await page.evaluate(()=>window.__speechRecovery.attempts.length),attempts);assert.equal(await page.evaluate(()=>window.__speechRecovery.started.length),1);
    });
    await check('Apple-uses-system-language-resolution-instead-of-the-first-listed-voice',async page=>{
      await page.evaluate(()=>{const s=window.__speechRecovery;s.apple=true;s.voices=[{name:'First listed broken English',lang:'en-US',localService:true},{name:'First listed broken Chinese',lang:'zh-CN',localService:true}];s.failVoices=s.voices.map(v=>v.name);});
      await beginSentence(page);await completeSentence(page,0);
      assert.ok((await page.evaluate(()=>window.__speechRecovery.attempts)).every(u=>u.voice===undefined));
    });
    await check('word-start-recovers-a-speaking-flag-without-an-actual-start-and-next-keeps-three',async page=>{
      await page.evaluate(()=>{const s=window.__speechRecovery;s.stallNext=1;s.voices=[{name:'Stalled installed voice',lang:'en-US',localService:true}];});
      await page.locator('.bottom-nav button').filter({hasText:'单词'}).click();await page.getByRole('button',{name:'开始学习',exact:true}).click();await page.locator('.word-card').waitFor();
      const before=await page.evaluate(()=>localStorage.getItem('wordflow-active-session-v1'));
      const english=await page.locator('.example-box p').innerText();
      for(let i=0;i<3;i++){await page.waitForFunction(n=>window.__speechRecovery.started.length===n,i+1);await page.evaluate(()=>window.__speechRecovery.end());}
      assert.deepEqual(await page.evaluate(()=>window.__speechRecovery.started.map(u=>u.text)),Array(3).fill(english));
      assert.equal(await page.evaluate(()=>localStorage.getItem('wordflow-active-session-v1')),before);
      assert.equal(await page.locator('.speech-warning').count(),0);
      await page.locator('[aria-label="切换词卡"] button').last().click();
      const next=await page.locator('.example-box p').innerText();
      for(let i=0;i<3;i++){await page.waitForFunction(n=>window.__speechRecovery.started.length===n,i+4);await page.evaluate(()=>window.__speechRecovery.end());}
      assert.deepEqual(await page.evaluate(()=>window.__speechRecovery.started.slice(3).map(u=>u.text)),Array(3).fill(next));
    });
    await check('Apple-stalled-sentence-start-falls-back-without-skipping-English-or-Chinese',async page=>{
      await page.evaluate(()=>{const s=window.__speechRecovery;s.apple=true;s.stallNext=1;s.voices=[{name:'Installed alternative English',lang:'en-US',localService:true}];});
      await beginSentence(page);
      const before=await page.evaluate(()=>localStorage.getItem('wordflow-sentence-active-session-v1'));
      await completeSentence(page,0);
      assert.equal(await page.evaluate(()=>window.__speechRecovery.started[0].voice),'Installed alternative English');
      assert.equal(await page.evaluate(()=>localStorage.getItem('wordflow-sentence-active-session-v1')),before);
      await page.getByRole('button',{name:'下一句 ›',exact:true}).click();await completeSentence(page,4);
      assert.equal(await page.evaluate(()=>window.__speechRecovery.started[4].voice),'Installed alternative English');
      assert.equal(await page.evaluate(()=>window.__speechRecovery.started[7].voice),undefined);
    });
    await check('voice-check-exposes-native-feedback-and-an-explicit-alternative-without-changing-records',async page=>{
      await page.setViewportSize({width:320,height:780});
      await page.evaluate(()=>{const s=window.__speechRecovery;s.apple=true;s.voices=[{name:'Installed English',lang:'en-US',localService:true}];});
      await page.locator('.home-settings-entry').click();await page.locator('.speech-check summary').click();
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
      for(const button of await page.locator('.speech-check button').all()){const r=await button.boundingBox();assert.ok(r.height>=44&&r.x>=0&&r.x+r.width<=320);}
      const before=await page.evaluate(()=>JSON.stringify(Object.entries(localStorage)));
      await page.getByRole('button',{name:'试听英文',exact:true}).click();await page.waitForFunction(()=>window.__speechRecovery.started.length===1);
      assert.match(await page.locator('.speech-check [role="status"]').innerText(),/系统报告已开始/);
      await page.evaluate(()=>window.__speechRecovery.end());
      assert.match(await page.locator('.speech-check [role="status"]').innerText(),/系统报告朗读结束/);
      await page.getByRole('button',{name:'换个声音试播',exact:true}).click();await page.waitForFunction(()=>window.__speechRecovery.started.length===2);
      assert.equal(await page.evaluate(()=>window.__speechRecovery.started.at(-1).voice),'Installed English');
      await page.getByRole('button',{name:'停止试听',exact:true}).click();
      assert.equal(await page.evaluate(()=>window.__speechRecovery.active),null);
      assert.equal(await page.evaluate(()=>JSON.stringify(Object.entries(localStorage))),before);
      await page.evaluate(()=>window.__speechRecovery.failAll='not-allowed');await page.getByRole('button',{name:'试听中文',exact:true}).click();
      assert.match(await page.locator('.speech-check').innerText(),/not-allowed/);
      assert.match(await page.locator('.speech-check [role="status"]').innerText(),/浏览器阻止了朗读/);
      await page.locator('.speech-check summary').click();assert.equal(await page.evaluate(()=>window.__speechRecovery.active),null);
    });
    await browser.close();
  }
  const failed=results.filter(r=>r.status==='FAIL').length;
  console.log(local?'SPEECH_RECOVERY_SUMMARY':'LIVE_SPEECH_RECOVERY_SUMMARY',JSON.stringify({passed:results.length-failed,failed,total:results.length,...(expectedCommit?{commit:expectedCommit}:{}),faultsSimulated:true,physicalAudioVerified:false}));
  if(failed)process.exitCode=1;
}
