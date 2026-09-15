import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
const page=await readFile(new URL('../app/page.tsx',import.meta.url),'utf8');
const css=await readFile(new URL('../app/globals.css',import.meta.url),'utf8');
for(const [name,next,id] of [['renderLearnSetup','renderCards','word-session-choice'],['renderSentenceSetup','renderSentenceCards','sentence-session-choice']]){
  test(`${name} keeps one start and its live summary directly below the header`,()=>{
    const section=page.split(`  const ${name} =`)[1].split(`  const ${next} =`)[0];
    assert.equal((section.match(/>开始这组学习<\/button>/g)||[]).length,1);
    assert.match(section,/commonHeader\([^\n]+\)\}\n      <div className="setup-start-panel">/);
    const action=section.indexOf('setup-start-panel');
    assert.ok(action<section.indexOf('className="setup-block"'));
    const button=section.indexOf('>开始这组学习</button>');
    assert.ok(button<section.indexOf(`id="${id}"`));
    assert.match(section,new RegExp(`aria-describedby="${id}"`));
    assert.match(section,/className="session-choice-summary" aria-live="polite"/);
  });
}
test('top setup starts retain current choices and sentence-loading guards',()=>{
  const word=page.split('  const renderLearnSetup =')[1].split('  const renderCards =')[0];
  const sentence=page.split('  const renderSentenceSetup =')[1].split('  const renderSentenceCards =')[0];
  assert.match(word,/onClick=\{\(\) => startSession\(\)\}/);
  assert.match(word,/currentPathLabel[\s\S]*currentSessionCount[\s\S]*currentModeLabel/);
  assert.match(sentence,/disabled=\{sentenceSelectionLoading \|\| availableCount === 0\} onClick=\{\(\) => startSentenceSession\(\)\}/);
  assert.match(sentence,/onClick=\{resumeSentenceSession\}/);
});
test('only setup buttons lose bottom-sticky positioning; quiz and card toolbars remain',()=>{
  assert.match(css,/\.setup-start-panel>\.setup-start\{[^}]*position:static;bottom:auto;[^}]*min-height:53px/);
  assert.match(css,/\.setup-start-panel>\.session-choice-summary\{margin:8px 0 0/);
  assert.match(css,/\.learn-page>\.word-card-actions\{position:sticky;bottom:calc\(74px/);
  const quiz=page.split('  const renderQuiz =')[1].split('  const renderResult =')[0];
  assert.match(quiz,/className="sticky-start primary-action"/);
  assert.doesNotMatch(quiz,/setup-start/);
});
