import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
const page=await readFile(new URL('../app/page.tsx',import.meta.url),'utf8');
const css=await readFile(new URL('../app/globals.css',import.meta.url),'utf8');
const cards=page.slice(page.indexOf('  const renderCards ='),page.indexOf('  const renderQuiz ='));
test('immersive word cards keep reading and both action rows without secondary clutter',()=>{
 const markers=['className="word-card"','className="word-card-actions"','className="sentence-pager"','className="learn-actions"'];
 const positions=markers.map(marker=>cards.indexOf(marker));
 assert.ok(positions.every((pos,i)=>pos>=0&&(i===0||pos>positions[i-1])));
 for(const marker of markers)assert.equal(cards.split(marker).length-1,1);
 assert.doesNotMatch(cards,/word-auto-controls|session-progress|card-count|learn-tip/);
 assert.match(cards,/退出学习并保留进度/);
});
test('immersive primary actions respect the safe area and retain scrollable long content',()=>{
 assert.match(css,/\.immersive-learning>\.word-card-actions\{position:sticky;bottom:0;[^}]*env\(safe-area-inset-bottom\)/);
 assert.match(css,/\.phone-stage:has\(\.learn-page\),\.phone-stage:has\(\.quiz-page\)\{overflow-x:clip;overflow-y:visible\}/);
 assert.doesNotMatch(cards,/overflow:\s*hidden|line-clamp|height:\s*100/);
 for(const handler of ['moveCard(-1)','moveCard(1)','finishCard(false)','finishCard(true)','playSpeech(current.example)','openLearningSetup()'])assert.ok(cards.includes(handler));
 assert.match(page,/const autoWordExamples = true/);
 assert.match(page,/!\(tab === "learn" && \(learnStage === "cards" \|\| learnStage === "quiz" \|\| learnStage === "result"\)\)/);
});
test('viewport and direct-hit-target regressions run with the normal browser suite',async()=>{
 const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
 assert.ok(pkg.scripts['test:browser'].includes('scripts/browser-word-layout.mjs'));
});
