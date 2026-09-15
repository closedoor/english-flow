import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
const source = await readFile(new URL('../app/speech-playback.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const speech = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
function fixture(t, start = true) {
  t.mock.timers.enable({apis:['setTimeout']});
  const window = new EventTarget();
  const spoken = [], errors = [], states = [];
  window.speechSynthesis = {paused:false,cancel(){},resume(){this.paused=false;},getVoices(){return [];},speak(u){spoken.push(u);if(start)u.onstart?.();}};
  globalThis.window = window;
  globalThis.SpeechSynthesisUtterance = class {constructor(text){this.text=text;}};
  window.addEventListener(speech.SPEECH_ERROR_EVENT,e=>errors.push(e.detail));
  window.addEventListener(speech.SPEECH_PLAYBACK_EVENT,e=>states.push(e.detail));
  t.after(()=>{speech.stopSpeech();delete globalThis.window;delete globalThis.SpeechSynthesisUtterance;});
  return {window,spoken,errors,states};
}
test('NGSL example is spoken fully exactly three times, advancing only after end', t=>{
  const {spoken,states}=fixture(t);
  const example='I would like a cup of tea, please.';
  assert.equal(speech.startRepeatedSpeech(example),true);
  assert.equal(spoken.length,1);
  t.mock.timers.tick(12000);
  assert.equal(spoken.length,1,'elapsed time cannot cut a long sentence short');
  spoken[0].onend();assert.equal(spoken.length,2);
  spoken[1].onend();assert.equal(spoken.length,3);
  spoken[2].onend();t.mock.timers.tick(30000);
  assert.deepEqual(spoken.map(u=>u.text),[example,example,example]);
  assert.ok(spoken.every(u=>u.rate===0.82));
  assert.equal(states.at(-1),'idle');
});
test('changing words cancels remaining old repeats and ignores their late callbacks',t=>{
  const {spoken,errors}=fixture(t);
  speech.startRepeatedSpeech('Old example.');const old=spoken[0];
  speech.startRepeatedSpeech('New example.');
  old.onend();old.onerror({error:'interrupted'});old.onstart();
  assert.deepEqual(spoken.map(u=>u.text),['Old example.','New example.']);
  spoken[1].onend();spoken[2].onend();spoken[3].onend();
  assert.deepEqual(spoken.slice(1).map(u=>u.text),Array(3).fill('New example.'));
  assert.deepEqual(errors,[]);
});
test('manual word audio cancels repeat queue without restarting it',t=>{
  const {spoken}=fixture(t);
  speech.startRepeatedSpeech('A full example.');const old=spoken[0];
  speech.speak('word');old.onend();spoken[1].onend();
  t.mock.timers.tick(30000);
  assert.deepEqual(spoken.map(u=>u.text),['A full example.','word']);
});
test('leaving a card or hiding a page cancels all pending repetitions',t=>{
  const {spoken}=fixture(t,false);
  speech.startRepeatedSpeech('Stop when leaving.');const old=spoken[0];
  speech.stopSpeech();old.onstart();old.onend();t.mock.timers.tick(30000);
  assert.equal(spoken.length,1);
});
test('failed repeat startup stops the queue and remains retryable',t=>{
  const {spoken,errors,states}=fixture(t,false);
  speech.startRepeatedSpeech('No permission yet.');
  spoken[0].onerror({error:'not-allowed'});
  spoken[0].onend();assert.equal(spoken.length,1);assert.equal(states.at(-1),'idle');
  assert.deepEqual(errors,['not-allowed']);
  speech.startRepeatedSpeech('Retry after a tap.');spoken[1].onstart();
  spoken[1].onend();spoken[2].onstart();spoken[2].onend();spoken[3].onstart();spoken[3].onend();
  assert.equal(spoken.length,4);
});
test('silent repeat startup times out once and cannot restart from stale events',t=>{
  const {spoken,errors}=fixture(t,false);
  speech.startRepeatedSpeech('Silent engine.');t.mock.timers.tick(8000);
  assert.deepEqual(errors,['start-timeout']);spoken[0].onend();t.mock.timers.tick(30000);
  assert.equal(spoken.length,1);
});
test('blank text and invalid repeat counts never start or replace audio',t=>{
  const {spoken}=fixture(t);
  assert.equal(speech.startRepeatedSpeech(' '),false);
  for(const count of [0,-1,1.5,NaN,Infinity,11]) assert.equal(speech.startRepeatedSpeech('Example.',count),false);
  assert.equal(spoken.length,0);
});
test('repeat helper tolerates unsupported speech and a failing cancel operation',t=>{
  const {window,spoken}=fixture(t);
  window.speechSynthesis.cancel=()=>{throw Error('unavailable');};
  assert.equal(speech.startRepeatedSpeech('Example.'),false);assert.equal(spoken.length,0);
  delete globalThis.SpeechSynthesisUtterance;
  assert.equal(speech.startRepeatedSpeech('Example.'),false);
});
