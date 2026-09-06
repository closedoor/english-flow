export function takeRotatedSpread<T>(items: T[], count: number, rotation: number) {
  if (count <= 0 || !items.length) return [];
  if (items.length <= count) return items;
  const offset = ((Math.trunc(rotation) % items.length) + items.length) % items.length;
  const step = items.length / count;
  return Array.from({ length: count }, (_, index) => items[(Math.floor(index * step) + offset) % items.length]);
}

export function hasUnfinishedRatings<T extends string | number>(ids: T[], ratings: Partial<Record<T, unknown>>) {
  return ids.some((id) => !Object.prototype.hasOwnProperty.call(ratings, id));
}

export function newestSnapshot<T extends { updatedAt: number }>(stored: T | null, memory: T | null) {
  if (!stored) return memory;
  if (!memory) return stored;
  return memory.updatedAt >= stored.updatedAt ? memory : stored;
}

export function scheduleMasteredWord(previous: { due: number; stage: number } | undefined, now: number, dayMs: number) {
  return {
    due: Math.max(previous?.due ?? 0, now + dayMs),
    stage: Math.max(previous?.stage ?? 0, 1),
  };
}

export function normalizeQuizAnswer(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/’/g, "'")
    .replace(/[.,!?;:。\s]+$/g, "")
    .trim()
    .replace(/\s+/g, " ");
}

export function nextReviewStage(currentStage: number, rating: "again" | "hard" | "good" | "easy") {
  const stage = Math.min(Math.max(Math.trunc(currentStage), 0), 5);
  if (rating === "again") return 0;
  if (rating === "hard") return stage;
  return Math.min(stage + (rating === "easy" ? 2 : 1), 5);
}

export function reviewIntervalDays(currentStage: number, rating: "again" | "hard" | "good" | "easy") {
  const stage = Math.min(Math.max(Math.trunc(currentStage), 0), 4);
  if (rating === "again") return 0;
  if (rating === "hard") return 1;
  return (rating === "good" ? [1, 3, 7, 14, 30] : [3, 7, 14, 30, 60])[stage];
}

export function nextScheduledReview(schedule: Record<number, { due: number }>, now: number) {
  return Object.values(schedule).reduce<number | null>((next, entry) => (
    entry.due > now && (next === null || entry.due < next) ? entry.due : next
  ), null);
}

export function blankAnswerInSentence(sentence: string, answer: string) {
  const escaped = answer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`\\b${escaped}\\b`, "gi");
  const blanked = sentence.replace(regex, "______");
  return blanked === sentence ? null : blanked;
}
