import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
const page=await readFile(new URL('../app/page.tsx',import.meta.url),'utf8');
const region=page.slice(page.indexOf('  const startSentenceSession ='),page.indexOf('  const resumeSentenceSession ='));
const js=ts.transpileModule(region+'\nstartSentenceSession;', {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const base={version:1,updatedAt:100,band:'short',category:'daily',count:10,mode:'bilingual',sentenceIds:[1,2,3],index:0,ratings:{}};
function invoke({snapshot=base,preferences={},args=[]}={}){
 const calls=[];const before=JSON.stringify(snapshot);
 const fn=vm.runInNewContext(js,{sentenceStage:'setup',sentenceSessionIds:snapshot?.sentenceIds??[],sentenceBand:'short',sentenceCategory:'daily',sentenceCount:10,sentenceMode:'bilingual',...preferences,
  STORAGE:{sentenceActiveSession:'saved'},readJson:()=>snapshot,cleanSentenceSession:x=>x,newestSnapshot:(stored,memory)=>stored??memory,sentenceResumeSnapshotRef:{current:snapshot},
  resumeSentenceSession(){calls.push('resume');},beginSentenceSession(){calls.push('start');},setDiscardRequest(value){calls.push({confirm:value});}});
 fn(...args);assert.equal(JSON.stringify(snapshot),before,'dispatch must never mutate the saved snapshot');return JSON.parse(JSON.stringify(calls));
}
test('the reported untouched ten-sentence group resumes with no discard dialog',()=>assert.deepEqual(invoke(),['resume']));
test('a searched single sentence cannot masquerade as the normal learning range',()=>assert.deepEqual(invoke({snapshot:{...base,kind:'lookup',sentenceIds:[1]}}),['start']));
test('legacy single-sentence practice and a continuous one-item range keep their existing continuation',()=>{
 for(const snapshot of [{...base,sentenceIds:[1]},{...base,kind:'group',sentenceIds:[1]},{...base,kind:'group',continuous:true,sentenceIds:[1]}])assert.deepEqual(invoke({snapshot}),['resume']);
});
test('partially rated or merely browsed groups retain their position when resuming',()=>{for(const snapshot of [{...base,index:1},{...base,ratings:{1:'known'}}])assert.deepEqual(invoke({snapshot}),['resume']);});
test('removed group-count preference cannot interrupt an unchanged saved range',()=>{for(const snapshot of [base,{...base,index:1}])assert.deepEqual(invoke({snapshot,preferences:{sentenceCount:20}}),['resume']);});
test('changed ranges may replace only an untouched first card silently',()=>{assert.deepEqual(invoke({preferences:{sentenceBand:'long'}}),['start']);assert.equal(invoke({snapshot:{...base,index:1},preferences:{sentenceBand:'long'}})[0].confirm.sentence,true);});
test('every materially different visible choice protects real unfinished progress',()=>{for(const preferences of [{sentenceBand:'long'},{sentenceCategory:'travel'},{sentenceMode:'speak'}])assert.equal(invoke({snapshot:{...base,ratings:{1:'known'}},preferences})[0].confirm.sentence,true);});
test('reinforcement snapshots cannot silently masquerade as the normal range',()=>{assert.deepEqual(invoke({snapshot:{...base,continuous:true,reviewOnly:true}}),['start']);assert.equal(invoke({snapshot:{...base,continuous:true,reviewOnly:true,index:1}})[0].confirm.sentence,true);});
test('explicit new groups are distinguishable from normal continuation',()=>{assert.deepEqual(invoke({args:[false,undefined,true]}),['start']);assert.equal(invoke({snapshot:{...base,index:1},args:[false,undefined,true]})[0].confirm.sentence,true);});
test('review and single-result requests cannot silently replace progressed sessions',()=>{for(const args of [[true],[false,{id:222}]])assert.equal(invoke({snapshot:{...base,index:1},args})[0].confirm.sentence,true);});
test('absent sessions start normally without inventing a resume target',()=>assert.deepEqual(invoke({snapshot:null}),['start']));
test('bilingual translation is real text and speaking-first answers remain conditional',()=>{const cards=page.slice(page.indexOf('  const renderSentenceCards ='),page.indexOf('  const renderSentenceResult ='));assert.match(cards,/className="sentence-translation" lang="zh-CN">\{currentSentence.translation\}/);assert.doesNotMatch(cards,/点击显示中文翻译/);assert.match(cards,/sentenceMode === "bilingual"/);assert.match(page,/selectedMode !== "bilingual"/);});
