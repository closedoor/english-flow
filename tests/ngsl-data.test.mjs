import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../app/ngsl-data.ts", import.meta.url), "utf8");
const generator = await readFile(new URL("../scripts/generate-ngsl.py", import.meta.url), "utf8");
const corrections = await readFile(new URL("../app/word-corrections.ts", import.meta.url), "utf8");
const wordData = await readFile(new URL("../app/word-data.ts", import.meta.url), "utf8");
const curatedSource = await readFile(new URL("../app/data.ts", import.meta.url), "utf8");
const curatedJavaScript = ts.transpileModule(curatedSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { curatedWords } = await import(`data:text/javascript;base64,${Buffer.from(curatedJavaScript).toString("base64")}`);
const correctionsJavaScript = ts.transpileModule(corrections, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { normalizeWordDisplay, wordCardCorrections } = await import(`data:text/javascript;base64,${Buffer.from(correctionsJavaScript).toString("base64")}`);
const packedRecords = (await Promise.all([1, 2, 3].map(async (pack) => JSON.parse(await readFile(new URL(`../public/data/ngsl-words-${pack}.json`, import.meta.url), "utf8"))))).flat();
const curatedByWord = new Map(curatedWords.map((item) => [item.word, item]));
const effectiveRecords = packedRecords.map((item) => {
  const curated = curatedByWord.get(item.word);
  const correction = wordCardCorrections[item.word];
  return normalizeWordDisplay({ ...item, ...correction, ...curated, id: item.id, rank: item.rank, exampleForm: curated?.exampleForm ?? correction?.exampleForm ?? item.exampleForm ?? curated?.word ?? item.word });
});
const officialWords = new Set(effectiveRecords.map((item) => item.word));
const effectiveStudyWords = [...effectiveRecords, ...curatedWords.filter((item) => !officialWords.has(item.word)).map((item) => ({ ...item, id: 10_000 + item.id, rank: undefined, exampleForm: item.exampleForm ?? item.word }))];
const records = source
  .split("\n")
  .filter((line) => line.startsWith("  {") && line.endsWith(","))
  .map((line) => JSON.parse(line.trim().slice(0, -1)));

test("contains the complete ranked NGSL 1.2 list", () => {
  assert.equal(records.length, 2809);
  assert.equal(new Set(records.map((item) => item.word)).size, 2809);
  assert.deepEqual(records.map((item) => item.rank), Array.from({ length: 2809 }, (_, index) => index + 1));
  assert.equal(records[0].word, "the");
  assert.equal(records.at(-1).word, "thirst");
});

test("word examples distinguish quantity, doubling, preventive in-case and taking a message", () => {
  const byWord = new Map(effectiveRecords.map((word) => [word.word, word]));
  for (const word of ["little", "cook", "meat"]) assert.match(byWord.get(word).translation, /再做熟一点/);
  assert.equal(byWord.get("double").example, "Ten is double five.");
  assert.match(byWord.get("double").translation, /五的两倍/);
  assert.match(byWord.get("case").example, /in case it rains/);
  assert.match(byWord.get("case").translation, /以防/);
  assert.match(byWord.get("message").translation, /记下口信/);
  assert.match(byWord.get("meal").translation, /总是/);
  assert.doesNotMatch(byWord.get("sugar").translation, /罐头/);
  for (const word of ["down", "something", "put", "another", "each", "brand"]) {
    assert.ok(byWord.get(word).example.toLowerCase().includes(word));
    assert.doesNotMatch(byWord.get(word).example, /turn down|something of a poet|put off|each other|brand new/);
  }
});

test("browser NGSL packs exactly match the canonical generated list", () => {
  assert.equal(packedRecords.length, 2809);
  assert.deepEqual(packedRecords, records);
});

test("the personal pronoun I is spelled correctly throughout learner word cards without changing word IDs", () => {
  const original = packedRecords.find((item) => item.word === "i");
  const shown = effectiveRecords.find((item) => item.id === original.id);
  assert.equal(shown.word, "I");
  assert.equal(shown.rank, original.rank);
  assert.equal(original.word, "i", "the canonical frequency list is unchanged");
  assert.equal(effectiveRecords.filter((item) => item.word.toLowerCase() === "i").length, 1);
  for (const word of effectiveRecords) assert.doesNotMatch(word.collocations.join(" "), /\bi\b/, `lowercase pronoun in ${word.word}`);
});

test("every card has usable learning content", () => {
  for (const item of records) {
    assert.ok(item.word.trim(), `missing word at rank ${item.rank}`);
    assert.ok(item.meaning.trim(), `missing meaning for ${item.word}`);
    assert.ok(item.example.trim(), `missing example for ${item.word}`);
    assert.ok(item.translation.trim(), `missing translation for ${item.word}`);
    assert.ok(item.collocations.length >= 1, `missing context chunk for ${item.word}`);
    assert.ok(item.collocations.length <= 2, `too many context chunks for ${item.word}`);
    assert.ok(item.collocations.every((chunk) => !chunk.endsWith(" in context")), `mechanical context chunk for ${item.word}`);
    assert.doesNotMatch(item.meaning, /\\[rn]/, `escaped newline in ${item.word}`);
    assert.match(item.example.toLowerCase(), new RegExp(`\\b${item.exampleForm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"), `example form missing for ${item.word}`);
  }
  assert.match(source, /fallbackExamples: 0/);
});

test("no card falls back to a mechanical placeholder sentence", () => {
  const placeholder = /^(?:They .+ it in everyday life\.|It seems .+ in this situation\.|We can use it .+ in a sentence\.|The .+ is important in this example\.|This example uses the word .+\.)$/;
  for (const item of records) assert.doesNotMatch(item.example, placeholder, `placeholder example for ${item.word}`);
  assert.equal(records[0].example, "The bus arrives at eight.");
  assert.equal(records.at(-1).example, "A cold drink satisfied my thirst after the walk.");
});

test("nearby cards do not recycle the same sentence", () => {
  for (let start = 0; start < records.length; start += 45) {
    const batch = records.slice(start, start + 45).map((item) => item.example);
    assert.equal(new Set(batch).size, batch.length, `duplicate example near rank ${start + 1}`);
  }
});

test("Chinese meanings and examples stay in simplified Chinese", () => {
  const commonTraditionalCharacters = /[這個們為說學習還難與於裡來時後會話書車門開關長見過應該種樣實現讓給從將請認識財國幫買賣讀聽頭風飯體問題]/;
  for (const item of records) {
    assert.doesNotMatch(`${item.meaning}${item.translation}`, commonTraditionalCharacters, `traditional Chinese found in ${item.word}`);
  }
  assert.match(generator, /OpenCC\("t2s"\)/);
  assert.match(generator, /T2S\.convert\(zh\[item\]\)/);
});

test("beginner examples avoid unsafe or needlessly distressing corpus sentences", () => {
  const content = records.map((item) => `${item.example} ${item.translation}`).join("\n");
  assert.doesNotMatch(content, /\b(fuck|shit|bitch|porn|rape|suicide|naked)\b/i);
  assert.doesNotMatch(content, /public park|own head|kill myself|kill yourself|only release|can kill a lot of people|don't give a damn|fired a shot at random|shot the horse/i);
  assert.doesNotMatch(content, /不屌|找个毛|操你|他妈|婊子|强奸|色情/);

  const examples = new Map(records.map((item) => [item.word, item.example]));
  assert.equal(examples.get("a"), "She bought a new bag.");
  assert.equal(examples.get("shot"), "I took a great shot with my camera.");
  assert.equal(examples.get("trigger"), "A loud noise can trigger the alarm.");
  assert.equal(examples.get("random"), "We chose a winner at random.");
  assert.match(generator, /EXAMPLE_OVERRIDES/);
});

test("high-frequency cards use short learner-friendly display corrections", () => {
  for (const word of ["do", "as", "at", "she", "but", "from", "by", "will", "or", "say", "go", "so", "all", "if"]) {
    assert.match(corrections, new RegExp(`\\n  ${word}: \\{`), `missing display correction for ${word}`);
  }
  assert.match(corrections, /Would you like tea or coffee\?/);
  assert.match(corrections, /We will go regardless of the weather\./);
  assert.match(corrections, /She wore a pink shirt\./);
  assert.doesNotMatch(corrections, /regardless what|pink panties|穿著|转帳/);
  assert.match(wordData, /\.\.\.item, \.\.\.correction, \.\.\.curated/);
  assert.match(wordData, /Promise\.all\(\(\[1, 2, 3\]/);
});

test("confirmed unsafe or incorrect NGSL cards have persistent display corrections", () => {
  for (const word of ["dollar", "host", "wire", "equivalent", "owe"]) {
    assert.match(corrections, new RegExp(`\\n  ${word}: \\{`), `missing display correction for ${word}`);
  }
  assert.match(corrections, /equivalent to about 0\.62 miles/);
  assert.doesNotMatch(corrections, /派对主席|I owe it you|touching it|形容词相等语|两元店/);
  assert.match(generator, /UNSAFE_LEARNER_CONTEXT_RE/);
  assert.match(generator, /UNSAFE_LEARNER_CONTEXT_ZH_RE/);
});

test("core high-frequency meanings match the examples learners see", () => {
  for (const word of ["mean", "still", "meet"]) {
    assert.match(corrections, new RegExp(`\\n  ${word}: \\{`), `missing meaning correction for ${word}`);
  }
  assert.match(corrections, /mean: \{ meaning: "意思是；意味着；表示"/);
  assert.match(corrections, /still: \{ meaning: "仍然；还是；依旧"/);
  assert.match(corrections, /meet: \{ meaning: "遇见；会面；认识"/);
});

test("every curated scene card can hide its exact answer inside the example", () => {
  for (const item of curatedWords) {
    const form = item.exampleForm ?? item.word;
    const escaped = form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(item.example, new RegExp(`\\b${escaped}\\b`, "i"), `example form missing for curated ${item.word}`);
  }
  assert.match(wordData, /exampleForm: item\.exampleForm \?\? item\.word/);
  assert.match(wordData, /curated\?\.exampleForm \?\? correction\?\.exampleForm/);
});

test("every effective listening card has exactly one unambiguous answer target", () => {
  for (const item of effectiveStudyWords) {
    const form = item.exampleForm ?? item.word;
    const escaped = form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const matches = item.example.match(new RegExp(`\\b${escaped}\\b`, "gi")) ?? [];
    assert.equal(matches.length, 1, `${item.word} exposes ${matches.length} answer targets in: ${item.example}`);
  }
  assert.match(corrections, /The nurse cleaned the wound carefully\./);
  assert.doesNotMatch(corrections, /He wound a bandage around the wound/);
});
