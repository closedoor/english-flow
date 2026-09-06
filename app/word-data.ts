import { curatedWords, sceneTerms, scenes, type SceneId, type WordItem } from "./data";
import { normalizeWordDisplay, wordCardCorrections } from "./word-corrections";
import { CONTENT_REVISION, fetchJsonWithRecovery } from "./content-loader";

export const ngslMeta = { version: "1.2", count: 2809, fallbackExamples: 0 } as const;
const wordPackMemoryCache = new Map<1 | 2 | 3, WordItem[]>();
const wordPackPromiseCache = new Map<1 | 2 | 3, Promise<WordItem[]>>();

async function loadNgslPack(pack: 1 | 2 | 3) {
  const existing = wordPackMemoryCache.get(pack);
  if (existing) return existing;
  const pending = wordPackPromiseCache.get(pack);
  if (pending) return pending;
  const start = (pack - 1) * 1000 + 1;
  const expectedCount = pack === 3 ? 809 : 1000;
  const sceneIds = new Set(scenes.map((scene) => scene.id));
  const validate = (value: unknown): value is WordItem[] => Array.isArray(value)
    && value.length === expectedCount
    && value.every((item, index) => item && typeof item === "object"
      && (item as WordItem).id === start + index
      && (item as WordItem).rank === start + index
      && typeof (item as WordItem).word === "string"
      && (item as WordItem).word.trim().length > 0
      && typeof (item as WordItem).phonetic === "string"
      && typeof (item as WordItem).meaning === "string"
      && (item as WordItem).meaning.trim().length > 0
      && Array.isArray((item as WordItem).collocations)
      && (item as WordItem).collocations.length > 0
      && (item as WordItem).collocations.every((value) => typeof value === "string" && value.trim().length > 0)
      && typeof (item as WordItem).example === "string"
      && (item as WordItem).example.trim().length > 0
      && typeof (item as WordItem).translation === "string"
      && (item as WordItem).translation.trim().length > 0
      && ((item as WordItem).exampleForm === undefined || (typeof (item as WordItem).exampleForm === "string" && (item as WordItem).exampleForm!.trim().length > 0))
      && sceneIds.has((item as WordItem).scene));
  const request = fetchJsonWithRecovery(`/data/ngsl-words-${pack}.json?rev=${CONTENT_REVISION}`, validate).then((items) => {
    wordPackMemoryCache.set(pack, items);
    wordPackPromiseCache.delete(pack);
    return items;
  }).catch((error) => {
    wordPackPromiseCache.delete(pack);
    throw error;
  });
  wordPackPromiseCache.set(pack, request);
  return request;
}

export async function loadWordData(onProgress?: (loaded: number, total: number) => void) {
  let loaded = 0;
  const ngslWords = (await Promise.all(([1, 2, 3] as const).map(async (pack) => {
    const items = await loadNgslPack(pack);
    loaded += 1;
    onProgress?.(loaded, 3);
    return items;
  }))).flat();
  if (ngslWords.length !== ngslMeta.count) throw new Error(`Expected ${ngslMeta.count} NGSL words, found ${ngslWords.length}`);
  const curatedByWord = new Map(curatedWords.map((item) => [item.word, item]));
  const words: WordItem[] = ngslWords.map((item) => {
    const curated = curatedByWord.get(item.word);
    const correction = wordCardCorrections[item.word];
    return normalizeWordDisplay({ ...item, ...correction, ...curated, id: item.id, rank: item.rank, exampleForm: curated?.exampleForm ?? correction?.exampleForm ?? item.exampleForm ?? curated?.word ?? item.word });
  });

  const officialWords = new Set(words.map((item) => item.word.toLowerCase()));
  const sceneExtras: WordItem[] = curatedWords
    .filter((item) => !officialWords.has(item.word.toLowerCase()))
    .map((item) => normalizeWordDisplay({ ...item, id: 10_000 + item.id, rank: undefined, exampleForm: item.exampleForm ?? item.word }));

  const allStudyWords = [...words, ...sceneExtras];
  const studyWordByName = new Map(allStudyWords.map((item) => [item.word.toLowerCase(), item]));
  const scenePacks = Object.fromEntries(scenes.map((scene) => [
    scene.id,
    sceneTerms[scene.id].map((term) => studyWordByName.get(term.toLowerCase())).filter((item): item is WordItem => Boolean(item)),
  ])) as Record<SceneId, WordItem[]>;

  return { words, sceneExtras, allStudyWords, scenePacks, ngslMeta };
}
