import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const packs = await Promise.all([1, 2, 3].map(async (pack) => JSON.parse(await readFile(new URL(`../public/data/tatoeba-sentences-${pack}.json`, import.meta.url), "utf8"))));
const items = packs.flat();

test("Tatoeba sentence library has three balanced packs and 3,000 unique pairs", () => {
  assert.deepEqual(packs.map((pack) => pack.length), [1000, 1000, 1000]);
  assert.equal(new Set(items.map((item) => item.id)).size, 3000);
  assert.equal(new Set(items.map((item) => item.text.toLowerCase())).size, 3000);
  assert.equal(new Set(items.map((item) => item.translation)).size, 3000);
  assert.deepEqual(Object.fromEntries(["short", "medium", "long"].map((band) => [band, items.filter((item) => item.length === band).length])), { short: 1000, medium: 1000, long: 1000 });
});

test("every sentence keeps bilingual text, attribution and a valid category", () => {
  const categories = new Set(["daily", "social", "food", "travel", "shopping", "work", "help"]);
  for (const item of items) {
    assert.ok(Number.isInteger(item.sourceId) && item.sourceId > 0);
    assert.ok(Number.isInteger(item.translationId) && item.translationId > 0);
    assert.ok(item.text.length > 2 && item.translation.length > 1);
    assert.ok(item.author && item.author !== "\\N");
    assert.ok(item.translationAuthor && item.translationAuthor !== "\\N");
    assert.doesNotMatch(item.translation, /[們這來時會為裡後還說學國麼開關門見過與買賣車書長樂點樣體應問間讓從對實處發現經話給頭萬東兩無當氣專業網頁電腦]/);
    assert.doesNotMatch(item.translation, /甚么|计程车|公车|网路|企划|推介|连络|联络|帐单|巴士|单车|月台|马铃薯/);
    assert.doesNotMatch(item.text, /\b(?:kill|murder|suicide|rape|porn|nazi|terrorist|bomb|gun|cocaine|heroin|die|death|hate|fight|war|drunk)\b/i);
    assert.ok(categories.has(item.category), `invalid category on ${item.id}`);
    const wordCount = item.text.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g)?.length ?? 0;
    if (item.length === "short") assert.ok(wordCount >= 2 && wordCount <= 7);
    if (item.length === "medium") assert.ok(wordCount >= 8 && wordCount <= 12);
    if (item.length === "long") assert.ok(wordCount >= 13 && wordCount <= 18);
  }
});

test("ambiguous words do not put unrelated sentences into food or travel scenes", () => {
  for (const item of items) {
    if (/\bin order\b/i.test(item.text)) assert.notEqual(item.category, "food", `in order misclassified on ${item.id}`);
    if (/^Bill\b/.test(item.text)) assert.notEqual(item.category, "food", `person name Bill misclassified on ${item.id}`);
    if (/leave the (?:lights|room)/i.test(item.text)) assert.notEqual(item.category, "travel", `generic leave misclassified on ${item.id}`);
  }
});

