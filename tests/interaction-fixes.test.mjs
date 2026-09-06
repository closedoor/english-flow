import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const readingSource = await readFile(new URL("../app/reading-data.ts", import.meta.url), "utf8");
const readingJavaScript = ts.transpileModule(readingSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const readingData = await import(`data:text/javascript;base64,${Buffer.from(readingJavaScript).toString("base64")}`);

function sourceBetween(startMarker, endMarker) {
  const start = page.indexOf(startMarker);
  const end = page.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return page.slice(start, end);
}

function openingTagWithClass(region, className) {
  const match = region.match(new RegExp(`<[a-z][^>]*\\bclassName="${className}"[^>]*>`, "i"));
  assert.ok(match, `missing element with class ${className}`);
  return match[0];
}

function assertEnglishElement(region, tagName, expression) {
  const escapedExpression = expression.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = region.match(new RegExp(`<${tagName}\\b[^>]*>\\{${escapedExpression}\\}</${tagName}>`));
  assert.ok(match, `missing <${tagName}> for {${expression}}`);
  assert.match(match[0], /\blang="en"/, `{${expression}} must be marked as English`);
}

function listChromeIsGuarded(renderRead, marker) {
  const markerIndex = renderRead.indexOf(marker);
  assert.notEqual(markerIndex, -1, `missing reading marker: ${marker}`);
  const nearbyPrefix = renderRead.slice(Math.max(0, markerIndex - 1_500), markerIndex);
  if (/!activeReading\s*(?:&&|\?)/.test(nearbyPrefix)) return true;

  const positiveBranch = renderRead.lastIndexOf("activeReading ?", markerIndex);
  const detail = renderRead.indexOf('className="reading-detail"', positiveBranch);
  return positiveBranch >= 0 && detail > positiveBranch && detail < markerIndex;
}

test("revealed speaking answers are announced and receive focus", () => {
  const sentenceCards = sourceBetween("const renderSentenceCards", "const renderPatternSetup");
  const patternCards = sourceBetween("const renderPatternCards", "const renderPatternResult");
  const sentenceAnswer = openingTagWithClass(sentenceCards, "speak-answer");
  const patternAnswer = openingTagWithClass(patternCards, "pattern-answer");

  for (const [tag, refName] of [[sentenceAnswer, "sentenceAnswerRef"], [patternAnswer, "patternAnswerRef"]]) {
    assert.match(tag, new RegExp(`\\bref=\\{${refName}\\}`));
    assert.match(tag, /\btabIndex=\{-1\}/);
    assert.match(tag, /\baria-live="polite"/);
    assert.match(tag, /\baria-atomic="true"/);
  }

  assert.match(page, /sentenceAnswerRef\.current\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(page, /patternAnswerRef\.current\?\.focus\(\{ preventScroll: true \}\)/);
});

test("every reading has one valid comprehension question and the detail view renders it", () => {
  const { readings, readingQuestions } = readingData;
  assert.equal(readings.length, 15);
  assert.deepEqual(Object.keys(readingQuestions).sort(), readings.map((item) => item.id).sort());

  for (const reading of readings) {
    const question = readingQuestions[reading.id];
    assert.equal(typeof question.question, "string");
    assert.ok(question.question.trim().length > 0, `${reading.id} needs a question`);
    assert.equal(question.options.length, 3, `${reading.id} needs three choices`);
    assert.ok(question.options.every((option) => typeof option === "string" && option.trim()), `${reading.id} has an empty choice`);
    assert.ok(Number.isInteger(question.answer) && question.answer >= 0 && question.answer < question.options.length, `${reading.id} has an invalid answer`);
    assert.ok(question.explanation.trim().length > 0, `${reading.id} needs answer feedback`);
  }

  const renderRead = sourceBetween("const renderRead", "const renderReview");
  assert.match(renderRead, /activeReadingQuestion/);
  assert.match(renderRead, /activeReadingQuestion\.options\.map/);
  assert.match(renderRead, /setReadingAnswers/);
  assert.match(renderRead, /selectedReadingAnswer/);
  assert.match(renderRead, /阅读理解|理解检查/);
  assert.match(renderRead, /aria-live="polite"/);
  assert.match(renderRead, /selectedReadingAnswer === activeReadingQuestion\.answer \? "再答一次" : "重新作答"/);
  assert.match(renderRead, /ref=\{readingFeedbackRef\} tabIndex=\{-1\}/);
  assert.match(renderRead, /retryReadingQuestion\(activeReading\.id, selectedReadingAnswer\)/);
  assert.match(page, /readingQuestionOptionsRef\.current\?\.querySelectorAll<HTMLButtonElement>\("button"\)\[optionIndex\]\?\.focus/);
  assert.match(styles, /\.reading-question-feedback button\{min-height:44px/);
});

test("review cards require recall before revealing answers or ratings", () => {
  const review = sourceBetween("const renderReview", "const renderProgress");
  assert.match(review, /const answerOpen = reviewWord \? reviewRevealedWordId === reviewWord\.id : false/);
  assert.match(review, /answerOpen \? <div[^>]*className="review-answer"/);
  assert.match(review, /显示答案/);
  assert.match(review, /reviewWord && answerOpen && reviewView === "due"/);
  assert.match(review, /setReviewRevealedWordId\(null\)/);
  assert.match(page, /revealReviewAnswer[\s\S]*reviewAnswerRef\.current\?\.focus/);
});

test("view changes are announced and completed sessions move focus to an action", () => {
  const announcement = sourceBetween("const screenAnnouncement", "useEffect(() => {");
  assert.match(page, /className="sr-only" aria-live="polite" aria-atomic="true">\{screenAnnouncement\}/);
  assert.match(page, /resultPrimaryRef\.current\?\.focus\(\{ preventScroll: true \}\)/);
  assert.ok((page.match(/ref=\{resultPrimaryRef\}/g) ?? []).length >= 3);
  assert.match(announcement, /sentenceMode === "speak" \? `句子卡 \$\{safeSentenceIndex \+ 1\}，请根据中文说英文` : `句子卡 \$\{safeSentenceIndex \+ 1\}，\$\{currentSentence\.text\}`/);
});

test("content recovery reloads the document so failed dynamic imports are retried", () => {
  assert.ok((page.match(/onClick=\{\(\) => window\.location\.reload\(\)\}>重新载入页面<\/button>/g) ?? []).length >= 4);
});

test("card swipes ignore touches that begin on interactive controls", () => {
  assert.match(page, /event\.target\.closest\('button, a, input, textarea, select/);
  assert.equal((page.match(/onTouchStart=\{beginCardSwipe\}/g) ?? []).length, 2);
});

test("small-screen dialogs scroll and key actions meet contrast and focus requirements", () => {
  assert.match(styles, /\.install-sheet,\.discard-dialog\{max-height:calc\(100dvh/);
  assert.match(styles, /\.sheet-backdrop\{overflow-y:auto/);
  assert.match(styles, /outline:3px solid #0f6b55/);
  assert.match(styles, /\.primary-action\{background:var\(--green-dark\)/);
  assert.match(styles, /\.reading-complete-action\.completed\{border-color:#397c66;background:#397c66/);
});

test("an open article omits library-only introduction, progress and level controls", () => {
  const renderRead = sourceBetween("const renderRead", "const renderReview");
  for (const marker of ['className="page-intro"', 'className="reading-overview"', 'className="level-switch"']) {
    assert.ok(listChromeIsGuarded(renderRead, marker), `${marker} must stay in the reading-library branch`);
  }
  assert.match(renderRead, /className="reading-detail"/);
  assert.match(renderRead, /className="back-line"[^>]*>[\s\S]{0,120}?返回/);
  assert.match(renderRead, /className="back-line" onClick=\{returnToReadings\}/);
});

test("all speech controls expose an unavailable-browser message", () => {
  const shortSpeech = sourceBetween("const playSpeech", "const controlReadingSpeech");
  assert.match(shortSpeech, /if \(!speak\(text, rate\)\)/);
  assert.match(shortSpeech, /setSpeechNotice\("[^"\n]+"\)/);

  const readingSpeech = sourceBetween("const controlReadingSpeech", "const exportLearningBackup");
  assert.match(readingSpeech, /if \(!isSpeechSupported\(\)\) \{[\s\S]*?setSpeechNotice\("[^"\n]+"\);[\s\S]*?return;/);

  const directSpeechCalls = [...page.matchAll(/\bspeak\(/g)];
  assert.equal(directSpeechCalls.length, 1, "UI speech buttons must use the feedback-aware playSpeech helper");
  const noticeMatch = page.match(/\{speechNotice && <(?:div|p)\b[^>]*>[\s\S]{0,400}?\{speechNotice\}/);
  assert.ok(noticeMatch, "speech failures need a visible message");
  assert.ok(/role="alert"/.test(noticeMatch[0]) || (/role="status"/.test(noticeMatch[0]) && /aria-live="polite"/.test(noticeMatch[0])), "the speech failure message must be announced");
});

test("empty states explain the next useful action without claiming progress that never happened", () => {
  const sentenceSetup = sourceBetween("const renderSentenceSetup", "const renderSentenceCards");
  assert.match(sentenceSetup, /sentenceSavedOnly \? "还没有收藏句子/);
  assert.match(sentenceSetup, /: "没有找到相关句子/);

  const review = sourceBetween("const renderReview", "const renderProgress");
  assert.match(review, /hasWordStudyHistory/);
  assert.match(review, /还没有需要复习的词/);
  assert.match(review, /先完成一组学习/);
  assert.doesNotMatch(review, /reviewView === "due" \? "今天已经复习完了"/);
});

test("English content in mixed-language lists carries an explicit language tag", () => {
  const sentenceSetup = sourceBetween("const renderSentenceSetup", "const renderSentenceCards");
  const patternSetup = sourceBetween("const renderPatternSetup", "const renderPatternCards");
  const learnSetup = sourceBetween("const renderLearnSetup", "const renderCards");
  const renderRead = sourceBetween("const renderRead", "const renderReview");
  const progress = sourceBetween("const renderProgress", "if (!wordData || !hydrated)");

  assertEnglishElement(sentenceSetup, "b", "item.text");
  assertEnglishElement(patternSetup, "b", "pattern.template");
  assertEnglishElement(learnSetup, "b", "word.word");
  assertEnglishElement(renderRead, "b", "lastReading.title");
  assertEnglishElement(renderRead, "h2", "item.title");
  assertEnglishElement(progress, "b", "word.word");
});

test("today remains visually distinct after the learner completes it", () => {
  const home = sourceBetween("const renderHome", "const renderLearnSetup");
  const weekStart = home.indexOf('className="week-card"');
  assert.notEqual(weekStart, -1, "missing weekly rhythm grid");
  const week = home.slice(weekStart, weekStart + 1_500);

  assert.doesNotMatch(week, /done \? "done" : today \? "today"/);
  assert.match(week, /done \? "done" : ""/);
  assert.match(week, /today \? "today" : ""/);
  assert.match(week, /aria-label=\{`星期\$\{day\}，\$\{state\}`\}/);
});
