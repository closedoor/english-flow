import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
const page=await readFile(new URL('../app/page.tsx',import.meta.url),'utf8');
const css=await readFile(new URL('../app/globals.css',import.meta.url),'utf8');
const cards=page.slice(page.indexOf('  const renderCards ='),page.indexOf('  const renderQuiz ='));
test('word-card reading and both action rows precede secondary autoplay settings',()=>{
 const markers=['className="word-card"','className="word-card-actions"','className="sentence-pager"','className="learn-actions"','className="word-auto-controls"'];
 const positions=markers.map(marker=>cards.indexOf(marker));
 assert.ok(positions.every((pos,i)=>pos>=0&&(i===0||pos>positions[i-1])));
 for(const marker of markers)assert.equal(cards.split(marker).length-1,1);
});
test('primary mobile actions respect the bottom navigation and retain scrollable long content',()=>{
 assert.match(css,/\.learn-page>\.word-card-actions\{position:sticky;bottom:calc\(74px \+ env\(safe-area-inset-bottom\)\)/);
 assert.match(css,/\.phone-stage:has\(\.learn-page\)\{overflow-x:clip;overflow-y:visible\}/);
 assert.doesNotMatch(cards,/overflow:\s*hidden|line-clamp|height:\s*100/);
 for(const handler of ['moveCard(-1)','moveCard(1)','finishCard(false)','finishCard(true)','toggleWordExamples','replayWordExample'])assert.ok(cards.includes(handler));
});
test('viewport and direct-hit-target regressions run with the normal browser suite',async()=>{
 const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
 assert.ok(pkg.scripts['test:browser'].includes('scripts/browser-word-layout.mjs'));
});
