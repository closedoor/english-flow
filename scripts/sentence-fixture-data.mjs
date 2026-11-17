import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

// Use the real display loader and its corrections/validator. Only the network
// response is substituted with the unchanged canonical packs. This is test
// input, not evidence about network recovery or physical browser storage.
export async function loadSentenceFixturePacks() {
  const sources = Object.fromEntries(await Promise.all(['sentence-data', 'sentence-corrections'].map(async name => [name, await readFile(new URL(`../app/${name}.ts`, import.meta.url), 'utf8')])));
  const packs = await Promise.all([1, 2, 3].map(async n => JSON.parse(await readFile(new URL(`../public/data/tatoeba-sentences-${n}.json`, import.meta.url), 'utf8'))));
  const modules = new Map();
  function load(name) {
    if (name === 'content-loader') return {
      CONTENT_REVISION: 'sentence-fixture',
      async fetchJsonWithRecovery(url, validate) {
        const match = /^\/data\/tatoeba-sentences-([123])\.json\?rev=/.exec(url);
        assert.ok(match, url);
        const value = structuredClone(packs[Number(match[1]) - 1]);
        assert.equal(validate(value), true);
        return value;
      },
    };
    if (modules.has(name)) return modules.get(name).exports;
    assert.ok(Object.hasOwn(sources, name));
    const compiledModule = { exports: {} };
    modules.set(name, compiledModule);
    vm.runInNewContext(ts.transpileModule(sources[name], { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, {
      module: compiledModule, exports: compiledModule.exports, require(specifier) { return load(specifier.replace(/^\.\//, '')); },
    });
    return compiledModule.exports;
  }
  const loader = load('sentence-data');
  return Object.fromEntries(await Promise.all([1, 2, 3].map(async n => [n, JSON.parse(JSON.stringify(await loader.loadSentencePack(n)))])));
}
