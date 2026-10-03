import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = await readFile(new URL("../app/sentence-data.ts", import.meta.url), "utf8");
const corrections = await readFile(new URL("../app/sentence-corrections.ts", import.meta.url), "utf8");
const packs = await Promise.all([1, 2, 3].map(async (pack) => JSON.parse(await readFile(new URL(`../public/data/tatoeba-sentences-${pack}.json`, import.meta.url), "utf8"))));
const sources = { "sentence-data": source, "sentence-corrections": corrections };
const modules = new Map();
// Execute the real loader and its imported display corrections. Only the
// network boundary is supplied with isolated canonical content.
function loadModule(name) {
  if (modules.has(name)) return modules.get(name).exports;
  if (name === "content-loader") return {
    CONTENT_REVISION: "test",
    fetchJsonWithRecovery: async (url, validate) => {
      const pack = packs[Number(url.match(/sentences-(\d)/)[1]) - 1];
      assert.equal(validate(pack), true);
      return structuredClone(pack);
    },
  };
  assert.ok(Object.hasOwn(sources, name), `unexpected imported module: ${name}`);
  const module = { exports: {} };
  modules.set(name, module);
  const compiled = ts.transpileModule(sources[name], {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    reportDiagnostics: true,
  });
  assert.deepEqual(compiled.diagnostics.filter((item) => item.category === ts.DiagnosticCategory.Error), []);
  vm.runInNewContext(compiled.outputText, {
    module, exports: module.exports,
    require: (specifier) => loadModule(specifier.replace(/^\.\//, "")),
  }, { filename: `app/${name}.ts` });
  return module.exports;
}
const load = loadModule("sentence-data").loadSentencePack;
const displayed = (await Promise.all([1, 2, 3].map(load))).flat();
const byId = new Map(displayed.map((item) => [item.id, item]));

test("displayed sentence packs retain all 3000 identities, unique English and original attribution", () => {
  assert.equal(displayed.length, 3000);
  assert.equal(byId.size, 3000);
  assert.equal(new Set(displayed.map((item) => item.text.toLowerCase())).size, 3000);
  for (const original of packs.flat()) {
    const item = byId.get(original.id);
    for (const field of ["id", "sourceId", "translationId", "author", "translationAuthor", "length"]) assert.equal(item[field], original[field]);
    if (item.text !== original.text || item.translation !== original.translation) assert.equal(item.adapted, true);
    const count = item.text.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g)?.length ?? 0;
    const [min, max] = item.length === "short" ? [2, 7] : item.length === "medium" ? [8, 12] : [13, 18];
    assert.ok(count >= min && count <= max, `sentence ${item.id} respects its learning band`);
  }
});

test("corrected learner Chinese preserves payment, duration, comparison, frequency and idiomatic meaning", () => {
  for (const [id, meaning] of [
    [479, /付多少/], [513, /聊一会儿/], [743, /那所学校/], [1302, /和他一样快/],
    [1688, /再做熟一点/], [1895, /随时打电话/], [1989, /成功赶上/],
    [2239, /每周.*几次/], [2370, /个子最矮/], [2553, /接受.*录用/],
    [2795, /退出比赛/], [2859, /小节.*欢呼/],
  ]) assert.match(byId.get(id).translation, meaning);
  assert.doesNotMatch(byId.get(1498).translation, /我保证/);
});
