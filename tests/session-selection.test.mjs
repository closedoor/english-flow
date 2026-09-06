import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const speechPlayback = await readFile(new URL("../app/speech-playback.ts", import.meta.url), "utf8");

test("home session uses the learner's current choices", () => {
  assert.doesNotMatch(page, /startSession\("frequency",\s*"test",\s*10\)/);
  assert.match(page, /hasOngoingSession \? setTab\("learn"\) : startSession\(\)/);
  assert.match(page, /currentPathLabel/);
  assert.match(page, /currentSessionCount/);
  assert.match(page, /currentModeLabel/);
});

test("an ongoing session resumes instead of being silently overwritten", () => {
  assert.match(page, /const hasOngoingSession = learnStage === "cards" \|\| learnStage === "quiz"/);
  assert.match(page, /继续本组/);
  assert.match(page, /setDiscardRequest\(nextPath \? \{ path: nextPath \} : \{\}\)/);
  assert.match(page, /id="discard-title">结束当前学习/);
  assert.match(page, /className="discard-confirm" onClick=\{confirmDiscardSession\}/);
  assert.match(page, /进度已自动保存/);
  assert.match(page, /activeScene \? `\$\{activeScene\.icon\} \$\{activePathLabel\}` : activePathLabel/);
  assert.doesNotMatch(page, /activeScene\?\.icon \?\? "NG"/);
});

