import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const root = new URL("../", import.meta.url);
const sources = Object.fromEntries(await Promise.all(["data", "word-corrections", "word-data", "sentence-data", "sentence-corrections"].map(async (name) => [name, await readFile(new URL(`app/${name}.ts`, root), "utf8")])));
const packs = Object.fromEntries(await Promise.all(["ngsl-words", "tatoeba-sentences"].map(async (kind) => [kind, await Promise.all([1, 2, 3].map(async (pack) => JSON.parse(await readFile(new URL(`public/data/${kind}-${pack}.json`, root), "utf8"))))])));
const originalPacks = JSON.stringify(packs);
const modules = new Map();

// Exercise the display fields learners receive from the actual production
// loaders. The only substitute is the isolated, validated network response.
function loadModule(name) {
  if (name === "content-loader") return {
    CONTENT_REVISION: "isolated-context-regressions",
    async fetchJsonWithRecovery(url, validate) {
      const match = /\/data\/(ngsl-words|tatoeba-sentences)-([123])\.json\?rev=/.exec(url);
      assert.ok(match, `unexpected content request: ${url}`);
      const items = structuredClone(packs[match[1]][Number(match[2]) - 1]);
      assert.equal(validate(items), true, `the production validator must accept ${url}`);
      return items;
    },
  };
  if (modules.has(name)) return modules.get(name).exports;
  assert.ok(Object.hasOwn(sources, name), `unexpected module: ${name}`);
  const compiledModule = { exports: {} };
  modules.set(name, compiledModule);
  const javascript = ts.transpileModule(sources[name], {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(javascript, {
    module: compiledModule,
    exports: compiledModule.exports,
    require(specifier) { return loadModule(specifier.replace(/^\.\//, "")); },
  }, { filename: `app/${name}.ts` });
  return compiledModule.exports;
}

const wordData = await loadModule("word-data").loadWordData();
const words = JSON.parse(JSON.stringify(wordData.words));
const sentences = JSON.parse(JSON.stringify((await Promise.all([1, 2, 3].map((pack) => loadModule("sentence-data").loadSentencePack(pack)))).flat()));
const byWord = new Map(words.map((item) => [item.word, item]));
const bySentenceId = new Map(sentences.map((item) => [item.id, item]));

test("consider has the word's final schwa rather than a spurious nasal", () => {
  assert.equal(byWord.get("consider").phonetic, "/kənˈsɪd.ə/");
  assert.equal(byWord.get("consider").example, "Let's consider it again when the time comes.");
});

test("increase's noun example has first-syllable stress", () => {
  assert.equal(byWord.get("increase").phonetic, "/ˈɪn.kriːs/");
  assert.equal(byWord.get("increase").example, "The number of cars is on the increase.");
});

test("offer of support is translated as giving support rather than requesting it", () => {
  const item = byWord.get("offer");
  assert.equal(item.example, "Of course I accepted his offer of support.");
  assert.equal(item.translation, "我当然接受了他主动提供的支持。");
  assert.doesNotMatch(item.translation, /请求/);
});

for (const word of ["end", "month", "until"]) {
  test(`${word}'s shared waiting example keeps the month-end endpoint in Chinese`, () => {
    const item = byWord.get(word);
    assert.equal(item.example, "Please wait until the end of this month.");
    assert.equal(item.translation, "请等到这个月底。");
    if (word === "until") {
      assert.equal(item.meaning, "直到；到……为止");
      assert.doesNotMatch(item.meaning, /在.*以前/);
    }
  });
}

test("information on concerts asks for information in both languages", () => {
  const item = byWord.get("information");
  assert.equal(item.example, "Do you have any information on classical music concerts?");
  assert.equal(item.translation, "你有关于古典音乐会的信息吗？");
  assert.doesNotMatch(item.translation, /有什么可说/);
});

const correctedScenes = new Map([
  [53, "food"], [72, "food"], [157, "food"], [166, "food"],
  [1771, "daily"], [1858, "daily"], [2689, "social"],
  [2812, "daily"],
]);
for (const [id, category] of correctedScenes) {
  test(`sentence ${id} is available in its whole-sentence scene ${category}`, () => {
    const item = bySentenceId.get(id);
    assert.equal(item.category, category);
    assert.ok(sentences.filter((candidate) => candidate.category === category).some((candidate) => candidate.id === id));
    const raw = packs["tatoeba-sentences"].flat().find((candidate) => candidate.id === id);
    assert.equal(item.text, raw.text, "scene corrections do not rewrite English");
    assert.equal(item.translation, raw.translation, "scene corrections do not rewrite Chinese");
    assert.equal(item.adapted, raw.adapted, "a scene choice alone preserves the source adaptation field");
    assert.equal(Object.hasOwn(item, "adapted"), Object.hasOwn(raw, "adapted"), "an absent optional adaptation field stays absent");
  });
}

test("context corrections preserve canonical data, learning identities and answer targets", () => {
  assert.equal(JSON.stringify(packs), originalPacks);
  assert.equal(words.length, 2809);
  assert.equal(sentences.length, 3000);
  assert.deepEqual(words.map(({ id, rank }) => ({ id, rank })), packs["ngsl-words"].flat().map(({ id, rank }) => ({ id, rank })));
  const identity = ({ id, length, sourceId, translationId, author, translationAuthor }) => ({ id, length, sourceId, translationId, author, translationAuthor });
  assert.deepEqual(sentences.map(identity), packs["tatoeba-sentences"].flat().map(identity));
  const ids = { end: 152, month: 209, information: 213, increase: 230, offer: 237, until: 255, consider: 295 };
  for (const [word, id] of Object.entries(ids)) {
    const item = byWord.get(word);
    const raw = packs["ngsl-words"].flat().find((candidate) => candidate.id === id);
    assert.equal(item.id, id);
    assert.equal(item.rank, id);
    assert.equal(item.scene, raw.scene);
    assert.equal(item.exampleForm, raw.exampleForm);
    assert.deepEqual(item.collocations, raw.collocations);
    const escaped = item.exampleForm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.equal((item.example.match(new RegExp(`\\b${escaped}\\b`, "gi")) ?? []).length, 1, `${word} keeps exactly one listening answer`);
  }
});