test("sentence module loads packs on demand and exposes card learning, search, speech and source", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const contentLoader = await readFile(new URL("../app/content-loader.ts", import.meta.url), "utf8");
  const sentenceData = await readFile(new URL("../app/sentence-data.ts", import.meta.url), "utf8");
  assert.match(page, /import\("\.\/sentence-data"\)/);
  assert.doesNotMatch(page, /import \{[^\n]*\} from "\.\/sentence-data"/);
  assert.match(page, /loadSentencePack/);
  assert.match(sentenceData, /fetchSentencePack/);
  assert.match(sentenceData, /fetchJsonWithRecovery\(`\/data\/tatoeba-sentences-\$\{pack\}\.json\?rev=\$\{CONTENT_REVISION\}`, validate\)/);
  assert.match(contentLoader, /DEFAULT_TIMEOUT = 8_000/);
  assert.match(contentLoader, /signal: controller\.signal/);
  assert.match(contentLoader, /parseValidatedJson/);
  assert.match(sentenceData, /SENTENCE_CORRECTIONS/);
  assert.match(sentenceData, /items\.map\(\(item\) => \{[\s\S]*?const correction = SENTENCE_CORRECTIONS\[item\.id\]/);
  assert.match(page, /学习长短句/);
  assert.match(page, /句子卡片/);
  assert.match(page, /还不熟悉/);
  assert.match(page, /我学会了/);
  assert.match(page, /搜索英文或中文/);
  assert.match(page, /playSpeech\(currentSentence\.text/);
  assert.match(page, /tatoeba\.org\/en\/sentences\/show/);
  assert.match(page, /filteredSentences\.slice\(0, sentenceResultLimit\)/);
  assert.match(page, /再显示 30 句/);
  assert.match(page, /已显示 \{Math\.min\(sentenceResultLimit, filteredSentences\.length\)\}/);
  assert.doesNotMatch(page, /filteredSentences\.slice\(0, 30\)/);
  assert.match(page, /只保存在当前设备/);
  assert.match(styles, /\.sentence-result-list>button\.library-more\{/);
});

test("sentence learning remembers choices, mastery, difficult cards and interrupted position", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  for (const key of ["sentenceMastered", "sentenceDifficult", "sentencePreferences", "sentenceActiveSession"]) {
    assert.match(page, new RegExp(`${key}: \\\"wordflow-sentence-`));
  }
  assert.match(page, /cleanSentenceSession/);
  assert.match(page, /sentenceIds: sentenceSessionIds/);
  assert.match(page, /index: sentenceIndex/);
  assert.match(page, /ratings: sentenceRatings/);
  assert.match(page, /setSentenceMastered/);
  assert.match(page, /setSentenceDifficult/);
  assert.match(page, /\[unseen, needsWork, learned\]\.reduce/);
  assert.match(page, /takeRotatedSpread\(group, selectionLimit - items\.length, selectionRotation \+ groupIndex\)/);
  assert.match(page, /已保留在待加强练习中/);
  assert.match(page, /返回句库设置并保留进度/);
  assert.match(page, /resumeSentenceSession/);
  assert.match(page, /未完成的句子练习/);
  assert.match(page, /sentenceResumeSnapshotRef/);
  assert.match(page, /newestSnapshot\(cleanSentenceSession\(readJson<unknown>\(STORAGE\.sentenceActiveSession, null\)\), sentenceResumeSnapshotRef\.current\)/);
});

test("opening one search result does not overwrite sentence setup choices", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const starter = page.split("const beginSentenceSession", 2)[1].split("const startSentenceSession", 1)[0];
  assert.match(page, /sentenceSetupPreferencesRef/);
  assert.match(page, /if \(sentenceStage === "setup"\)/);
  assert.match(starter, /if \(!singleSentence\)/);
  assert.doesNotMatch(starter, /setSentenceCount\(10\)/);
  assert.match(page, /const restoreSentenceSetupPreferences/);
  assert.match(page, /onClick=\{restoreSentenceSetupPreferences\}/);
});

test("sentence cards support Chinese-first speaking practice and persist the selected mode", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /看中文说英文/);
  assert.match(page, /我说好了，查看英文答案/);
  assert.match(page, /sentenceMode === "speak"/);
  assert.match(page, /mode: sentenceMode/);
  assert.match(page, /mode: normalizedSentenceMode/);
  assert.match(page, /sentenceMode === "bilingual" \|\| sentenceTranslationOpen/);
});

test("speech and install guidance are resilient across iPhone and desktop", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const speechPlayback = await readFile(new URL("../app/speech-playback.ts", import.meta.url), "utf8");
  assert.match(speechPlayback, /activeUtterance = utterance/);
  assert.match(speechPlayback, /utterance\.onend/);
  assert.match(page, /navigator\.maxTouchPoints > 1/);
  assert.match(page, /!standalone && iosInstallAvailable/);
  assert.match(page, /系统英文语音/);
});

