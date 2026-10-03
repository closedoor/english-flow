import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const root = new URL("../", import.meta.url);
const sources = Object.fromEntries(await Promise.all(["data", "word-corrections", "word-data"].map(async (name) => [name, await readFile(new URL(`app/${name}.ts`, root), "utf8")])));
const packs = await Promise.all([1, 2, 3].map(async (pack) => JSON.parse(await readFile(new URL(`public/data/ngsl-words-${pack}.json`, root), "utf8"))));
const originalPacks = JSON.stringify(packs);
const modules = new Map();

// Execute the real loader and its real display corrections. Only the network
// boundary is replaced with isolated, validated copies of the canonical packs.
function loadModule(name) {
  if (modules.has(name)) return modules.get(name).exports;
  if (name === "content-loader") return {
    CONTENT_REVISION: "isolated-content-review",
    async fetchJsonWithRecovery(url, validate) {
      const pack = /\/data\/ngsl-words-([123])\.json\?rev=/.exec(url)?.[1];
      assert.ok(pack, `unexpected content request: ${url}`);
      const items = structuredClone(packs[Number(pack) - 1]);
      assert.equal(validate(items), true, `canonical pack ${pack} must pass the production validator`);
      return items;
    },
  };
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

const loaded = await loadModule("word-data").loadWordData();
const words = JSON.parse(JSON.stringify(loaded.words));
const byWord = new Map(words.map((word) => [word.word, word]));
const rawWords = packs.flat();
const originalByWord = new Map(rawWords.map((word) => [word.word, word]));

test("use keeps its camera example and displays the verb pronunciation", () => {
  const item = byWord.get("use");
  assert.equal(item.phonetic, "/juːz/");
  assert.match(item.example, /how to use this camera/);
  assert.equal(item.translation, "你会用这台相机吗？");
  assert.match(item.meaning, /使用/);
});

test("record's information noun matches the first-syllable stress", () => {
  const item = byWord.get("record");
  assert.equal(item.phonetic, "/ˈrek.ɔːd/");
  assert.match(item.example, /keeps a record of/);
  assert.match(item.translation, /记录/);
  assert.match(item.meaning, /记录/);
});

test("object's opposition verb has second-syllable stress", () => {
  const item = byWord.get("object");
  assert.equal(item.phonetic, "/əbˈdʒekt/");
  assert.match(item.example, /^I object to /);
  assert.match(item.translation, /不同意/);
  assert.match(item.meaning, /反对/);
});

test("measurement has no extra consonant in its pronunciation", () => {
  const item = byWord.get("measurement");
  assert.equal(item.phonetic, "/ˈmeʒ.ə.mənt/");
  assert.equal(item.example, "The measurement must be accurate.");
  assert.equal(item.translation, "测量结果必须准确。");
});

test("airline uses standard IPA and preserves the proper name in its context", () => {
  const item = byWord.get("airline");
  assert.equal(item.phonetic, "/ˈeə.laɪn/");
  assert.doesNotMatch(item.phonetic, /[єә]/);
  assert.equal(item.example, "Where is the United Airlines check-in counter?");
  assert.equal(item.translation, "联合航空公司办理登机手续的柜台在哪里？");
  assert.equal(item.exampleForm, "airlines");
  assert.ok(item.collocations.includes("United Airlines"));
});

test("cream teaches dairy cream rather than confusing it with cheese", () => {
  const item = byWord.get("cream");
  assert.match(item.meaning, /奶油/);
  assert.match(item.meaning, /乳脂/);
  assert.doesNotMatch(item.meaning, /乳酪|奶酪/);
  assert.equal(item.phonetic, "/kriːm/");
  assert.equal(item.example, "Would you like some cream in your coffee?");
  assert.equal(item.translation, "你的咖啡要加些奶油吗？");
});

test("online teaches a real meaning and the adverb used by its example", () => {
  const item = byWord.get("online");
  assert.match(item.meaning, /在线|在网上|上网/);
  assert.equal(item.phonetic, "/ˌɒnˈlaɪn/");
  assert.match(item.example, /goes online/);
  assert.equal(item.translation, "她每天上几个小时网。");
  for (const word of words) assert.notEqual(word.meaning, "常用英语词汇", `${word.word} still shows a placeholder instead of its meaning`);
});

test("significantly includes the improvement sense shown in both languages", () => {
  const item = byWord.get("significantly");
  assert.match(item.meaning, /显著地/);
  assert.match(item.meaning, /意味深长地/);
  assert.equal(item.phonetic, "/sɪɡˈnɪf.ɪ.kənt.li/");
  assert.match(item.example, /improved significantly/);
  assert.match(item.translation, /显著进步/);
});

test("English stays capitalized in the learner's we card and its phrases", () => {
  const item = byWord.get("we");
  assert.equal(item.example, "We study English every morning.");
  assert.equal(item.translation, "我们每天早上学习英语。");
  assert.ok(item.collocations.includes("we study English"));
  for (const word of words) assert.doesNotMatch(word.collocations.join(" "), /\benglish\b/, `${word.word} shows English as a common noun`);
});

test("desert uses a natural example without the incorrect global area claim", () => {
  const item = byWord.get("desert");
  assert.equal(item.example, "We drove through the desert before sunset.");
  assert.equal(item.translation, "我们在日落前开车穿过了沙漠。");
  assert.doesNotMatch(item.example, /one third|earth's surface/i);
  assert.equal(item.meaning, originalByWord.get("desert").meaning);
});

test("content corrections preserve ranked IDs, source packs, and unique answer targets", () => {
  assert.equal(words.length, 2809);
  assert.equal(JSON.stringify(packs), originalPacks, "loading must not mutate canonical source data");
  assert.deepEqual(words.map(({ id, rank }) => ({ id, rank })), rawWords.map(({ id, rank }) => ({ id, rank })));
  const expectedIds = { we: 16, use: 68, record: 344, object: 942, significantly: 1669, online: 1794, desert: 2287, cream: 2388, measurement: 2431, airline: 2602 };
  for (const [word, id] of Object.entries(expectedIds)) {
    const item = byWord.get(word);
    assert.equal(item.id, id);
    assert.equal(item.rank, id);
    assert.equal(item.scene, originalByWord.get(word).scene);
    const escaped = item.exampleForm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.equal((item.example.match(new RegExp(`\\b${escaped}\\b`, "gi")) ?? []).length, 1, `${word} needs exactly one listening answer`);
    assert.ok(item.translation.trim());
    if (!["cream", "desert"].includes(word)) {
      assert.equal(item.example, originalByWord.get(word).example, `${word} keeps its existing English context`);
      assert.equal(item.translation, originalByWord.get(word).translation, `${word} keeps its existing Chinese context`);
    }
  }
});
