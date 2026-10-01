import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
const source=await readFile(new URL('../app/speech-playback.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const speech=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
function setup(t,{start=true,voices=[]}={}){
 t.mock.timers.enable({apis:['setTimeout']}); const win=new EventTarget(),spoken=[],errors=[];
 win.speechSynthesis={paused:false,cancel(){},resume(){this.paused=false;},getVoices(){return voices;},speak(u){spoken.push(u);if(start)u.onstart?.();}};
 globalThis.window=win;globalThis.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}};
 win.addEventListener(speech.SPEECH_ERROR_EVENT,e=>errors.push(e.detail));
 t.after(()=>{speech.stopSpeech();delete globalThis.window;delete globalThis.SpeechSynthesisUtterance;});return{win,spoken,errors};
}
test('sentence listening queues exactly three whole English utterances and one Mandarin translation',t=>{
 const en={lang:'en-US',name:'English'},zh={lang:'zh-CN',name:'Mandarin'};const{spoken}=setup(t,{voices:[en,zh]});
 assert.equal(speech.startBilingualSentenceSpeech('Can you guess what I have?','你能猜到我有什么吗？'),true);
 t.mock.timers.tick(30000);assert.equal(spoken.length,1);
 for(let i=0;i<4;i++)spoken[i].onend();
 assert.deepEqual(spoken.map(u=>u.lang),['en-US','en-US','en-US','zh-CN']);
 assert.deepEqual(spoken.map(u=>u.text),['Can you guess what I have?','Can you guess what I have?','Can you guess what I have?','你能猜到我有什么吗？']);
 assert.equal(spoken[0].voice,en);assert.equal(spoken[3].voice,zh);assert.equal(spoken[3].rate,0.88);
});
test('English fallback voices never get assigned to a Chinese utterance',t=>{
 const{spoken}=setup(t,{voices:[{lang:'en-GB'},{lang:'zh-HK'}]});speech.startBilingualSentenceSpeech('Hello.','你好。');
 for(let i=0;i<3;i++)spoken[i].onend();assert.equal(spoken[3].lang,'zh-CN');assert.equal(spoken[3].voice,undefined);
});
test('Mandarin voice lookup accepts normalized tags and asynchronously arriving voices',t=>{
 const voices=[{lang:'en-US'}];const{spoken}=setup(t,{voices});speech.startBilingualSentenceSpeech('Hello.','你好。');
 voices.push({lang:'zh_CN',name:'Chinese'});for(let i=0;i<3;i++)spoken[i].onend();assert.equal(spoken[3].voice.name,'Chinese');
});
test('changing a sentence cancels all remaining old English and Chinese callbacks',t=>{
 const{spoken,errors}=setup(t);speech.startBilingualSentenceSpeech('Old.','旧。');const old=spoken[0];
 speech.startBilingualSentenceSpeech('New.','新。');old.onend();old.onerror({error:'interrupted'});old.onstart();
 for(let i=1;i<5;i++)spoken[i].onend();assert.deepEqual(spoken.map(u=>u.text),['Old.','New.','New.','New.','新。']);assert.deepEqual(errors,[]);
});
test('manual English playback and existing NGSL repetition discard bilingual queue metadata',t=>{
 const{spoken}=setup(t);speech.startBilingualSentenceSpeech('Hello.','你好。');const old=spoken[0];speech.speak('word');old.onend();spoken[1].onend();
 speech.startRepeatedSpeech('Existing word example.');for(let i=2;i<5;i++)spoken[i].onend();assert.equal(spoken.length,5);assert.ok(spoken.every(u=>u.lang==='en-US'));
});
test('a missing Chinese voice produces a useful failure without replaying English or advancing cards',t=>{
 const{spoken,errors}=setup(t);speech.startBilingualSentenceSpeech('Hello.','你好。');for(let i=0;i<3;i++)spoken[i].onend();
 spoken[3].onerror({error:'language-unavailable'});spoken[3].onend();assert.equal(spoken.length,4);assert.deepEqual(errors,['chinese-unavailable']);
});
test('hidden-page cancellation and silent startup cannot produce late Chinese speech',t=>{
 const{spoken,errors}=setup(t,{start:false});speech.startBilingualSentenceSpeech('Hello.','你好。');t.mock.timers.tick(8000);spoken[0].onend();assert.equal(spoken.length,1);assert.deepEqual(errors,['start-timeout']);
 speech.startBilingualSentenceSpeech('Retry.','重试。');speech.stopSpeech();spoken[1].onend();assert.equal(spoken.length,2);
});
test('empty bilingual text cannot interrupt an existing valid queue',t=>{
 const{spoken}=setup(t);speech.startRepeatedSpeech('Keep playing.');assert.equal(speech.startBilingualSentenceSpeech('','中'),false);assert.equal(speech.startBilingualSentenceSpeech('English',' '),false);spoken[0].onend();assert.equal(spoken.length,2);
});