test("known awkward corpus sentences receive learner-friendly display corrections", async () => {
  const sentenceData = await readFile(new URL("../app/sentence-data.ts", import.meta.url), "utf8");
  const correctionBlock = sentenceData.split("const SENTENCE_CORRECTIONS", 2)[1].split("const sentencePackCache", 1)[0];
  for (const id of [74, 125, 258, 523, 987, 1005, 1022, 1054, 1163, 1198, 1659, 1873, 1911, 1924, 1926, 1928, 1930, 1937, 1942, 1946, 1953, 1954, 1964, 1967, 1970, 1974, 1980, 1992, 1998, 2012, 2014, 2021, 2026, 2105, 2137, 2141, 2158, 2165, 2184, 2218, 2228, 2248, 2263, 2289, 2311, 2362, 2440, 2462, 2474, 2508, 2532, 2534, 2549, 2566, 2584, 2642, 2708, 2711, 2714, 2716, 2729, 2742, 2749, 2763, 2787, 2796, 2814, 2826, 2835, 2845, 2847, 2857, 2885, 2895, 2899, 2902, 2905, 2908, 2927, 2928, 2932, 2934, 2937, 2938, 2947, 2951, 2974, 2978, 2979, 2985, 2989, 2993, 2995, 2998]) {
    assert.match(correctionBlock, new RegExp(`\\n  ${id}:`), `missing correction for sentence ${id}`);
  }
  assert.doesNotMatch(correctionBlock, /discuss about|hunting a job|didn't not|do you got|任期完全记得|失败我的课|大型公会|prostitutes|砸东西|water buffalo|see you in Arabic|发电报|部首是女|名义上市公司|不需要在那样做|不必要呆在医院|cedars|hyssops|some degree of insincerity|sparkle of constellations|baseball in Italian|雪松|牛膝草|掺入一些虚伪|星宿/);
  assert.match(correctionBlock, /Never drive after drinking alcohol/);
  assert.match(correctionBlock, /两个孩子的年龄加起来等于他们父亲的年龄/);
  assert.match(correctionBlock, /前者比后者更优雅/);
  assert.match(correctionBlock, /buy train tickets online or at the station/);
  assert.match(correctionBlock, /clarity matters because every word should help the reader/);
  assert.match(correctionBlock, /If the kitchen smells like smoke/);
  assert.match(correctionBlock, /Honest conversations are easier/);
  assert.match(correctionBlock, /Watching a film in English/);
  assert.match(correctionBlock, /\n  74: \{ category: "food" \}/);
  assert.match(correctionBlock, /\n  1924: \{ category: "work" \}/);
  assert.match(correctionBlock, /\n  1928: \{ category: "shopping" \}/);
});

test("confirmed mistranslations and misleading beginner sentences are corrected", async () => {
  const sentenceData = await readFile(new URL("../app/sentence-data.ts", import.meta.url), "utf8");
  const correctionBlock = sentenceData.split("const SENTENCE_CORRECTIONS", 2)[1].split("const sentencePackCache", 1)[0];
  for (const id of [115, 239, 458, 523, 557, 563, 661, 853, 988, 993, 1220, 1286, 1307, 1397, 1414, 1416, 1447, 1483, 1553, 1600, 1642, 1650, 1674, 1675, 1697, 1779, 2117, 2144, 2304, 2309, 2409, 2476, 2501, 2503, 2525, 2529, 2539, 2593, 2596, 2646, 2662, 2722, 2794, 2907, 2967]) {
    assert.match(correctionBlock, new RegExp(`\\n  ${id}:`), `missing correction for sentence ${id}`);
  }
  assert.match(correctionBlock, /付诸实践/);
  assert.match(correctionBlock, /I'll treat you to a cup of coffee/);
  assert.match(correctionBlock, /我能把那件事办成/);
  assert.match(correctionBlock, /Do you know of a cheap hotel near here/);
  assert.match(correctionBlock, /你喜欢喝哪一种酒/);
  assert.match(correctionBlock, /帮你振作一点/);
  assert.match(correctionBlock, /\n  2794: \{ category: "daily" \}/);
  assert.doesNotMatch(correctionBlock, /付出实践|我想你表现我怎么做那个|会给人取笑的|I treat you to a cup of coffee|Would you know a cheap hotel|我不能让那事发生|in the near|吸毒吸傻了|送进牢里|上吊死|缺乏的政府|不足的的时候|决没决定|今个月|两个巴仙|踫|姊姊|彩劵|让大家开心一下|萤幕/);
});

test("common sentence searches show standard, accurate learner Chinese", async () => {
  const sentenceData = await readFile(new URL("../app/sentence-data.ts", import.meta.url), "utf8");
  const correctionBlock = sentenceData.split("const SENTENCE_CORRECTIONS", 2)[1].split("const sentencePackCache", 1)[0];
  for (const id of [1057, 1298, 1668, 1690, 1692, 1762, 2178, 2353, 2507, 2523, 2555, 2633, 2643, 2922, 2983]) {
    assert.match(correctionBlock, new RegExp(`\\n  ${id}:`), `missing learner Chinese correction for sentence ${id}`);
  }
  assert.match(correctionBlock, /想喝茶还是咖啡/);
  assert.match(correctionBlock, /想喝果汁还是咖啡/);
  assert.match(correctionBlock, /只吃了一片吐司，喝了一杯咖啡/);
  assert.doesNotMatch(correctionBlock, /喜欢喝茶；还是咖啡|早餐大致上|橙汁还是咖啡|喜欢咖啡 来说|一把它放进去/);
});

test("learner-friendly adaptations are labeled without altering Tatoeba attribution", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const sentenceData = await readFile(new URL("../app/sentence-data.ts", import.meta.url), "utf8");
  assert.match(sentenceData, /adapted\?: boolean/);
  assert.match(sentenceData, /adapted: Boolean\(correction\.text \|\| correction\.translation\)/);
  assert.match(page, /currentSentence\.adapted \? "学习化整理自：" : "来源："/);
  assert.match(page, /原始英\/中贡献者/);
  assert.match(page, /tatoeba\.org\/en\/sentences\/show/);
});

test("display corrections keep the advertised sentence length", async () => {
  const sentenceData = await readFile(new URL("../app/sentence-data.ts", import.meta.url), "utf8");
  const correctionBlock = sentenceData.split("const SENTENCE_CORRECTIONS", 2)[1].split("const sentencePackCache", 1)[0];
  const itemById = new Map(items.map((item) => [item.id, item]));
  for (const match of correctionBlock.matchAll(/\n\s+(\d+): \{([^\n]+)\}/g)) {
    const textMatch = match[2].match(/text: "((?:[^"\\]|\\.)*)"/);
    if (!textMatch) continue;
    const item = itemById.get(Number(match[1]));
    assert.ok(item, `unknown corrected sentence ${match[1]}`);
    const correctedText = JSON.parse(`"${textMatch[1]}"`);
    const wordCount = correctedText.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g)?.length ?? 0;
    if (item.length === "short") assert.ok(wordCount >= 2 && wordCount <= 7, `short correction ${item.id} has ${wordCount} words`);
    if (item.length === "medium") assert.ok(wordCount >= 8 && wordCount <= 12, `medium correction ${item.id} has ${wordCount} words`);
    if (item.length === "long") assert.ok(wordCount >= 13 && wordCount <= 18, `long correction ${item.id} has ${wordCount} words`);
  }
});

test("future sentence-pack regeneration excludes unsafe learner contexts", async () => {
  const generator = await readFile(new URL("../scripts/generate-tatoeba-sentences.py", import.meta.url), "utf8");
  assert.match(generator, /prostitut\\w\*/);
  assert.match(generator, /bullet\\w\*/);
  assert.match(generator, /smash\\w\*/);
  assert.match(generator, /drink\|drank\|drinking/);
  assert.match(generator, /MALFORMED_ENGLISH/);
  assert.match(generator, /do\(\?:es\)\?/);
  assert.match(generator, /holds\? water/);
  assert.match(generator, /"妳": "你"/);
  assert.match(generator, /"咱们": "我们"/);
  assert.match(generator, /\(\?<=\[\\u3400-\\u9fff\]\)\\s\+/);
});
