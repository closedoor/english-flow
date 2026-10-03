import type { SentenceItem } from "./sentence-data";

type SentenceDisplayCorrection = Partial<Pick<SentenceItem, "text" | "translation" | "category">>;

// Reviewed display corrections preserve the canonical packs, learning IDs,
// length bands and source attribution. Scene choices follow the sentence's
// meaning rather than ambiguous words such as fish, order, leave or station.
const SENTENCE_DISPLAY_CORRECTIONS: Record<number, SentenceDisplayCorrection> = {
  199: { category: "social" },
  290: { category: "social" },
  751: { category: "shopping" },
  875: { category: "work" },
  924: { category: "daily" },
  976: { category: "daily" },
  983: { category: "help" },
  984: { category: "daily" },
  985: { category: "social" },
  1221: { category: "help" },
  1272: { category: "social" },
  1337: { category: "daily" },
  1444: { category: "daily" },
  1561: { category: "social" },
  1583: { category: "daily" },
  1757: { category: "daily" },
  1760: { category: "daily" },
  1764: { category: "daily" },
  1765: { category: "daily" },
  1797: { category: "daily" },
  1821: { category: "daily" },
  1893: { category: "work" },
  1910: { category: "daily" },
  1912: { category: "work" },
  1914: { category: "daily" },
  1919: { category: "daily" },
  2115: { category: "daily" },
  2247: { category: "daily" },
  2295: { category: "daily" },
  2350: { category: "work" },
  2417: { category: "shopping" },
  2464: { category: "daily" },
  2615: { category: "daily" },
  2707: { category: "daily" },
  2719: { category: "shopping" },
  2752: { category: "daily" },
  2754: { category: "daily" },
  2755: { category: "social" },
  2756: { category: "daily" },
  2761: { category: "daily" },
  // Swimming ability does not remove the need for supervision:
  // https://www.cdc.gov/drowning/prevention/index.html
  2803: {
    category: "daily",
    text: "Even though the child knows how to swim, an adult still watches her in the water.",
    translation: "虽然这个孩子会游泳，大人仍然在她下水时看护她。",
  },
  2807: {
    category: "daily",
    text: "Grass needs water to grow, so we water the lawn when the weather is dry.",
    translation: "草需要水才能生长，所以天气干燥时我们会给草坪浇水。",
  },
  2813: { category: "daily" },
  2820: { category: "work" },
  2825: { category: "daily" },
  2827: { category: "daily" },
  2879: { category: "work" },
  2880: { category: "daily" },
  // Use a neutral, original fact rather than claiming other planets lack water.
  // Earth's oceans cover most of its surface: https://science.nasa.gov/earth/facts/
  2881: {
    category: "daily",
    text: "Earth has vast oceans of liquid water, which cover much of its surface.",
    translation: "地球拥有广阔的液态水海洋，覆盖了它大部分的表面。",
  },
  2882: { category: "daily" },
  2916: { category: "daily" },
  2925: { category: "work" },
  2935: { category: "work" },
  2997: {
    text: "When travelling, I always go to the airport in Nanjing; I've never been to Shanghai.",
  },
};

export function applySentenceDisplayCorrection(item: SentenceItem): SentenceItem {
  const correction = SENTENCE_DISPLAY_CORRECTIONS[item.id];
  if (!correction) return item;
  const corrected = { ...item, ...correction };
  if (correction.text !== undefined || correction.translation !== undefined) corrected.adapted = true;
  return corrected;
}
