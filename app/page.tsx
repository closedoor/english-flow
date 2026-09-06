"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { scenes, type SceneId, type WordItem } from "./data";
import { corePatterns, patternCategories, type PatternCategory } from "./pattern-data";
import { BACKUP_MAX_BYTES, createLearningBackup, isLearningBackup, restoreLearningBackupData, type LearningBackup } from "./backup-data";
import { isSpeechSupported, SPEECH_ERROR_EVENT, SPEECH_PLAYBACK_EVENT, speak, startSegmentedSpeech, stopSpeech, toggleSegmentedSpeech, type SpeechPlaybackState } from "./speech-playback";
import { blankAnswerInSentence, hasUnfinishedRatings, newestSnapshot, nextReviewStage, nextScheduledReview, normalizeQuizAnswer, reviewIntervalDays, scheduleMasteredWord, takeRotatedSpread } from "./session-utils";

type Tab = "home" | "learn" | "sentences" | "read" | "review" | "progress";
type LearnStage = "setup" | "cards" | "quiz" | "result";
type LearnMode = "free" | "test";
type LearnPath = "frequency" | SceneId;
type CardRating = "known" | "difficult";
type ScheduleEntry = { due: number; stage: number };
type ReviewUndo = { id: number; word: string; schedule?: ScheduleEntry; mastered: boolean; difficult: boolean; index: number; label: string };
type SessionPreferences = { mode: LearnMode; count: 10 | 20; path: LearnPath };
type DiscardRequest = {
  path?: LearnPath;
  sentence?: boolean;
  pattern?: boolean;
  sentenceStart?: { reviewOnly: boolean; singleSentence?: SentenceItem };
  patternStart?: { reviewOnly: boolean };
};
type SentenceBand = "short" | "medium" | "long";
type SentenceCategory = "all" | "daily" | "social" | "food" | "travel" | "shopping" | "work" | "help";
type SentenceStage = "setup" | "cards" | "result";
type SentenceLearningMode = "bilingual" | "speak";
type SentenceSection = "library" | "patterns";
type SentenceRating = "known" | "difficult";
type SentencePreferences = { band: SentenceBand; category: SentenceCategory; count: 10 | 20; mode: SentenceLearningMode };
type PatternStage = "setup" | "cards" | "result";
type PatternRating = "known" | "difficult";
type PracticeRotation = { word: number; sentence: number; pattern: number };
type WordData = Awaited<ReturnType<typeof import("./word-data")["loadWordData"]>>;
type ReadingItem = import("./reading-data").ReadingItem;
type ReadingQuestion = import("./reading-data").ReadingQuestion;
type ReadingLast = { id: string; updatedAt: number };
type SentenceItem = import("./sentence-data").SentenceItem;
type SentenceSessionSnapshot = {
  version: 1;
  updatedAt: number;
  band: SentenceBand;
  category: SentenceCategory;
  count: 10 | 20;
  mode: SentenceLearningMode;
  sentenceIds: number[];
  index: number;
  ratings: Record<number, SentenceRating>;
};
type PatternSessionSnapshot = {
  version: 1;
  updatedAt: number;
  category: "all" | PatternCategory;
  patternIds: string[];
  index: number;
  drillIndex: number;
  ratings: Record<string, PatternRating>;
};
type ActiveSessionSnapshot = {
  version: 1;
  kind?: "group" | "lookup";
  updatedAt: number;
  path: LearnPath;
  mode: LearnMode;
  wordIds: number[];
  index: number;
  ratings: Record<number, CardRating>;
  stage: "cards" | "quiz";
  quizIndex: number;
  quizAnswer: string;
  quizFeedback: "correct" | "wrong" | null;
  quizResults: boolean[];
};
type BackupNotice = { kind: "success" | "error"; message: string };
type BrowserOrigin = { id: number; scrollY: number; listScrollTop: number };

const DAY = 86_400_000;
const REVIEW_AGAIN_DELAY = 10 * 60_000;
const STORAGE = {
  mastered: "wordflow-ngsl-mastered-v1",
  difficult: "wordflow-ngsl-difficult-v1",
  schedule: "wordflow-ngsl-schedule-v1",
  days: "wordflow-days",
  session: "wordflow-session-preferences-v1",
  activeSession: "wordflow-active-session-v1",
  readingCompleted: "wordflow-reading-completed-v1",
  readingLast: "wordflow-reading-last-v1",
  readingAnswers: "wordflow-reading-answers-v1",
  sentenceSaved: "wordflow-sentence-saved-v1",
  sentenceSeen: "wordflow-sentence-seen-v1",
  sentenceMastered: "wordflow-sentence-mastered-v1",
  sentenceDifficult: "wordflow-sentence-difficult-v1",
  sentencePreferences: "wordflow-sentence-preferences-v1",
  sentenceActiveSession: "wordflow-sentence-active-session-v1",
  patternMastered: "wordflow-pattern-mastered-v1",
  patternDifficult: "wordflow-pattern-difficult-v1",
  patternActiveSession: "wordflow-pattern-active-session-v1",
  practiceRotation: "wordflow-practice-rotation-v1",
} as const;
type StorageKey = (typeof STORAGE)[keyof typeof STORAGE];
const STORAGE_KEYS = Object.values(STORAGE);
const BACKUP_OPTIONAL_KEYS: StorageKey[] = [STORAGE.readingCompleted, STORAGE.readingLast, STORAGE.practiceRotation, STORAGE.readingAnswers];
const tabItems: { id: Tab; label: string; icon: string }[] = [
  { id: "home", label: "今天", icon: "⌂" },
  { id: "learn", label: "学习", icon: "▤" },
  { id: "sentences", label: "句库", icon: "“”" },
  { id: "read", label: "阅读", icon: "◫" },
  { id: "review", label: "复习", icon: "↻" },
  { id: "progress", label: "进度", icon: "◌" },
];
let STUDY_WORD_IDS = new Set<number>();
let STUDY_WORD_BY_ID = new Map<number, WordItem>();
const EMPTY_WORDS: WordItem[] = [];
const EMPTY_SCENE_PACKS: Record<SceneId, WordItem[]> = { daily: [], restaurant: [], airport: [], hotel: [], shopping: [] };
const EMPTY_NGSL_META = { version: "1.2", count: 2809, fallbackExamples: 0 } as const;
const ACTIVE_SESSION_TTL = 30 * DAY;
const READING_TOTAL = 15;
const READING_IDS = new Set(Array.from({ length: READING_TOTAL }, (_, index) => `r${index + 1}`));
const READING_SPEECH_RATES = [
  { value: 0.65, label: "慢速", detail: "0.65×" },
  { value: 0.8, label: "标准", detail: "0.8×" },
  { value: 1, label: "快速", detail: "1×" },
] as const;
const PATTERN_IDS = new Set(corePatterns.map((pattern) => pattern.id));
const SENTENCE_PACK_BY_BAND: Record<SentenceBand, 1 | 2 | 3> = { short: 1, medium: 2, long: 3 };
const STORAGE_ERROR_EVENT = "english-flow-storage-error";
const OFFLINE_CACHE_ERROR_EVENT = "english-flow-offline-cache-error";
const sentenceCategories: { id: SentenceCategory; label: string }[] = [
  { id: "all", label: "全部" }, { id: "daily", label: "日常" }, { id: "social", label: "社交" },
  { id: "food", label: "餐饮" }, { id: "travel", label: "出行" }, { id: "shopping", label: "购物" },
  { id: "work", label: "工作学习" }, { id: "help", label: "求助" },
];

function cacheLoadedPageAssets() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  const documentUrls = [...document.querySelectorAll<HTMLScriptElement | HTMLLinkElement>('script[src], link[rel="stylesheet"][href], link[rel="preload"][href]')]
    .map((element) => element instanceof HTMLScriptElement ? element.src : element.href)
    .filter((url) => { try { return new URL(url, location.href).origin === location.origin; } catch { return false; } });
  const resourceUrls = performance.getEntriesByType("resource").map((entry) => entry.name)
    .filter((url) => { try { return new URL(url, location.href).origin === location.origin; } catch { return false; } });
  const urls = [...new Set([...documentUrls, ...resourceUrls])];
  navigator.serviceWorker.ready.then((registration) => registration.active?.postMessage({ type: "CACHE_URLS", urls })).catch(() => undefined);
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    window.dispatchEvent(new Event(STORAGE_ERROR_EVENT));
    return false;
  }
}

function removeStoredValue(key: string) {
  try {
    window.localStorage.removeItem(key);
    return true;
  } catch {
    window.dispatchEvent(new Event(STORAGE_ERROR_EVENT));
    return false;
  }
}

function backupItemCount(backup: LearningBackup<StorageKey>, key: StorageKey) {
  const value = backup.data[key];
  return Array.isArray(value) ? value.length : 0;
}

function sessionPayloadMatches(previous: { updatedAt: number } | null, payload: object) {
  if (!previous) return false;
  const previousPayload = { ...previous } as Record<string, unknown>;
  delete previousPayload.updatedAt;
  return JSON.stringify(previousPayload) === JSON.stringify(payload);
}

function normalized(value: string) {
  return value.normalize("NFKC").toLowerCase().trim().replace(/[.,!?;:'’]/g, "").replace(/\s+/g, " ");
}

function readingWordCount(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function readingMinutes(text: string) {
  return Math.max(1, Math.ceil(readingWordCount(text) / 90));
}

function cleanStoredWordIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id): id is number => Number.isInteger(id) && STUDY_WORD_IDS.has(id)))];
}

function cleanReadingIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id): id is string => typeof id === "string" && READING_IDS.has(id)))];
}

function cleanReadingLast(value: unknown): ReadingLast | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Partial<ReadingLast>;
  if (typeof item.id !== "string" || !READING_IDS.has(item.id) || !Number.isFinite(item.updatedAt) || Number(item.updatedAt) < 0 || Number(item.updatedAt) > Date.now() + DAY) return null;
  return { id: item.id, updatedAt: Number(item.updatedAt) };
}

function cleanReadingAnswers(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([id, answer]) => READING_IDS.has(id) && Number.isInteger(answer) && answer >= 0 && answer < 3));
}

function cleanSentenceIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id): id is number => Number.isInteger(id) && id >= 1 && id <= 3000))];
}

function isSentenceBand(value: unknown): value is SentenceBand {
  return value === "short" || value === "medium" || value === "long";
}

function isSentenceCategory(value: unknown): value is SentenceCategory {
  return sentenceCategories.some((category) => category.id === value);
}

function isSentenceLearningMode(value: unknown): value is SentenceLearningMode {
  return value === "bilingual" || value === "speak";
}

function isPatternCategory(value: unknown): value is "all" | PatternCategory {
  return patternCategories.some((category) => category.id === value);
}

function cleanPatternIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id): id is string => typeof id === "string" && PATTERN_IDS.has(id)))];
}

function cleanPracticeRotation(value: unknown): PracticeRotation {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { word: 0, sentence: 0, pattern: 0 };
  const item = value as Partial<PracticeRotation>;
  return {
    word: Number.isSafeInteger(item.word) && Number(item.word) >= 0 ? Number(item.word) : 0,
    sentence: Number.isSafeInteger(item.sentence) && Number(item.sentence) >= 0 ? Number(item.sentence) : 0,
    pattern: Number.isSafeInteger(item.pattern) && Number(item.pattern) >= 0 ? Number(item.pattern) : 0,
  };
}

function cleanSentenceSession(value: unknown): SentenceSessionSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Partial<SentenceSessionSnapshot>;
  const isRecent = Number.isFinite(item.updatedAt) && Number(item.updatedAt) <= Date.now() + DAY && Number(item.updatedAt) >= Date.now() - ACTIVE_SESSION_TTL;
  if (item.version !== 1 || !isRecent || !isSentenceBand(item.band) || !isSentenceCategory(item.category) || (item.count !== 10 && item.count !== 20)) return null;
  const [minimumId, maximumId] = item.band === "short" ? [1, 1000] : item.band === "medium" ? [1001, 2000] : [2001, 3000];
  const sentenceIds = cleanSentenceIds(item.sentenceIds).filter((id) => id >= minimumId && id <= maximumId).slice(0, item.count);
  if (!sentenceIds.length) return null;
  const allowedIds = new Set(sentenceIds);
  const rawRatings = item.ratings && typeof item.ratings === "object" && !Array.isArray(item.ratings) ? item.ratings : {};
  const ratings = Object.fromEntries(Object.entries(rawRatings).filter(([rawId, rating]) => allowedIds.has(Number(rawId)) && (rating === "known" || rating === "difficult")).map(([rawId, rating]) => [Number(rawId), rating])) as Record<number, SentenceRating>;
  if (!hasUnfinishedRatings(sentenceIds, ratings)) return null;
  const index = Math.min(Math.max(Number.isInteger(item.index) ? Number(item.index) : 0, 0), sentenceIds.length - 1);
  const mode: SentenceLearningMode = isSentenceLearningMode(item.mode) ? item.mode : "bilingual";
  return { version: 1, updatedAt: Number(item.updatedAt), band: item.band, category: item.category, count: item.count, mode, sentenceIds, index, ratings };
}

function cleanPatternSession(value: unknown): PatternSessionSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Partial<PatternSessionSnapshot>;
  const isRecent = Number.isFinite(item.updatedAt) && Number(item.updatedAt) <= Date.now() + DAY && Number(item.updatedAt) >= Date.now() - ACTIVE_SESSION_TTL;
  if (item.version !== 1 || !isRecent || !isPatternCategory(item.category)) return null;
  const patternIds = cleanPatternIds(item.patternIds).slice(0, 10);
  if (!patternIds.length) return null;
  const allowedIds = new Set(patternIds);
  const rawRatings = item.ratings && typeof item.ratings === "object" && !Array.isArray(item.ratings) ? item.ratings : {};
  const ratings = Object.fromEntries(Object.entries(rawRatings).filter(([id, rating]) => allowedIds.has(id) && (rating === "known" || rating === "difficult"))) as Record<string, PatternRating>;
  if (!hasUnfinishedRatings(patternIds, ratings)) return null;
  const index = Math.min(Math.max(Number.isInteger(item.index) ? Number(item.index) : 0, 0), patternIds.length - 1);
  const drillIndex = Math.min(Math.max(Number.isInteger(item.drillIndex) ? Number(item.drillIndex) : 0, 0), 2);
  return { version: 1, updatedAt: Number(item.updatedAt), category: item.category, patternIds, index, drillIndex, ratings };
}

function cleanStoredSchedule(value: unknown): Record<number, ScheduleEntry> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const maximumScheduleDue = Date.now() + 365 * DAY;
  return Object.fromEntries(Object.entries(value).filter(([rawId, entry]) => {
    const id = Number(rawId);
    if (!Number.isInteger(id) || !STUDY_WORD_IDS.has(id) || !entry || typeof entry !== "object") return false;
    const item = entry as Partial<ScheduleEntry>;
    return Number.isFinite(item.due) && Number(item.due) >= 0 && Number(item.due) <= maximumScheduleDue && Number.isInteger(item.stage) && Number(item.stage) >= 0 && Number(item.stage) <= 5;
  })) as Record<number, ScheduleEntry>;
}

function isLearnPath(value: unknown): value is LearnPath {
  return value === "frequency" || scenes.some((scene) => scene.id === value);
}

function cleanActiveSession(value: unknown): ActiveSessionSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Partial<ActiveSessionSnapshot>;
  const pathIsValid = isLearnPath(item.path);
  const modeIsValid = item.mode === "free" || item.mode === "test";
  const stageIsValid = item.stage === "cards" || item.stage === "quiz";
  const isRecent = Number.isFinite(item.updatedAt) && Number(item.updatedAt) <= Date.now() + DAY && Number(item.updatedAt) >= Date.now() - ACTIVE_SESSION_TTL;
  if (item.version !== 1 || !pathIsValid || !modeIsValid || !stageIsValid || !isRecent || !Array.isArray(item.wordIds)) return null;
  if (item.stage === "quiz" && item.mode !== "test") return null;
  const wordIds = [...new Set(item.wordIds.filter((id): id is number => Number.isInteger(id) && STUDY_WORD_IDS.has(id)))].slice(0, 20);
  if (!wordIds.length) return null;
  const allowedIds = new Set(wordIds);
  const rawRatings = item.ratings && typeof item.ratings === "object" && !Array.isArray(item.ratings) ? item.ratings : {};
  const ratings = Object.fromEntries(Object.entries(rawRatings).filter(([rawId, rating]) => allowedIds.has(Number(rawId)) && (rating === "known" || rating === "difficult")).map(([rawId, rating]) => [Number(rawId), rating])) as Record<number, CardRating>;
  if (item.stage === "cards" && !hasUnfinishedRatings(wordIds, ratings)) return null;
  if (item.stage === "quiz" && hasUnfinishedRatings(wordIds, ratings)) return null;
  const index = Math.min(Math.max(Number.isInteger(item.index) ? Number(item.index) : 0, 0), wordIds.length - 1);
  if (item.stage === "quiz" && (!Number.isInteger(item.quizIndex) || Number(item.quizIndex) < 0 || Number(item.quizIndex) >= wordIds.length)) return null;
  const quizIndex = item.stage === "quiz" ? Number(item.quizIndex) : 0;
  if (item.stage === "quiz" && (!Array.isArray(item.quizResults) || !item.quizResults.every((result) => typeof result === "boolean"))) return null;
  const rawQuizResults = item.stage === "quiz" ? item.quizResults as boolean[] : [];
  const quizAnswer = item.stage === "quiz" && typeof item.quizAnswer === "string" ? item.quizAnswer.slice(0, 100) : "";
  // Revealing an unknown answer records a wrong result without fabricated input.
  const hasCurrentFeedback = item.quizFeedback === "wrong" || (Boolean(quizAnswer.trim()) && item.quizFeedback === "correct");
  if (item.stage === "quiz" && rawQuizResults.length !== quizIndex + (hasCurrentFeedback ? 1 : 0)) return null;
  if (item.stage === "quiz" && item.quizFeedback !== null && item.quizFeedback !== undefined && !hasCurrentFeedback) return null;
  if (hasCurrentFeedback && rawQuizResults.at(-1) !== (item.quizFeedback === "correct")) return null;
  const quizFeedback = hasCurrentFeedback ? item.quizFeedback as "correct" | "wrong" : null;
  const quizResults = item.stage === "quiz" ? rawQuizResults : [];
  const kind = item.kind === "group" || (item.kind === "lookup" && item.mode === "free" && wordIds.length === 1) ? item.kind : undefined;
  return { version: 1, ...(kind ? { kind } : {}), updatedAt: Number(item.updatedAt), path: item.path as LearnPath, mode: item.mode as LearnMode, wordIds, index, ratings, stage: item.stage as "cards" | "quiz", quizIndex, quizAnswer, quizFeedback, quizResults };
}

function localDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatReviewDue(due: number, todayKey: string) {
  const date = new Date(due);
  if (localDateKey(date) === todayKey) {
    return `今天 ${new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date)}`;
  }
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function isValidStudyDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day, 12);
  return localDateKey(date) === value;
}

function weekDateKeys(date: Date) {
  const monday = new Date(date);
  monday.setHours(12, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, index) => {
    const item = new Date(monday);
    item.setDate(monday.getDate() + index);
    return localDateKey(item);
  });
}

