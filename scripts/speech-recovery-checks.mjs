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
        const state={attempts:[],started:[],active:null,gesture:false,lateCancel:false,drop:false,failVoices:[],voices:[],cancels:0,
          end(){const u=this.active;this.active=null;synth.pending=false;synth.speaking=false;u?.onend?.();}};
        window.__speechRecovery=state;
        document.addEventListener('click',()=>state.gesture=true,true);window.addEventListener('click',()=>state.gesture=false);
        Object.defineProperty(window,'SpeechSynthesisUtterance',{configurable:true,value:class{constructor(text){this.text=text;}}});
        const synth={paused:false,pending:false,speaking:false,getVoices(){return state.voices;},resume(){this.paused=false;},
          cancel(){state.cancels++;state.active=null;this.pending=false;this.speaking=false;
            if(state.lateCancel)setTimeout(()=>{state.active=null;this.pending=false;this.speaking=false;},0);},
          speak(u){state.attempts.push({text:u.text,lang:u.lang,voice:u.voice?.name,gesture:state.gesture});
            if(state.failVoices.includes(u.voice?.name)){u.onerror?.({error:'voice-unavailable'});u.onend?.();u.onstart?.();return;}
            if(state.drop)return;
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
    await browser.close();
  }
  const failed=results.filter(r=>r.status==='FAIL').length;
  console.log(local?'SPEECH_RECOVERY_SUMMARY':'LIVE_SPEECH_RECOVERY_SUMMARY',JSON.stringify({passed:results.length-failed,failed,total:results.length,...(expectedCommit?{commit:expectedCommit}:{}),faultsSimulated:true,physicalAudioVerified:false}));
  if(failed)process.exitCode=1;
}