test("paused sentence and pattern sessions cannot be silently replaced", () => {
  assert.match(page, /if \(sentenceStage === "setup" && sentenceSessionIds\.length && sentenceResumeSnapshotRef\.current\) \{[\s\S]*?setDiscardRequest\(\{ sentence: true, sentenceStart: \{ reviewOnly, singleSentence \} \}\);[\s\S]*?return;/);
  assert.match(page, /if \(patternStage === "setup" && patternSessionIds\.length && patternResumeSnapshotRef\.current\) \{[\s\S]*?setDiscardRequest\(\{ pattern: true, patternStart: \{ reviewOnly \} \}\);[\s\S]*?return;/);
  assert.match(page, /if \(discardRequest\?\.sentence\) \{[\s\S]*?setSentenceSessionIds\(\[\]\)/);
  assert.match(page, /if \(discardRequest\?\.pattern\) \{[\s\S]*?setPatternSessionIds\(\[\]\)/);
});

test("confirming a replacement immediately continues the requested sentence or pattern practice", () => {
  assert.match(page, /const pendingStart = discardRequest\.sentenceStart;[\s\S]*?beginSentenceSession\(pendingStart\.reviewOnly, pendingStart\.singleSentence\)/);
  assert.match(page, /const pendingStart = discardRequest\.patternStart;[\s\S]*?beginPatternSession\(pendingStart\.reviewOnly\)/);
  assert.match(page, /const beginSentenceSession/);
  assert.match(page, /const beginPatternSession/);
  assert.match(page, /结束并开始新练习/);
  assert.match(page, /确认后会直接开始你刚刚选择的练习/);
});

test("browsing one library word does not replace the saved learning path", () => {
  assert.match(page, /const \[sessionPath, setSessionPath\]/);
  const singleWord = page.split("const startSingleWord", 2)[1].split("const finishCard", 1)[0];
  assert.match(singleWord, /setSessionPath\("frequency"\)/);
  assert.doesNotMatch(singleWord, /saveSessionPreferences\(\{ path: "frequency" \}\)/);
  assert.match(page, /path: sessionPath/);
});

test("new NGSL words advance before difficult and completed words", () => {
  const startSession = page.split("const startSession", 2)[1].split("const startSingleWord", 1)[0];
  assert.match(startSession, /const unseen =/);
  assert.match(startSession, /const needsReview =/);
  assert.match(startSession, /const completed =/);
  assert.match(startSession, /\[unseen, needsReview, completed\]\.reduce/);
  assert.match(startSession, /groupIndex === 0 \? group\.slice\(0, remaining\) : takeRotatedSpread/);
  assert.match(startSession, /practiceRotationRef\.current\.word/);
});

test("fast repeated taps cannot rate multiple cards or quiz answers", () => {
  assert.match(page, /if \(cardActionLock\.current\) return/);
  assert.match(page, /if \(quizActionLock\.current\.submitted >= quizIndex\) return/);
  assert.match(page, /quizActionLock\.current\.advanced >= quizIndex/);
  assert.match(page, /if \(reviewActionLock\.current\) return/);
  assert.match(page, /setTimeout\(\(\) => \{ cardActionLock\.current = false; \}, 350\)/);
});

test("major screen transitions return to the top", () => {
  // The browsing-return branch restores its previous position; ordinary views still start at the top.
  assert.match(page, /else \{\s+window\.scrollTo\(\{ top: 0, left: 0, behavior: "auto" \}\)/);
  assert.match(page, /\[hydrated, index, learnStage, patternDrillIndex, patternIndex, patternStage, quizIndex, readingId, readingLevel, reviewIndex, reviewView, sentenceIndex, sentenceSection, sentenceStage, tab\]/);
});

test("iPhone repaints changing home summary text without overlapping glyphs", () => {
  assert.match(page, /className="hero-meta" key=\{`\$\{estimatedMinutes\}-\$\{mode\}`\}/);
  assert.match(page, /<span>约 \{estimatedMinutes\} 分钟<\/span><span>·/);
  assert.match(styles, /-webkit-text-size-adjust:100%/);
  assert.match(styles, /\.hero-meta\{[^}]*line-height:20px[^}]*contain:paint/);
  assert.match(styles, /font-family:-apple-system,BlinkMacSystemFont/);
});

test("session choices persist across reloads", () => {
  assert.match(page, /wordflow-session-preferences-v1/);
  assert.match(page, /saveSessionPreferences/);
  assert.match(page, /setPreferences\(normalizedSession\)/);
  assert.match(page, /setPreferences\(\(current\) => \(\{ \.\.\.current, \.\.\.patch \}\)\)/);
  assert.match(page, /writeJson\(STORAGE\.session, preferences\)/);
});

test("wrong and difficult words are removed from mastered progress", () => {
  const addDifficult = page.split("const addDifficult", 2)[1].split("const markMastered", 1)[0];
  assert.match(addDifficult, /saveMastered\(\(currentMastered\) => currentMastered\.filter/);
  assert.match(addDifficult, /saveDifficult/);
});

test("rapid local updates compose instead of overwriting one another", () => {
  assert.match(page, /setMastered\(\(current\) => typeof update === "function" \? update\(current\) : update\)/);
  assert.match(page, /setDifficult\(\(current\) => typeof update === "function" \? update\(current\) : update\)/);
  assert.match(page, /setSchedule\(\(current\) => typeof update === "function" \? update\(current\) : update\)/);
  assert.match(page, /setStudyDays\(\(current\) => current\.includes\(today\)/);
});

test("forgotten reviews wait before returning to the due queue", () => {
  assert.match(page, /const REVIEW_AGAIN_DELAY = 10 \* 60_000/);
  assert.match(page, /now \+ REVIEW_AGAIN_DELAY/);
  assert.match(page, /10 分钟后/);
});

test("free learning results count words marked for reinforcement", () => {
  assert.match(page, /const sessionDifficultCount = sessionWords\.filter/);
  assert.match(page, /tested \? quizResults\.filter[\s\S]*: sessionDifficultCount/);
  assert.match(page, /tested \? "本组错词" : "待加强"/);
});

test("the first mastered words do not display as zero percent progress", () => {
  assert.match(page, /preciseProgress > 0 && preciseProgress < 1 \? Number\(preciseProgress\.toFixed\(2\)\)/);
});

test("review shortcuts open the intended review list", () => {
  const homeSection = page.split("const renderHome", 2)[1].split("const renderLearnSetup", 1)[0];
  const progressSection = page.split("const renderProgress", 2)[1].split("return <main", 1)[0];
  assert.match(homeSection, /setReviewView\("due"\)/);
  assert.match(progressSection, /setReviewView\("wordbook"\)/);
});

test("stored progress is cleaned and difficult words take priority", () => {
  assert.match(page, /function cleanStoredWordIds/);
  assert.match(page, /function cleanStoredSchedule/);
  assert.match(page, /validMastered = cleanStoredWordIds\(storedMastered\)\.filter\(\(id\) => !difficultIds\.has\(id\)\)/);
  assert.match(page, /writeJson\(STORAGE\.mastered, validMastered\)/);
});

test("swiping ahead cannot finish a session before every card is rated", () => {
  const finishCard = page.split("const finishCard", 2)[1].split("const moveCard", 1)[0];
  assert.match(finishCard, /const nextRatings/);
  assert.match(finishCard, /sessionWords\.findIndex\(\(word, wordIndex\) => wordIndex > index && !nextRatings\[word\.id\]\)/);
  assert.match(finishCard, /sessionWords\.findIndex\(\(word\) => !nextRatings\[word\.id\]\)/);
  assert.doesNotMatch(finishCard, /index < sessionWords\.length - 1/);
});

test("review due times refresh while the app remains open", () => {
  assert.match(page, /const refreshClocks = \(\) => \{[\s\S]*setReviewClock\(current\.getTime\(\)\)/);
  assert.match(page, /setInterval\(refreshClocks, 30_000\)/);
  assert.match(page, /\[allStudyWords, difficult, schedule, reviewClock\]/);
});

test("review queue prioritizes the earliest due words", () => {
  assert.match(page, /\.sort\(\(left, right\) => \(schedule\[left\.id\]\?\.due \?\? Number\.NEGATIVE_INFINITY\) - \(schedule\[right\.id\]\?\.due \?\? Number\.NEGATIVE_INFINITY\)/);
});

test("review ratings always apply to the word currently displayed after the queue changes", () => {
  const reviewRater = page.split("const rateReview", 2)[1].split("const markWordbookMastered", 1)[0];
  assert.match(reviewRater, /const safeIndex = Math\.min\(reviewIndex, Math\.max\(dueWords\.length - 1, 0\)\)/);
  assert.match(reviewRater, /const item = dueWords\[safeIndex\] \?\? null/);
  assert.doesNotMatch(reviewRater, /dueWords\[reviewIndex\] \?\? dueWords\[0\]/);
});

test("a study day starts after real learning activity", () => {
  const startSession = page.split("const startSession", 2)[1].split("const startSingleWord", 1)[0];
  const startSingleWord = page.split("const startSingleWord", 2)[1].split("const finishCard", 1)[0];
  const finishCard = page.split("const finishCard", 2)[1].split("const moveCard", 1)[0];
  assert.doesNotMatch(startSession, /noteStudyDay/);
  assert.doesNotMatch(startSingleWord, /noteStudyDay/);
  assert.match(finishCard, /noteStudyDay/);
  const openReading = page.split("const openReading", 2)[1].split("const toggleReadingCompleted", 1)[0];
  assert.match(openReading, /setReadingId\(reading\.id\)/);
  assert.doesNotMatch(openReading, /noteStudyDay\(\)/);
  const renderRead = page.split("const renderRead", 2)[1].split("const renderReview", 1)[0];
  assert.match(renderRead, /onClick=\{\(\) => \{ noteStudyDay\(\); setReadingAnswers/);
  const controlReadingSpeech = page.split("const controlReadingSpeech", 2)[1].split("const exportLearningBackup", 1)[0];
  assert.match(controlReadingSpeech, /startSegmentedSpeech\(reading\.text, readingSpeechRate, noteStudyDay\)/);
});

test("library and reading edge states have explicit behavior", () => {
  assert.match(page, /setLibraryBand\(band\); setLibrarySearch\(""\)/);
  assert.match(page, /没有找到相关词汇，请换一个关键词/);
  assert.match(page, /disabled=\{!match \|\| isSaved\}/);
  assert.match(page, /✓ 已加入/);
});

test("corrupt or unavailable Safari storage cannot break learning", () => {
  assert.match(page, /function writeJson[\s\S]*try[\s\S]*localStorage\.setItem[\s\S]*catch/);
  assert.match(page, /STORAGE_ERROR_EVENT = "english-flow-storage-error"/);
  assert.match(page, /window\.dispatchEvent\(new Event\(STORAGE_ERROR_EVENT\)\)/);
  assert.match(page, /role="alert"/);
  assert.match(page, /学习记录暂未保存/);
  assert.match(page, /const storedDays = readJson<unknown>/);
  assert.match(page, /storedSessionValue && typeof storedSessionValue === "object" && !Array\.isArray/);
  assert.match(page, /item\.stage === "quiz" && item\.mode !== "test"/);
  assert.match(page, /item\.stage === "quiz" && hasUnfinishedRatings\(wordIds, ratings\)/);
  assert.match(page, /rawQuizResults\.length !== quizIndex \+ \(hasCurrentFeedback \? 1 : 0\)/);
  assert.match(page, /rawQuizResults\.at\(-1\) !== \(item\.quizFeedback === "correct"\)/);
  assert.match(page, /const maximumScheduleDue = Date\.now\(\) \+ 365 \* DAY/);
  assert.match(page, /Number\(item\.due\) >= 0 && Number\(item\.due\) <= maximumScheduleDue/);
});

test("a stale second window is paused before it can overwrite newer progress", () => {
  assert.match(page, /window\.addEventListener\("storage", handleExternalStorageUpdate\)/);
  assert.match(page, /STORAGE_KEYS\.includes\(event\.key as StorageKey\)/);
  assert.match(page, /setExternalUpdateDetected\(true\)/);
  assert.match(page, /role="alertdialog" aria-modal="true"/);
  assert.match(page, /另一窗口已更新记录/);
  assert.match(page, /window\.location\.reload\(\)/);
  assert.match(styles, /\.sync-backdrop\{z-index:70\}/);
});

test("study history is not capped and the calendar rolls over at midnight", () => {
  const noteStudyDay = page.split("const noteStudyDay", 2)[1].split("const addDifficult", 1)[0];
  assert.doesNotMatch(noteStudyDay, /slice\(-60\)/);
  assert.match(page, /if \(nextDateKey !== displayedDateKey\)/);
  assert.match(page, /setTodayKey\(nextDateKey\)/);
  assert.match(page, /visibilitychange/);
  assert.match(page, /isValidStudyDate/);
  assert.match(page, /\{weeklyStudyCount\}\/7 天/);
});

test("vertical scrolling cannot accidentally swipe to another card", () => {
  assert.match(page, /distanceX/);
  assert.match(page, /distanceY/);
  assert.match(page, /Math\.abs\(distanceX\) > Math\.abs\(distanceY\) \* 1\.25/);
  assert.match(page, /onTouchCancel/);
  assert.match(page, /event\.target\.closest\('button, a, input, textarea, select/);
});

test("the complete library can progressively reveal every result", () => {
  assert.match(page, /const \[libraryLimit, setLibraryLimit\] = useState\(24\)/);
  assert.match(page, /bandWords\.slice\(0, libraryLimit\)/);
  assert.match(page, /setLibraryLimit\(\(currentLimit\) => currentLimit \+ 24\)/);
  assert.match(page, /已显示 \{Math\.min\(libraryLimit, bandWords\.length\)\} \/ \{bandWords\.length\}/);
});

test("example highlighting does not match letters inside another word", () => {
  const highlighter = page.split("function highlightedExample", 2)[1].split("export default", 1)[0];
  assert.match(highlighter, /const before =/);
  assert.match(highlighter, /const after =/);
  assert.match(highlighter, /\/\[A-Za-z\]\/\.test\(before\)/);
  assert.match(highlighter, /\/\[A-Za-z\]\/\.test\(after\)/);
});

test("selection controls expose their state to assistive technology", () => {
  assert.match(page, /aria-pressed=\{mode === "free"\}/);
  assert.match(page, /aria-pressed=\{readingLevel === level\}/);
  assert.match(page, /aria-current=\{tab === item\.id \? "page" : undefined\}/);
  assert.match(page, /role="dialog" aria-modal="true"/);
  assert.match(page, /event\.key !== "Tab"/);
  assert.match(page, /aria-describedby="discard-description"/);
});

test("English learning content is announced with the correct language", () => {
  assert.match(page, /<h2 lang="en" className=\{current\.word\.length/);
  assert.match(page, /<p lang="en" className="sentence-english">/);
  assert.match(page, /<div lang="en" className="reading-text">/);
  assert.match(page, /<input lang="en" ref=\{quizInputRef\}/);
  assert.match(styles, /@media\(prefers-reduced-motion:reduce\)/);
  assert.match(page, /<span aria-hidden="true">\{item\.icon\}<\/span>/);
});

test("speech stops when the learner changes cards, screens or leaves the app", () => {
  assert.match(speechPlayback, /export function stopSpeech\(\)[\s\S]*activeUtterance = null[\s\S]*window\.speechSynthesis\.cancel\(\)/);
  assert.match(page, /window\.addEventListener\("pagehide", stopSpeech\)/);
  assert.match(page, /const currentReviewWordId = tab === "review" \? reviewWordsForSpeech\[Math\.min\(reviewIndex/);
  assert.match(page, /\[current\?\.id, currentPattern\?\.id, currentReviewWordId, currentSentence\?\.id, learnStage, patternDrillIndex, patternStage, quizWord\?\.id, readingId, reviewView, sentenceSection, sentenceStage, tab\]/);
});

test("small secondary controls meet phone touch target sizes", () => {
  assert.match(styles, /\.section-heading button\{min-width:44px;min-height:44px/);
  assert.match(styles, /\.source-card a\{min-height:44px/);
  assert.match(styles, /\.sheet-close\{width:44px;height:44px\}/);
  assert.match(styles, /\.feedback-box button\{min-height:44px/);
});

test("sentence filters, retry actions and pattern audio meet phone touch targets", () => {
  assert.match(styles, /\.sentence-categories button,\.sentence-load-error button,\.sentence-card-error button\{min-height:44px\}/);
  assert.match(styles, /\.pattern-answer button\{width:44px;height:44px\}/);
});

test("quiz keyboard is dismissed for feedback and restored for the next answer", () => {
  assert.match(page, /const quizInputRef = useRef<HTMLInputElement \| null>\(null\)/);
  assert.match(page, /const quizNextRef = useRef<HTMLButtonElement \| null>\(null\)/);
  assert.match(page, /quizInputRef\.current\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(page, /quizNextRef\.current\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(page, /quizInputRef\.current\?\.blur\(\)/);
  assert.match(page, /ref=\{quizInputRef\}/);
  assert.match(page, /ref=\{quizNextRef\}/);
  assert.match(page, /!event\.nativeEvent\.isComposing/);
  assert.match(page, /event\.preventDefault\(\); checkQuiz\(\)/);
  assert.match(page, /autoComplete="off" spellCheck=\{false\}/);
});

test("quiz answers normalize full-width input from mobile keyboards", () => {
  assert.match(page, /value\.normalize\("NFKC"\)/);
});

test("saved progress is restored behind a stable loading screen", () => {
  assert.match(page, /if \(!wordData \|\| !hydrated\) return <main className="app-shell">/);
  assert.match(page, /正在载入核心词库并恢复学习进度/);
  assert.match(styles, /\.app-loading\{/);
});

test("learning progress can be reset without deleting sentence bookmarks or preferences", () => {
  assert.match(page, /重置学习进度/);
  assert.match(page, /确定重置学习进度/);
  const reset = page.split("const resetLearningProgress", 2)[1].split("const addDifficult", 1)[0];
  for (const key of ["mastered", "difficult", "schedule", "days", "activeSession", "sentenceSeen", "sentenceMastered", "sentenceDifficult", "sentenceActiveSession", "patternMastered", "patternDifficult", "patternActiveSession"]) {
    assert.match(reset, new RegExp(`STORAGE\\.${key}`));
  }
  assert.match(reset, /STORAGE\.practiceRotation/);
  assert.match(reset, /setReadingAnswers\(\{\}\)/);
  assert.match(reset, /practiceRotationRef\.current = \{ word: 0, sentence: 0, pattern: 0 \}/);
  assert.doesNotMatch(reset, /STORAGE\.sentenceSaved/);
  assert.doesNotMatch(reset, /STORAGE\.session/);
  assert.doesNotMatch(reset, /STORAGE\.sentencePreferences/);
  assert.match(page, /句库收藏和学习偏好会保留/);
});

test("an interrupted card or quiz session resumes after Safari reloads", () => {
  assert.match(page, /wordflow-active-session-v1/);
  assert.match(page, /function cleanActiveSession/);
  assert.match(page, /ACTIVE_SESSION_TTL = 30 \* DAY/);
  assert.match(page, /setLearnStage\(storedActiveSession\.stage\)/);
  assert.match(page, /setTab\("learn"\)/);
  assert.match(page, /stage: learnStage/);
  assert.match(page, /removeStoredValue\(STORAGE\.activeSession\)/);
});

test("quiz input and restored quiz sessions enforce consistent bounded state", () => {
  assert.match(page, /maxLength=\{100\}/);
  const cleaner = page.split("function cleanActiveSession", 2)[1].split("function localDateKey", 1)[0];
  assert.match(cleaner, /item\.stage === "quiz" && hasUnfinishedRatings/);
  assert.match(cleaner, /!Number\.isInteger\(item\.quizIndex\)/);
  assert.match(cleaner, /item\.quizResults\.every\(\(result\) => typeof result === "boolean"\)/);
  assert.match(cleaner, /rawQuizResults\.length !== quizIndex \+ \(hasCurrentFeedback \? 1 : 0\)/);
});

test("reload opens the most recently used unfinished learning module", () => {
  assert.match(page, /const latestSession = \[/);
  assert.match(page, /\.sort\(\(left, right\) => right\.updatedAt - left\.updatedAt\)\[0\]/);
  assert.match(page, /latestSession\?\.kind === "sentence"/);
  assert.match(page, /latestSession\?\.kind === "pattern"/);
  assert.match(page, /latestSession\?\.kind === "word"/);
});

test("sentence and pattern resume cards keep their own most recent section", () => {
  assert.match(page, /const preferredSentenceSection: SentenceSection/);
  assert.match(page, /storedPatternActiveSession\.updatedAt > storedSentenceActiveSession\.updatedAt/);
  assert.match(page, /setSentenceSection\(preferredSentenceSection\)/);
});

test("restoring sessions does not falsely refresh their recency", () => {
  assert.match(page, /function sessionPayloadMatches/);
  assert.match(page, /activeSessionResumeSnapshotRef/);
  assert.match(page, /sessionPayloadMatches\(previous, payload\) \? previous!\.updatedAt : Date\.now\(\)/);
});
