import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { loadSentenceFixturePacks } from './sentence-fixture-data.mjs';

// Diagnostic only: no timing threshold in CI. Supply an explicit baseline,
// e.g. git show COMMIT:app/page.tsx > /tmp/english-flow-before.tsx.
if (!process.env.BASELINE_PAGE) throw Error('Set BASELINE_PAGE to the baseline app/page.tsx file.');
const before = await readFile(process.env.BASELINE_PAGE, 'utf8');
const after = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
async function compile(source) {
  const ast = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let normalize, filter, setup;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'normalized') normalize = node.getText(ast);
    if (ts.isVariableDeclaration(node) && node.initializer) {
      if (node.name.getText(ast) === 'filteredSentences') filter = node.initializer.arguments[0].getText(ast);
      if (node.name.getText(ast) === 'renderSentenceSetup') setup = node.initializer.body.statements;
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(normalize && filter && setup);
  const preamble = [...setup].slice(0, [...setup].findIndex(node => ts.isReturnStatement(node))).map(node => node.getText(ast)).join('\n');
  const js = ts.transpileModule(`${normalize}\nexport function run(state) {const {sentenceBand,sentenceCategory,sentenceSearch,sentenceSavedOnly,sentenceReviewOnly,sentencePacks,sentenceSaved,sentenceDifficult}=state;const SENTENCE_PACK_BY_BAND={short:1,medium:2,long:3};const result=(${filter})();${preamble}\nreturn {ids:result.map(x=>x.id),availableCount,difficultInSelection};}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  return (await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)).run;
}
const baseline = await compile(before), candidate = await compile(after);
const packs = await loadSentenceFixturePacks();
const all = [1, 2, 3].flatMap(n => packs[n]);
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const rows = [];
for (const count of [100, 1000, 3000]) {
  for (const mode of ['saved', 'reinforcement']) {
    const ids = all.slice(0, count).map(x => x.id);
    const state = { sentenceBand: 'short', sentenceCategory: 'all', sentenceSearch: 'you', sentenceSavedOnly: mode === 'saved', sentenceReviewOnly: mode === 'reinforcement', sentencePacks: packs, sentenceSaved: ids, sentenceDifficult: ids };
    assert.deepEqual(candidate(state), baseline(state));
    for (let i = 0; i < 15; i++) { baseline(state); candidate(state); }
    const times = { baseline: [], candidate: [] }, rounds = 80;
    for (let batch = 0; batch < 7; batch++) {
      // Alternate order to avoid consistently favoring one version's warm cache.
      for (const name of batch % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate']) {
        const fn = name === 'baseline' ? baseline : candidate;
        const start = performance.now();
        for (let i = 0; i < rounds; i++) fn(state);
        times[name].push((performance.now() - start) / rounds);
      }
    }
    const baselineMs = median(times.baseline), candidateMs = median(times.candidate);
    rows.push({ mode, historyItems: count, sentenceItems: all.length, resultCount: candidate(state).ids.length, baselineMs, candidateMs, reductionPercent: (baselineMs - candidateMs) / baselineMs * 100, samples: 7, roundsPerSample: rounds });
  }
}
console.log(JSON.stringify({ node: process.version, baselinePageSha256: createHash('sha256').update(before).digest('hex'), candidatePageSha256: createHash('sha256').update(after).digest('hex'), scope: 'Actual filtering and setup counts only; includes Set construction. Not end-to-end browser, network or physical-iPhone timing.', rows }, null, 2));