function calculateStreak(studyDays: string[], todayKey: string) {
  if (!todayKey) return 0;
  const studied = new Set(studyDays);
  const cursor = new Date(`${todayKey}T12:00:00`);
  if (!studied.has(todayKey)) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (studied.has(localDateKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function blankSentence(item: WordItem) {
  return blankAnswerInSentence(item.example, item.exampleForm ?? item.word) ?? `${item.meaning}：______`;
}

function highlightedExample(item: WordItem) {
  const form = item.exampleForm ?? item.word;
  const escaped = form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(escaped, "gi");
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(item.example))) {
    const start = match.index;
    const end = start + match[0].length;
    const before = start > 0 ? item.example[start - 1] : "";
    const after = end < item.example.length ? item.example[end] : "";
    if (/[A-Za-z]/.test(before) || /[A-Za-z]/.test(after)) continue;
    if (start > lastIndex) parts.push(item.example.slice(lastIndex, start));
    parts.push(<mark key={`${start}-${match[0]}`}>{match[0]}</mark>);
    lastIndex = end;
  }
  if (lastIndex === 0) return item.example;
  if (lastIndex < item.example.length) parts.push(item.example.slice(lastIndex));
  return parts;
}

export default function Home() {
  const [wordData, setWordData] = useState<WordData | null>(null);
  const [wordDataLoadError, setWordDataLoadError] = useState(false);
  const [wordDataLoadAttempt, setWordDataLoadAttempt] = useState(0);
  const [wordDataLoadedPacks, setWordDataLoadedPacks] = useState(0);
  const words = wordData?.words ?? EMPTY_WORDS;
  const allStudyWords = wordData?.allStudyWords ?? EMPTY_WORDS;
  const sceneExtras = wordData?.sceneExtras ?? EMPTY_WORDS;
  const scenePacks = wordData?.scenePacks ?? EMPTY_SCENE_PACKS;
  const ngslMeta = wordData?.ngslMeta ?? EMPTY_NGSL_META;
  const [tab, setTab] = useState<Tab>("home");
  const [learnStage, setLearnStage] = useState<LearnStage>("setup");
  const [preferences, setPreferences] = useState<SessionPreferences>({ mode: "test", count: 10, path: "frequency" });
  const { mode, count, path } = preferences;
  const [sessionMode, setSessionMode] = useState<LearnMode>("test");
  const [wordSessionKind, setWordSessionKind] = useState<"group" | "lookup">("group");
  const [sessionPath, setSessionPath] = useState<LearnPath>("frequency");
  const [sessionWords, setSessionWords] = useState<WordItem[]>([]);
  const [index, setIndex] = useState(0);
  const [cardRatings, setCardRatings] = useState<Record<number, CardRating>>({});
  const [mastered, setMastered] = useState<number[]>([]);
  const [difficult, setDifficult] = useState<number[]>([]);
  const [schedule, setSchedule] = useState<Record<number, ScheduleEntry>>({});
  const [studyDays, setStudyDays] = useState<string[]>([]);
  const [quizIndex, setQuizIndex] = useState(0);
  const [quizAnswer, setQuizAnswer] = useState("");
  const [quizFeedback, setQuizFeedback] = useState<"correct" | "wrong" | null>(null);
  const [quizResults, setQuizResults] = useState<boolean[]>([]);
  const [readings, setReadings] = useState<ReadingItem[]>([]);
  const [readingQuestions, setReadingQuestions] = useState<Record<string, ReadingQuestion>>({});
  const [readingAnswers, setReadingAnswers] = useState<Record<string, number>>({});
  const [readingRetryId, setReadingRetryId] = useState<string | null>(null);
  const [readingLoadError, setReadingLoadError] = useState(false);
  const [readingLoadAttempt, setReadingLoadAttempt] = useState(0);
  const [readingLevel, setReadingLevel] = useState<1 | 2 | 3>(1);
  const [readingFilter, setReadingFilter] = useState<"all" | "unread" | "review">("all");
  const [readingId, setReadingId] = useState<string | null>(null);
  const [readingCompleted, setReadingCompleted] = useState<string[]>([]);
  const [readingLast, setReadingLast] = useState<ReadingLast | null>(null);
  const [readingSpeechState, setReadingSpeechState] = useState<SpeechPlaybackState>("idle");
  const [readingSpeechRate, setReadingSpeechRate] = useState<(typeof READING_SPEECH_RATES)[number]["value"]>(0.8);
  const [showTranslation, setShowTranslation] = useState(false);
  const [sentenceBand, setSentenceBand] = useState<SentenceBand>("short");
  const [sentenceCategory, setSentenceCategory] = useState<SentenceCategory>("all");
  const [sentenceCount, setSentenceCount] = useState<10 | 20>(10);
  const [sentenceMode, setSentenceMode] = useState<SentenceLearningMode>("bilingual");
  const [sentenceSection, setSentenceSection] = useState<SentenceSection>("library");
  const [sentenceStage, setSentenceStage] = useState<SentenceStage>("setup");
  const [sentenceSearch, setSentenceSearch] = useState("");
  const [sentenceSavedOnly, setSentenceSavedOnly] = useState(false);
  const [sentenceReviewOnly, setSentenceReviewOnly] = useState(false);
  const [sentenceIndex, setSentenceIndex] = useState(0);
  const [sentenceSessionIds, setSentenceSessionIds] = useState<number[]>([]);
  const [sentenceRatings, setSentenceRatings] = useState<Record<number, SentenceRating>>({});
  const [sentenceTranslationOpen, setSentenceTranslationOpen] = useState(false);
  const [sentenceSaved, setSentenceSaved] = useState<number[]>([]);
  const [sentenceSeen, setSentenceSeen] = useState<number[]>([]);
  const [sentenceMastered, setSentenceMastered] = useState<number[]>([]);
  const [sentenceDifficult, setSentenceDifficult] = useState<number[]>([]);
  const [sentencePacks, setSentencePacks] = useState<Partial<Record<1 | 2 | 3, SentenceItem[]>>>({});
  const [sentenceLoadError, setSentenceLoadError] = useState(false);
  const [sentenceLoadAttempt, setSentenceLoadAttempt] = useState(0);
  const [sentenceResultLimit, setSentenceResultLimit] = useState(30);
  const [patternCategory, setPatternCategory] = useState<"all" | PatternCategory>("all");
  const [patternStage, setPatternStage] = useState<PatternStage>("setup");
  const [patternSessionIds, setPatternSessionIds] = useState<string[]>([]);
  const [patternIndex, setPatternIndex] = useState(0);
  const [patternDrillIndex, setPatternDrillIndex] = useState(0);
  const [patternAnswerOpen, setPatternAnswerOpen] = useState(false);
  const [patternRatings, setPatternRatings] = useState<Record<string, PatternRating>>({});
  const [patternMastered, setPatternMastered] = useState<string[]>([]);
  const [patternDifficult, setPatternDifficult] = useState<string[]>([]);
  const [reviewView, setReviewView] = useState<"due" | "wordbook">("due");
  const [reviewIndex, setReviewIndex] = useState(0);
  const [reviewRevealedWordId, setReviewRevealedWordId] = useState<number | null>(null);
  const [reviewUndo, setReviewUndo] = useState<ReviewUndo | null>(null);
  const [installOpen, setInstallOpen] = useState(false);
  const [discardRequest, setDiscardRequest] = useState<DiscardRequest | null>(null);
  const [resetProgressOpen, setResetProgressOpen] = useState(false);
  const [pendingBackup, setPendingBackup] = useState<LearningBackup<StorageKey> | null>(null);
  const [backupNotice, setBackupNotice] = useState<BackupNotice | null>(null);
  const [backupBusy, setBackupBusy] = useState<"read" | "export" | "restore" | null>(null);
  const [networkOnline, setNetworkOnline] = useState(true);
  const [storageWriteError, setStorageWriteError] = useState(false);
  const [offlineCacheWriteError, setOfflineCacheWriteError] = useState(false);
  const [speechNotice, setSpeechNotice] = useState<string | null>(null);
  const [statusToastHeight, setStatusToastHeight] = useState(0);
  const [externalUpdateDetected, setExternalUpdateDetected] = useState(false);
  const [librarySearch, setLibrarySearch] = useState("");
  const [libraryBand, setLibraryBand] = useState<1 | 2 | 3>(1);
  const [libraryLimit, setLibraryLimit] = useState(24);
  const [standalone, setStandalone] = useState(false);
  const [iosInstallAvailable, setIosInstallAvailable] = useState(false);
  const [dateText, setDateText] = useState("");
  const [todayKey, setTodayKey] = useState("");
  const [weekKeys, setWeekKeys] = useState<string[]>([]);
  const [reviewClock, setReviewClock] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const activeDialog = externalUpdateDetected ? "sync" : pendingBackup ? "restore" : resetProgressOpen ? "reset" : discardRequest ? "discard" : installOpen ? "install" : null;
  const hasOpenDialog = activeDialog !== null;
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const cardActionLock = useRef(false);
  const sentenceActionLock = useRef(false);
  const patternActionLock = useRef(false);
  const quizActionLock = useRef({ submitted: -1, advanced: -1 });
  const reviewActionLock = useRef(false);
  const quizInputRef = useRef<HTMLInputElement | null>(null);
  const quizNextRef = useRef<HTMLButtonElement | null>(null);
  const installCloseRef = useRef<HTMLButtonElement | null>(null);
  const installSheetRef = useRef<HTMLDivElement | null>(null);
  const discardCancelRef = useRef<HTMLButtonElement | null>(null);
  const discardDialogRef = useRef<HTMLDivElement | null>(null);
  const resetCancelRef = useRef<HTMLButtonElement | null>(null);
  const resetDialogRef = useRef<HTMLDivElement | null>(null);
  const restoreCancelRef = useRef<HTMLButtonElement | null>(null);
  const restoreDialogRef = useRef<HTMLDivElement | null>(null);
  const syncReloadRef = useRef<HTMLButtonElement | null>(null);
  const syncDialogRef = useRef<HTMLDivElement | null>(null);
  const sentenceAnswerRef = useRef<HTMLDivElement | null>(null);
  const patternAnswerRef = useRef<HTMLDivElement | null>(null);
  const readingFeedbackRef = useRef<HTMLDivElement | null>(null);
  const readingQuestionOptionsRef = useRef<HTMLDivElement | null>(null);
  const readingHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const readingListRef = useRef<HTMLDivElement | null>(null);
  const readingReturnIdRef = useRef<string | null>(null);
  const readingFeedbackStateRef = useRef<{ id: string | null; answer: number | undefined }>({ id: null, answer: undefined });
  const reviewAnswerRef = useRef<HTMLDivElement | null>(null);
  const reviewHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const wordHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const wordBrowserRef = useRef<HTMLDivElement | null>(null);
  const wordBrowserOriginRef = useRef<BrowserOrigin | null>(null);
  const wordBrowserReturnRef = useRef(false);
  const sentenceBrowserRef = useRef<HTMLDivElement | null>(null);
  const sentenceBrowserOriginRef = useRef<BrowserOrigin | null>(null);
  const resultPrimaryRef = useRef<HTMLButtonElement | null>(null);
  const backupInputRef = useRef<HTMLInputElement | null>(null);
  const backupActionLock = useRef(false);
  const backupReadRequestRef = useRef(0);
  const statusToastRef = useRef<HTMLDivElement | null>(null);
  const sentenceResumeSnapshotRef = useRef<SentenceSessionSnapshot | null>(null);
  const patternResumeSnapshotRef = useRef<PatternSessionSnapshot | null>(null);
  const activeSessionResumeSnapshotRef = useRef<ActiveSessionSnapshot | null>(null);
  const sentenceSetupPreferencesRef = useRef<SentencePreferences>({ band: "short", category: "all", count: 10, mode: "bilingual" });
  const patternSetupCategoryRef = useRef<"all" | PatternCategory>("all");
  const practiceRotationRef = useRef<PracticeRotation>({ word: 0, sentence: 0, pattern: 0 });

  useEffect(() => {
    const showStorageError = () => setStorageWriteError(true);
    window.addEventListener(STORAGE_ERROR_EVENT, showStorageError);
    return () => window.removeEventListener(STORAGE_ERROR_EVENT, showStorageError);
  }, []);

  useEffect(() => {
    const showOfflineCacheError = () => setOfflineCacheWriteError(true);
    window.addEventListener(OFFLINE_CACHE_ERROR_EVENT, showOfflineCacheError);
    return () => window.removeEventListener(OFFLINE_CACHE_ERROR_EVENT, showOfflineCacheError);
  }, []);

  useEffect(() => {
    const stack = statusToastRef.current;
    if (!stack) return;
    const measure = () => setStatusToastHeight(Math.ceil(stack.getBoundingClientRect().height));
    const frame = window.requestAnimationFrame(measure);
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    observer?.observe(stack);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [hydrated, networkOnline, offlineCacheWriteError, speechNotice]);

  useEffect(() => {
    const handleSpeechPlayback = (event: Event) => {
      setReadingSpeechState((event as CustomEvent<SpeechPlaybackState>).detail ?? "idle");
    };
    const handleSpeechError = () => {
      setSpeechNotice("系统英文语音没有成功播放，请检查设备静音设置，或改用最新版 Safari、Chrome 或 Edge。");
    };
    window.addEventListener(SPEECH_PLAYBACK_EVENT, handleSpeechPlayback);
    window.addEventListener(SPEECH_ERROR_EVENT, handleSpeechError);
    return () => {
      window.removeEventListener(SPEECH_PLAYBACK_EVENT, handleSpeechPlayback);
      window.removeEventListener(SPEECH_ERROR_EVENT, handleSpeechError);
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const handleExternalStorageUpdate = (event: StorageEvent) => {
      if (event.storageArea && event.storageArea !== window.localStorage) return;
      if (event.key !== null && !STORAGE_KEYS.includes(event.key as StorageKey)) return;
      stopSpeech();
      setExternalUpdateDetected(true);
    };
    window.addEventListener("storage", handleExternalStorageUpdate);
    return () => window.removeEventListener("storage", handleExternalStorageUpdate);
  }, [hydrated]);

  useEffect(() => {
    const handleOnline = () => {
      setNetworkOnline(true);
      if (wordDataLoadError) {
        setWordDataLoadError(false);
        setWordDataLoadAttempt((value) => value + 1);
      }
      if (readingLoadError) {
        setReadingLoadError(false);
        setReadingLoadAttempt((value) => value + 1);
      }
      if (sentenceLoadError) {
        setSentenceLoadError(false);
        setSentenceLoadAttempt((value) => value + 1);
      }
    };
    const handleOffline = () => setNetworkOnline(false);
    const initialStatus = window.setTimeout(() => setNetworkOnline(navigator.onLine), 0);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.clearTimeout(initialStatus);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [readingLoadError, sentenceLoadError, wordDataLoadError]);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.addEventListener("controllerchange", cacheLoadedPageAssets);
    navigator.serviceWorker.register("/sw.js").then(cacheLoadedPageAssets).catch(() => undefined);
    return () => navigator.serviceWorker.removeEventListener("controllerchange", cacheLoadedPageAssets);
  }, []);

  useEffect(() => {
    let active = true;
    import("./word-data").then(({ loadWordData }) => loadWordData((loaded) => {
      if (active) setWordDataLoadedPacks(loaded);
    })).then((loadedWordData) => {
      if (!active) return;
      STUDY_WORD_IDS = new Set(loadedWordData.allStudyWords.map((word) => word.id));
      STUDY_WORD_BY_ID = new Map(loadedWordData.allStudyWords.map((word) => [word.id, word]));
      setWordDataLoadError(false);
      setWordData(loadedWordData);
    }).catch(() => {
      if (active) setWordDataLoadError(true);
    });
    return () => { active = false; };
  }, [wordDataLoadAttempt]);

  useEffect(() => {
    if (tab !== "read" || readings.length) return;
    let active = true;
    import("./reading-data").then(({ readings: loadedReadings, readingQuestions: loadedQuestions }) => {
      if (!active) return;
      setReadings(loadedReadings);
      setReadingQuestions(loadedQuestions);
      setReadingLoadError(false);
    }).catch(() => {
      if (active) setReadingLoadError(true);
    });
    return () => { active = false; };
  }, [readingLoadAttempt, readings.length, tab]);

  useEffect(() => {
    if (!wordData || !STUDY_WORD_IDS.size) return;
    // Client-only local progress is hydrated after the initial static render.
    const today = new Date();
    const currentKey = localDateKey(today);
    const storedDays = readJson<unknown>(STORAGE.days, []);
    // A time-zone or clock change can make a real study day temporarily appear
    // to be tomorrow. Preserve it in storage; only the display filters by today.
    const validDays = Array.isArray(storedDays) ? [...new Set(storedDays.filter(isValidStudyDate))].sort() : [];
    const storedMastered = readJson<unknown>(STORAGE.mastered, []);
    const storedDifficult = readJson<unknown>(STORAGE.difficult, []);
    const validDifficult = cleanStoredWordIds(storedDifficult);
    const difficultIds = new Set(validDifficult);
    const validMastered = cleanStoredWordIds(storedMastered).filter((id) => !difficultIds.has(id));
    const storedSchedule = readJson<unknown>(STORAGE.schedule, {});
    const validSchedule = cleanStoredSchedule(storedSchedule);
    const storedReadingCompleted = readJson<unknown>(STORAGE.readingCompleted, []);
    const validReadingCompleted = cleanReadingIds(storedReadingCompleted);
    const storedReadingLast = readJson<unknown>(STORAGE.readingLast, null);
    const validReadingLast = cleanReadingLast(storedReadingLast);
    const validReadingAnswers = cleanReadingAnswers(readJson<unknown>(STORAGE.readingAnswers, {}));
    const validSentenceSaved = cleanSentenceIds(readJson<unknown>(STORAGE.sentenceSaved, []));
    const validSentenceSeen = cleanSentenceIds(readJson<unknown>(STORAGE.sentenceSeen, []));
    const validSentenceDifficult = cleanSentenceIds(readJson<unknown>(STORAGE.sentenceDifficult, []));
    const sentenceDifficultIds = new Set(validSentenceDifficult);
    const validSentenceMastered = cleanSentenceIds(readJson<unknown>(STORAGE.sentenceMastered, [])).filter((id) => !sentenceDifficultIds.has(id));
    const storedSentencePreferencesValue = readJson<unknown>(STORAGE.sentencePreferences, {});
    const storedSentencePreferences = storedSentencePreferencesValue && typeof storedSentencePreferencesValue === "object" && !Array.isArray(storedSentencePreferencesValue) ? storedSentencePreferencesValue as { band?: unknown; category?: unknown; count?: unknown; mode?: unknown } : {};
    const normalizedSentenceBand: SentenceBand = isSentenceBand(storedSentencePreferences.band) ? storedSentencePreferences.band : "short";
    const normalizedSentenceCategory: SentenceCategory = isSentenceCategory(storedSentencePreferences.category) ? storedSentencePreferences.category : "all";
    const normalizedSentenceCount: 10 | 20 = storedSentencePreferences.count === 20 ? 20 : 10;
    const normalizedSentenceMode: SentenceLearningMode = isSentenceLearningMode(storedSentencePreferences.mode) ? storedSentencePreferences.mode : "bilingual";
    const normalizedSentencePreferences = { band: normalizedSentenceBand, category: normalizedSentenceCategory, count: normalizedSentenceCount, mode: normalizedSentenceMode };
    sentenceSetupPreferencesRef.current = normalizedSentencePreferences;
    const storedSentenceActiveSession = cleanSentenceSession(readJson<unknown>(STORAGE.sentenceActiveSession, null));
    const validPatternDifficult = cleanPatternIds(readJson<unknown>(STORAGE.patternDifficult, []));
    const patternDifficultIds = new Set(validPatternDifficult);
    const validPatternMastered = cleanPatternIds(readJson<unknown>(STORAGE.patternMastered, [])).filter((id) => !patternDifficultIds.has(id));
    const storedPatternActiveSession = cleanPatternSession(readJson<unknown>(STORAGE.patternActiveSession, null));
    const storedPracticeRotation = cleanPracticeRotation(readJson<unknown>(STORAGE.practiceRotation, null));
    practiceRotationRef.current = storedPracticeRotation;
    const preferredSentenceSection: SentenceSection = storedPatternActiveSession && (!storedSentenceActiveSession || storedPatternActiveSession.updatedAt > storedSentenceActiveSession.updatedAt) ? "patterns" : "library";
    const storedSessionValue = readJson<unknown>(STORAGE.session, {});
    const storedSession = storedSessionValue && typeof storedSessionValue === "object" && !Array.isArray(storedSessionValue) ? storedSessionValue as Partial<SessionPreferences> : {};
    const storedPath: LearnPath = isLearnPath(storedSession.path) ? storedSession.path : "frequency";
    const storedMode = storedSession.mode === "free" ? "free" : "test";
    const storedCount = storedSession.count === 20 ? 20 : 10;
    const normalizedSession: SessionPreferences = { mode: storedMode, count: storedCount, path: storedPath };
    const storedActiveSession = cleanActiveSession(readJson<unknown>(STORAGE.activeSession, null));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMastered(validMastered);
    setDifficult(validDifficult);
    setSchedule(validSchedule);
    setStudyDays(validDays);
    setReadingCompleted(validReadingCompleted);
    setReadingLast(validReadingLast);
    setReadingAnswers(validReadingAnswers);
    setSentenceSaved(validSentenceSaved);
    setSentenceSeen(validSentenceSeen);
    setSentenceMastered(validSentenceMastered);
    setSentenceDifficult(validSentenceDifficult);
    setSentenceBand(storedSentenceActiveSession?.band ?? normalizedSentenceBand);
    setSentenceCategory(storedSentenceActiveSession?.category ?? normalizedSentenceCategory);
    setSentenceCount(storedSentenceActiveSession?.count ?? normalizedSentenceCount);
    setSentenceMode(storedSentenceActiveSession?.mode ?? normalizedSentenceMode);
    setPatternMastered(validPatternMastered);
    setPatternDifficult(validPatternDifficult);
    if (storedSentenceActiveSession) {
      sentenceResumeSnapshotRef.current = storedSentenceActiveSession;
      setSentenceSessionIds(storedSentenceActiveSession.sentenceIds);
      setSentenceIndex(storedSentenceActiveSession.index);
      setSentenceRatings(storedSentenceActiveSession.ratings);
      setSentenceTranslationOpen(false);
      setSentenceStage("cards");
    } else {
      removeStoredValue(STORAGE.sentenceActiveSession);
    }
    if (storedPatternActiveSession) {
      patternResumeSnapshotRef.current = storedPatternActiveSession;
      setPatternCategory(storedPatternActiveSession.category);
      patternSetupCategoryRef.current = storedPatternActiveSession.category;
      setPatternSessionIds(storedPatternActiveSession.patternIds);
      setPatternIndex(storedPatternActiveSession.index);
      setPatternDrillIndex(storedPatternActiveSession.drillIndex);
      setPatternRatings(storedPatternActiveSession.ratings);
      setPatternAnswerOpen(false);
      setPatternStage("cards");
    } else {
      removeStoredValue(STORAGE.patternActiveSession);
    }
    setSentenceSection(preferredSentenceSection);
    setSessionPath(storedPath);
    setPreferences(normalizedSession);
    if (storedActiveSession) {
      activeSessionResumeSnapshotRef.current = storedActiveSession;
      const restoredWords = storedActiveSession.wordIds.map((id) => STUDY_WORD_BY_ID.get(id)).filter((word): word is WordItem => Boolean(word));
      setSessionWords(restoredWords);
      setIndex(storedActiveSession.index);
      setCardRatings(storedActiveSession.ratings);
      setSessionMode(storedActiveSession.mode);
      setWordSessionKind(storedActiveSession.kind ?? (storedActiveSession.mode === "free" && restoredWords.length === 1 ? "lookup" : "group"));
      setSessionPath(storedActiveSession.path);
      setQuizIndex(storedActiveSession.quizIndex);
      setQuizAnswer(storedActiveSession.quizAnswer);
      setQuizFeedback(storedActiveSession.quizFeedback);
      setQuizResults(storedActiveSession.quizResults);
      setLearnStage(storedActiveSession.stage);
    } else {
      activeSessionResumeSnapshotRef.current = null;
      removeStoredValue(STORAGE.activeSession);
      setSessionWords(words.slice(0, normalizedSession.count));
    }
    const latestSession = [
      storedActiveSession && { kind: "word" as const, updatedAt: storedActiveSession.updatedAt },
      storedSentenceActiveSession && { kind: "sentence" as const, updatedAt: storedSentenceActiveSession.updatedAt },
      storedPatternActiveSession && { kind: "pattern" as const, updatedAt: storedPatternActiveSession.updatedAt },
    ].filter((item): item is { kind: "word" | "sentence" | "pattern"; updatedAt: number } => Boolean(item))
      .sort((left, right) => right.updatedAt - left.updatedAt)[0];
    if (latestSession?.kind === "word") setTab("learn");
    else if (latestSession?.kind === "sentence") { setSentenceSection("library"); setTab("sentences"); }
    else if (latestSession?.kind === "pattern") { setSentenceSection("patterns"); setTab("sentences"); }
    if (JSON.stringify(storedDays) !== JSON.stringify(validDays)) writeJson(STORAGE.days, validDays);
    if (JSON.stringify(storedMastered) !== JSON.stringify(validMastered)) writeJson(STORAGE.mastered, validMastered);
    if (JSON.stringify(storedDifficult) !== JSON.stringify(validDifficult)) writeJson(STORAGE.difficult, validDifficult);
    if (JSON.stringify(storedSchedule) !== JSON.stringify(validSchedule)) writeJson(STORAGE.schedule, validSchedule);
    if (JSON.stringify(storedReadingCompleted) !== JSON.stringify(validReadingCompleted)) writeJson(STORAGE.readingCompleted, validReadingCompleted);
    if (JSON.stringify(storedReadingLast) !== JSON.stringify(validReadingLast)) {
      if (validReadingLast) writeJson(STORAGE.readingLast, validReadingLast);
      else removeStoredValue(STORAGE.readingLast);
    }
    if (JSON.stringify(storedSessionValue) !== JSON.stringify(normalizedSession)) writeJson(STORAGE.session, normalizedSession);
    if (JSON.stringify(storedSentencePreferencesValue) !== JSON.stringify(normalizedSentencePreferences)) writeJson(STORAGE.sentencePreferences, normalizedSentencePreferences);
    if (JSON.stringify(readJson<unknown>(STORAGE.sentenceMastered, [])) !== JSON.stringify(validSentenceMastered)) writeJson(STORAGE.sentenceMastered, validSentenceMastered);
    if (JSON.stringify(readJson<unknown>(STORAGE.sentenceDifficult, [])) !== JSON.stringify(validSentenceDifficult)) writeJson(STORAGE.sentenceDifficult, validSentenceDifficult);
    if (JSON.stringify(readJson<unknown>(STORAGE.patternMastered, [])) !== JSON.stringify(validPatternMastered)) writeJson(STORAGE.patternMastered, validPatternMastered);
    if (JSON.stringify(readJson<unknown>(STORAGE.patternDifficult, [])) !== JSON.stringify(validPatternDifficult)) writeJson(STORAGE.patternDifficult, validPatternDifficult);
    if (JSON.stringify(readJson<unknown>(STORAGE.practiceRotation, null)) !== JSON.stringify(storedPracticeRotation)) writeJson(STORAGE.practiceRotation, storedPracticeRotation);
    setStandalone(window.matchMedia("(display-mode: standalone)").matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
    setIosInstallAvailable(/iP(?:hone|ad|od)/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
    setDateText(new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric" }).format(today).toUpperCase());
    setTodayKey(currentKey);
    setWeekKeys(weekDateKeys(today));
    setHydrated(true);
    let displayedDateKey = currentKey;
    const refreshClocks = () => {
      const current = new Date();
      const nextDateKey = localDateKey(current);
      setReviewClock(current.getTime());
      if (nextDateKey !== displayedDateKey) {
        displayedDateKey = nextDateKey;
        setTodayKey(nextDateKey);
        setDateText(new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric" }).format(current).toUpperCase());
        setWeekKeys(weekDateKeys(current));
      }
    };
    const refreshWhenVisible = () => {
      if (document.hidden) {
        stopSpeech();
        return;
      }
      refreshClocks();
    };
    const reviewTimer = window.setInterval(refreshClocks, 30_000);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(reviewTimer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [wordData, words]);

  useEffect(() => {
    if (!hydrated || externalUpdateDetected) return;
    writeJson(STORAGE.mastered, mastered);
    writeJson(STORAGE.difficult, difficult);
    writeJson(STORAGE.schedule, schedule);
    writeJson(STORAGE.days, studyDays);
    writeJson(STORAGE.session, preferences);
  }, [difficult, externalUpdateDetected, hydrated, mastered, preferences, schedule, studyDays]);

  useEffect(() => {
    if (!hydrated || externalUpdateDetected) return;
    writeJson(STORAGE.readingCompleted, readingCompleted);
    writeJson(STORAGE.readingAnswers, readingAnswers);
    if (readingLast) writeJson(STORAGE.readingLast, readingLast);
    else removeStoredValue(STORAGE.readingLast);
  }, [externalUpdateDetected, hydrated, readingAnswers, readingCompleted, readingLast]);

  useEffect(() => {
    if (!hydrated || externalUpdateDetected) return;
    writeJson(STORAGE.sentenceSaved, sentenceSaved);
    writeJson(STORAGE.sentenceSeen, sentenceSeen);
    writeJson(STORAGE.sentenceMastered, sentenceMastered);
    writeJson(STORAGE.sentenceDifficult, sentenceDifficult);
    if (sentenceStage === "setup") {
      const nextPreferences = { band: sentenceBand, category: sentenceCategory, count: sentenceCount, mode: sentenceMode } satisfies SentencePreferences;
      sentenceSetupPreferencesRef.current = nextPreferences;
      writeJson(STORAGE.sentencePreferences, nextPreferences);
    }
  }, [externalUpdateDetected, hydrated, sentenceBand, sentenceCategory, sentenceCount, sentenceDifficult, sentenceMastered, sentenceMode, sentenceSaved, sentenceSeen, sentenceStage]);

  useEffect(() => {
    if (!hydrated || externalUpdateDetected) return;
    writeJson(STORAGE.patternMastered, patternMastered);
    writeJson(STORAGE.patternDifficult, patternDifficult);
  }, [externalUpdateDetected, hydrated, patternDifficult, patternMastered]);

  useEffect(() => {
    if (!hydrated || externalUpdateDetected) return;
    if (sentenceStage === "cards" && sentenceSessionIds.length) {
      const payload = {
        version: 1,
        band: sentenceBand,
        category: sentenceCategory,
        count: sentenceCount,
        mode: sentenceMode,
        sentenceIds: sentenceSessionIds,
        index: sentenceIndex,
        ratings: sentenceRatings,
      } satisfies Omit<SentenceSessionSnapshot, "updatedAt">;
      const previous = sentenceResumeSnapshotRef.current;
      const snapshot = { ...payload, updatedAt: sessionPayloadMatches(previous, payload) ? previous!.updatedAt : Date.now() } satisfies SentenceSessionSnapshot;
      sentenceResumeSnapshotRef.current = snapshot;
      writeJson(STORAGE.sentenceActiveSession, snapshot);
    } else if (!sentenceSessionIds.length || sentenceStage === "result") {
      sentenceResumeSnapshotRef.current = null;
      removeStoredValue(STORAGE.sentenceActiveSession);
    }
  }, [externalUpdateDetected, hydrated, sentenceBand, sentenceCategory, sentenceCount, sentenceIndex, sentenceMode, sentenceRatings, sentenceSection, sentenceSessionIds, sentenceStage]);

  useEffect(() => {
    if (!hydrated || externalUpdateDetected) return;
    if (patternStage === "cards" && patternSessionIds.length) {
      const payload = {
        version: 1,
        category: patternCategory,
        patternIds: patternSessionIds,
        index: patternIndex,
        drillIndex: patternDrillIndex,
        ratings: patternRatings,
      } satisfies Omit<PatternSessionSnapshot, "updatedAt">;
      const previous = patternResumeSnapshotRef.current;
      const snapshot = { ...payload, updatedAt: sessionPayloadMatches(previous, payload) ? previous!.updatedAt : Date.now() } satisfies PatternSessionSnapshot;
      patternResumeSnapshotRef.current = snapshot;
      writeJson(STORAGE.patternActiveSession, snapshot);
    } else if (!patternSessionIds.length || patternStage === "result") {
      patternResumeSnapshotRef.current = null;
      removeStoredValue(STORAGE.patternActiveSession);
    }
  }, [externalUpdateDetected, hydrated, patternCategory, patternDrillIndex, patternIndex, patternRatings, patternSessionIds, patternStage, sentenceSection]);

  useEffect(() => {
    if (tab !== "sentences" || sentenceSection !== "library") return;
    let active = true;
    const packs: (1 | 2 | 3)[] = sentenceStage === "cards" ? [SENTENCE_PACK_BY_BAND[sentenceBand]] : sentenceSearch.trim() || sentenceSavedOnly || sentenceReviewOnly ? [1, 2, 3] : [SENTENCE_PACK_BY_BAND[sentenceBand]];
    import("./sentence-data").then(({ loadSentencePack }) => Promise.allSettled(packs.map((pack) => loadSentencePack(pack).then((items) => [pack, items] as const))))
      .then((results) => {
        if (!active) return;
        const loaded = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
        if (loaded.length) setSentencePacks((current) => ({ ...current, ...Object.fromEntries(loaded) }));
        setSentenceLoadError(results.some((result) => result.status === "rejected"));
      }).catch(() => {
        if (active) setSentenceLoadError(true);
      });
    return () => { active = false; };
  }, [sentenceBand, sentenceLoadAttempt, sentenceReviewOnly, sentenceSavedOnly, sentenceSearch, sentenceSection, sentenceStage, tab]);

  useEffect(() => {
    if (!hydrated || externalUpdateDetected) return;
    if (learnStage === "cards" || learnStage === "quiz") {
      const payload = {
        version: 1,
        kind: wordSessionKind,
        path: sessionPath,
        mode: sessionMode,
        wordIds: sessionWords.map((word) => word.id),
        index,
        ratings: cardRatings,
        stage: learnStage,
        quizIndex,
        quizAnswer,
        quizFeedback,
        quizResults,
      } satisfies Omit<ActiveSessionSnapshot, "updatedAt">;
      const previous = activeSessionResumeSnapshotRef.current;
      const snapshot = { ...payload, updatedAt: sessionPayloadMatches(previous, payload) ? previous!.updatedAt : Date.now() } satisfies ActiveSessionSnapshot;
      activeSessionResumeSnapshotRef.current = snapshot;
      writeJson(STORAGE.activeSession, snapshot);
    } else {
      activeSessionResumeSnapshotRef.current = null;
      removeStoredValue(STORAGE.activeSession);
    }
  }, [cardRatings, externalUpdateDetected, hydrated, index, learnStage, quizAnswer, quizFeedback, quizIndex, quizResults, sessionMode, sessionPath, sessionWords, wordSessionKind]);

  useEffect(() => {
    if (!hasOpenDialog) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [hasOpenDialog]);

  useEffect(() => {
    if (!activeDialog) return;
    const dialog = activeDialog === "sync" ? syncDialogRef.current
      : activeDialog === "restore" ? restoreDialogRef.current
        : activeDialog === "reset" ? resetDialogRef.current
          : activeDialog === "discard" ? discardDialogRef.current : installSheetRef.current;
    const focusInitial = () => {
      if (activeDialog === "sync") syncReloadRef.current?.focus();
      else if (activeDialog === "restore") restoreCancelRef.current?.focus();
      else if (activeDialog === "reset") resetCancelRef.current?.focus();
      else if (activeDialog === "discard") discardCancelRef.current?.focus();
      else installCloseRef.current?.focus();
      if (dialog && !dialog.contains(document.activeElement)) dialog.focus({ preventScroll: true });
    };
    const handleDialogKeys = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (activeDialog === "restore") { if (!backupActionLock.current) setPendingBackup(null); }
        else if (activeDialog === "reset") setResetProgressOpen(false);
        else if (activeDialog === "discard") setDiscardRequest(null);
        else if (activeDialog === "install") setInstallOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(dialog?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? [])];
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) { event.preventDefault(); dialog?.focus(); return; }
      const focusOutside = !dialog?.contains(document.activeElement);
      if (event.shiftKey && (focusOutside || document.activeElement === first)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (focusOutside || document.activeElement === last)) { event.preventDefault(); first.focus(); }
    };
    const keepDialogFocused = (event: FocusEvent) => {
      if (dialog?.isConnected && event.target instanceof Node && !dialog.contains(event.target)) focusInitial();
    };
    document.addEventListener("keydown", handleDialogKeys);
    document.addEventListener("focusin", keepDialogFocused);
    focusInitial();
    return () => {
      document.removeEventListener("keydown", handleDialogKeys);
      document.removeEventListener("focusin", keepDialogFocused);
    };
  }, [activeDialog]);

  useEffect(() => {
    if (hasOpenDialog || tab !== "learn" || learnStage !== "quiz") return;
    const frame = window.requestAnimationFrame(() => {
      if (quizFeedback) quizNextRef.current?.focus({ preventScroll: true });
      else quizInputRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [hasOpenDialog, learnStage, quizFeedback, quizIndex, tab]);

  useEffect(() => {
    const visibleResult = (tab === "learn" && learnStage === "result")
      || (tab === "sentences" && sentenceSection === "library" && sentenceStage === "result")
      || (tab === "sentences" && sentenceSection === "patterns" && patternStage === "result");
    if (hasOpenDialog || !visibleResult) return;
    const frame = window.requestAnimationFrame(() => resultPrimaryRef.current?.focus({ preventScroll: true }));
    return () => window.cancelAnimationFrame(frame);
  }, [hasOpenDialog, learnStage, patternStage, sentenceSection, sentenceStage, tab]);

  useEffect(() => {
    if (!speechNotice) return;
    const timeout = window.setTimeout(() => setSpeechNotice(null), 6_000);
    return () => window.clearTimeout(timeout);
  }, [speechNotice]);

  useEffect(() => {
    if (!hasOpenDialog && sentenceStage === "cards" && sentenceMode === "speak" && sentenceTranslationOpen) {
      sentenceAnswerRef.current?.focus({ preventScroll: true });
    }
  }, [hasOpenDialog, sentenceMode, sentenceStage, sentenceTranslationOpen]);

  useEffect(() => {
    if (!hasOpenDialog && patternStage === "cards" && patternAnswerOpen) patternAnswerRef.current?.focus({ preventScroll: true });
  }, [hasOpenDialog, patternAnswerOpen, patternStage]);

  useEffect(() => {
    if (!hydrated) return;
    const frame = window.requestAnimationFrame(() => {
      const origin = sentenceBrowserOriginRef.current;
      if (tab === "learn" && learnStage === "setup" && wordBrowserReturnRef.current) {
        wordBrowserReturnRef.current = false;
        const wordOrigin = wordBrowserOriginRef.current;
        wordBrowserOriginRef.current = null;
        const list = wordBrowserRef.current?.querySelector<HTMLDivElement>(".library-list");
        if (list) list.scrollTop = wordOrigin?.listScrollTop ?? 0;
        if (wordOrigin) window.scrollTo({ top: wordOrigin.scrollY, left: 0, behavior: "auto" });
        else wordBrowserRef.current?.scrollIntoView({ block: "start", behavior: "auto" });
        const previousWord = wordOrigin ? wordBrowserRef.current?.querySelector<HTMLButtonElement>(`button[data-word-id="${wordOrigin.id}"]`) : null;
        (previousWord ?? wordBrowserRef.current)?.focus({ preventScroll: true });
      } else if (tab === "sentences" && sentenceSection === "library" && sentenceStage === "setup" && origin) {
        sentenceBrowserOriginRef.current = null;
        const list = sentenceBrowserRef.current?.querySelector<HTMLDivElement>(".sentence-result-list");
        if (list) list.scrollTop = origin.listScrollTop;
        window.scrollTo({ top: origin.scrollY, left: 0, behavior: "auto" });
        const previousSentence = sentenceBrowserRef.current?.querySelector<HTMLButtonElement>(`button[data-sentence-id="${origin.id}"]`);
        (previousSentence ?? sentenceBrowserRef.current)?.focus({ preventScroll: true });
      } else {
        window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [hydrated, index, learnStage, patternDrillIndex, patternIndex, patternStage, quizIndex, readingId, readingLevel, reviewIndex, reviewView, sentenceIndex, sentenceSection, sentenceStage, tab]);

  const masteredSet = useMemo(() => new Set(mastered), [mastered]);
  const difficultSet = useMemo(() => new Set(difficult), [difficult]);
  const studiedSet = useMemo(() => new Set([...mastered, ...difficult]), [difficult, mastered]);
  const masteredNgslCount = mastered.filter((id) => id <= ngslMeta.count).length;
  const preciseProgress = words.length ? (masteredNgslCount / words.length) * 100 : 0;
  const progress = preciseProgress > 0 && preciseProgress < 1 ? Number(preciseProgress.toFixed(2))
    : preciseProgress < 10 ? Number(preciseProgress.toFixed(1))
    : preciseProgress < 99 ? Math.round(preciseProgress)
    : preciseProgress < 100 ? Math.min(99.9, Number(preciseProgress.toFixed(1))) : 100;
  const visibleStudyDays = useMemo(() => studyDays.filter((key) => key <= todayKey), [studyDays, todayKey]);
  const streak = useMemo(() => calculateStreak(visibleStudyDays, todayKey), [visibleStudyDays, todayKey]);
  const weeklyStudyCount = weekKeys.filter((key) => visibleStudyDays.includes(key)).length;
  const dueWords = useMemo(() => {
    // Review due times intentionally use the current wall clock.
    // eslint-disable-next-line react-hooks/purity
    const now = Math.max(reviewClock, Date.now());
    const ids = new Set<number>(Object.entries(schedule).filter(([, item]) => item.due <= now).map(([id]) => Number(id)));
    difficult.forEach((id) => { if (!schedule[id]) ids.add(id); });
    return allStudyWords
      .filter((word) => ids.has(word.id))
      .sort((left, right) => (schedule[left.id]?.due ?? Number.NEGATIVE_INFINITY) - (schedule[right.id]?.due ?? Number.NEGATIVE_INFINITY) || left.id - right.id);
  }, [allStudyWords, difficult, schedule, reviewClock]);
  const nextReviewDue = useMemo(() => {
    // Use the same wall clock as the due queue, including after app resume.
    // eslint-disable-next-line react-hooks/purity
    return nextScheduledReview(schedule, Math.max(reviewClock, Date.now()));
  }, [reviewClock, schedule]);
  const wordbookWords = allStudyWords.filter((word) => difficultSet.has(word.id));
  const sceneTotals = useMemo(() => Object.fromEntries(scenes.map((scene) => [scene.id, scenePacks[scene.id].length])) as Record<SceneId, number>, [scenePacks]);
  const bandWords = useMemo(() => {
    const start = libraryBand === 1 ? 1 : libraryBand === 2 ? 1001 : 2001;
    const end = libraryBand === 1 ? 1000 : libraryBand === 2 ? 2000 : words.length;
    const term = normalized(librarySearch);
    return words.filter((word) => (term ? normalized(`${word.word} ${word.meaning}`).includes(term) : (word.rank ?? word.id) >= start && (word.rank ?? word.id) <= end));
  }, [libraryBand, librarySearch, words]);
  const current = sessionWords[index] ?? words[0];
  const currentCardRating = current ? cardRatings[current.id] : undefined;
  const ratedCardCount = Object.keys(cardRatings).length;
  const quizWord = sessionWords[quizIndex] ?? words[0];
  const completedReadingSet = useMemo(() => new Set(readingCompleted), [readingCompleted]);
  const activeReading = readings.find((item) => item.id === readingId) ?? null;
  const lastReading = readings.find((item) => item.id === readingLast?.id) ?? null;
  const activeReadingQuestion = activeReading ? readingQuestions[activeReading.id] ?? null : null;
  const selectedReadingAnswer = activeReading && readingRetryId !== activeReading.id ? readingAnswers[activeReading.id] : undefined;
  const readingsAtLevel = readings.filter((item) => item.level === readingLevel);
  const readingNeedsReview = (item: ReadingItem) => readingAnswers[item.id] !== undefined && Boolean(readingQuestions[item.id]) && readingAnswers[item.id] !== readingQuestions[item.id].answer;
  const visibleReadings = (readingFilter === "review" ? readings : readingsAtLevel).filter((item) => readingFilter === "unread" ? !completedReadingSet.has(item.id) : readingFilter === "review" ? readingNeedsReview(item) : true);
  const nextReading = useMemo(() => {
    if (!activeReading) return null;
    const currentIndex = readings.findIndex((item) => item.id === activeReading.id);
    const candidates = [...readings.slice(currentIndex + 1), ...readings.slice(0, currentIndex)]
      .filter((item) => !completedReadingSet.has(item.id));
    return candidates.find((item) => item.level === activeReading.level) ?? candidates[0] ?? null;
  }, [activeReading, completedReadingSet, readings]);
  const readingCompletionPercent = Math.round(readingCompleted.length / READING_TOTAL * 100);
  const filteredSentences = useMemo(() => {
    const search = normalized(sentenceSearch);
    const source = search || sentenceSavedOnly || sentenceReviewOnly
      ? ([1, 2, 3] as const).flatMap((pack) => sentencePacks[pack] ?? [])
      : sentencePacks[SENTENCE_PACK_BY_BAND[sentenceBand]] ?? [];
    return source.filter((item) => {
      if (!search && !sentenceSavedOnly && !sentenceReviewOnly && item.length !== sentenceBand) return false;
      if (sentenceSavedOnly && !sentenceSaved.includes(item.id)) return false;
      if (sentenceReviewOnly && !sentenceDifficult.includes(item.id)) return false;
      if (!sentenceReviewOnly && sentenceCategory !== "all" && item.category !== sentenceCategory) return false;
      return !search || normalized(`${item.text} ${item.translation}`).includes(search);
    });
  }, [sentenceBand, sentenceCategory, sentenceDifficult, sentencePacks, sentenceReviewOnly, sentenceSaved, sentenceSavedOnly, sentenceSearch]);
  const sentenceItemById = useMemo(() => new Map(([1, 2, 3] as const).flatMap((pack) => sentencePacks[pack] ?? []).map((item) => [item.id, item])), [sentencePacks]);
  const sentenceSessionItems = sentenceSessionIds.map((id) => sentenceItemById.get(id)).filter((item): item is SentenceItem => Boolean(item));
  const safeSentenceIndex = Math.min(sentenceIndex, Math.max(sentenceSessionItems.length - 1, 0));
  const currentSentence = sentenceSessionItems[safeSentenceIndex] ?? null;
  const currentSentenceSaved = currentSentence ? sentenceSaved.includes(currentSentence.id) : false;
  const currentSentenceRating = currentSentence ? sentenceRatings[currentSentence.id] : undefined;
  const ratedSentenceCount = Object.keys(sentenceRatings).length;
  const canResumeSentence = sentenceStage === "setup" && sentenceSessionIds.length > ratedSentenceCount;
  const hasUnfinishedSentence = sentenceSessionIds.length > ratedSentenceCount;
  const availablePatterns = corePatterns.filter((pattern) => patternCategory === "all" || pattern.category === patternCategory);
  const patternById = new Map(corePatterns.map((pattern) => [pattern.id, pattern]));
  const patternSessionItems = patternSessionIds.map((id) => patternById.get(id)).filter((item): item is (typeof corePatterns)[number] => Boolean(item));
  const safePatternIndex = Math.min(patternIndex, Math.max(patternSessionItems.length - 1, 0));
  const currentPattern = patternSessionItems[safePatternIndex] ?? null;
  const currentPatternDrill = currentPattern?.drills[patternDrillIndex] ?? null;
  const currentPatternRating = currentPattern ? patternRatings[currentPattern.id] : undefined;
  const ratedPatternCount = Object.keys(patternRatings).length;
  const canResumePattern = patternStage === "setup" && patternSessionIds.length > ratedPatternCount;
  const hasUnfinishedPattern = patternSessionIds.length > ratedPatternCount;
  const requiredSentencePacks: (1 | 2 | 3)[] = sentenceStage === "cards" ? [SENTENCE_PACK_BY_BAND[sentenceBand]] : sentenceSearch.trim() || sentenceSavedOnly || sentenceReviewOnly ? [1, 2, 3] : [SENTENCE_PACK_BY_BAND[sentenceBand]];
  const sentenceLoading = requiredSentencePacks.some((pack) => !sentencePacks[pack]) && !sentenceLoadError;
  const nextNgslWord = words.find((word) => !studiedSet.has(word.id)) ?? null;
  const selectedScene = path === "frequency" ? null : scenes.find((scene) => scene.id === path) ?? null;
  const activeScene = sessionPath === "frequency" ? null : scenes.find((scene) => scene.id === sessionPath) ?? null;
  const currentPathLabel = selectedScene ? selectedScene.name : "NGSL 高频顺序";
  const currentPathIcon = selectedScene?.icon ?? "NG";
  const activePathLabel = activeScene ? activeScene.name : "NGSL 高频顺序";
  const currentSessionCount = Math.min(count, path === "frequency" ? words.length : sceneTotals[path]);
  const currentModeLabel = mode === "test" ? "学习＋考试" : "自由学习";
  const estimatedMinutes = Math.max(3, Math.round(currentSessionCount * 0.8));
  const hasOngoingSession = learnStage === "cards" || learnStage === "quiz";
  const hasWordStudyHistory = mastered.length > 0 || difficult.length > 0 || Object.keys(schedule).length > 0;
  const reviewWordsForSpeech = reviewView === "due" ? dueWords : wordbookWords;
  const currentReviewWordId = tab === "review" ? reviewWordsForSpeech[Math.min(reviewIndex, Math.max(reviewWordsForSpeech.length - 1, 0))]?.id ?? null : null;
  const screenAnnouncement = tab === "learn" && learnStage === "cards" && current
    ? `单词卡 ${index + 1}，${current.word}`
    : tab === "learn" && learnStage === "quiz" && quizWord
      ? `考试第 ${quizIndex + 1} 题`
      : tab === "learn" && learnStage === "result"
        ? "单词学习结果"
        : tab === "sentences" && sentenceSection === "library" && sentenceStage === "cards" && currentSentence
          ? sentenceMode === "speak" ? `句子卡 ${safeSentenceIndex + 1}，请根据中文说英文` : `句子卡 ${safeSentenceIndex + 1}，${currentSentence.text}`
          : tab === "sentences" && sentenceSection === "patterns" && patternStage === "cards" && currentPatternDrill
            ? `句型 ${safePatternIndex + 1}，替换练习 ${patternDrillIndex + 1}`
            : tab === "sentences" && ((sentenceSection === "library" && sentenceStage === "result") || (sentenceSection === "patterns" && patternStage === "result"))
              ? "句子学习结果"
              : tab === "read" && activeReading
                ? `阅读，${activeReading.title}`
                : tab === "review"
                  ? "复习中心"
                  : tab === "progress"
                    ? "学习进度"
                    : tab === "sentences"
                      ? "句子与核心句型"
                      : tab === "read"
                        ? "分级阅读"
                        : tab === "learn"
                          ? "单词学习设置"
                          : "今天";

  useEffect(() => {
    if (!hydrated || tab !== "review" || hasOpenDialog) return;
    const frame = window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      reviewHeadingRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [currentReviewWordId, hasOpenDialog, hydrated, tab]);

  useEffect(() => {
    if (!hydrated || tab !== "learn" || learnStage !== "cards" || hasOpenDialog) return;
    const frame = window.requestAnimationFrame(() => wordHeadingRef.current?.focus({ preventScroll: true }));
    return () => window.cancelAnimationFrame(frame);
  }, [current?.id, hasOpenDialog, hydrated, learnStage, tab]);

  useEffect(() => {
    // An undo only applies within the review view where the rating was made.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReviewUndo(null);
  }, [tab, reviewView]);

  useEffect(() => {
    window.addEventListener("pagehide", stopSpeech);
    return () => {
      stopSpeech();
      window.removeEventListener("pagehide", stopSpeech);
    };
  }, [current?.id, currentPattern?.id, currentReviewWordId, currentSentence?.id, learnStage, patternDrillIndex, patternStage, quizWord?.id, readingId, reviewView, sentenceSection, sentenceStage, tab]);

  useEffect(() => {
    if (!hydrated || hasOpenDialog || tab !== "read") return;
    const frame = window.requestAnimationFrame(() => {
      if (activeReading) readingHeadingRef.current?.focus({ preventScroll: true });
      else if (readingReturnIdRef.current) {
        const previous = readingListRef.current?.querySelector<HTMLButtonElement>(`button[data-reading-id="${readingReturnIdRef.current}"]`);
        readingReturnIdRef.current = null;
        const target = previous ?? readingListRef.current;
        target?.scrollIntoView({ block: "nearest", behavior: "auto" });
        target?.focus({ preventScroll: true });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeReading, hasOpenDialog, hydrated, tab]);

  useEffect(() => {
    const previous = readingFeedbackStateRef.current;
    readingFeedbackStateRef.current = { id: activeReading?.id ?? null, answer: selectedReadingAnswer };
    if (hasOpenDialog || tab !== "read" || selectedReadingAnswer === undefined || previous.id !== activeReading?.id || previous.answer === selectedReadingAnswer) return;
    const frame = window.requestAnimationFrame(() => readingFeedbackRef.current?.focus({ preventScroll: true }));
    return () => window.cancelAnimationFrame(frame);
  }, [activeReading?.id, hasOpenDialog, selectedReadingAnswer, tab]);

  const saveMastered = (update: number[] | ((current: number[]) => number[])) => { setMastered((current) => typeof update === "function" ? update(current) : update); };
  const saveDifficult = (update: number[] | ((current: number[]) => number[])) => { setDifficult((current) => typeof update === "function" ? update(current) : update); };
  const saveSchedule = (update: Record<number, ScheduleEntry> | ((current: Record<number, ScheduleEntry>) => Record<number, ScheduleEntry>)) => { setSchedule((current) => typeof update === "function" ? update(current) : update); };
  const saveSessionPreferences = (patch: Partial<SessionPreferences>) => {
    setPreferences((current) => ({ ...current, ...patch }));
  };
  const selectMode = (nextMode: LearnMode) => { saveSessionPreferences({ mode: nextMode }); };
  const selectCount = (nextCount: 10 | 20) => { saveSessionPreferences({ count: nextCount }); };
  const selectPath = (nextPath: LearnPath) => { saveSessionPreferences({ path: nextPath }); };

  const finishOpeningLearningSetup = (nextPath?: LearnPath) => {
    wordBrowserOriginRef.current = null;
    wordBrowserReturnRef.current = false;
    if (nextPath) selectPath(nextPath);
    setLearnStage("setup");
    setTab("learn");
  };

  const openLearningSetup = (nextPath?: LearnPath) => {
    if (hasOngoingSession && !(learnStage === "cards" && ratedCardCount === 0)) {
      setDiscardRequest(nextPath ? { path: nextPath } : {});
      return;
    }
    finishOpeningLearningSetup(nextPath);
  };

  const returnToWordLibrary = () => {
    if (!wordBrowserOriginRef.current && sessionWords[0]) {
      // A restored single-word card has no in-memory browsing position.
      setLibrarySearch(sessionWords[0].word);
      setLibraryLimit(24);
    }
    wordBrowserReturnRef.current = true;
    setLearnStage("setup");
    setTab("learn");
  };

  const openSentenceBrowser = (savedOnly: boolean, reviewOnly = false) => {
    sentenceBrowserOriginRef.current = null;
    setSentenceSavedOnly(savedOnly);
    setSentenceReviewOnly(!savedOnly && reviewOnly);
    setSentenceCategory("all");
    setSentenceSearch("");
    setSentenceResultLimit(30);
    window.requestAnimationFrame(() => {
      const browser = sentenceBrowserRef.current;
      const list = browser?.querySelector<HTMLDivElement>(".sentence-result-list");
      if (list) list.scrollTop = 0;
      browser?.scrollIntoView({ block: "start", behavior: "auto" });
      browser?.focus({ preventScroll: true });
    });
  };

  const restoreSentenceSetupPreferences = () => {
    const setup = sentenceSetupPreferencesRef.current;
    setSentenceBand(setup.band);
    setSentenceCategory(setup.category);
    setSentenceCount(setup.count);
    setSentenceMode(setup.mode);
    setSentenceStage("setup");
  };

  const restorePatternSetupPreferences = () => {
    setPatternCategory(patternSetupCategoryRef.current);
    setPatternStage("setup");
  };

  const selectPatternCategory = (category: "all" | PatternCategory) => {
    patternSetupCategoryRef.current = category;
    setPatternCategory(category);
  };

  const confirmDiscardSession = () => {
    if (discardRequest?.pattern) {
      const pendingStart = discardRequest.patternStart;
      setDiscardRequest(null);
      setPatternStage("setup");
      setPatternSessionIds([]);
      setPatternRatings({});
      setPatternIndex(0);
      setPatternDrillIndex(0);
      setPatternAnswerOpen(false);
      setSentenceSection("patterns");
      setTab("sentences");
      if (pendingStart) beginPatternSession(pendingStart.reviewOnly);
      return;
    }
    if (discardRequest?.sentence) {
      const pendingStart = discardRequest.sentenceStart;
      setDiscardRequest(null);
      setSentenceStage("setup");
      setSentenceSessionIds([]);
      setSentenceRatings({});
      setSentenceIndex(0);
      setTab("sentences");
      if (pendingStart) beginSentenceSession(pendingStart.reviewOnly, pendingStart.singleSentence);
      return;
    }
    const nextPath = discardRequest?.path;
    setDiscardRequest(null);
    finishOpeningLearningSetup(nextPath);
  };

  const noteStudyDay = () => {
    const today = localDateKey(new Date());
    setStudyDays((current) => current.includes(today) ? current : [...current, today].sort());
  };

  const openReading = (reading: ReadingItem) => {
    stopSpeech();
    setReadingId(reading.id);
    setReadingLevel(reading.level);
    setShowTranslation(false);
    setReadingRetryId(null);
    // Reading recency intentionally uses the wall clock after a user action.
    // eslint-disable-next-line react-hooks/purity
    setReadingLast({ id: reading.id, updatedAt: Date.now() });
  };

  const returnToReadings = () => {
    stopSpeech();
    readingReturnIdRef.current = activeReading?.id ?? null;
    setReadingId(null);
  };

  const toggleReadingCompleted = (reading: ReadingItem) => {
    setReadingCompleted((current) => current.includes(reading.id) ? current.filter((id) => id !== reading.id) : [...current, reading.id]);
    // Reading recency intentionally uses the wall clock after a user action.
    setReadingLast({ id: reading.id, updatedAt: Date.now() });
    if (!readingCompleted.includes(reading.id)) noteStudyDay();
  };

  const retryReadingQuestion = (readingId: string, optionIndex: number) => {
    setReadingRetryId(readingId);
    window.requestAnimationFrame(() => {
      readingQuestionOptionsRef.current?.querySelectorAll<HTMLButtonElement>("button")[optionIndex]?.focus({ preventScroll: true });
    });
  };

  const beginCardSwipe = (event: React.TouchEvent<HTMLElement>) => {
    if (event.target instanceof Element && event.target.closest('button, a, input, textarea, select, [role="button"], [contenteditable="true"]')) {
      touchStart.current = null;
      return;
    }
    const touch = event.touches[0];
    touchStart.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
  };

  const revealReviewAnswer = (wordId: number) => {
    setReviewRevealedWordId(wordId);
    window.requestAnimationFrame(() => reviewAnswerRef.current?.focus({ preventScroll: true }));
  };

  const playSpeech = (text: string, rate = 0.82) => {
    setSpeechNotice(null);
    if (!speak(text, rate)) {
      setSpeechNotice("当前浏览器无法使用系统英文语音，请使用最新版 Safari、Chrome 或 Edge。");
    }
  };

  const controlReadingSpeech = (reading: ReadingItem) => {
    setSpeechNotice(null);
    if (!isSpeechSupported()) {
      setSpeechNotice("当前浏览器无法使用系统英文语音，请使用最新版 Safari、Chrome 或 Edge。");
      return;
    }
    if (readingSpeechState === "idle") {
      if (!startSegmentedSpeech(reading.text, readingSpeechRate, noteStudyDay)) setSpeechNotice("这篇文章暂时无法朗读，请稍后重试。");
    } else {
      toggleSegmentedSpeech();
    }
  };

  const exportLearningBackup = async () => {
    if (backupActionLock.current) return;
    backupActionLock.current = true;
    setBackupBusy("export");
    try {
      // Export the current session even when Safari cannot persist its latest
      // changes. The resume refs also retain paused sessions between modules.
      const snapshot: Record<StorageKey, unknown> = {
        [STORAGE.mastered]: mastered,
        [STORAGE.difficult]: difficult,
        [STORAGE.schedule]: schedule,
        [STORAGE.days]: studyDays,
        [STORAGE.session]: preferences,
        [STORAGE.activeSession]: activeSessionResumeSnapshotRef.current,
        [STORAGE.readingCompleted]: readingCompleted,
        [STORAGE.readingLast]: readingLast,
        [STORAGE.readingAnswers]: readingAnswers,
        [STORAGE.sentenceSaved]: sentenceSaved,
        [STORAGE.sentenceSeen]: sentenceSeen,
        [STORAGE.sentenceMastered]: sentenceMastered,
        [STORAGE.sentenceDifficult]: sentenceDifficult,
        [STORAGE.sentencePreferences]: sentenceSetupPreferencesRef.current,
        [STORAGE.sentenceActiveSession]: sentenceResumeSnapshotRef.current,
        [STORAGE.patternMastered]: patternMastered,
        [STORAGE.patternDifficult]: patternDifficult,
        [STORAGE.patternActiveSession]: patternResumeSnapshotRef.current,
        [STORAGE.practiceRotation]: practiceRotationRef.current,
      };
      const backup = createLearningBackup({ getItem: (key) => JSON.stringify(snapshot[key as StorageKey]) }, STORAGE_KEYS);
      const content = JSON.stringify(backup, null, 2);
      const date = backup.exportedAt.slice(0, 10);
      const file = new File([content], `english-flow-backup-${date}.json`, { type: "application/json" });
      const shareData: ShareData = { title: "English Flow 学习记录备份", files: [file] };
      let canShareFile = false;
      try {
        canShareFile = typeof navigator.share === "function" && typeof navigator.canShare === "function" && navigator.canShare(shareData);
      } catch {
        // Some Safari versions throw for file payloads instead of returning false.
      }
      if (canShareFile) {
        try {
          await navigator.share(shareData);
          setBackupNotice({ kind: "success", message: "备份文件已生成，请保存到“文件”或你的常用位置。" });
          return;
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") return;
        }
      }
      const url = URL.createObjectURL(file);
      const link = document.createElement("a");
      link.href = url;
      link.download = file.name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
      setBackupNotice({ kind: "success", message: "已开始下载备份，请确认文件已保存。换手机或清理 Safari 前，请妥善保管。" });
    } catch {
      setBackupNotice({ kind: "error", message: "备份没有生成成功，请确认 Safari 允许下载且设备仍有可用空间。" });
    } finally {
      backupActionLock.current = false;
      setBackupBusy(null);
    }
  };

  const chooseBackupFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const request = ++backupReadRequestRef.current;
    const file = event.target.files?.[0];
    event.target.value = "";
    setPendingBackup(null);
    setBackupBusy(null);
    if (!file) return;
    if (file.size > BACKUP_MAX_BYTES) {
      setBackupNotice({ kind: "error", message: "这个文件过大，不像是 English Flow 生成的学习记录备份。" });
      return;
    }
    setBackupBusy("read");
    setBackupNotice(null);
    try {
      const value: unknown = JSON.parse(await file.text());
      if (request !== backupReadRequestRef.current) return;
      if (!isLearningBackup(value, STORAGE_KEYS, BACKUP_OPTIONAL_KEYS)) throw new Error("Invalid backup");
      setBackupNotice(null);
      setResetProgressOpen(false);
      setDiscardRequest(null);
      setInstallOpen(false);
      setPendingBackup(value);
    } catch {
      if (request !== backupReadRequestRef.current) return;
      setBackupNotice({ kind: "error", message: "无法识别这个备份。请选择 English Flow 导出的 JSON 文件。" });
    } finally {
      if (request === backupReadRequestRef.current) setBackupBusy(null);
    }
  };

  const cancelBackupRead = () => {
    backupReadRequestRef.current += 1;
    setBackupBusy(null);
    setPendingBackup(null);
    setBackupNotice(null);
  };

  const restoreLearningBackup = () => {
    if (!pendingBackup || backupActionLock.current) return;
    backupActionLock.current = true;
    setBackupBusy("restore");
    let restored = false;
    try {
      restored = restoreLearningBackupData(window.localStorage, STORAGE_KEYS, pendingBackup);
    } catch {
      // Accessing localStorage itself can throw in restricted Safari contexts.
    }
    if (!restored) {
      setStorageWriteError(true);
      setBackupNotice({ kind: "error", message: "恢复没有完成，原有记录已尽量保留。请检查设备存储空间后再试。" });
      setPendingBackup(null);
      setBackupBusy(null);
      backupActionLock.current = false;
      return;
    }
    setPendingBackup(null);
    window.location.reload();
  };

  const resetLearningProgress = () => {
    const resetKeys = [
      STORAGE.mastered,
      STORAGE.difficult,
      STORAGE.schedule,
      STORAGE.days,
      STORAGE.activeSession,
      STORAGE.readingCompleted,
      STORAGE.readingLast,
      STORAGE.readingAnswers,
      STORAGE.sentenceSeen,
      STORAGE.sentenceMastered,
      STORAGE.sentenceDifficult,
      STORAGE.sentenceActiveSession,
      STORAGE.patternMastered,
      STORAGE.patternDifficult,
      STORAGE.patternActiveSession,
      STORAGE.practiceRotation,
    ];
    let reset = false;
    try {
      const emptyProgress = createLearningBackup({ getItem: () => null }, resetKeys);
      reset = restoreLearningBackupData(window.localStorage, resetKeys, emptyProgress);
    } catch {
      // Accessing localStorage itself may be blocked, before any removal runs.
    }
    if (!reset) {
      setStorageWriteError(true);
      setBackupNotice({ kind: "error", message: "重置没有完成，当前页面的进度仍保留。请先导出备份，检查设备存储空间后再试。" });
      setResetProgressOpen(false);
      return;
    }
    setMastered([]);
    setDifficult([]);
    setSchedule({});
    setStudyDays([]);
    setLearnStage("setup");
    setSessionWords(words.slice(0, count));
    setWordSessionKind("group");
    setIndex(0);
    setCardRatings({});
    setQuizIndex(0);
    setQuizAnswer("");
    setQuizFeedback(null);
    setQuizResults([]);
    activeSessionResumeSnapshotRef.current = null;
    setReadingAnswers({});
    setReadingRetryId(null);
    setReadingFilter("all");
    setReadingCompleted([]);
    setReadingLast(null);
    setReadingId(null);
    setShowTranslation(false);
    setSentenceSeen([]);
    setSentenceMastered([]);
    setSentenceDifficult([]);
    restoreSentenceSetupPreferences();
    setSentenceSessionIds([]);
    setSentenceRatings({});
    setSentenceIndex(0);
    sentenceResumeSnapshotRef.current = null;
    setPatternMastered([]);
    setPatternDifficult([]);
    setPatternStage("setup");
    setPatternSessionIds([]);
    setPatternRatings({});
    setPatternIndex(0);
    setPatternDrillIndex(0);
    setPatternAnswerOpen(false);
    patternResumeSnapshotRef.current = null;
    practiceRotationRef.current = { word: 0, sentence: 0, pattern: 0 };
    setReviewView("due");
    setReviewIndex(0);
    setReviewRevealedWordId(null);
    setResetProgressOpen(false);
    setTab("progress");
    setBackupNotice({ kind: "success", message: "学习进度已重置，句库收藏和学习偏好已保留。" });
  };

  const addDifficult = (id: number) => {
    saveMastered((currentMastered) => currentMastered.filter((item) => item !== id));
    saveDifficult((currentDifficult) => currentDifficult.includes(id) ? currentDifficult : [...currentDifficult, id]);
    // Review scheduling intentionally starts from the current wall clock.
    // eslint-disable-next-line react-hooks/purity
    const due = Date.now();
    saveSchedule((currentSchedule) => ({ ...currentSchedule, [id]: { due, stage: 0 } }));
  };

  const markMastered = (id: number) => {
    saveMastered((currentMastered) => currentMastered.includes(id) ? currentMastered : [...currentMastered, id]);
    saveDifficult((currentDifficult) => currentDifficult.filter((item) => item !== id));
    // Review scheduling intentionally starts from the current wall clock.
    // eslint-disable-next-line react-hooks/purity
    const now = Date.now();
    saveSchedule((currentSchedule) => {
      const previous = currentSchedule[id];
      const next = scheduleMasteredWord(previous, now, DAY);
      return previous?.due === next.due && previous.stage === next.stage ? currentSchedule : { ...currentSchedule, [id]: next };
    });
  };

  const startSession = (pathOverride?: LearnPath, modeOverride?: LearnMode, countOverride?: 10 | 20) => {
    wordBrowserOriginRef.current = null;
    wordBrowserReturnRef.current = false;
    const selectedPath = pathOverride ?? path;
    const selectedMode = modeOverride ?? mode;
    const selectedCount = countOverride ?? count;
    const currentMastered = new Set(mastered);
    const currentDifficult = new Set(difficult);
    const pool = selectedPath === "frequency" ? words : scenePacks[selectedPath];
    const unseen = pool.filter((item) => !currentMastered.has(item.id) && !currentDifficult.has(item.id));
    const needsReview = pool.filter((item) => currentDifficult.has(item.id));
    const completed = pool.filter((item) => currentMastered.has(item.id));
    const selectionLimit = Math.min(selectedCount, pool.length);
    const selectionRotation = practiceRotationRef.current.word;
    practiceRotationRef.current = { ...practiceRotationRef.current, word: selectionRotation + 1 };
    writeJson(STORAGE.practiceRotation, practiceRotationRef.current);
    const selected = [unseen, needsReview, completed].reduce<WordItem[]>((items, group, groupIndex) => {
      if (items.length >= selectionLimit) return items;
      const remaining = selectionLimit - items.length;
      const candidates = groupIndex === 0 ? group.slice(0, remaining) : takeRotatedSpread(group, remaining, selectionRotation + groupIndex);
      return [...items, ...candidates];
    }, []);
    saveSessionPreferences({ path: selectedPath, mode: selectedMode, count: selectedCount });
    setSessionPath(selectedPath);
    setSessionMode(selectedMode);
    setWordSessionKind("group");
    setSessionWords(selected);
    setIndex(0);
    setCardRatings({});
    setQuizIndex(0);
    setQuizAnswer("");
    setQuizFeedback(null);
    setQuizResults([]);
    setLearnStage("cards");
    setTab("learn");
  };

  const startSingleWord = (word: WordItem) => {
    wordBrowserOriginRef.current = {
      id: word.id,
      scrollY: window.scrollY,
      listScrollTop: wordBrowserRef.current?.querySelector<HTMLDivElement>(".library-list")?.scrollTop ?? 0,
    };
    wordBrowserReturnRef.current = false;
    setSessionWords([word]);
    setIndex(0);
    setCardRatings({});
    setQuizIndex(0);
    setQuizAnswer("");
    setQuizFeedback(null);
    setQuizResults([]);
    setSessionMode("free");
    setWordSessionKind("lookup");
    setSessionPath("frequency");
    setLearnStage("cards");
  };

  const finishCard = (known: boolean) => {
    if (cardActionLock.current) return;
    cardActionLock.current = true;
    window.setTimeout(() => { cardActionLock.current = false; }, 350);
    noteStudyDay();
    if (known) markMastered(current.id); else addDifficult(current.id);
    const nextRatings = { ...cardRatings, [current.id]: known ? "known" as const : "difficult" as const };
    setCardRatings(nextRatings);
    const nextIndex = sessionWords.findIndex((word, wordIndex) => wordIndex > index && !nextRatings[word.id]);
    const wrappedIndex = nextIndex >= 0 ? nextIndex : sessionWords.findIndex((word) => !nextRatings[word.id]);
    if (wrappedIndex >= 0) setIndex(wrappedIndex);
    else if (sessionMode === "test") {
      quizActionLock.current = { submitted: -1, advanced: -1 };
      setLearnStage("quiz");
    }
    else setLearnStage("result");
  };

  const moveCard = (direction: number) => {
    const next = Math.min(Math.max(index + direction, 0), sessionWords.length - 1);
    setIndex(next);
  };

  const checkQuiz = (showAnswer = false) => {
    if ((!showAnswer && !quizAnswer.trim()) || quizFeedback) return;
    if (quizActionLock.current.submitted >= quizIndex) return;
    quizActionLock.current.submitted = quizIndex;
    noteStudyDay();
    const isCorrect = !showAnswer && normalizeQuizAnswer(quizAnswer) === normalizeQuizAnswer(quizWord.exampleForm ?? quizWord.word);
    setQuizFeedback(isCorrect ? "correct" : "wrong");
    setQuizResults([...quizResults, isCorrect]);
    quizInputRef.current?.blur();
    if (isCorrect) markMastered(quizWord.id); else addDifficult(quizWord.id);
  };

  const nextQuiz = () => {
    if (!quizFeedback || quizActionLock.current.advanced >= quizIndex) return;
    quizActionLock.current.advanced = quizIndex;
    if (quizIndex >= sessionWords.length - 1) {
      setLearnStage("result");
      return;
    }
    setQuizIndex(quizIndex + 1);
    setQuizAnswer("");
    setQuizFeedback(null);
  };

  const retryMissedWords = () => {
    const missed = sessionWords.filter((_, wordIndex) => quizResults[wordIndex] === false);
    if (!missed.length) return;
    setSessionWords(missed);
    setIndex(0);
    setCardRatings({});
    setQuizIndex(0);
    setQuizAnswer("");
    setQuizFeedback(null);
    setQuizResults([]);
    quizActionLock.current = { submitted: -1, advanced: -1 };
    setSessionMode("test");
    setWordSessionKind("group");
    setLearnStage("cards");
    setTab("learn");
  };

  const retryDifficultWords = () => {
    if (learnStage !== "result" || sessionMode !== "free") return;
    const missed = sessionWords.filter((word) => difficultSet.has(word.id));
    if (!missed.length) return;
    setSessionWords(missed);
    setWordSessionKind("group");
    setIndex(0);
    setCardRatings({});
    setQuizIndex(0);
    setQuizAnswer("");
    setQuizFeedback(null);
    setQuizResults([]);
    setLearnStage("cards");
    setTab("learn");
  };

  const rememberReviewAction = (item: WordItem, index: number, label: string) => {
    setReviewUndo({ id: item.id, word: item.word, schedule: schedule[item.id], mastered: mastered.includes(item.id), difficult: difficult.includes(item.id), index, label });
  };

  const undoReviewAction = () => {
    if (!reviewUndo) return;
    const previous = reviewUndo;
    saveSchedule((currentSchedule) => {
      const restored = { ...currentSchedule };
      if (previous.schedule) restored[previous.id] = previous.schedule;
      else delete restored[previous.id];
      return restored;
    });
    saveMastered((items) => previous.mastered ? [...new Set([...items, previous.id])] : items.filter((id) => id !== previous.id));
    saveDifficult((items) => previous.difficult ? [...new Set([...items, previous.id])] : items.filter((id) => id !== previous.id));
    setReviewIndex(previous.index);
    setReviewRevealedWordId(previous.id);
    setReviewUndo(null);
  };

  const rateReview = (rating: "again" | "hard" | "good" | "easy") => {
    if (reviewActionLock.current) return;
    reviewActionLock.current = true;
    window.setTimeout(() => { reviewActionLock.current = false; }, 350);
    const safeIndex = Math.min(reviewIndex, Math.max(dueWords.length - 1, 0));
    const item = dueWords[safeIndex] ?? null;
    if (!item) return;
    if (reviewRevealedWordId !== item.id) return;
    noteStudyDay();
    const currentStage = schedule[item.id]?.stage ?? 0;
    const days = reviewIntervalDays(currentStage, rating);
    const stage = nextReviewStage(currentStage, rating);
    // Review scheduling intentionally starts from the current wall clock.
    const now = Date.now();
    const due = rating === "again" ? now + REVIEW_AGAIN_DELAY : now + days * DAY;
    rememberReviewAction(item, safeIndex, `已标记“${{ again: "忘了", hard: "困难", good: "记得", easy: "简单" }[rating]}” · ${rating === "again" ? "10 分钟" : `${days} 天`}后复习`);
    saveSchedule((currentSchedule) => ({ ...currentSchedule, [item.id]: { due, stage } }));
    if (rating === "good" || rating === "easy") {
      saveMastered((currentMastered) => currentMastered.includes(item.id) ? currentMastered : [...currentMastered, item.id]);
      saveDifficult((currentDifficult) => currentDifficult.filter((id) => id !== item.id));
    } else {
      saveMastered((currentMastered) => currentMastered.filter((id) => id !== item.id));
      saveDifficult((currentDifficult) => currentDifficult.includes(item.id) ? currentDifficult : [...currentDifficult, item.id]);
    }
    setReviewIndex(0);
    setReviewRevealedWordId(null);
  };

  const markWordbookMastered = (wordId: number) => {
    if (reviewActionLock.current) return;
    if (reviewRevealedWordId !== wordId) return;
    reviewActionLock.current = true;
    window.setTimeout(() => { reviewActionLock.current = false; }, 350);
    const item = wordbookWords.find((word) => word.id === wordId);
    if (!item) return;
    rememberReviewAction(item, wordbookWords.findIndex((word) => word.id === wordId), "已标记掌握，移出生词本");
    markMastered(wordId);
    noteStudyDay();
    setReviewIndex(0);
    setReviewRevealedWordId(null);
  };

  const commonHeader = (title: string, eyebrow: string) => (
    <header className="simple-header"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1></div><span className="avatar-button" aria-hidden="true">EN</span></header>
  );

  const markSentenceSeen = (sentenceId: number) => {
    setSentenceSeen((items) => items.includes(sentenceId) ? items : [...items, sentenceId]);
  };

  const beginSentenceSession = (reviewOnly = false, singleSentence?: SentenceItem) => {
    const source = singleSentence ? [singleSentence] : sentencePacks[SENTENCE_PACK_BY_BAND[sentenceBand]] ?? [];
    const categoryPool = source.filter((item) => sentenceCategory === "all" || item.category === sentenceCategory);
    const masteredIds = new Set(sentenceMastered);
    const difficultIds = new Set(sentenceDifficult);
    const pool = reviewOnly ? categoryPool.filter((item) => difficultIds.has(item.id)) : categoryPool;
    const unseen = pool.filter((item) => !masteredIds.has(item.id) && !difficultIds.has(item.id));
    const needsWork = pool.filter((item) => difficultIds.has(item.id));
    const learned = pool.filter((item) => masteredIds.has(item.id));
    const selectionLimit = Math.min(sentenceCount, pool.length);
    const selectionRotation = practiceRotationRef.current.sentence;
    if (!singleSentence) {
      practiceRotationRef.current = { ...practiceRotationRef.current, sentence: selectionRotation + 1 };
      writeJson(STORAGE.practiceRotation, practiceRotationRef.current);
    }
    const selected = singleSentence ? [singleSentence] : [unseen, needsWork, learned].reduce<SentenceItem[]>((items, group, groupIndex) => {
      if (items.length >= selectionLimit) return items;
      return [...items, ...takeRotatedSpread(group, selectionLimit - items.length, selectionRotation + groupIndex)];
    }, []);
    if (!selected.length) return;
    if (!singleSentence) {
      const setup = { band: sentenceBand, category: sentenceCategory, count: sentenceCount, mode: sentenceMode } satisfies SentencePreferences;
      sentenceSetupPreferencesRef.current = setup;
      writeJson(STORAGE.sentencePreferences, setup);
    }
    if (singleSentence) {
      sentenceBrowserOriginRef.current = {
        id: singleSentence.id,
        scrollY: window.scrollY,
        listScrollTop: sentenceBrowserRef.current?.querySelector<HTMLDivElement>(".sentence-result-list")?.scrollTop ?? 0,
      };
      setSentenceBand(singleSentence.length);
      setSentenceCategory("all");
    } else {
      sentenceBrowserOriginRef.current = null;
      setSentenceSearch("");
      setSentenceSavedOnly(false);
      setSentenceReviewOnly(false);
    }
    setSentenceSessionIds(selected.map((item) => item.id));
    setSentenceIndex(0);
    setSentenceRatings({});
    setSentenceTranslationOpen(false);
    setSentenceSection("library");
    setSentenceStage("cards");
  };

  const startSentenceSession = (reviewOnly = false, singleSentence?: SentenceItem) => {
    if (sentenceStage === "setup" && sentenceSessionIds.length && sentenceResumeSnapshotRef.current) {
      setDiscardRequest({ sentence: true, sentenceStart: { reviewOnly, singleSentence } });
      return;
    }
    beginSentenceSession(reviewOnly, singleSentence);
  };

  const resumeSentenceSession = () => {
    const snapshot = newestSnapshot(cleanSentenceSession(readJson<unknown>(STORAGE.sentenceActiveSession, null)), sentenceResumeSnapshotRef.current);
    if (!snapshot) return;
    setSentenceBand(snapshot.band);
    setSentenceCategory(snapshot.category);
    setSentenceCount(snapshot.count);
    setSentenceMode(snapshot.mode);
    setSentenceSessionIds(snapshot.sentenceIds);
    setSentenceIndex(snapshot.index);
    setSentenceRatings(snapshot.ratings);
    setSentenceTranslationOpen(false);
    setSentenceSection("library");
    setSentenceStage("cards");
  };

  const finishSentenceCard = (known: boolean) => {
    if (!currentSentence || sentenceActionLock.current) return;
    sentenceActionLock.current = true;
    window.setTimeout(() => { sentenceActionLock.current = false; }, 350);
    noteStudyDay();
    markSentenceSeen(currentSentence.id);
    if (known) {
      setSentenceMastered((items) => items.includes(currentSentence.id) ? items : [...items, currentSentence.id]);
      setSentenceDifficult((items) => items.filter((id) => id !== currentSentence.id));
    } else {
      setSentenceMastered((items) => items.filter((id) => id !== currentSentence.id));
      setSentenceDifficult((items) => items.includes(currentSentence.id) ? items : [...items, currentSentence.id]);
    }
    const nextRatings = { ...sentenceRatings, [currentSentence.id]: known ? "known" as const : "difficult" as const };
    setSentenceRatings(nextRatings);
    const nextIndex = sentenceSessionItems.findIndex((item, itemIndex) => itemIndex > safeSentenceIndex && !nextRatings[item.id]);
    const wrappedIndex = nextIndex >= 0 ? nextIndex : sentenceSessionItems.findIndex((item) => !nextRatings[item.id]);
    if (wrappedIndex >= 0) {
      setSentenceIndex(wrappedIndex);
      setSentenceTranslationOpen(false);
    } else {
      setSentenceStage("result");
    }
  };

  const moveSentence = (direction: number) => {
    if (!sentenceSessionItems.length) return;
    const nextIndex = Math.min(Math.max(safeSentenceIndex + direction, 0), sentenceSessionItems.length - 1);
    setSentenceIndex(nextIndex);
    setSentenceTranslationOpen(false);
  };

  const retryDifficultSentences = () => {
    if (sentenceStage !== "result") return;
    const retryIds = sentenceSessionIds.filter((id) => sentenceRatings[id] === "difficult");
    if (!retryIds.length) return;
    setSentenceSessionIds(retryIds);
    setSentenceRatings({});
    setSentenceIndex(0);
    setSentenceTranslationOpen(false);
    setSentenceStage("cards");
    setSentenceSection("library");
    setTab("sentences");
  };

  const beginPatternSession = (reviewOnly = false) => {
    const masteredIds = new Set(patternMastered);
    const difficultIds = new Set(patternDifficult);
    const source = availablePatterns;
    const pool = reviewOnly ? source.filter((pattern) => difficultIds.has(pattern.id)) : source;
    const unseen = pool.filter((pattern) => !masteredIds.has(pattern.id) && !difficultIds.has(pattern.id));
    const needsWork = pool.filter((pattern) => difficultIds.has(pattern.id));
    const learned = pool.filter((pattern) => masteredIds.has(pattern.id));
    const selectionRotation = practiceRotationRef.current.pattern;
    practiceRotationRef.current = { ...practiceRotationRef.current, pattern: selectionRotation + 1 };
    writeJson(STORAGE.practiceRotation, practiceRotationRef.current);
    const selected = [unseen, needsWork, learned].reduce<(typeof corePatterns)[number][]>((items, group, groupIndex) => {
      if (items.length >= 10) return items;
      return [...items, ...takeRotatedSpread(group, 10 - items.length, selectionRotation + groupIndex)];
    }, []);
    if (!selected.length) return;
    setPatternSessionIds(selected.map((pattern) => pattern.id));
    setPatternIndex(0);
    setPatternDrillIndex(0);
    setPatternAnswerOpen(false);
    setPatternRatings({});
    setPatternStage("cards");
    setSentenceSection("patterns");
  };

  const startPatternSession = (reviewOnly = false) => {
    if (patternStage === "setup" && patternSessionIds.length && patternResumeSnapshotRef.current) {
      setDiscardRequest({ pattern: true, patternStart: { reviewOnly } });
      return;
    }
    beginPatternSession(reviewOnly);
  };

  const resumePatternSession = () => {
    const snapshot = newestSnapshot(cleanPatternSession(readJson<unknown>(STORAGE.patternActiveSession, null)), patternResumeSnapshotRef.current);
    if (!snapshot) return;
    setPatternCategory(snapshot.category);
    setPatternSessionIds(snapshot.patternIds);
    setPatternIndex(snapshot.index);
    setPatternDrillIndex(snapshot.drillIndex);
    setPatternRatings(snapshot.ratings);
    setPatternAnswerOpen(false);
    setSentenceSection("patterns");
    setPatternStage("cards");
  };

  const movePatternDrill = (direction: number) => {
    const next = Math.min(Math.max(patternDrillIndex + direction, 0), 2);
    setPatternDrillIndex(next);
    setPatternAnswerOpen(false);
  };

  const finishPattern = (known: boolean) => {
    if (!currentPattern || patternActionLock.current) return;
    patternActionLock.current = true;
    window.setTimeout(() => { patternActionLock.current = false; }, 350);
    noteStudyDay();
    if (known) {
      setPatternMastered((items) => items.includes(currentPattern.id) ? items : [...items, currentPattern.id]);
      setPatternDifficult((items) => items.filter((id) => id !== currentPattern.id));
    } else {
      setPatternMastered((items) => items.filter((id) => id !== currentPattern.id));
      setPatternDifficult((items) => items.includes(currentPattern.id) ? items : [...items, currentPattern.id]);
    }
    const nextRatings = { ...patternRatings, [currentPattern.id]: known ? "known" as const : "difficult" as const };
    setPatternRatings(nextRatings);
    const nextIndex = patternSessionItems.findIndex((pattern, itemIndex) => itemIndex > safePatternIndex && !nextRatings[pattern.id]);
    const wrappedIndex = nextIndex >= 0 ? nextIndex : patternSessionItems.findIndex((pattern) => !nextRatings[pattern.id]);
    if (wrappedIndex >= 0) {
      setPatternIndex(wrappedIndex);
      setPatternDrillIndex(0);
      setPatternAnswerOpen(false);
    } else {
      setPatternStage("result");
    }
  };

  const retryDifficultPatterns = () => {
    if (patternStage !== "result") return;
    const retryIds = patternSessionIds.filter((id) => patternRatings[id] === "difficult");
    if (!retryIds.length) return;
    setPatternSessionIds(retryIds);
    setPatternRatings({});
    setPatternIndex(0);
    setPatternDrillIndex(0);
    setPatternAnswerOpen(false);
    setPatternStage("cards");
    setSentenceSection("patterns");
    setTab("sentences");
  };

  const openSentencePracticeFromHome = () => {
    if (hasUnfinishedSentence) resumeSentenceSession();
    else {
      restoreSentenceSetupPreferences();
      setSentenceMode("speak");
      setSentenceSection("library");
    }
    setTab("sentences");
  };

  const openPatternPracticeFromHome = () => {
    if (hasUnfinishedPattern) resumePatternSession();
    else {
      setSentenceSection("patterns");
      restorePatternSetupPreferences();
    }
    setTab("sentences");
  };

  const renderSentenceSetup = () => {
    const currentPack = sentencePacks[SENTENCE_PACK_BY_BAND[sentenceBand]] ?? [];
    const availableCount = currentPack.filter((item) => sentenceCategory === "all" || item.category === sentenceCategory).length;
    const difficultInSelection = currentPack.filter((item) => sentenceDifficult.includes(item.id) && (sentenceCategory === "all" || item.category === sentenceCategory)).length;
    return <section className="page sentence-page">{commonHeader("学习长短句", "BUILD A SENTENCE SESSION")}
      <p className="page-intro">选择直接学习英文，或者先看中文、自己说出英文。每张卡的进度都会自动保存在本机。</p>
      <div className="sentence-section-switch" role="group" aria-label="句子学习内容"><button className="selected" aria-pressed="true">日常长短句</button><button aria-pressed="false" onClick={() => setSentenceSection("patterns")}>核心句型</button></div>
      {canResumeSentence && <button className="resume-session-card" onClick={resumeSentenceSession}><span>继续上次</span><div><b>未完成的句子练习</b><small>第 {Math.min(sentenceIndex + 1, sentenceSessionIds.length)} 张 · 已标记 {ratedSentenceCount} / {sentenceSessionIds.length}</small></div><i>›</i></button>}
      {sentenceLoadError && <div className="sentence-load-error" role="alert"><span>{networkOnline ? "部分句库尚未载入，已显示可用内容。重新载入页面可恢复缺少的数据。" : "当前处于离线状态，已缓存的句子仍可使用；联网后会自动补全。"}</span><button onClick={() => window.location.reload()}>重新载入页面</button></div>}
      <div className="sentence-summary"><div><b>{sentenceMastered.length}</b><small>已掌握</small></div><button className={sentenceReviewOnly ? "selected" : ""} aria-pressed={sentenceReviewOnly} aria-label={`查看 ${sentenceDifficult.length} 个待加强句子`} onClick={() => openSentenceBrowser(false, true)}><b>{sentenceDifficult.length}</b><small>待加强</small></button><button className={sentenceSavedOnly ? "selected" : ""} aria-pressed={sentenceSavedOnly} onClick={() => openSentenceBrowser(true)}><b>{sentenceSaved.length}</b><small>{sentenceSavedOnly ? "正在看收藏" : "收藏句子"}</small></button></div>
      <div className="setup-block"><h2>选择练习方式</h2><div className="sentence-mode-grid"><button className={sentenceMode === "bilingual" ? "selected" : ""} aria-pressed={sentenceMode === "bilingual"} onClick={() => setSentenceMode("bilingual")}><span>EN</span><div><b>英文卡片</b><small>先看英文，再查看中文</small></div></button><button className={sentenceMode === "speak" ? "selected" : ""} aria-pressed={sentenceMode === "speak"} onClick={() => setSentenceMode("speak")}><span>中</span><div><b>看中文说英文</b><small>先开口，再揭晓答案</small></div></button></div></div>
      <div className="setup-block"><div className="row-heading"><h2>每组句数</h2><small>学完逐句标记</small></div><div className="count-switch"><button className={sentenceCount === 10 ? "selected" : ""} aria-pressed={sentenceCount === 10} onClick={() => setSentenceCount(10)}>10 句</button><button className={sentenceCount === 20 ? "selected" : ""} aria-pressed={sentenceCount === 20} onClick={() => setSentenceCount(20)}>20 句</button></div></div>
      <div className="setup-block"><h2>选择句子长度</h2><div className="sentence-band-switch">
        {(["short", "medium", "long"] as const).map((band) => <button key={band} className={sentenceBand === band ? "selected" : ""} aria-pressed={sentenceBand === band} onClick={() => { setSentenceBand(band); setSentenceSavedOnly(false); setSentenceReviewOnly(false); setSentenceSearch(""); setSentenceResultLimit(30); }}>{band === "short" ? "短句" : band === "medium" ? "常用句" : "长句"}<small>{band === "short" ? "2–7 词" : band === "medium" ? "8–12 词" : "13–18 词"}</small></button>)}
      </div></div>
      <div className="setup-block"><div className="row-heading"><h2>选择沟通场景</h2><small>{sentenceLoading ? "正在加载…" : `${availableCount} 句可学`}</small></div><div className="sentence-categories sentence-category-grid" role="group" aria-label="句子场景">{sentenceCategories.map((category) => <button key={category.id} className={sentenceCategory === category.id ? "selected" : ""} aria-pressed={sentenceCategory === category.id} onClick={() => { setSentenceCategory(category.id); setSentenceSavedOnly(false); setSentenceReviewOnly(false); setSentenceResultLimit(30); }}>{category.label}</button>)}</div></div>
      <p className="session-choice-summary" aria-live="polite"><span>“”</span> 当前：{sentenceMode === "speak" ? "看中文说英文" : "英文卡片"} · {sentenceBand === "short" ? "短句" : sentenceBand === "medium" ? "常用句" : "长句"} · {sentenceCategories.find((item) => item.id === sentenceCategory)?.label} · {Math.min(sentenceCount, availableCount)} 句</p>
      <button className="sticky-start primary-action" disabled={sentenceLoading || availableCount === 0} onClick={() => startSentenceSession()}>开始这组学习</button>
      {difficultInSelection > 0 && <button className="sentence-review-start" onClick={() => startSentenceSession(true)}>复习当前范围内 {Math.min(sentenceCount, difficultInSelection)} 个待加强句子</button>}
      <div ref={sentenceBrowserRef} tabIndex={-1} className="setup-block sentence-browser"><div className="row-heading"><h2>{sentenceSavedOnly ? "收藏的句子" : sentenceReviewOnly ? "待加强的句子" : "查找完整句库"}</h2><small>{sentenceSavedOnly || sentenceReviewOnly ? `${filteredSentences.length} 句` : sentenceSearch ? `${filteredSentences.length} 个结果` : "支持中英文"}</small></div>
        {sentenceReviewOnly && <p className="browser-hint">这里包含所有句长和场景。点一句开始复习，标记学会后会从这里移除。</p>}
        {(sentenceSavedOnly || sentenceReviewOnly) && <button className="browser-switch" onClick={() => openSentenceBrowser(false)}>‹ 返回句库搜索</button>}
        {!sentenceSavedOnly && !sentenceReviewOnly && <label className="sentence-search"><span aria-hidden="true">⌕</span><input type="search" aria-label="搜索长短句" value={sentenceSearch} onChange={(event) => { setSentenceSearch(event.target.value); setSentenceResultLimit(30); }} placeholder="搜索英文或中文" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="search" /></label>}
        {(sentenceSearch.trim() || sentenceSavedOnly || sentenceReviewOnly) && <div className="sentence-result-list">{sentenceLoading ? <p>正在加载完整句库…</p> : filteredSentences.length ? <>{filteredSentences.slice(0, sentenceResultLimit).map((item) => <button key={item.id} data-sentence-id={item.id} onClick={() => startSentenceSession(false, item)}><div><b lang="en">{item.text}</b><small>{item.translation}</small></div><i>›</i></button>)}<p className="sentence-result-count">已显示 {Math.min(sentenceResultLimit, filteredSentences.length)} / {filteredSentences.length} 句</p>{sentenceResultLimit < filteredSentences.length && <button className="library-more" onClick={() => setSentenceResultLimit((value) => value + 30)}>再显示 30 句</button>}</> : <p>{sentenceSavedOnly ? "还没有收藏句子。学习时点 ☆ 就能在这里找到。" : sentenceReviewOnly ? "当前没有待加强的句子。以后标记“还不熟悉”的句子会出现在这里。" : "没有找到相关句子，请换一个关键词。"}</p>}</div>}
      </div>
      <div className="source-card sentence-license"><b>句库说明</b><p>共 3,000 组 Tatoeba 英汉对应句，短句、常用句、长句各 1,000 句。学习状态和当前卡片位置只保存在当前设备。</p><div><a href="https://tatoeba.org/en/downloads" target="_blank" rel="noreferrer">Tatoeba 数据与授权</a></div></div>
    </section>;
  };

  const renderSentenceCards = () => (
    <section className="page learn-page sentence-learn-page">
      <header className="compact-header"><button className="round-button" onClick={restoreSentenceSetupPreferences} aria-label="返回句库设置并保留进度">‹</button><div><p className="eyebrow">{sentenceBand === "short" ? "短句" : sentenceBand === "medium" ? "常用句" : "长句"} · {sentenceCategories.find((item) => item.id === sentenceCategory)?.label}</p><h1>{sentenceMode === "speak" ? "看中文说英文" : "句子卡片"}</h1></div><button className="round-button" disabled={!currentSentence || (sentenceMode === "speak" && !sentenceTranslationOpen)} onClick={() => currentSentence && playSpeech(currentSentence.text, .68)} aria-label="慢速播放">0.7×</button></header>
      <div className="session-progress" role="progressbar" aria-label="本组句子学习进度" aria-valuemin={0} aria-valuemax={sentenceSessionIds.length} aria-valuenow={ratedSentenceCount}><span style={{ width: `${sentenceSessionIds.length ? ratedSentenceCount / sentenceSessionIds.length * 100 : 0}%` }} /></div><p className="card-count" aria-live="polite">第 {safeSentenceIndex + 1} 张 · 已标记 {ratedSentenceCount} / {sentenceSessionIds.length}</p>
      {sentenceLoadError ? <div className="sentence-card-loading sentence-card-error" role="alert"><div><b>{networkOnline ? "这组句子暂时无法恢复" : "网络已断开，联网后会自动恢复这组句子"}</b><button onClick={() => window.location.reload()}>重新载入页面</button></div></div> : sentenceLoading || !currentSentence ? <div className="sentence-card-loading" role="status">正在恢复这组句子…</div> : <div className="sentence-card sentence-study-card" onTouchStart={beginCardSwipe} onTouchEnd={(event) => { if (!touchStart.current) return; const distanceX = event.changedTouches[0].clientX - touchStart.current.x; const distanceY = event.changedTouches[0].clientY - touchStart.current.y; if (Math.abs(distanceX) > 55 && Math.abs(distanceX) > Math.abs(distanceY) * 1.25) moveSentence(distanceX < 0 ? 1 : -1); touchStart.current = null; }} onTouchCancel={() => { touchStart.current = null; }}>
        <div className="sentence-card-top"><span>{currentSentence.length === "short" ? "短句" : currentSentence.length === "medium" ? "常用句" : "长句"} · {sentenceCategories.find((item) => item.id === currentSentence.category)?.label}</span><button className={currentSentenceSaved ? "saved" : ""} aria-label={currentSentenceSaved ? "取消收藏" : "收藏句子"} onClick={() => setSentenceSaved((items) => currentSentenceSaved ? items.filter((id) => id !== currentSentence.id) : [...items, currentSentence.id])}>{currentSentenceSaved ? "★" : "☆"}</button></div>
        {sentenceMode === "bilingual" ? <><button className="sentence-listen" onClick={() => playSpeech(currentSentence.text, .76)}><span aria-hidden="true">♪</span><b>播放英文</b><small>系统英文语音 · 慢速</small></button><p lang="en" className="sentence-english">{currentSentence.text}</p><button className="sentence-translation-toggle" aria-expanded={sentenceTranslationOpen} onClick={() => setSentenceTranslationOpen((open) => !open)}>{sentenceTranslationOpen ? currentSentence.translation : "点击显示中文翻译"}</button></> : <><div className="speak-prompt"><span>先不要看答案</span><small>看中文，自己完整说出英文</small><p>{currentSentence.translation}</p></div>{sentenceTranslationOpen ? <div id={`sentence-answer-${currentSentence.id}`} ref={sentenceAnswerRef} className="speak-answer" tabIndex={-1} role="status" aria-live="polite" aria-atomic="true"><span>英文答案</span><p lang="en" className="sentence-english">{currentSentence.text}</p><button className="sentence-listen" onClick={() => playSpeech(currentSentence.text, .76)}><span aria-hidden="true">♪</span><b>播放英文</b><small>听一遍核对表达</small></button></div> : <button className="reveal-answer" aria-expanded="false" aria-controls={`sentence-answer-${currentSentence.id}`} onClick={() => setSentenceTranslationOpen(true)}>我说好了，查看英文答案</button>}</>}
        {(sentenceMode === "bilingual" || sentenceTranslationOpen) && <div className="sentence-source">{currentSentence.adapted ? "学习化整理自：" : "来源："}<a href={`https://tatoeba.org/en/sentences/show/${currentSentence.sourceId}`} target="_blank" rel="noreferrer">Tatoeba #{currentSentence.sourceId}</a>{currentSentence.adapted ? <> · 原始英/中贡献者：{currentSentence.author} / {currentSentence.translationAuthor}</> : <> · 英文 {currentSentence.author} · 中文 {currentSentence.translationAuthor}</>}</div>}
      </div>}
      {currentSentence && <div className="sentence-pager" role="group" aria-label="切换句子卡片"><button disabled={safeSentenceIndex === 0} onClick={() => moveSentence(-1)}>‹ 上一句</button><span>{safeSentenceIndex + 1} / {sentenceSessionItems.length}</span><button disabled={safeSentenceIndex === sentenceSessionItems.length - 1} onClick={() => moveSentence(1)}>下一句 ›</button></div>}
      {currentSentence && (sentenceMode === "bilingual" || sentenceTranslationOpen) && <div className="learn-actions"><button className={`secondary-action ${currentSentenceRating === "difficult" ? "is-difficult" : ""}`} onClick={() => finishSentenceCard(false)}>{currentSentenceRating === "difficult" ? "✓ 还不熟悉" : "还不熟悉"}</button><button className={`primary-action ${currentSentenceRating === "known" ? "is-mastered" : ""}`} onClick={() => finishSentenceCard(true)}>{currentSentenceRating === "known" ? "✓ 已学会" : "我学会了"}</button></div>}
    </section>
  );

  const renderPatternSetup = () => {
    const difficultInSelection = availablePatterns.filter((pattern) => patternDifficult.includes(pattern.id)).length;
    return <section className="page sentence-page pattern-page">{commonHeader("核心句型替换", "30 CORE SPEAKING PATTERNS")}
      <p className="page-intro">每个句型包含3组替换练习。先看中文自己说英文，再揭晓答案，练会同一个骨架的不同用法。</p>
      <div className="sentence-section-switch" role="group" aria-label="句子学习内容"><button aria-pressed="false" onClick={() => setSentenceSection("library")}>日常长短句</button><button className="selected" aria-pressed="true">核心句型</button></div>
      {canResumePattern && <button className="resume-session-card" onClick={resumePatternSession}><span>继续上次</span><div><b>未完成的句型替换</b><small>第 {Math.min(patternIndex + 1, patternSessionIds.length)} 个句型 · 替换 {patternDrillIndex + 1} / 3</small></div><i>›</i></button>}
      <div className="sentence-summary pattern-summary"><div><b>{corePatterns.length}</b><small>核心句型</small></div><div><b>{patternMastered.length}</b><small>已掌握</small></div><div><b>{patternDifficult.length}</b><small>待加强</small></div></div>
      <div className="setup-block"><div className="row-heading"><h2>选择使用场景</h2><small>{availablePatterns.length} 个句型</small></div><div className="sentence-categories sentence-category-grid pattern-category-grid" role="group" aria-label="句型场景">{patternCategories.map((category) => <button key={category.id} className={patternCategory === category.id ? "selected" : ""} aria-pressed={patternCategory === category.id} onClick={() => selectPatternCategory(category.id)}>{category.label}</button>)}</div></div>
      <div className="pattern-preview-list">{availablePatterns.slice(0, 6).map((pattern) => <div key={pattern.id}><span>{pattern.title}</span><b lang="en">{pattern.template}</b><small>{pattern.meaning}</small></div>)}</div>
      <p className="session-choice-summary" aria-live="polite"><span>↔</span> 当前：{patternCategories.find((category) => category.id === patternCategory)?.label} · 每组最多10个句型 · 每个3次替换</p>
      <button className="sticky-start primary-action" disabled={!availablePatterns.length} onClick={() => startPatternSession()}>开始句型替换练习</button>
      {difficultInSelection > 0 && <button className="sentence-review-start" onClick={() => startPatternSession(true)}>复习当前范围内 {Math.min(10, difficultInSelection)} 个待加强句型</button>}
    </section>;
  };

  const renderPatternCards = () => (
    <section className="page learn-page pattern-learn-page">
      <header className="compact-header"><button className="round-button" onClick={restorePatternSetupPreferences} aria-label="返回句型设置并保留进度">‹</button><div><p className="eyebrow">{patternCategories.find((category) => category.id === currentPattern?.category)?.label ?? "核心句型"} · 替换练习</p><h1>看中文说英文</h1></div><button className="round-button" disabled={!currentPatternDrill || !patternAnswerOpen} onClick={() => currentPatternDrill && playSpeech(currentPatternDrill.answer, .72)} aria-label="慢速播放">0.7×</button></header>
      <div className="session-progress" role="progressbar" aria-label="核心句型学习进度" aria-valuemin={0} aria-valuemax={patternSessionIds.length} aria-valuenow={ratedPatternCount}><span style={{ width: `${patternSessionIds.length ? ratedPatternCount / patternSessionIds.length * 100 : 0}%` }} /></div><p className="card-count" aria-live="polite">第 {safePatternIndex + 1} 个句型 · 已完成 {ratedPatternCount} / {patternSessionIds.length}</p>
      {currentPattern && currentPatternDrill ? <div className="pattern-card">
        <div className="pattern-template"><span>{currentPattern.title}</span><h2 lang="en">{currentPattern.template}</h2><p>{currentPattern.meaning}</p></div>
        <div className="pattern-drill-count">替换练习 {patternDrillIndex + 1} / 3</div>
        <div className="pattern-prompt"><span>先自己说英文</span><p>{currentPatternDrill.prompt}</p></div>
        {patternAnswerOpen ? <div id={`pattern-answer-${currentPattern.id}-${patternDrillIndex}`} ref={patternAnswerRef} className="pattern-answer" tabIndex={-1} role="status" aria-live="polite" aria-atomic="true"><span>参考答案</span><p lang="en">{currentPatternDrill.answer}</p><div><small>本次替换</small><b lang="en">{currentPatternDrill.slot}</b><button onClick={() => playSpeech(currentPatternDrill.answer, .76)} aria-label="播放参考答案">♪</button></div></div> : <button className="reveal-answer" aria-expanded="false" aria-controls={`pattern-answer-${currentPattern.id}-${patternDrillIndex}`} onClick={() => setPatternAnswerOpen(true)}>我说好了，查看参考答案</button>}
        <div className="pattern-drill-pager" role="group" aria-label="切换句型替换练习"><button disabled={patternDrillIndex === 0} onClick={() => movePatternDrill(-1)}>‹ 上一组</button><span>{patternDrillIndex + 1} / 3</span><button disabled={!patternAnswerOpen || patternDrillIndex === 2} onClick={() => movePatternDrill(1)}>下一组 ›</button></div>
      </div> : <div className="sentence-card-loading" role="status">正在恢复句型练习…</div>}
      {currentPattern && patternAnswerOpen && patternDrillIndex === 2 && <div className="learn-actions"><button className={`secondary-action ${currentPatternRating === "difficult" ? "is-difficult" : ""}`} onClick={() => finishPattern(false)}>{currentPatternRating === "difficult" ? "✓ 继续练习" : "还需练习"}</button><button className={`primary-action ${currentPatternRating === "known" ? "is-mastered" : ""}`} onClick={() => finishPattern(true)}>{currentPatternRating === "known" ? "✓ 已掌握" : "掌握句型"}</button></div>}
    </section>
  );

  const renderPatternResult = () => {
    const difficultCount = Object.values(patternRatings).filter((rating) => rating === "difficult").length;
    return <section className="page result-page"><div className="result-mark">↔</div><p className="eyebrow">PATTERN SESSION COMPLETE</p><h1>句型替换完成了</h1><p>你练习了 {patternSessionIds.length} 个核心句型、共 {patternSessionIds.length * 3} 次替换，其中 {difficultCount} 个已保留在待加强练习中。</p><div className="result-stats"><div><b>{patternSessionIds.length}</b><small>练习句型</small></div><div><b>{patternSessionIds.length * 3}</b><small>替换次数</small></div><div><b>{difficultCount}</b><small>待加强</small></div></div>
      <div className="result-actions">
        {difficultCount > 0 && <button ref={resultPrimaryRef} className="primary-action full-button" onClick={retryDifficultPatterns}>再练这 {difficultCount} 个待加强句型</button>}
        <div className={difficultCount > 0 ? "result-secondary" : undefined}>
          <button ref={difficultCount === 0 ? resultPrimaryRef : undefined} className={difficultCount > 0 ? "text-button" : "primary-action full-button"} onClick={() => { restorePatternSetupPreferences(); setPatternSessionIds([]); setPatternRatings({}); setPatternIndex(0); setPatternDrillIndex(0); }}>再练一组</button>
          <button className="text-button" onClick={() => { restorePatternSetupPreferences(); setPatternSessionIds([]); setPatternRatings({}); setPatternIndex(0); setPatternDrillIndex(0); setTab("home"); }}>回到今天</button>
        </div>
      </div>
    </section>;
  };

  const renderSentenceResult = () => {
    const difficultCount = Object.values(sentenceRatings).filter((rating) => rating === "difficult").length;
    const returnLabel = sentenceReviewOnly ? "返回待加强列表" : sentenceSavedOnly ? "返回收藏句子" : sentenceSessionIds.length === 1 ? "返回句库" : "再学一组";
    return <section className="page result-page"><div className="result-mark">✓</div><p className="eyebrow">SENTENCE SESSION COMPLETE</p><h1>这一组句子完成了</h1><p>你学习了 {sentenceSessionIds.length} 个句子，其中 {difficultCount} 个已保留在待加强练习中。</p><div className="result-stats"><div><b>{sentenceSessionIds.length}</b><small>学习句数</small></div><div><b>{sentenceSessionIds.length - difficultCount}</b><small>本组掌握</small></div><div><b>{difficultCount}</b><small>待加强</small></div></div>
      <div className="result-actions">
        {difficultCount > 0 && <button ref={resultPrimaryRef} className="primary-action full-button" onClick={retryDifficultSentences}>再练这 {difficultCount} 个待加强句子</button>}
        <div className={difficultCount > 0 ? "result-secondary" : undefined}>
          <button ref={difficultCount === 0 ? resultPrimaryRef : undefined} className={difficultCount > 0 ? "text-button" : "primary-action full-button"} onClick={() => { restoreSentenceSetupPreferences(); setSentenceSessionIds([]); setSentenceRatings({}); setSentenceIndex(0); }}>{returnLabel}</button>
          <button className="text-button" onClick={() => { restoreSentenceSetupPreferences(); setSentenceSessionIds([]); setSentenceRatings({}); setSentenceIndex(0); setTab("home"); }}>回到今天</button>
        </div>
      </div>
    </section>;
  };

  const renderSentences = () => sentenceSection === "patterns" ? (patternStage === "setup" ? renderPatternSetup() : patternStage === "cards" ? renderPatternCards() : renderPatternResult()) : (sentenceStage === "setup" ? renderSentenceSetup() : sentenceStage === "cards" ? renderSentenceCards() : renderSentenceResult());

  const renderHome = () => (
    <section className="page home-page">
      <header className="home-header">
        <div><p className="date-line">{dateText}</p><h1>今天，学一点就很好。</h1></div>
        <div className="streak-badge" aria-label={`连续学习 ${streak} 天`}><span>🔥</span><b>{streak}</b></div>
      </header>
      {dueWords.length > 0 && <button className="review-banner home-review-priority" onClick={() => { setReviewView("due"); setReviewIndex(0); setTab("review"); }}><span aria-hidden="true">↻</span><div><b>{dueWords.length} 个词到期了，先复习</b><small>回忆旧词后，再开始新一组学习</small></div><i aria-hidden="true">›</i></button>}
      <button className="hero-card" onClick={() => hasOngoingSession ? setTab("learn") : startSession()} aria-label={hasOngoingSession ? `继续${activePathLabel}${learnStage === "quiz" ? "考试" : "学习"}` : `开始${currentPathLabel}，${currentSessionCount}个词，${currentModeLabel}`}>
        {hasOngoingSession ? <><span className="hero-kicker">继续本组 · {activeScene ? `${activeScene.icon} ${activePathLabel}` : activePathLabel}</span><h2>{learnStage === "quiz" ? `继续第 ${quizIndex + 1} 题` : `继续第 ${index + 1} 张`}</h2><p className="hero-meta" key={`resume-${learnStage}-${quizIndex}-${ratedCardCount}`}><span>{learnStage === "quiz" ? `已完成 ${quizResults.length} / ${sessionWords.length} 题` : `已标记 ${ratedCardCount} / ${sessionWords.length} 个`}</span><span>· 进度已自动保存</span></p></> : <><span className="hero-kicker">今日学习 · {selectedScene ? `${currentPathIcon} ${currentPathLabel}` : nextNgslWord ? `NGSL 从 #${nextNgslWord.rank} 开始` : "NGSL 全库已学习 · 继续巩固"}</span><h2>{currentSessionCount} 个{selectedScene ? `${currentPathLabel}词汇` : "核心词"}</h2><p className="hero-meta" key={`${estimatedMinutes}-${mode}`}><span>约 {estimatedMinutes} 分钟</span><span>· {mode === "test" ? "学完进行填空与听音测试" : "自由滑动学习，不安排考试"}</span></p></>}
        <span className="hero-cta">{hasOngoingSession ? "继续学习" : "开始学习"} <b>→</b></span><i className="orb orb-one" /><i className="orb orb-two" />
      </button>
      <div className="stats-row">
        <button onClick={() => setTab("progress")}><span className="stat-icon mint" aria-hidden="true">✓</span><div><b>{mastered.length}</b><small>已掌握</small></div></button>
        <button onClick={() => { setReviewView("due"); setReviewIndex(0); setTab("review"); }}><span className="stat-icon lilac" aria-hidden="true">↻</span><div><b>{dueWords.length}</b><small>待复习</small></div></button>
        <button onClick={() => { setReviewView("wordbook"); setReviewIndex(0); setTab("review"); }}><span className="stat-icon peach" aria-hidden="true">☆</span><div><b>{difficult.length}</b><small>生词</small></div></button>
      </div>
      <div className="section-heading quick-practice-heading"><div><p className="eyebrow">SPEAK OUT LOUD</p><h2>快速口语练习</h2></div><button onClick={() => setTab("sentences")}>全部内容</button></div>
      <div className="quick-practice-grid"><button onClick={openSentencePracticeFromHome}><span>{hasUnfinishedSentence ? "继续" : "中→EN"}</span><div><b>{hasUnfinishedSentence ? "继续句子练习" : "看中文说英文"}</b><small>{hasUnfinishedSentence ? `第 ${sentenceIndex + 1} / ${sentenceSessionIds.length} 句 · 已标记 ${ratedSentenceCount} 句` : "用 3,000 句练主动表达"}</small></div><i>›</i></button><button onClick={openPatternPracticeFromHome}><span>{hasUnfinishedPattern ? "继续" : "↔"}</span><div><b>{hasUnfinishedPattern ? "继续句型练习" : "核心句型替换"}</b><small>{hasUnfinishedPattern ? `第 ${patternIndex + 1} / ${patternSessionIds.length} 个句型 · 替换 ${patternDrillIndex + 1} / 3` : `${patternMastered.length}/${corePatterns.length} 个句型已掌握`}</small></div><i>›</i></button></div>
      <div className="section-heading"><div><p className="eyebrow">CHOOSE A PATH</p><h2>按场景学习</h2></div><button onClick={() => openLearningSetup()}>自选模式</button></div>
      <div className="scene-strip">
        {scenes.map((scene) => <button key={scene.id} className="scene-card" style={{ background: scene.color }} onClick={() => openLearningSetup(scene.id)}><span>{scene.icon}</span><b>{scene.name}</b><small>{sceneTotals[scene.id]} 个词</small></button>)}
      </div>
      <div className="section-heading"><div><p className="eyebrow">YOUR RHYTHM</p><h2>本周节奏</h2></div><span className="percent">{weeklyStudyCount}/7 天</span></div>
      <div className="week-card">
        {["一", "二", "三", "四", "五", "六", "日"].map((day, dayIndex) => { const key = weekKeys[dayIndex]; const done = Boolean(key && visibleStudyDays.includes(key)); const today = key === todayKey; const state = `${today ? "今天，" : ""}${done ? "已学习" : "未学习"}`; return <div key={day} role="img" aria-label={`星期${day}，${state}`}><span className={[done ? "done" : "", today ? "today" : ""].filter(Boolean).join(" ")} aria-hidden="true">{done ? "✓" : today ? "•" : ""}</span><small aria-hidden="true">{day}</small></div>; })}
      </div>
    </section>
  );

  const renderLearnSetup = () => (
    <section className="page setup-page">
      {commonHeader("开始一组学习", "BUILD A SESSION")}
      <div className="setup-block"><h2>选择学习模式</h2><div className="mode-grid">
        <button className={mode === "free" ? "selected" : ""} aria-pressed={mode === "free"} onClick={() => selectMode("free")}><span>∞</span><b>自由学习</b><small>自由滑动，不安排考试</small></button>
        <button className={mode === "test" ? "selected" : ""} aria-pressed={mode === "test"} onClick={() => selectMode("test")}><span>✎</span><b>学习＋考试</b><small>学完进行英文填空</small></button>
      </div></div>
      <div className="setup-block"><div className="row-heading"><h2>每组词数</h2><small>场景不足时学习全部</small></div><div className="count-switch"><button className={count === 10 ? "selected" : ""} aria-pressed={count === 10} onClick={() => selectCount(10)}>10 个</button><button className={count === 20 ? "selected" : ""} aria-pressed={count === 20} onClick={() => selectCount(20)}>20 个</button></div></div>
      <div className="setup-block"><h2>选择词汇路线</h2><button className={`path-card ${path === "frequency" ? "selected" : ""}`} aria-pressed={path === "frequency"} onClick={() => selectPath("frequency")}><span className="path-icon">NG</span><div><b>NGSL 高频顺序</b><small>官方 1.2 版 · 共 {ngslMeta.count.toLocaleString()} 个通用词</small></div><i>{path === "frequency" ? "✓" : "›"}</i></button>
        <div className="scene-list">{scenes.map((scene) => <button key={scene.id} className={path === scene.id ? "selected" : ""} aria-pressed={path === scene.id} onClick={() => selectPath(scene.id)}><span style={{ background: scene.color }}>{scene.icon}</span><div><b>{scene.name}</b><small>{scene.subtitle}</small></div><i>{path === scene.id ? "✓" : "›"}</i></button>)}</div>
      </div>
      <p className="session-choice-summary" aria-live="polite"><span>{currentPathIcon}</span> 当前：{currentPathLabel} · {currentSessionCount} 个 · {currentModeLabel}</p>
      <button className="sticky-start primary-action" onClick={() => startSession()}>开始这组学习</button>
      <div ref={wordBrowserRef} tabIndex={-1} className="setup-block library-block"><div className="row-heading"><h2>浏览完整词库</h2><small>{librarySearch ? `全库 · ${bandWords.length} 个结果` : `${bandWords.length} 个结果`}</small></div>
        <div className="rank-switch">{([1, 2, 3] as const).map((band) => <button key={band} className={!librarySearch && libraryBand === band ? "selected" : ""} aria-pressed={!librarySearch && libraryBand === band} onClick={() => { setLibraryBand(band); setLibrarySearch(""); setLibraryLimit(24); }}>{band === 1 ? "1–1000" : band === 2 ? "1001–2000" : "2001–2809"}</button>)}</div>
        <label className="library-search"><span aria-hidden="true">⌕</span><input type="search" aria-label="搜索词库" value={librarySearch} onChange={(event) => { setLibrarySearch(event.target.value); setLibraryLimit(24); }} placeholder="搜索英文或中文释义" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="search" /></label>
        <div className="library-list">{bandWords.length ? bandWords.slice(0, libraryLimit).map((word) => <button key={word.id} data-word-id={word.id} onClick={() => startSingleWord(word)}><span>#{word.rank}</span><div><b lang="en">{word.word}</b><small>{word.meaning}</small></div><i>›</i></button>) : <p className="library-empty">没有找到相关词汇，请换一个关键词。</p>}</div>
        {bandWords.length > libraryLimit && <button className="library-more" onClick={() => setLibraryLimit((currentLimit) => currentLimit + 24)}>再显示 {Math.min(24, bandWords.length - libraryLimit)} 个</button>}
        {bandWords.length > 0 && <p className="library-note">已显示 {Math.min(libraryLimit, bandWords.length)} / {bandWords.length} 个；也可以输入关键词直接定位。</p>}
      </div>
    </section>
  );

  const renderCards = () => {
    const singleWordLookup = wordSessionKind === "lookup" && sessionMode === "free" && sessionWords.length === 1;
    return (
    <section className="page learn-page">
      <header className="compact-header"><button className={singleWordLookup ? "library-back" : "round-button"} onClick={() => singleWordLookup ? returnToWordLibrary() : openLearningSetup()} aria-label={singleWordLookup ? "返回词库" : "退出本组"}>{singleWordLookup ? "‹ 词库" : "‹"}</button><div><p className="eyebrow">{sessionPath === "frequency" ? "NGSL 高频词" : scenes.find((item) => item.id === sessionPath)?.name} · {sessionMode === "test" ? "学后测试" : "自由学习"}</p><h1>核心词卡</h1></div><button className="round-button" onClick={() => playSpeech(current.example, .72)} aria-label="慢速播放">0.7×</button></header>
      <div className="session-progress" role="progressbar" aria-label="本组学习进度" aria-valuemin={0} aria-valuemax={sessionWords.length} aria-valuenow={ratedCardCount}><span style={{ width: `${(ratedCardCount / sessionWords.length) * 100}%` }} /></div><p className="card-count" aria-live="polite">第 {index + 1} 张 · 已标记 {ratedCardCount} / {sessionWords.length}</p>
      <div className="word-card" onTouchStart={beginCardSwipe} onTouchEnd={(event) => { if (!touchStart.current) return; const distanceX = event.changedTouches[0].clientX - touchStart.current.x; const distanceY = event.changedTouches[0].clientY - touchStart.current.y; if (Math.abs(distanceX) > 55 && Math.abs(distanceX) > Math.abs(distanceY) * 1.25) moveCard(distanceX < 0 ? 1 : -1); touchStart.current = null; }} onTouchCancel={() => { touchStart.current = null; }}>
        <div className="card-topline"><span className="scene-pill">{sessionPath === "frequency" ? current.rank ? `NGSL #${current.rank}` : "实用场景词组" : `${scenes.find((scene) => scene.id === sessionPath)?.icon} ${scenes.find((scene) => scene.id === sessionPath)?.name}`}</span><button className="sound-button" onClick={() => playSpeech(current.word)} aria-label={`播放 ${current.word} 发音`}>♪</button></div>
        <div className="word-heading"><h2 lang="en" className={current.word.length > 12 ? "long" : ""} ref={wordHeadingRef} tabIndex={-1}>{current.word}</h2><p>{current.phonetic || "点击右上角听发音"}</p><strong>{current.meaning}</strong>{current.exampleForm && current.exampleForm !== current.word && <small>句中形式：{current.exampleForm}</small>}</div><div className="card-divider" />
        <div className="card-section"><span className="section-label">句中搭配</span><div className="chips" lang="en">{current.collocations.map((item) => <span key={item}>{item}</span>)}</div></div>
        <div className="example-box"><div><span className="section-label">场景句子</span><button onClick={() => playSpeech(current.example)} aria-label="播放场景句子">♪</button></div><p lang="en">{highlightedExample(current)}</p><small>{current.translation}</small></div>
      </div>
      <div className="sentence-pager" role="group" aria-label="切换词卡"><button disabled={index === 0} onClick={() => moveCard(-1)}>‹ 上一张</button><span>{index + 1} / {sessionWords.length}</span><button disabled={index === sessionWords.length - 1} onClick={() => moveCard(1)}>下一张 ›</button></div>
      <div className="learn-actions"><button className={`secondary-action ${currentCardRating === "difficult" ? "is-difficult" : ""}`} onClick={() => finishCard(false)}>{currentCardRating === "difficult" ? "✓ 还不熟悉" : "还不熟悉"}</button><button className={`primary-action ${currentCardRating === "known" ? "is-mastered" : ""}`} onClick={() => finishCard(true)}>{currentCardRating === "known" ? "✓ 已学会" : "我学会了"}</button></div>
    </section>
    );
  };

  const renderQuiz = () => {
    const listening = quizIndex % 3 === 1;
    return <section className="page quiz-page">
      <header className="compact-header"><button className="pause-quiz" onClick={() => setTab("home")} aria-label="暂停考试并保留进度">稍后继续</button><div><p className="eyebrow">{listening ? "LISTEN & TYPE" : "FILL THE BLANK"}</p><h1>{listening ? "听音填写" : "英文填空"}</h1></div><span className="quiz-count">{quizIndex + 1}/{sessionWords.length}</span></header>
      <div className="session-progress" role="progressbar" aria-label="本组考试进度" aria-valuemin={1} aria-valuemax={sessionWords.length} aria-valuenow={quizIndex + 1}><span style={{ width: `${((quizIndex + 1) / sessionWords.length) * 100}%` }} /></div>
      <div className="quiz-card"><span className="quiz-type">{listening ? "听完整句子，填写目标词" : "根据句意，补全英文"}</span>
        {listening ? <><button className="big-listen" onClick={() => playSpeech(quizWord.example, .72)}><span aria-hidden="true">♪</span><b>播放句子</b><small>可以重复播放</small></button><p lang="en" className="blank-sentence listening-blank">{blankSentence(quizWord)}</p></> : <p lang="en" className="blank-sentence">{blankSentence(quizWord)}</p>}
        <p className="quiz-translation">{quizWord.translation}</p>
        <label className={`answer-field ${quizFeedback ?? ""}`}><span>你的答案</span><input lang="en" ref={quizInputRef} value={quizAnswer} maxLength={100} onChange={(event) => setQuizAnswer(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); checkQuiz(); } }} autoCapitalize="none" autoCorrect="off" autoComplete="off" spellCheck={false} enterKeyHint="go" placeholder="输入英文单词或词组" disabled={Boolean(quizFeedback)} /></label>
        {quizFeedback && <div className={`feedback-box ${quizFeedback}`} role="status" aria-live="polite"><b>{quizFeedback === "correct" ? "回答正确 ✓" : "再记一下"}</b>{quizFeedback === "wrong" && <p>正确答案：<strong lang="en">{quizWord.exampleForm ?? quizWord.word}</strong>{quizWord.exampleForm && quizWord.exampleForm !== quizWord.word ? `（词条：${quizWord.word}）` : ""}</p>}<button onClick={() => playSpeech(quizWord.example)}>♪ 听完整句</button></div>}
      </div>
      <button ref={quizNextRef} className="sticky-start primary-action" disabled={!quizFeedback && !quizAnswer.trim()} onClick={() => quizFeedback ? nextQuiz() : checkQuiz()}>{quizFeedback ? (quizIndex === sessionWords.length - 1 ? "查看结果" : "下一题") : "提交答案"}</button>
      {!quizFeedback && <button className="quiz-skip text-button" onClick={() => checkQuiz(true)}>想不起来，查看答案</button>}
    </section>;
  };

  const renderResult = () => {
    const score = quizResults.filter(Boolean).length;
    const tested = sessionMode === "test" && quizResults.length > 0;
    const singleWordLookup = wordSessionKind === "lookup" && sessionMode === "free" && sessionWords.length === 1;
    const missedWords = tested ? sessionWords.filter((_, wordIndex) => quizResults[wordIndex] === false) : [];
    const sessionDifficultCount = sessionWords.filter((word) => difficultSet.has(word.id)).length;
    return <section className="page result-page"><div className="result-mark">{tested && score / quizResults.length >= .8 ? "★" : "✓"}</div><p className="eyebrow">SESSION COMPLETE</p><h1>这一组完成了</h1><p>{tested ? (missedWords.length ? `答对 ${score} / ${quizResults.length}，错词已自动加入生词本。` : `答对 ${score} / ${quizResults.length}，系统已安排后续复习。`) : `你学习了 ${sessionWords.length} 个词，系统已安排后续复习。`}</p>
      <div className="result-stats"><div><b>{sessionWords.length}</b><small>学习词数</small></div><div><b>{tested ? `${Math.round(score / quizResults.length * 100)}%` : mastered.length}</b><small>{tested ? "正确率" : "累计掌握"}</small></div><div><b>{tested ? quizResults.filter((item) => !item).length : sessionDifficultCount}</b><small>{tested ? "本组错词" : "待加强"}</small></div></div>
      <div className="result-actions">{singleWordLookup ? <><button ref={resultPrimaryRef} className="primary-action full-button" onClick={returnToWordLibrary}>返回词库，继续查词</button><button className="text-button" onClick={() => { setTab("home"); setLearnStage("setup"); }}>回到今天</button></> : missedWords.length > 0 || (!tested && sessionDifficultCount > 0) ? <><button ref={resultPrimaryRef} className="primary-action full-button" onClick={tested ? retryMissedWords : retryDifficultWords}>{tested ? `再练这 ${missedWords.length} 个错词` : `再练这 ${sessionDifficultCount} 个待加强单词`}</button><div className="result-secondary"><button className="text-button" onClick={() => { setTab("home"); setLearnStage("setup"); }}>回到今天</button><button className="text-button" onClick={() => setLearnStage("setup")}>再学一组</button></div></> : <><button ref={resultPrimaryRef} className="primary-action full-button" onClick={() => { setTab("home"); setLearnStage("setup"); }}>回到今天</button><button className="text-button" onClick={() => setLearnStage("setup")}>再学一组</button></>}</div>
      {missedWords.length > 0 && <div className="result-mistakes"><h2>这次需要巩固的词</h2><p>点击听例句，也可以重练词卡后再测试。</p><div>{missedWords.map((word) => <button key={word.id} onClick={() => playSpeech(word.example)} aria-label={`播放 ${word.word} 的例句`}><span><b lang="en">{word.word}</b><small>{word.meaning}</small></span><i aria-hidden="true">♪</i></button>)}</div></div>}
    </section>;
  };

  const renderLearn = () => learnStage === "setup" ? renderLearnSetup() : learnStage === "cards" ? renderCards() : learnStage === "quiz" ? renderQuiz() : renderResult();

  const renderRead = () => (
    <section className={`page reading-page ${activeReading ? "reading-detail-page" : ""}`}>
      {!activeReading && <>{commonHeader("分级阅读", "READ & LISTEN")}<p className="page-intro">15 篇完整原创文章，从基础叙事逐步升级，同时练习阅读能力和整段听力。</p></>}
      {readingLoadError ? <div className="content-load-state" role="alert"><b>阅读内容暂时没有加载成功</b><span>{networkOnline ? "重新载入页面即可重试；已加载过的内容会保留在离线缓存中。" : "当前处于离线状态，联网后会自动重试。"}</span><button onClick={() => window.location.reload()}>重新载入页面</button></div> : !readings.length ? <div className="content-load-state" role="status" aria-live="polite"><b>正在载入分级阅读…</b><span>首次打开后会自动保存，之后离线也能阅读。</span></div> : activeReading ? <article className="reading-detail">
        <button className="back-line" onClick={returnToReadings}>‹ {readingFilter === "review" ? "返回待巩固文章" : `返回 Level ${activeReading.level}`}</button>
        <p className="eyebrow">LEVEL {activeReading.level} · COMPLETE STORY</p>
        <h1 ref={readingHeadingRef} tabIndex={-1} lang="en">{activeReading.title}</h1>
        <p className="reading-zh-title">{activeReading.titleZh}</p>
        <p className="reading-meta">{readingWordCount(activeReading.text)} 词 · 约 {readingMinutes(activeReading.text)} 分钟</p>
        <div className="reading-audio-controls">
          <button className="listen-strip" onClick={() => controlReadingSpeech(activeReading)} disabled={readingSpeechState === "loading"} aria-label={readingSpeechState === "loading" ? "正在准备全文朗读" : readingSpeechState === "playing" ? "暂停全文朗读" : readingSpeechState === "paused" ? "继续全文朗读" : "播放全文"}>
            <span aria-hidden="true">♪</span>
            <div><b aria-live="polite">{readingSpeechState === "loading" ? "正在准备朗读…" : readingSpeechState === "playing" ? "暂停朗读" : readingSpeechState === "paused" ? "继续朗读" : "播放全文"}</b><small>{readingSpeechState === "idle" ? `系统英文语音 · 自动分段 · ${READING_SPEECH_RATES.find((rate) => rate.value === readingSpeechRate)?.detail}` : readingSpeechState === "loading" ? "正在启动系统语音 · 请稍候" : readingSpeechState === "playing" ? "正在分段播放 · 可随时暂停" : "已暂停 · 点击继续"}</small></div>
            <i aria-hidden="true">{readingSpeechState === "loading" ? "…" : readingSpeechState === "playing" ? "Ⅱ" : "▶"}</i>
          </button>
          {readingSpeechState !== "idle" && <button className="reading-audio-stop" onClick={stopSpeech} aria-label="停止全文朗读"><span aria-hidden="true">■</span><small>停止</small></button>}
        </div>
        <div className="reading-speed-control" role="group" aria-label="全文朗读速度"><span>朗读速度</span><div>{READING_SPEECH_RATES.map((rate) => <button key={rate.value} className={readingSpeechRate === rate.value ? "selected" : ""} aria-pressed={readingSpeechRate === rate.value} onClick={() => { stopSpeech(); setReadingSpeechRate(rate.value); }}>{rate.label}<small>{rate.detail}</small></button>)}</div></div>
        <div lang="en" className="reading-text">{activeReading.text.split("\n\n").map((paragraph, paragraphIndex) => <p key={paragraphIndex}>{paragraph}</p>)}</div>
        <button className="translation-toggle" aria-expanded={showTranslation} aria-controls={`reading-translation-${activeReading.id}`} onClick={() => setShowTranslation(!showTranslation)}>{showTranslation ? "隐藏中文" : "显示完整中文翻译"}</button>
        {showTranslation && <div id={`reading-translation-${activeReading.id}`} className="reading-translation">{activeReading.translation.split("\n\n").map((paragraph, paragraphIndex) => <p key={paragraphIndex}>{paragraph}</p>)}</div>}
        {activeReadingQuestion && <section className="reading-question" aria-labelledby={`reading-question-${activeReading.id}`}><p className="eyebrow">QUICK CHECK</p><h2 id={`reading-question-${activeReading.id}`}>读完想一想：{activeReadingQuestion.question}</h2><div ref={readingQuestionOptionsRef} className="reading-question-options" role="group" aria-label="阅读理解选项">{activeReadingQuestion.options.map((option, optionIndex) => { const answered = selectedReadingAnswer !== undefined; const correct = optionIndex === activeReadingQuestion.answer; const selected = optionIndex === selectedReadingAnswer; const classes = [selected ? "selected" : "", answered && correct ? "correct" : "", answered && selected && !correct ? "wrong" : ""].filter(Boolean).join(" "); return <button key={option} className={classes} aria-pressed={selected} disabled={answered} onClick={() => { noteStudyDay(); setReadingAnswers((answers) => ({ ...answers, [activeReading.id]: optionIndex })); setReadingRetryId(null); }}><span>{String.fromCharCode(65 + optionIndex)}</span><b>{option}</b></button>; })}</div>{selectedReadingAnswer !== undefined && <div ref={readingFeedbackRef} tabIndex={-1} className={`reading-question-feedback ${selectedReadingAnswer === activeReadingQuestion.answer ? "correct" : "wrong"}`} role="status" aria-live="polite"><b>{selectedReadingAnswer === activeReadingQuestion.answer ? "回答正确 ✓" : "再看一眼正文"}</b><p>{activeReadingQuestion.explanation}</p><button onClick={() => retryReadingQuestion(activeReading.id, selectedReadingAnswer)}>{selectedReadingAnswer === activeReadingQuestion.answer ? "再答一次" : "重新作答"}</button></div>}</section>}
        <button className={`reading-complete-action ${completedReadingSet.has(activeReading.id) ? "completed" : ""}`} aria-pressed={completedReadingSet.has(activeReading.id)} onClick={() => toggleReadingCompleted(activeReading)}>{completedReadingSet.has(activeReading.id) ? "✓ 本篇已完成 · 点击取消" : "标记本篇已读"}</button>
        <div className="reading-focus"><span className="section-label">重点词 · 点击加入生词本</span><div>{activeReading.focus.map((focus) => { const match = allStudyWords.find((word) => word.word === focus); const isSaved = difficult.includes(match?.id ?? -1); return <button key={focus} lang="en" disabled={!match || isSaved} onClick={() => { if (match) addDifficult(match.id); }}>{isSaved ? "✓ 已加入 " : "+ "}{focus}</button>; })}</div></div>
        <div className="reading-next-actions">{nextReading && <button className="reading-next" onClick={() => { setReadingFilter("all"); openReading(nextReading); }}><span><small>下一篇未读 · Level {nextReading.level}</small><b lang="en">{nextReading.title}</b><em>{nextReading.titleZh}</em></span><i aria-hidden="true">→</i></button>}<button className="text-button" onClick={returnToReadings}>返回阅读列表</button></div>
      </article> : <>
        <div className="reading-overview"><div><span>阅读完成度</span><b>{readingCompleted.length} / {READING_TOTAL}</b></div><div><i><em style={{ width: `${readingCompletionPercent}%` }} /></i><small>{readingCompletionPercent}% · 完成标记会进入本机备份</small></div></div>
        <div className="reading-filters" role="group" aria-label="筛选阅读文章">{([{ id: "all", label: "全部" }, { id: "unread", label: "未读" }, { id: "review", label: `待巩固 ${readings.filter(readingNeedsReview).length}` }] as const).map((filter) => <button key={filter.id} className={readingFilter === filter.id ? "selected" : ""} aria-pressed={readingFilter === filter.id} onClick={() => setReadingFilter(filter.id)}>{filter.label}</button>)}</div>
        {readingFilter === "review" ? <p className="browser-hint">这里汇总所有等级中答错的文章。重新作答后会更新，答对后从待巩固列表移除。</p> : <div className="level-switch" role="group" aria-label="阅读难度">{([1, 2, 3] as const).map((level) => <button key={level} className={readingLevel === level ? "selected" : ""} aria-pressed={readingLevel === level} onClick={() => { setReadingLevel(level); setReadingId(null); }}>Level {level}<small>{level === 1 ? "60–90 词" : level === 2 ? "120–180 词" : "220–300 词"}</small></button>)}</div>}
        {readingFilter !== "review" && lastReading && <button className="reading-resume" onClick={() => openReading(lastReading)}><span>↻</span><div><small>{completedReadingSet.has(lastReading.id) ? "上次已完成 · 再读一次" : "继续上次阅读"}</small><b lang="en">{lastReading.title}</b><p>{lastReading.titleZh} · Level {lastReading.level}</p></div><i>›</i></button>}
        <div ref={readingListRef} tabIndex={-1} className="reading-list">{visibleReadings.length ? visibleReadings.map((item) => <button key={item.id} data-reading-id={item.id} className={`reading-card ${completedReadingSet.has(item.id) ? "completed" : ""}`} onClick={() => openReading(item)}><span className="reading-number">{completedReadingSet.has(item.id) ? "✓" : String(readings.filter((reading) => reading.level === item.level).findIndex((reading) => reading.id === item.id) + 1).padStart(2, "0")}</span><div><small>Level {item.level} · {readingWordCount(item.text)} 词 · 约 {readingMinutes(item.text)} 分钟{completedReadingSet.has(item.id) ? " · 已读" : ""}</small><h2 lang="en">{item.title}</h2><p>{item.titleZh}</p>{readingAnswers[item.id] !== undefined && <small className={`reading-answer-status ${readingNeedsReview(item) ? "needs-review" : ""}`}>{readingNeedsReview(item) ? "理解题待巩固" : "理解题已答对"}</small>}<div className="focus-row">{item.focus.map((focus) => <span key={focus} lang="en">{focus}</span>)}</div></div><i>›</i></button>) : <div className="reading-empty" role="status"><b>{readingFilter === "review" ? "当前没有待巩固的文章" : "这个等级的文章都已读完"}</b><p>{readingFilter === "review" ? "理解题答错后会出现在这里，方便以后再练。" : "可以切换等级继续阅读，或回到全部文章温习。"}</p><button className="browser-switch" onClick={() => setReadingFilter("all")}>查看全部文章</button></div>}</div>
      </>}
    </section>
  );

  const renderReview = () => {
    const reviewWords = reviewView === "due" ? dueWords : wordbookWords;
    const safeReviewIndex = Math.min(reviewIndex, Math.max(reviewWords.length - 1, 0));
    const reviewWord = reviewWords[safeReviewIndex] ?? null;
    const answerOpen = reviewWord ? reviewRevealedWordId === reviewWord.id : false;
    return <section className="page review-page">{commonHeader("复习中心", "SPACED REPETITION")}
      <p className="page-intro">按记忆强度安排间隔，容易忘的词会更早出现。</p>
      {reviewUndo && <div className="review-undo"><div role="status" aria-live="polite"><b lang="en">{reviewUndo.word}</b><span>{reviewUndo.label}</span></div><button onClick={undoReviewAction}>撤销上次</button></div>}
      <div className="segment-control" role="group" aria-label="复习内容"><button className={reviewView === "due" ? "selected" : ""} aria-pressed={reviewView === "due"} onClick={() => { setReviewView("due"); setReviewIndex(0); setReviewRevealedWordId(null); }}>今日复习 <span>{dueWords.length}</span></button><button className={reviewView === "wordbook" ? "selected" : ""} aria-pressed={reviewView === "wordbook"} onClick={() => { setReviewView("wordbook"); setReviewIndex(0); setReviewRevealedWordId(null); }}>生词本 <span>{wordbookWords.length}</span></button></div>
      {reviewWord ? <div className="review-card">
        <div className="review-top"><span>{reviewView === "due" ? "先回忆，再揭晓答案" : "先尝试回忆这个词"}</span><button aria-label={`播放 ${reviewWord.word} 发音`} onClick={() => playSpeech(reviewWord.word)}>♪</button></div>
        <h2 ref={reviewHeadingRef} tabIndex={-1} lang="en">{reviewWord.word}</h2><p>{reviewWord.phonetic || "点击播放发音"}</p>
        {answerOpen ? <div id={`review-answer-${reviewWord.id}`} ref={reviewAnswerRef} className="review-answer" tabIndex={-1} role="status" aria-live="polite"><strong>{reviewWord.meaning}</strong><div className="mini-example"><p lang="en">{highlightedExample(reviewWord)}</p><small>{reviewWord.translation}</small></div></div> : <button className="review-reveal" aria-expanded="false" aria-controls={`review-answer-${reviewWord.id}`} onClick={() => revealReviewAnswer(reviewWord.id)}>显示答案</button>}
        <div className="review-pager" role="group" aria-label="切换复习词"><button aria-label="上一个复习词" disabled={safeReviewIndex === 0} onClick={() => { setReviewIndex(safeReviewIndex - 1); setReviewRevealedWordId(null); }}>‹</button><span>{safeReviewIndex + 1} / {reviewWords.length}</span><button aria-label="下一个复习词" disabled={safeReviewIndex === reviewWords.length - 1} onClick={() => { setReviewIndex(safeReviewIndex + 1); setReviewRevealedWordId(null); }}>›</button></div>
      </div> : <div className="empty-state"><span>✓</span><h2 ref={reviewHeadingRef} tabIndex={-1}>{reviewView === "due" ? (nextReviewDue !== null ? "暂时没有到期的词" : hasWordStudyHistory ? "当前没有待复习的词" : "还没有需要复习的词") : "生词本还是空的"}</h2><p>{reviewView === "due" ? (nextReviewDue !== null ? <>下次复习<strong className="next-review-time">{formatReviewDue(nextReviewDue, todayKey)}</strong>到时会自动出现在这里，也可以先去学习新词。</> : hasWordStudyHistory ? "继续学习新词，系统会安排下一次复习。" : "先完成一组学习，系统会按记忆规律安排复习。") : "测试答错或标记“还不熟悉”的词会出现在这里。"}</p><button onClick={() => openLearningSetup()}>去学习新词</button></div>}
      {reviewWord && answerOpen && reviewView === "due" && <div className="rating-grid" role="group" aria-label="评价记忆程度"><button onClick={() => rateReview("again")}><b>忘了</b><small>10 分钟后</small></button><button onClick={() => rateReview("hard")}><b>困难</b><small>1 天后</small></button><button onClick={() => rateReview("good")}><b>记得</b><small>{reviewIntervalDays(schedule[reviewWord.id]?.stage ?? 0, "good")} 天后</small></button><button onClick={() => rateReview("easy")}><b>简单</b><small>{reviewIntervalDays(schedule[reviewWord.id]?.stage ?? 0, "easy")} 天后</small></button></div>}
      {reviewWord && answerOpen && reviewView === "wordbook" && <button className="primary-action full-button" onClick={() => markWordbookMastered(reviewWord.id)}>这个词已经会了</button>}
    </section>;
  };

  const renderProgress = () => (
    <section className="page progress-page">{commonHeader("学习进度", "YOUR PROGRESS")}
      <div className="progress-hero"><div><span>NGSL 1.2 掌握度</span><strong>{progress}<small>%</small></strong><p>{masteredNgslCount} / {words.length} 个通用高频词</p></div><div className="progress-ring" aria-hidden="true" style={{ "--value": `${progress * 3.6}deg` } as React.CSSProperties}><span>{progress}%</span></div></div>
      <div className="progress-mini-grid"><article><span>🔥</span><b>{visibleStudyDays.length}</b><small>学习天数</small></article><article><span>✎</span><b>{difficult.length}</b><small>需要加强</small></article><article><span>↻</span><b>{dueWords.length}</b><small>今日复习</small></article></div>
      <button className="sentence-progress-panel" onClick={() => setTab("sentences")}><span>“”</span><div><p><b>句子与核心句型</b><small>{sentenceMastered.length}/3,000 句 · {patternMastered.length}/{corePatterns.length} 句型</small></p><i><em style={{ width: `${Math.min(sentenceMastered.length / 30, 100)}%` }} /></i></div><strong>›</strong></button>
      <button className="sentence-progress-panel reading-progress-panel" onClick={() => setTab("read")}><span>◫</span><div><p><b>分级阅读</b><small>{readingCompleted.length}/{READING_TOTAL} 篇已读{readingLast ? " · 可继续上次文章" : ""}</small></p><i><em style={{ width: `${readingCompletionPercent}%` }} /></i></div><strong>›</strong></button>
      <div className="progress-section"><div className="section-heading"><div><p className="eyebrow">BY SCENE</p><h2>场景掌握情况</h2></div></div><div className="scene-progress-list">{scenes.map((scene) => { const sceneWords = scenePacks[scene.id]; const sceneDone = sceneWords.filter((word) => masteredSet.has(word.id)).length; const value = Math.round(sceneDone / sceneWords.length * 100); return <div key={scene.id}><span style={{ background: scene.color }}>{scene.icon}</span><div><p><b>{scene.name}</b><small>{sceneDone}/{sceneWords.length}</small></p><i><em style={{ width: `${value}%` }} /></i></div></div>; })}</div></div>
      <div className="progress-section"><div className="section-heading"><div><p className="eyebrow">NEEDS ATTENTION</p><h2>容易错的词</h2></div><button onClick={() => { setReviewView("wordbook"); setReviewIndex(0); setTab("review"); }}>去复习</button></div>{wordbookWords.length ? <div className="trouble-list">{wordbookWords.slice(0, 5).map((word) => <button key={word.id} onClick={() => playSpeech(word.word)}><div><b lang="en">{word.word}</b><small>{word.meaning}</small></div><span>♪</span></button>)}</div> : <div className="clean-slate">目前没有错词，继续保持。</div>}</div>
      <div className="source-card"><b>词库说明</b><p>完整收录 NGSL 1.2 的 {ngslMeta.count.toLocaleString()} 个词条，并按官方 SFI 词频顺序排列；另含 {sceneExtras.length} 个实用场景词组。中文释义基于 ECDICT；例句基于 Tatoeba 并经过学习化整理，每个词条均配有完整场景例句。</p><div><a href="https://www.newgeneralservicelist.com/new-general-service-list" target="_blank" rel="noreferrer">NGSL · CC BY-SA 4.0</a><a href="https://github.com/skywind3000/ECDICT" target="_blank" rel="noreferrer">ECDICT · MIT</a><a href="https://tatoeba.org/en/downloads" target="_blank" rel="noreferrer">Tatoeba · CC BY 2.0 FR</a></div></div>
      <div className="backup-management"><div><b>学习记录备份</b><small>换手机或清理 Safari 前，导出一个本机备份文件。</small></div><div className="backup-actions"><button disabled={Boolean(backupBusy)} onClick={exportLearningBackup}>{backupBusy === "export" ? "正在导出…" : "导出备份"}</button><button disabled={Boolean(backupBusy)} onClick={() => backupInputRef.current?.click()}>{backupBusy === "read" ? "正在读取…" : "恢复备份"}</button></div>{backupBusy === "read" && <div className="backup-read-status" role="status"><span>正在读取备份文件…</span><button onClick={cancelBackupRead}>取消读取</button></div>}<input ref={backupInputRef} hidden type="file" accept=".json,application/json" onChange={chooseBackupFile} /></div>
      {backupNotice && <div className={`backup-notice ${backupNotice.kind}`} role={backupNotice.kind === "error" ? "alert" : "status"}><span>{backupNotice.message}</span><button aria-label="关闭备份提示" onClick={() => setBackupNotice(null)}>×</button></div>}
      <div className="data-management"><div><b>重置学习进度</b><small>清除单词、句子、句型、阅读和复习记录</small></div><button disabled={Boolean(backupBusy)} onClick={() => setResetProgressOpen(true)}>重置</button></div>
      {!standalone && iosInstallAvailable && <button className="install-card" onClick={() => setInstallOpen(true)}><span>＋</span><div><b>添加到 iPhone 主屏幕</b><small>像 App 一样打开，学习记录保存在本机</small></div><i>›</i></button>}
    </section>
  );

  if (!wordData || !hydrated) return <main className="app-shell"><div className="phone-stage app-loading" role="status" aria-live="polite"><div className="loading-mark" aria-hidden="true">EN</div><b>{wordDataLoadError ? "核心词库暂时没有加载成功" : "词流英语"}</b><span>{wordDataLoadError ? (networkOnline ? "已保存成功下载的数据；重新载入页面可恢复缺少部分。" : "当前处于离线状态，联网后会自动继续载入。") : wordDataLoadedPacks ? `核心词库已加载 ${wordDataLoadedPacks}/3，正在继续…` : "正在载入核心词库并恢复学习进度…"}</span>{wordDataLoadError && <button onClick={() => window.location.reload()}>重新载入页面</button>}</div></main>;

  return <main className="app-shell"><div className="phone-stage" style={speechNotice || offlineCacheWriteError || !networkOnline ? { paddingBottom: statusToastHeight + 64 } : undefined}>
    <div inert={hasOpenDialog}>
    <div className="sr-only" aria-live="polite" aria-atomic="true">{screenAnnouncement}</div>
    {storageWriteError && <div className="storage-warning" role="alert"><div><b>学习记录暂未保存</b><span>请关闭 Safari 无痕浏览，并确认设备还有可用存储空间。</span></div><button aria-label="关闭保存失败提示" onClick={() => setStorageWriteError(false)}>×</button></div>}
    {(speechNotice || offlineCacheWriteError || !networkOnline) && <div className="status-toast-stack" ref={statusToastRef}>{speechNotice && <div className="speech-warning" role="alert"><span>{speechNotice}</span><button aria-label="关闭语音提示" onClick={() => setSpeechNotice(null)}>×</button></div>}{offlineCacheWriteError && <div className="speech-warning offline-cache-warning" role="alert"><span>本次内容可以正常使用，但设备没有保存离线副本。请检查 Safari 隐私模式和可用空间。</span><button aria-label="关闭离线保存提示" onClick={() => setOfflineCacheWriteError(false)}>×</button></div>}{!networkOnline && <div className="offline-status" role="status">离线模式 · 已加载内容和本机记录仍可使用</div>}</div>}
    {tab === "home" ? renderHome() : tab === "learn" ? renderLearn() : tab === "sentences" ? renderSentences() : tab === "read" ? renderRead() : tab === "review" ? renderReview() : renderProgress()}
    {!(tab === "learn" && (learnStage === "quiz" || learnStage === "result")) && <nav className="bottom-nav" aria-label="主导航">{tabItems.map((item) => <button key={item.id} className={tab === item.id ? "active" : ""} aria-current={tab === item.id ? "page" : undefined} onClick={() => setTab(item.id)}><span aria-hidden="true">{item.icon}</span><small>{item.label}</small></button>)}</nav>}
    </div>
    {activeDialog === "install" && <div className="sheet-backdrop" onClick={() => setInstallOpen(false)}><div ref={installSheetRef} tabIndex={-1} className="install-sheet" role="dialog" aria-modal="true" aria-labelledby="install-title" onClick={(event) => event.stopPropagation()}><div className="sheet-handle" /><button ref={installCloseRef} className="sheet-close" aria-label="关闭安装说明" onClick={() => setInstallOpen(false)}>×</button><div className="app-preview"><span className="app-preview-icon" aria-hidden="true" /><div><b>词流英语</b><small>添加到主屏幕</small></div></div><h2 id="install-title">在 Safari 中安装</h2><ol><li><span>1</span><p>点击 Safari 底部的<strong>分享按钮</strong>。</p></li><li><span>2</span><p>向下找到并点击<strong>“添加到主屏幕”</strong>。</p></li><li><span>3</span><p>点击右上角<strong>“添加”</strong>即可。</p></li></ol><button className="primary-action full-button" onClick={() => setInstallOpen(false)}>我知道了</button></div></div>}
    {activeDialog === "discard" && discardRequest && <div className="sheet-backdrop discard-backdrop" onClick={() => setDiscardRequest(null)}><div ref={discardDialogRef} tabIndex={-1} className="discard-dialog" role="dialog" aria-modal="true" aria-labelledby="discard-title" aria-describedby="discard-description" onClick={(event) => event.stopPropagation()}><span className="discard-icon" aria-hidden="true">↻</span><h2 id="discard-title">结束当前学习？</h2><p id="discard-description">{discardRequest.pattern ? `本组已完成 ${ratedPatternCount} / ${patternSessionIds.length} 个句型。` : discardRequest.sentence ? `本组已标记 ${ratedSentenceCount} / ${sentenceSessionIds.length} 个句子。` : learnStage === "quiz" ? `考试已完成 ${quizResults.length} / ${sessionWords.length} 题。` : `本组已标记 ${ratedCardCount} / ${sessionWords.length} 个词。`}已有记录都会保留，但未完成位置将结束。{(discardRequest.sentenceStart || discardRequest.patternStart) && "确认后会直接开始你刚刚选择的练习。"}</p><div className="discard-actions"><button ref={discardCancelRef} className="secondary-action" onClick={() => setDiscardRequest(null)}>保留进度</button><button className="discard-confirm" onClick={confirmDiscardSession}>{discardRequest.sentenceStart || discardRequest.patternStart ? "结束并开始新练习" : "结束本组"}</button></div></div></div>}
    {activeDialog === "reset" && <div className="sheet-backdrop discard-backdrop" onClick={() => setResetProgressOpen(false)}><div ref={resetDialogRef} tabIndex={-1} className="discard-dialog reset-dialog" role="dialog" aria-modal="true" aria-labelledby="reset-title" aria-describedby="reset-description" onClick={(event) => event.stopPropagation()}><span className="discard-icon reset-icon" aria-hidden="true">!</span><h2 id="reset-title">确定重置学习进度？</h2><p id="reset-description">单词、句子、核心句型和阅读的掌握记录、待加强内容、复习计划、学习天数以及未完成课程都会被清除。<strong>句库收藏和学习偏好会保留。</strong></p><div className="discard-actions"><button ref={resetCancelRef} className="secondary-action" onClick={() => setResetProgressOpen(false)}>取消</button><button className="reset-confirm" onClick={resetLearningProgress}>确认重置</button></div></div></div>}
    {activeDialog === "restore" && pendingBackup && <div className="sheet-backdrop discard-backdrop" onClick={() => { if (!backupBusy) setPendingBackup(null); }}><div ref={restoreDialogRef} tabIndex={-1} className="discard-dialog restore-dialog" role="dialog" aria-modal="true" aria-labelledby="restore-title" aria-describedby="restore-description" aria-busy={backupBusy === "restore"} onClick={(event) => event.stopPropagation()}><span className="discard-icon restore-icon" aria-hidden="true">↥</span><h2 id="restore-title">恢复这份学习记录？</h2><p id="restore-description">备份时间：{new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(pendingBackup.exportedAt))}<br />包含 {backupItemCount(pendingBackup, STORAGE.mastered)} 个已掌握单词、{backupItemCount(pendingBackup, STORAGE.sentenceMastered)} 个已掌握句子、{backupItemCount(pendingBackup, STORAGE.patternMastered)} 个已掌握句型和 {backupItemCount(pendingBackup, STORAGE.readingCompleted)} 篇已读文章。<strong>恢复后会替换这台设备当前的全部学习记录和偏好。</strong></p><div className="discard-actions"><button ref={restoreCancelRef} disabled={backupBusy === "restore"} className="secondary-action" onClick={() => setPendingBackup(null)}>取消</button><button disabled={backupBusy === "restore"} className="restore-confirm" onClick={restoreLearningBackup}>{backupBusy === "restore" ? "正在恢复…" : "确认恢复"}</button></div></div></div>}
    {activeDialog === "sync" && <div className="sheet-backdrop discard-backdrop sync-backdrop"><div ref={syncDialogRef} tabIndex={-1} className="discard-dialog sync-dialog" role="alertdialog" aria-modal="true" aria-labelledby="sync-title" aria-describedby="sync-description"><span className="discard-icon sync-icon" aria-hidden="true">↻</span><h2 id="sync-title">另一窗口已更新记录</h2><p id="sync-description">为避免旧页面覆盖最新学习进度，此页面已暂停。请只保留一个 English Flow 学习窗口，再载入最新记录继续。</p><button ref={syncReloadRef} className="primary-action full-button" onClick={() => window.location.reload()}>载入最新记录</button></div></div>}
  </div></main>;
}
