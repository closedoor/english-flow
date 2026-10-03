export const BACKUP_MAX_BYTES = 2_000_000;
const BACKUP_VALUE_MAX_LENGTH = 500_000;

type ReadableStorage = Pick<Storage, "getItem">;
type WritableStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

// Finish all reads before hydration is allowed to normalize or save anything.
// A blocked read is different from a genuinely missing learning record.
export function readLearningStorage(storage: ReadableStorage, keys: readonly string[]): ReadableStorage {
  const values = new Map(keys.map((key) => [key, storage.getItem(key)]));
  return { getItem: (key) => values.get(key) ?? null };
}

export type LearningBackup<Key extends string = string> = {
  app: "english-flow";
  formatVersion: 1;
  exportedAt: string;
  data: Record<Key, unknown>;
};

export function createLearningBackup<Key extends string>(storage: ReadableStorage, keys: readonly Key[], exportedAt = new Date().toISOString()) {
  const data = Object.fromEntries(keys.map((key) => {
    const raw = storage.getItem(key);
    if (!raw) return [key, null];
    try { return [key, JSON.parse(raw) as unknown]; } catch { return [key, null]; }
  })) as Record<Key, unknown>;
  return { app: "english-flow", formatVersion: 1, exportedAt, data } satisfies LearningBackup<Key>;
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const nonnegative = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0;
const integer = (value: unknown) => nonnegative(value) && Number.isSafeInteger(value);
const positiveId = (value: unknown) => integer(value) && Number(value) > 0;
const textId = (value: unknown) => typeof value === "string" && value.trim().length > 0;
const oneOf = (value: unknown, choices: readonly unknown[]) => choices.includes(value);
const listOf = (value: unknown, valid: (item: unknown) => boolean) => Array.isArray(value) && value.every(valid);
const optional = (value: Record<string, unknown>, key: string, valid: (item: unknown) => boolean) => !Object.hasOwn(value, key) || valid(value[key]);
const wordMode = (value: unknown) => oneOf(value, ["free", "test"]);
const wordPath = (value: unknown) => oneOf(value, ["frequency", "daily", "restaurant", "airport", "hotel", "shopping"]);
const sentenceBand = (value: unknown) => oneOf(value, ["short", "medium", "long"]);
const sentenceCategory = (value: unknown) => oneOf(value, ["all", "daily", "social", "food", "travel", "shopping", "work", "help"]);
const sentenceMode = (value: unknown) => oneOf(value, ["bilingual", "speak"]);
const patternCategory = (value: unknown) => oneOf(value, ["all", "daily", "request", "social", "travel", "food", "shopping", "work"]);
const sessionCount = (value: unknown) => value === 10 || value === 20;
const ratings = (value: unknown) => isRecord(value) && Object.values(value).every((rating) => rating === "known" || rating === "difficult");
const continuous = (value: Record<string, unknown>) => optional(value, "continuous", (flag) => flag === true);

function continuousWordIds(value: unknown, path: unknown) {
  // The range is bounded by the 2,809 NGSL words and the 50 curated scene
  // candidates. Hydration still checks membership against the loaded content.
  return Array.isArray(value) && value.length > 0 && value.length <= 2809 + 50
    && value.every((id) => positiveId(id) && (Number(id) <= 2809 || (path !== "frequency" && Number(id) >= 10001 && Number(id) <= 10050)));
}

function continuousSentenceIds(value: unknown, band: unknown) {
  const minimum = band === "short" ? 1 : band === "medium" ? 1001 : 2001;
  return Array.isArray(value) && value.length > 0 && value.length <= 1000
    && value.every((id) => positiveId(id) && Number(id) >= minimum && Number(id) < minimum + 1000);
}

function studyDate(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

// Validate stored shapes before the user can replace their records. Do not use
// hydration's time limits here: an old backup may contain an expired session
// alongside valuable progress, and time-zone changes may put a date in tomorrow.
function validBackupRecord(key: string, value: unknown): boolean {
  if (value === null) return true;
  switch (key) {
    case "wordflow-ngsl-mastered-v1":
    case "wordflow-ngsl-difficult-v1":
    case "wordflow-sentence-saved-v1":
    case "wordflow-sentence-seen-v1":
    case "wordflow-sentence-mastered-v1":
    case "wordflow-sentence-difficult-v1": return listOf(value, positiveId);
    case "wordflow-pattern-mastered-v1":
    case "wordflow-pattern-difficult-v1":
    case "wordflow-reading-completed-v1": return listOf(value, textId);
    case "wordflow-days": return listOf(value, studyDate);
    case "wordflow-ngsl-schedule-v1":
      return isRecord(value) && Object.entries(value).every(([id, entry]) => /^\d+$/.test(id) && positiveId(Number(id)) && isRecord(entry) && nonnegative(entry.due) && integer(entry.stage) && Number(entry.stage) <= 5);
    case "wordflow-session-preferences-v1":
      return isRecord(value) && optional(value, "mode", wordMode) && optional(value, "count", sessionCount) && optional(value, "path", wordPath);
    case "wordflow-sentence-preferences-v1":
      return isRecord(value) && optional(value, "band", sentenceBand) && optional(value, "category", sentenceCategory) && optional(value, "count", sessionCount) && optional(value, "mode", sentenceMode);
    case "wordflow-practice-rotation-v1":
      return isRecord(value) && ["word", "sentence", "pattern"].every((field) => optional(value, field, integer));
    case "wordflow-reading-last-v1":
      return isRecord(value) && textId(value.id) && nonnegative(value.updatedAt);
    case "wordflow-reading-answers-v1":
      return isRecord(value) && Object.entries(value).every(([id, answer]) => /^r(?:[1-9]|1[0-5])$/.test(id) && integer(answer) && Number(answer) < 3);
    case "wordflow-active-session-v1":
    case "wordflow-sentence-active-session-v1":
    case "wordflow-pattern-active-session-v1": {
      if (!isRecord(value) || value.version !== 1 || !nonnegative(value.updatedAt) || !optional(value, "index", integer) || !optional(value, "ratings", ratings)) return false;
      if (key === "wordflow-sentence-active-session-v1") {
        return sentenceBand(value.band) && sentenceCategory(value.category) && sessionCount(value.count) && optional(value, "mode", sentenceMode) && continuous(value)
          && optional(value, "reviewOnly", (flag) => flag === true)
          && optional(value, "kind", (kind) => kind === "group" || (kind === "lookup" && value.continuous !== true && value.reviewOnly !== true && Array.isArray(value.sentenceIds) && value.sentenceIds.length === 1))
          && (value.continuous === true ? continuousSentenceIds(value.sentenceIds, value.band)
            : Array.isArray(value.sentenceIds) && value.sentenceIds.length > 0 && value.sentenceIds.every(positiveId));
      }
      if (key === "wordflow-pattern-active-session-v1") {
        return patternCategory(value.category) && optional(value, "drillIndex", (item) => integer(item) && Number(item) <= 2)
          && Array.isArray(value.patternIds) && value.patternIds.length > 0 && value.patternIds.every(textId);
      }
      return wordPath(value.path) && wordMode(value.mode) && oneOf(value.stage, ["cards", "quiz"])
        && continuous(value) && (value.continuous !== true || (value.mode === "free" && value.stage === "cards" && value.kind !== "lookup"))
        && optional(value, "kind", (kind) => kind === "group" || (kind === "lookup" && value.mode === "free" && Array.isArray(value.wordIds) && value.wordIds.length === 1))
        && (value.stage !== "quiz" || value.mode === "test")
        && (value.continuous === true ? continuousWordIds(value.wordIds, value.path)
          : Array.isArray(value.wordIds) && value.wordIds.length > 0 && value.wordIds.every(positiveId))
        && optional(value, "quizIndex", integer) && optional(value, "quizAnswer", (item) => typeof item === "string")
        && optional(value, "quizFeedback", (item) => oneOf(item, [null, "correct", "wrong"]))
        && optional(value, "quizResults", (item) => listOf(item, (result) => typeof result === "boolean"));
    }
    default: return true;
  }
}

export function isLearningBackup<Key extends string>(value: unknown, keys: readonly Key[], optionalKeys: readonly Key[] = []): value is LearningBackup<Key> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const backup = value as Partial<LearningBackup<Key>>;
  if (backup.app !== "english-flow" || backup.formatVersion !== 1 || typeof backup.exportedAt !== "string" || !Number.isFinite(Date.parse(backup.exportedAt))) return false;
  if (!backup.data || typeof backup.data !== "object" || Array.isArray(backup.data)) return false;
  const data = backup.data as Record<string, unknown>;
  const keySet = new Set<string>(keys);
  const optionalKeySet = new Set<string>(optionalKeys);
  if (Object.keys(data).some((key) => !keySet.has(key))) return false;
  if (!keys.every((key) => optionalKeySet.has(key) || Object.prototype.hasOwnProperty.call(data, key))) return false;
  return Object.keys(data).every((key) => {
    try {
      const serialized = JSON.stringify(data[key]);
      return serialized !== undefined && serialized.length <= BACKUP_VALUE_MAX_LENGTH && validBackupRecord(key, data[key]);
    } catch {
      return false;
    }
  });
}

export type BackupContentValidators = {
  word: (id: number) => boolean;
  sentence: (id: number) => boolean;
  pattern: (id: string) => boolean;
  reading: (id: string) => boolean;
};

// Shape validation alone cannot promise a faithful restore: hydration discards
// unknown content. Check compatibility before offering to replace good records.
// The caller supplies its loaded IDs, keeping the backup module independent of
// the content packs and retaining existing format-1/optional-field compatibility.
export function isBackupContentCompatible(backup: LearningBackup, validators: BackupContentValidators) {
  const knownWord = (id: unknown) => positiveId(id) && validators.word(Number(id));
  const knownSentence = (id: unknown) => positiveId(id) && validators.sentence(Number(id));
  const knownPattern = (id: unknown) => textId(id) && validators.pattern(String(id));
  const knownReading = (id: unknown) => textId(id) && validators.reading(String(id));
  const knownRatings = (value: Record<string, unknown>, valid: (id: unknown) => boolean, numeric: boolean) => (
    optional(value, "ratings", (entries) => isRecord(entries)
      && Object.keys(entries).every((id) => valid(numeric ? Number(id) : id)))
  );
  try {
    return Object.entries(backup.data).every(([key, value]) => {
      if (value === null) return true;
      switch (key) {
        case "wordflow-ngsl-mastered-v1":
        case "wordflow-ngsl-difficult-v1": return listOf(value, knownWord);
        case "wordflow-sentence-saved-v1":
        case "wordflow-sentence-seen-v1":
        case "wordflow-sentence-mastered-v1":
        case "wordflow-sentence-difficult-v1": return listOf(value, knownSentence);
        case "wordflow-pattern-mastered-v1":
        case "wordflow-pattern-difficult-v1": return listOf(value, knownPattern);
        case "wordflow-reading-completed-v1": return listOf(value, knownReading);
        case "wordflow-reading-last-v1": return isRecord(value) && knownReading(value.id);
        case "wordflow-reading-answers-v1": return isRecord(value) && Object.keys(value).every(knownReading);
        case "wordflow-ngsl-schedule-v1":
          // An alias such as "01" stays due after review writes the canonical
          // "1" entry. Backups must use exactly the keys the scheduler updates.
          return isRecord(value) && Object.keys(value).every((id) => String(Number(id)) === id && knownWord(Number(id)));
        case "wordflow-active-session-v1":
          return isRecord(value) && listOf(value.wordIds, knownWord) && knownRatings(value, knownWord, true);
        case "wordflow-sentence-active-session-v1":
          return isRecord(value) && listOf(value.sentenceIds, knownSentence) && knownRatings(value, knownSentence, true);
        case "wordflow-pattern-active-session-v1":
          return isRecord(value) && listOf(value.patternIds, knownPattern) && knownRatings(value, knownPattern, false);
        default: return true;
      }
    });
  } catch {
    return false;
  }
}

export function restoreLearningBackupData<Key extends string>(storage: WritableStorage, keys: readonly Key[], backup: LearningBackup<Key>) {
  const previous = new Map<Key, string | null>();
  const applied: Key[] = [];
  try {
    keys.forEach((key) => previous.set(key, storage.getItem(key)));
    // Serialize everything before touching storage. Free space before growing
    // other records so a backup that fits does not need a second copy's quota.
    const replacements = keys.map((key) => {
      const value = Object.prototype.hasOwnProperty.call(backup.data, key) ? backup.data[key] : null;
      const next = value === null ? null : JSON.stringify(value);
      if (next === undefined) throw new Error("Invalid backup value");
      return { key, next, delta: (next?.length ?? 0) - (previous.get(key)?.length ?? 0) };
    }).sort((left, right) => left.delta - right.delta);
    replacements.forEach(({ key, next }) => {
      if (next === previous.get(key)) return;
      if (next === null) storage.removeItem(key);
      else storage.setItem(key, next);
      applied.push(key);
    });
    return true;
  } catch {
    // Undo in reverse order: every intermediate size already fitted during the
    // forward writes. One blocked key must not prevent restoring the others.
    for (const key of applied.reverse()) {
      try {
        const value = previous.get(key) ?? null;
        if (value === null) storage.removeItem(key);
        else storage.setItem(key, value);
      } catch {
        // The caller surfaces a persistent-storage warning if access fails.
      }
    }
    return false;
  }
}
