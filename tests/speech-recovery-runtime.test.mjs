import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source=await readFile(process.env.SPEECH_SOURCE_FILE || new URL('../app/speech-playback.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
let fixtureId=0;
async function fixture(t,{voices=[],lateCancel=false,lateCancelDelay=0,apple=false}={}){
  t.mock.timers.enable({apis:['setTimeout']});
  const speech=await import(`data:text/javascript;base64,${Buffer.from(js+`\n// fixture ${fixtureId++}`).toString('base64')}`);
  const win=new EventTarget(),attempts=[],started=[],errors=[];
  const engine={paused:false,speaking:false,pending:false,active:null,cancels:0,failVoices:new Set(),
    getVoices(){return voices;},resume(){this.paused=false;},pause(){this.paused=true;},
    cancel(){this.cancels++;this.active=null;this.speaking=false;this.pending=false;
      if(lateCancel)setTimeout(()=>{this.active=null;this.speaking=false;this.pending=false;},lateCancelDelay);},
    speak(u){attempts.push(u);
      if(this.failVoices.has(u.voice?.name)){u.onerror?.({error:'voice-unavailable'});return;}
      this.active=u;this.pending=true;
    },
    start(){const u=this.active;if(!u)return;this.pending=false;this.speaking=true;started.push(u);u.onstart?.();},
    end(){const u=this.active;this.active=null;this.pending=false;this.speaking=false;u?.onend?.();}
  };
  win.speechSynthesis=engine;
  win.navigator={userAgent:apple?'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X)':'test'};
  win.addEventListener(speech.SPEECH_ERROR_EVENT,e=>errors.push(e.detail));
  globalThis.window=win;globalThis.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}};
  t.after(()=>{speech.stopSpeech();delete globalThis.window;delete globalThis.SpeechSynthesisUtterance;});
  return {speech,engine,attempts,started,errors};
}

test('starting from an empty native queue never cancels the new manual playback',async t=>{
  const {speech,engine,started}=await fixture(t,{lateCancel:true});
  assert.equal(speech.speak('A manual replay.'),true);
  t.mock.timers.tick(0);engine.start();
  assert.equal(engine.cancels,0);assert.deepEqual(started.map(u=>u.text),['A manual replay.']);
});

test('late native cancellation is recovered without losing English repetitions or Mandarin',async t=>{
  const {speech,engine,attempts,started,errors}=await fixture(t,{lateCancel:true});
  speech.speak('Old audio.');engine.start();const old=attempts[0];
  speech.startBilingualSentenceSpeech('Current sentence.','当前句子。');
  t.mock.timers.tick(0);assert.equal(engine.active,null,'Reproduce native cancellation swallowing the new queue');
  t.mock.timers.tick(300);assert.ok(engine.active,'Recover the lost queue before the eight-second failure deadline');
  old.onstart();old.onend();old.onerror({error:'interrupted'});
  attempts[1].onstart();attempts[1].onend();
  for(let i=0;i<4;i++){engine.start();engine.end();}
  assert.deepEqual(started.slice(1).map(u=>[u.text,u.lang]),[['Current sentence.','en-US'],['Current sentence.','en-US'],['Current sentence.','en-US'],['当前句子。','zh-CN']]);
  assert.deepEqual(errors,[]);
});

test('English prefers an installed voice over a network-dependent voice and normalizes tags',async t=>{
  const remote={lang:'en-US',name:'Remote',localService:false},local={lang:'en_US',name:'Installed',localService:true};
  const {speech,engine,attempts}=await fixture(t,{voices:[remote,local]});
  engine.failVoices.add('Remote');speech.speak('Works offline too.');engine.start();
  assert.equal(attempts[0].voice,local);assert.equal(engine.speaking,true);
});

test('an unavailable selected voice falls back once and the remaining sequence stays intact',async t=>{
  const broken={lang:'en-US',name:'Unavailable installed voice',localService:true};
  const {speech,engine,attempts,started,errors}=await fixture(t,{voices:[broken]});
  engine.failVoices.add(broken.name);speech.startBilingualSentenceSpeech('Hello.','你好。');
  t.mock.timers.tick(0);
  for(let i=0;i<4;i++){engine.start();engine.end();}
  assert.equal(attempts.length,5,'One failed attempt, then four completed utterances');
  assert.deepEqual(started.map(u=>[u.text,u.lang]),[['Hello.','en-US'],['Hello.','en-US'],['Hello.','en-US'],['你好。','zh-CN']]);
  assert.equal(attempts[1].voice,undefined);assert.deepEqual(errors,[]);
});

test('leaving before recovery cancels the retry and all late callbacks',async t=>{
  const {speech,engine,attempts,started}=await fixture(t,{lateCancel:true});
  speech.speak('Old.');engine.start();speech.startRepeatedSpeech('New.');
  t.mock.timers.tick(0);speech.stopSpeech();t.mock.timers.tick(8000);
  for(const u of attempts){u.onstart?.();u.onend?.();}
  assert.equal(attempts.length,2);assert.equal(started.length,1);assert.equal(engine.active,null);
});

test('recovery is bounded and does not retry permission errors or advance a never-started card',async t=>{
  const {speech,engine,attempts,errors}=await fixture(t);
  speech.startRepeatedSpeech('Never starts.');engine.active=null;engine.pending=false;
  t.mock.timers.tick(300);assert.equal(attempts.length,2);
  engine.active=null;engine.pending=false;t.mock.timers.tick(8000);
  assert.equal(attempts.length,2);assert.deepEqual(errors,['start-timeout']);
  speech.speak('Blocked.');attempts.at(-1).onerror({error:'not-allowed'});t.mock.timers.tick(8000);
  assert.equal(attempts.length,3);assert.deepEqual(errors,['start-timeout','not-allowed']);
});

test('a healthy delayed native queue is never restarted before its actual start',async t=>{
  const {speech,engine,attempts,errors}=await fixture(t);
  speech.startRepeatedSpeech('Preparing normally.');t.mock.timers.tick(7000);
  assert.equal(engine.pending,true);assert.equal(attempts.length,1);
  engine.start();t.mock.timers.tick(8000);assert.equal(attempts.length,1);assert.deepEqual(errors,[]);
});

test('native cancellation arriving after the first queue check still recovers only once',async t=>{
  const {speech,engine,attempts,started}=await fixture(t,{lateCancel:true,lateCancelDelay:500});
  speech.speak('Old.');engine.start();speech.speak('Current.');
  t.mock.timers.tick(250);assert.equal(attempts.length,2,'A healthy pending queue is left alone');
  t.mock.timers.tick(250);t.mock.timers.tick(0);assert.equal(attempts.length,3);
  engine.start();engine.end();t.mock.timers.tick(8000);
  assert.deepEqual(started.map(u=>u.text),['Old.','Current.']);assert.equal(attempts.length,3);
});

test('a current canceled startup retries once and stale replacement callbacks do not advance it',async t=>{
  const {speech,engine,attempts,started,errors}=await fixture(t);
  speech.startRepeatedSpeech('The current example.');const canceled=attempts[0];
  engine.active=null;engine.pending=false;canceled.onerror({error:'canceled'});
  canceled.onend();canceled.onstart();assert.equal(attempts.length,1,'A late callback cannot skip the utterance awaiting recovery');
  t.mock.timers.tick(0);assert.equal(attempts.length,2);
  for(let i=0;i<3;i++){engine.start();engine.end();}
  assert.deepEqual(started.map(u=>u.text),Array(3).fill('The current example.'));assert.deepEqual(errors,[]);
});

test('an unavailable Mandarin voice falls back in Chinese after all three English completions',async t=>{
  const broken={name:'Unavailable Mandarin',lang:'zh_CN',localService:true};
  const {speech,engine,attempts,started,errors}=await fixture(t,{voices:[broken]});
  engine.failVoices.add(broken.name);speech.startBilingualSentenceSpeech('Good morning.','早上好。');
  for(let i=0;i<3;i++){engine.start();engine.end();}
  t.mock.timers.tick(0);engine.start();engine.end();
  assert.equal(attempts.length,5);assert.deepEqual(started.map(u=>u.lang),['en-US','en-US','en-US','zh-CN']);
  assert.equal(attempts.at(-1).voice,undefined);assert.deepEqual(errors,[]);
});

test('reading recovery records activity only at actual start and retains pause, resume and stop',async t=>{
  const broken={name:'Unavailable reader voice',lang:'en-US',localService:true};
  const {speech,engine,attempts}=await fixture(t,{voices:[broken]});let activity=0;
  engine.failVoices.add(broken.name);speech.startSegmentedSpeech('A useful article. '.repeat(20),0.74,()=>activity++);
  assert.equal(activity,0);t.mock.timers.tick(0);engine.start();assert.equal(activity,1);
  assert.equal(speech.toggleSegmentedSpeech(),'paused');assert.equal(speech.toggleSegmentedSpeech(),'playing');
  engine.end();engine.start();assert.equal(activity,1);speech.stopSpeech();
  const n=attempts.length;t.mock.timers.tick(8000);assert.equal(attempts.length,n);assert.equal(engine.active,null);
});

test('Apple first playback delegates English and Mandarin voice resolution to the system',async t=>{
  const voices=[{lang:'en-US',name:'First listed novelty voice',localService:true},{lang:'zh-CN',name:'First listed Chinese',localService:true}];
  const {speech,engine,attempts,started}=await fixture(t,{voices,apple:true});
  speech.startBilingualSentenceSpeech('Hello.','你好。');
  for(let i=0;i<4;i++){engine.start();engine.end();}
  assert.ok(attempts.every(u=>u.voice===undefined),'A browser list is not proof that a voice is installed and ready');
  assert.ok(attempts.every(u=>u.volume===1));
  assert.deepEqual(started.map(u=>u.lang),['en-US','en-US','en-US','zh-CN']);
});

test('a WebKit queue reporting speaking before a real start recovers at the startup deadline',async t=>{
  const {speech,engine,attempts,started,errors}=await fixture(t,{voices:[{lang:'en-US',name:'Stuck voice',localService:true}]});
  speech.startRepeatedSpeech('Keep the full example.');const stalled=attempts[0];
  engine.speaking=true;engine.pending=false; // WebKit sets this before native didStartSpeaking.
  t.mock.timers.tick(7999);assert.equal(attempts.length,1);
  t.mock.timers.tick(1);t.mock.timers.tick(0);
  assert.equal(attempts.length,2);assert.equal(attempts[1].voice,undefined);assert.equal(engine.cancels,1);
  stalled.onend();stalled.onstart();stalled.onerror({error:'interrupted'});
  for(let i=0;i<3;i++){engine.start();engine.end();}
  assert.deepEqual(started.map(u=>u.text),Array(3).fill('Keep the full example.'));assert.deepEqual(errors,[]);
});

test('a failed system voice on Apple falls back once without losing a bilingual repetition',async t=>{
  const voices=[{lang:'en-US',name:'Installed English',localService:true},{lang:'zh-CN',name:'Installed Chinese',localService:true}];
  const {speech,engine,attempts,started}=await fixture(t,{voices,apple:true});
  speech.startBilingualSentenceSpeech('Current sentence.','当前句子。');
  engine.active=null;engine.pending=false;engine.speaking=false;attempts[0].onerror({error:'synthesis-failed'});
  t.mock.timers.tick(0);assert.equal(attempts[1].voice,voices[0]);
  for(let i=0;i<4;i++){engine.start();engine.end();}
  assert.deepEqual(started.map(u=>u.lang),['en-US','en-US','en-US','zh-CN']);
  assert.equal(attempts[2].voice,voices[0],'Subsequent English uses the confirmed working route');
  assert.equal(attempts.at(-1).voice,undefined,'Mandarin retains independent voice resolution');
});

test('a stuck Apple system startup can use an installed voice and a second stall terminates',async t=>{
  const {speech,engine,attempts,errors}=await fixture(t,{voices:[{lang:'en-US',name:'Installed',localService:true}],apple:true});
  speech.speak('An unstarted word.');engine.speaking=true;engine.pending=false;
  t.mock.timers.tick(8000);t.mock.timers.tick(0);assert.equal(attempts.length,2);assert.equal(attempts[1].voice.name,'Installed');
  engine.speaking=true;engine.pending=false;t.mock.timers.tick(8000);
  assert.equal(attempts.length,2);assert.deepEqual(errors,['start-timeout']);assert.equal(engine.active,null);
});

test('navigation before stalled-startup recovery invalidates all retries and diagnostic callbacks',async t=>{
  const {speech,engine,attempts}=await fixture(t,{voices:[{lang:'en-US',name:'Installed',localService:true}]});
  speech.startRepeatedSpeech('Old card.');engine.speaking=true;
  t.mock.timers.tick(7999);speech.stopSpeech();const before=speech.getSpeechDiagnostic();
  t.mock.timers.tick(16000);attempts[0].onstart();attempts[0].onend();
  assert.equal(attempts.length,1);assert.deepEqual(speech.getSpeechDiagnostic(),before);
});

test('explicit alternate voice testing affects later study without changing language or repeat count',async t=>{
  const {speech,engine,attempts,started}=await fixture(t,{voices:[{lang:'en-US',name:'Installed',localService:true}],apple:true});
  speech.testSpeech('en-US',true);assert.equal(attempts[0].voice.name,'Installed');engine.start();engine.end();
  speech.startRepeatedSpeech('The next example.');for(let i=0;i<3;i++){engine.start();engine.end();}
  assert.deepEqual(started.slice(1).map(u=>[u.text,u.lang,u.voice.name]),Array(3).fill(['The next example.','en-US','Installed']));
  assert.equal(speech.getSpeechDiagnostic().phase,'ended');
  speech.testSpeech('zh-CN');engine.start();engine.end();assert.equal(attempts.at(-1).voice,undefined);
});

test('stopping preparation publishes idle and preserves the last language and voice',async t=>{
  const {speech,engine,attempts}=await fixture(t,{voices:[{lang:'en-US',name:'Installed English',localService:true}]});
  const diagnostics=[];window.addEventListener(speech.SPEECH_DIAGNOSTIC_EVENT,e=>diagnostics.push(e.detail));
  speech.testSpeech('en-US');const requested=speech.getSpeechDiagnostic();
  assert.equal(requested.phase,'requested');assert.equal(requested.voice,'Installed English');
  speech.stopSpeech();t.mock.timers.tick(16000);attempts[0].onstart();attempts[0].onend();
  assert.equal(engine.active,null);assert.deepEqual(speech.getSpeechDiagnostic(),{...requested,phase:'idle'});
  assert.equal(diagnostics.at(-1).phase,'idle','Reopened speech checks must not keep reporting a canceled request');
});

test('stopping an active diagnostic publishes idle without a false completion',async t=>{
  const {speech,engine,attempts}=await fixture(t,{apple:true});
  speech.testSpeech('zh-CN');engine.start();const started=speech.getSpeechDiagnostic();
  assert.equal(started.phase,'started');assert.equal(started.language,'zh-CN');
  speech.stopSpeech();attempts[0].onend();attempts[0].onerror({error:'interrupted'});
  assert.equal(engine.active,null);assert.deepEqual(speech.getSpeechDiagnostic(),{...started,phase:'idle'});
});

test('stopping during voice recovery retains its metadata and cancels the replacement',async t=>{
  const broken={lang:'en-US',name:'Broken installed voice',localService:true};
  const {speech,engine,attempts}=await fixture(t,{voices:[broken]});
  engine.failVoices.add(broken.name);speech.testSpeech('en-US');
  const recovering=speech.getSpeechDiagnostic();assert.equal(recovering.phase,'recovering');
  speech.stopSpeech();t.mock.timers.tick(16000);
  assert.equal(attempts.length,1);assert.equal(engine.active,null);
  assert.deepEqual(speech.getSpeechDiagnostic(),{...recovering,phase:'idle'});
});

test('completed and failed speech feedback survives subsequent cleanup',async t=>{
  const {speech,engine,attempts}=await fixture(t);
  speech.startBilingualSentenceSpeech('Hello.','你好。');for(let i=0;i<4;i++){engine.start();engine.end();}
  const ended=speech.getSpeechDiagnostic();assert.equal(ended.phase,'ended');assert.equal(ended.language,'zh-CN');
  speech.stopSpeech();assert.deepEqual(speech.getSpeechDiagnostic(),ended);
  speech.startRepeatedSpeech('Blocked.');attempts.at(-1).onerror({error:'not-allowed'});
  const failed=speech.getSpeechDiagnostic();assert.equal(failed.phase,'failed');assert.equal(failed.error,'not-allowed');
  speech.stopSpeech();assert.deepEqual(speech.getSpeechDiagnostic(),failed);
});

test('an unavailable alternate voice stops old playback and reports the intended language',async t=>{
  const {speech,engine,attempts}=await fixture(t,{apple:true});
  speech.testSpeech('en-US');engine.start();
  assert.equal(speech.testSpeech('zh-CN',true),false);
  assert.equal(engine.active,null);assert.equal(attempts.length,1);
  const failed=speech.getSpeechDiagnostic();assert.equal(failed.phase,'failed');
  assert.equal(failed.language,'zh-CN');assert.equal(failed.error,'voice-unavailable');
  attempts[0].onend();attempts[0].onstart();t.mock.timers.tick(16000);
  assert.deepEqual(speech.getSpeechDiagnostic(),failed);
});

test('a Chinese diagnostic failure emits a Chinese learning warning and preserves the actual code',async t=>{
  const {speech,engine,errors}=await fixture(t,{apple:true});
  speech.testSpeech('zh-CN');engine.active.onerror({error:'language-unavailable'});
  assert.deepEqual(errors,['chinese-language-unavailable']);
  assert.equal(speech.getSpeechDiagnostic().language,'zh-CN');
  assert.equal(speech.getSpeechDiagnostic().error,'language-unavailable');
  speech.testSpeech('en-US');engine.active.onerror({error:'language-unavailable'});
  assert.deepEqual(errors,['chinese-language-unavailable','language-unavailable']);
});
