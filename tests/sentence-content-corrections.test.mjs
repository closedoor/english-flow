import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const root = new URL("../", import.meta.url);
const sources = Object.fromEntries(await Promise.all(["sentence-data", "sentence-corrections"].map(async (name) => [name, await readFile(new URL(`app/${name}.ts`, root), "utf8")])));
const packs = await Promise.all([1, 2, 3].map(async (pack) => JSON.parse(await readFile(new URL(`public/data/tatoeba-sentences-${pack}.json`, root), "utf8"))));
const originalPacks = JSON.stringify(packs);
const modules = new Map();

// Compile and execute the production loader. Only the network boundary uses
// isolated canonical packs; the loader's production validator still runs.
function loadModule(name) {
  if (modules.has(name)) return modules.get(name).exports;
  if (name === "content-loader") return {
    CONTENT_REVISION: "isolated-sentence-review",
    async fetchJsonWithRecovery(url, validate) {
      const pack = /\/data\/tatoeba-sentences-([123])\.json\?rev=/.exec(url)?.[1];
      assert.ok(pack, `unexpected content request: ${url}`);
      const items = structuredClone(packs[Number(pack) - 1]);
      assert.equal(validate(items), true, `canonical pack ${pack} must pass the production validator`);
      return items;
    },
  };
  assert.ok(Object.hasOwn(sources, name), `unexpected module: ${name}`);
  const module = { exports: {} };
  modules.set(name, module);
  const result = ts.transpileModule(sources[name], {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true,
  });
  assert.deepEqual(result.diagnostics.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error), [], `TypeScript compilation failed for ${name}`);
  vm.runInNewContext(result.outputText, {
    module,
    exports: module.exports,
    require(specifier) { return loadModule(specifier.replace(/^\.\//, "")); },
  }, { filename: `app/${name}.ts` });
  return module.exports;
}

const loader = loadModule("sentence-data");
const loadedPacks = await Promise.all([1, 2, 3].map((pack) => loader.loadSentencePack(pack)));
const sentences = JSON.parse(JSON.stringify(loadedPacks.flat()));
const byId = new Map(sentences.map((item) => [item.id, item]));
const rawItems = packs.flat();
const rawById = new Map(rawItems.map((item) => [item.id, item]));

function expectCategories(groups) {
  for (const [category, ids] of Object.entries(groups)) {
    for (const id of ids) assert.equal(byId.get(id).category, category, `${id}: ${byId.get(id).text}`);
  }
}

test("food scenes exclude reviewed idioms, animal facts, water topics and non-meal order", () => {
  expectCategories({
    daily: [924, 984, 1337, 1583, 1757, 1764, 1765, 1797, 1821, 1910, 2115, 2247, 2295, 2464, 2615, 2707, 2752, 2803, 2807, 2813, 2825, 2827, 2880, 2881, 2882, 2916],
    help: [983],
    work: [2350, 2820, 2935],
    shopping: [2417, 2719],
  });
});

test("travel scenes exclude reviewed relationships, household tasks and job departures", () => {
  expectCategories({
    social: [199, 290, 985, 1272, 1561, 2755],
    shopping: [751],
    work: [875, 1893, 1912, 2879, 2925],
    daily: [976, 1444, 1760, 1914, 1919, 2754, 2756, 2761],
    help: [1221],
  });
});

test("uncertain scene judgments and a meeting point retain their current choices", () => {
  expectCategories({
    food: [656, 670, 1211, 1299, 1441, 1592, 1597, 1662, 1848, 1996, 2182, 2261, 2747, 2797, 2829],
    travel: [314, 669, 907, 958, 1140, 1208, 1213, 1312, 1557, 1759, 1799, 1836, 2269, 2348, 2629, 2764, 2773, 2847, 2848, 2856, 2873, 2874, 2887, 2961],
  });
});

test("literal eating and transport examples still belong to their practical scenes", () => {
  expectCategories({ food: [5, 69, 109, 279, 454], travel: [2924, 2939, 2941, 2962, 2990, 2996, 2997] });
});

test("a swimming example describes adult supervision without a safety guarantee", () => {
  const item = byId.get(2803);
  assert.equal(item.text, "Even though the child knows how to swim, an adult still watches her in the water.");
  assert.equal(item.translation, "虽然这个孩子会游泳，大人仍然在她下水时看护她。");
  assert.doesNotMatch(item.text, /won't drown/);
  assert.equal(item.adapted, true);
});

test("the grass example uses a coherent, natural relationship between plants and water", () => {
  const item = byId.get(2807);
  assert.equal(item.text, "Grass needs water to grow, so we water the lawn when the weather is dry.");
  assert.equal(item.translation, "草需要水才能生长，所以天气干燥时我们会给草坪浇水。");
  assert.equal(item.adapted, true);
});

test("the Earth example avoids falsely making water exclusive to Earth", () => {
  const item = byId.get(2881);
  assert.equal(item.text, "Earth has vast oceans of liquid water, which cover much of its surface.");
  assert.equal(item.translation, "地球拥有广阔的液态水海洋，覆盖了它大部分的表面。");
  assert.doesNotMatch(item.text, /difference between Earth and the other planets/);
  assert.equal(item.adapted, true);
});

test("independent travel clauses have a semicolon and preserve the Chinese context", () => {
  const item = byId.get(2997);
  assert.equal(item.text, "When travelling, I always go to the airport in Nanjing; I've never been to Shanghai.");
  assert.equal(item.translation, rawById.get(2997).translation);
  assert.equal(item.adapted, true);
});

test("category-only changes preserve existing text edits and adaptation markers", () => {
  assert.equal(byId.get(1910).translation, "英国人很重视法律和秩序。");
  assert.equal(byId.get(1910).adapted, true);
  assert.equal(byId.get(2925).translation, "汤姆的妈妈是一名护士，她工作的医院就在玛丽住处的街对面。");
  assert.equal(byId.get(2925).adapted, true);
  assert.equal(byId.get(924).text, rawById.get(924).text);
  assert.equal(byId.get(924).translation, rawById.get(924).translation);
  assert.ok(!byId.get(924).adapted, "a scene correction does not claim a sentence was rewritten");
});

test("all packs and learning/source identities remain unchanged after display corrections", () => {
  assert.deepEqual(loadedPacks.map((pack) => pack.length), [1000, 1000, 1000]);
  assert.equal(sentences.length, 3000);
  assert.equal(JSON.stringify(packs), originalPacks, "loading must not mutate canonical source data");
  const identity = ({ id, length, sourceId, translationId, author, translationAuthor }) => ({ id, length, sourceId, translationId, author, translationAuthor });
  assert.deepEqual(sentences.map(identity), rawItems.map(identity));
  for (const id of [2803, 2807, 2881, 2997]) {
    const item = byId.get(id);
    const wordCount = item.text.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g)?.length ?? 0;
    assert.equal(item.length, "long");
    assert.ok(wordCount >= 13 && wordCount <= 18, `${id} should keep the long sentence band`);
  }
});
