import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

function sourceBetween(startMarker, endMarker) {
  const start = page.indexOf(startMarker);
  const end = page.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return page.slice(start, end);
}

function sourceBeforeMarker(region, marker, characters = 500) {
  const markerIndex = region.indexOf(marker);
  assert.notEqual(markerIndex, -1, `missing region marker: ${marker}`);
  return region.slice(Math.max(0, markerIndex - characters), markerIndex);
}

test("sentence sessions never reveal Chinese automatically", () => {
  assert.match(page, /\[sentenceTranslationOpen, setSentenceTranslationOpen\] = useState\(false\)/);

  const transitions = [
    ["const beginSentenceSession", "const startSentenceSession"],
    ["const resumeSentenceSession", "const finishSentenceCard"],
    ["const finishSentenceCard", "const moveSentence"],
    ["const moveSentence", "const beginPatternSession"],
  ];

  for (const [start, end] of transitions) {
    const transition = sourceBetween(start, end);
    assert.match(transition, /setSentenceTranslationOpen\(false\)/, `${start} must hide Chinese before displaying a card`);
    assert.doesNotMatch(transition, /setSentenceTranslationOpen\([^\n;]*(?:sentenceMode|snapshot\.mode)[^\n;]*\)/);
  }
});

test("resume affordances only show for unfinished work and handlers require a validated snapshot", () => {
  const sentenceSetup = sourceBetween("const renderSentenceSetup", "const renderSentenceCards");
  const patternSetup = sourceBetween("const renderPatternSetup", "const renderPatternCards");
  assert.match(page, /const canResumeSentence = sentenceStage === "setup" && sentenceSessionIds\.length > ratedSentenceCount/);
  assert.match(page, /const canResumePattern = patternStage === "setup" && patternSessionIds\.length > ratedPatternCount/);
  assert.match(sourceBeforeMarker(sentenceSetup, 'className="resume-session-card"'), /canResumeSentence/);
  assert.match(sourceBeforeMarker(patternSetup, 'className="resume-session-card"'), /canResumePattern/);

  const sentenceStarter = sourceBetween("const startSentenceSession", "const resumeSentenceSession");
  const patternStarter = sourceBetween("const startPatternSession", "const resumePatternSession");
  assert.match(sentenceStarter, /if \([^)]*sentenceSessionIds\.length[^)]*sentenceResumeSnapshotRef\.current[^)]*\)/);
  assert.match(patternStarter, /if \([^)]*patternSessionIds\.length[^)]*patternResumeSnapshotRef\.current[^)]*\)/);

  const sentenceResume = sourceBetween("const resumeSentenceSession", "const finishSentenceCard");
  const patternResume = sourceBetween("const resumePatternSession", "const movePatternDrill");
  assert.match(sentenceResume, /newestSnapshot\(cleanSentenceSession\([\s\S]*?\), sentenceResumeSnapshotRef\.current\)/);
  assert.match(patternResume, /newestSnapshot\(cleanPatternSession\([\s\S]*?\), patternResumeSnapshotRef\.current\)/);
  assert.match(sentenceResume, /if \(!snapshot\) return/);
  assert.match(patternResume, /if \(!snapshot\) return/);

  assert.match(page, /sentenceStage === "result"\) \{[\s\S]{0,180}?sentenceResumeSnapshotRef\.current = null/);
  assert.match(page, /patternStage === "result"\) \{[\s\S]{0,180}?patternResumeSnapshotRef\.current = null/);

  const sentenceCleaner = sourceBetween("function cleanSentenceSession", "function cleanPatternSession");
  const patternCleaner = sourceBetween("function cleanPatternSession", "function cleanStoredSchedule");
  const wordCleaner = sourceBetween("function cleanActiveSession", "function localDateKey");
  assert.match(sentenceCleaner, /if \(!hasUnfinishedRatings\(sentenceIds, ratings\)\) return null/);
  assert.match(patternCleaner, /if \(!hasUnfinishedRatings\(patternIds, ratings\)\) return null/);
  assert.match(wordCleaner, /item\.stage === "cards" && !hasUnfinishedRatings\(wordIds, ratings\)/);
  assert.match(wordCleaner, /item\.stage === "quiz" && hasUnfinishedRatings\(wordIds, ratings\)/);
  assert.match(wordCleaner, /rawQuizResults\.length !== quizIndex \+ \(hasCurrentFeedback \? 1 : 0\)/);
});

test("changing any visible card or question index returns the viewport to the top", () => {
  const scrollCall = 'window.scrollTo({ top: 0, left: 0, behavior: "auto" })';
  const scrollIndex = page.indexOf(scrollCall);
  assert.notEqual(scrollIndex, -1, "missing the transition scroll-to-top effect");

  const scrollEffectTail = page.slice(scrollIndex, scrollIndex + 1_200);
  assert.match(scrollEffectTail, /return \(\) => window\.cancelAnimationFrame\(frame\)/);
  const dependencyMatch = scrollEffectTail.match(/\}, \[([^\]]+)\]\);/);
  assert.ok(dependencyMatch, "the scroll-to-top effect must declare its transition dependencies");

  const dependencies = new Set(dependencyMatch[1].split(",").map((item) => item.trim()));
  for (const dependency of ["index", "quizIndex", "sentenceIndex", "patternIndex", "patternDrillIndex", "reviewIndex", "readingId"]) {
    assert.ok(dependencies.has(dependency), `${dependency} must trigger scroll-to-top`);
  }
});
