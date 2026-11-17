import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { loadSentenceFixturePacks } from '../scripts/sentence-fixture-data.mjs';

const source = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let normalizedSource, filterSource;
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'normalized') normalizedSource = node.getText(ast);
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'filteredSentences') filterSource = node.initializer.arguments[0].getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(normalizedSource && filterSource);
const compiled = ts.transpileModule(`${normalizedSource}\nexport function run(state) { const {sentenceBand,sentenceCategory,sentenceSearch,sentenceSavedOnly,sentenceReviewOnly,sentencePacks,sentenceSaved,sentenceDifficult}=state;const SENTENCE_PACK_BY_BAND={short:1,medium:2,long:3};return (${filterSource})(); }`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { run } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const packs = await loadSentenceFixturePacks();
const all = [1, 2, 3].flatMap(n => packs[n]);
const base = { sentenceBand: 'short', sentenceCategory: 'all', sentenceSearch: '', sentenceSavedOnly: false, sentenceReviewOnly: false, sentencePacks: packs, sentenceSaved: [], sentenceDifficult: [] };

test('full saved and reinforcement histories retain all 3000 IDs and original source order', () => {
  const ids = all.map(x => x.id);
  for (const flags of [{ sentenceSavedOnly: true }, { sentenceReviewOnly: true }, { sentenceSavedOnly: true, sentenceReviewOnly: true }]) {
    const state = { ...base, ...flags, sentenceSaved: [...ids].reverse(), sentenceDifficult: ids };
    const before = structuredClone(state);
    assert.deepEqual(run(state).map(x => x.id), ids);
    assert.deepEqual(state, before, 'Filtering must not mutate persisted history, pack order or practice settings');
  }
});

test('large sparse histories use their intersection without duplicate rows or IDs from an unloaded pack', () => {
  const saved = all.filter(x => x.id % 2 === 0).map(x => x.id);
  const difficult = all.filter(x => x.id % 3 === 0).map(x => x.id);
  const state = { ...base, sentenceSavedOnly: true, sentenceReviewOnly: true, sentenceSaved: [...saved, ...saved], sentenceDifficult: difficult, sentencePacks: { 1: packs[1], 3: packs[3] } };
  assert.deepEqual(run(state).map(x => x.id), [...packs[1], ...packs[3]].filter(x => x.id % 6 === 0).map(x => x.id));
  assert.deepEqual(run({ ...state, sentenceSaved: [] }), []);
});

test('English and Chinese searches stay global while ordinary browsing respects band and scene', () => {
  const ids = all.map(x => x.id);
  const normalize = value => value.normalize('NFKC').toLowerCase().trim().replace(/[.,!?;:'’]/g, '').replace(/\s+/g, ' ');
  for (const sentenceSearch of ['YOU', '  you  ', '我', 'ＡＮＤ']) {
    const term = normalize(sentenceSearch);
    const expected = all.filter(x => normalize(`${x.text} ${x.translation}`).includes(term)).map(x => x.id);
    for (const flags of [{}, { sentenceSavedOnly: true }, { sentenceReviewOnly: true }]) {
      assert.deepEqual(run({ ...base, ...flags, sentenceBand: 'long', sentenceCategory: 'food', sentenceSearch, sentenceSaved: ids, sentenceDifficult: ids }).map(x => x.id), expected);
    }
  }
  assert.deepEqual(run({ ...base, sentenceBand: 'medium', sentenceCategory: 'travel', sentenceSearch: '   ' }).map(x => x.id), packs[2].filter(x => x.category === 'travel').map(x => x.id));
});
