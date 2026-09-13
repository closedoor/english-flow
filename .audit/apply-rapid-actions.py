from pathlib import Path

page_path = Path("app/page.tsx")
page = page_path.read_text()

replacements = [
    (
        "  const cardActionLock = useRef<number | null>(null);\n  const sentenceActionLock = useRef(false);\n  const patternActionLock = useRef(false);",
        "  const cardActionLock = useRef<number | null>(null);\n  const sentenceActionLock = useRef<number | null>(null);\n  const patternActionLock = useRef<string | null>(null);\n  const wordStartLock = useRef(false);\n  const sentenceStartLock = useRef(false);\n  const patternStartLock = useRef(false);\n  const readingCompletionLock = useRef<string | null>(null);\n  const sentenceSaveLock = useRef<number | null>(null);",
    ),
    (
        "  const toggleReadingCompleted = (reading: ReadingItem) => {\n    setReadingCompleted((current) => current.includes(reading.id) ? current.filter((id) => id !== reading.id) : [...current, reading.id]);\n    // Reading recency intentionally uses the wall clock after a user action.\n    setReadingLast({ id: reading.id, updatedAt: Date.now() });\n    if (!readingCompleted.includes(reading.id)) noteStudyDay();\n  };",
        "  const toggleReadingCompleted = (reading: ReadingItem) => {\n    const readingId = reading.id;\n    if (readingCompletionLock.current === readingId) return;\n    readingCompletionLock.current = readingId;\n    window.setTimeout(() => {\n      if (readingCompletionLock.current === readingId) readingCompletionLock.current = null;\n    }, 350);\n    const completing = !readingCompleted.includes(readingId);\n    setReadingCompleted((current) => completing\n      ? current.includes(readingId) ? current : [...current, readingId]\n      : current.filter((id) => id !== readingId));\n    // Reading recency intentionally uses the wall clock after a user action.\n    setReadingLast({ id: readingId, updatedAt: Date.now() });\n    if (completing) noteStudyDay();\n  };\n\n  const toggleSentenceSaved = (sentenceId: number) => {\n    if (sentenceSaveLock.current === sentenceId) return;\n    sentenceSaveLock.current = sentenceId;\n    window.setTimeout(() => {\n      if (sentenceSaveLock.current === sentenceId) sentenceSaveLock.current = null;\n    }, 350);\n    const saving = !sentenceSaved.includes(sentenceId);\n    setSentenceSaved((items) => saving\n      ? items.includes(sentenceId) ? items : [...items, sentenceId]\n      : items.filter((id) => id !== sentenceId));\n  };",
    ),
    (
        "  const startSession = (pathOverride?: LearnPath, modeOverride?: LearnMode, countOverride?: 10 | 20) => {\n    wordBrowserOriginRef.current = null;",
        "  const startSession = (pathOverride?: LearnPath, modeOverride?: LearnMode, countOverride?: 10 | 20) => {\n    if (wordStartLock.current) return;\n    wordStartLock.current = true;\n    window.setTimeout(() => { wordStartLock.current = false; }, 350);\n    wordBrowserOriginRef.current = null;",
    ),
    (
        "  const beginSentenceSession = (reviewOnly = false, singleSentence?: SentenceItem) => {\n    const source = singleSentence ? [singleSentence] : sentencePacks[SENTENCE_PACK_BY_BAND[sentenceBand]] ?? [];",
        "  const beginSentenceSession = (reviewOnly = false, singleSentence?: SentenceItem) => {\n    if (sentenceStartLock.current) return;\n    sentenceStartLock.current = true;\n    window.setTimeout(() => { sentenceStartLock.current = false; }, 350);\n    const source = singleSentence ? [singleSentence] : sentencePacks[SENTENCE_PACK_BY_BAND[sentenceBand]] ?? [];",
    ),
    (
        "  const finishSentenceCard = (known: boolean) => {\n    if (!currentSentence || sentenceActionLock.current) return;\n    sentenceActionLock.current = true;\n    window.setTimeout(() => { sentenceActionLock.current = false; }, 350);",
        "  const finishSentenceCard = (known: boolean) => {\n    if (!currentSentence) return;\n    const sentenceId = currentSentence.id;\n    if (sentenceActionLock.current === sentenceId) return;\n    sentenceActionLock.current = sentenceId;\n    window.setTimeout(() => {\n      if (sentenceActionLock.current === sentenceId) sentenceActionLock.current = null;\n    }, 350);",
    ),
    (
        "  const beginPatternSession = (reviewOnly = false) => {\n    const masteredIds = new Set(patternMastered);",
        "  const beginPatternSession = (reviewOnly = false) => {\n    if (patternStartLock.current) return;\n    patternStartLock.current = true;\n    window.setTimeout(() => { patternStartLock.current = false; }, 350);\n    const masteredIds = new Set(patternMastered);",
    ),
    (
        "  const finishPattern = (known: boolean) => {\n    if (!currentPattern || patternActionLock.current) return;\n    patternActionLock.current = true;\n    window.setTimeout(() => { patternActionLock.current = false; }, 350);",
        "  const finishPattern = (known: boolean) => {\n    if (!currentPattern) return;\n    const patternId = currentPattern.id;\n    if (patternActionLock.current === patternId) return;\n    patternActionLock.current = patternId;\n    window.setTimeout(() => {\n      if (patternActionLock.current === patternId) patternActionLock.current = null;\n    }, 350);",
    ),
    (
        "onClick={() => setSentenceSaved((items) => currentSentenceSaved ? items.filter((id) => id !== currentSentence.id) : [...items, currentSentence.id])}",
        "onClick={() => toggleSentenceSaved(currentSentence.id)}",
    ),
]

for old, new in replacements:
    count = page.count(old)
    if count != 1:
        raise SystemExit(f"Expected exactly one match, found {count}: {old[:120]!r}")
    page = page.replace(old, new)

page_path.write_text(page)

test_path = Path("tests/rapid-actions-stability.test.mjs")
test_path.write_text('''import assert from "node:assert/strict";\nimport { readFile } from "node:fs/promises";\nimport test from "node:test";\n\nconst page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");\nconst packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));\n\nfunction sourceBetween(startMarker, endMarker) {\n  const start = page.indexOf(startMarker);\n  const end = page.indexOf(endMarker, start + startMarker.length);\n  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);\n  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);\n  return page.slice(start, end);\n}\n\ntest("session start actions reject synchronous duplicate taps", () => {\n  for (const [functionName, refName] of [["startSession", "wordStartLock"], ["beginSentenceSession", "sentenceStartLock"], ["beginPatternSession", "patternStartLock"]]) {\n    const source = sourceBetween(`const ${functionName} =`, functionName === "startSession" ? "const startSingleWord =" : functionName === "beginSentenceSession" ? "const startSentenceSession =" : "const startPatternSession =");\n    assert.match(source, new RegExp(`if \\(${refName}\\.current\\) return`));\n    assert.match(source, new RegExp(`${refName}\\.current = true`));\n    assert.match(source, new RegExp(`${refName}\\.current = false`));\n  }\n});\n\ntest("sentence and pattern rating guards follow the displayed item", () => {\n  const sentence = sourceBetween("const finishSentenceCard =", "const moveSentence =");\n  assert.match(sentence, /const sentenceId = currentSentence\\.id/);\n  assert.match(sentence, /sentenceActionLock\\.current === sentenceId/);\n  assert.doesNotMatch(sentence, /if \\(!currentSentence \\|\\| sentenceActionLock\\.current\\) return/);\n\n  const pattern = sourceBetween("const finishPattern =", "const retryDifficultPatterns =");\n  assert.match(pattern, /const patternId = currentPattern\\.id/);\n  assert.match(pattern, /patternActionLock\\.current === patternId/);\n  assert.doesNotMatch(pattern, /if \\(!currentPattern \\|\\| patternActionLock\\.current\\) return/);\n});\n\ntest("reading completion and sentence favorites are idempotent during a double tap", () => {\n  const reading = sourceBetween("const toggleReadingCompleted =", "const retryReadingQuestion =");\n  assert.match(reading, /readingCompletionLock\\.current === readingId/);\n  assert.match(reading, /current\\.includes\\(readingId\\) \\? current : \\[\\.\\.\\.current, readingId\\]/);\n\n  const favorite = sourceBetween("const toggleSentenceSaved =", "const retryReadingQuestion =");\n  assert.match(favorite, /sentenceSaveLock\\.current === sentenceId/);\n  assert.match(favorite, /items\\.includes\\(sentenceId\\) \\? items : \\[\\.\\.\\.items, sentenceId\\]/);\n  assert.match(page, /onClick=\\{\\(\\) => toggleSentenceSaved\\(currentSentence\\.id\\)\\}/);\n});\n\ntest("rapid-action browser scenarios stay in the normal validation command", () => {\n  assert.match(packageJson.scripts["test:browser"], /browser-rapid-actions\\.mjs/);\n});\n''')

session_test_path = Path("tests/session-selection.test.mjs")
session_test = session_test_path.read_text()
session_test = session_test.replace(
    '  assert.match(page, /if \\(reviewActionLock\\.current\\) return/);\n});',
    '  assert.match(page, /if \\(reviewActionLock\\.current\\) return/);\n  assert.match(page, /sentenceActionLock\\.current === sentenceId/);\n  assert.match(page, /patternActionLock\\.current === patternId/);\n});',
)
session_test_path.write_text(session_test)

testing_path = Path("TESTING.md")
testing = testing_path.read_text()
marker = "## Rapid-action and accidental double-tap coverage"
if marker not in testing:
    testing += '''\n\n## Rapid-action and accidental double-tap coverage\n\nChromium and WebKit now verify that accidental double taps cannot start two sessions, reverse a reading completion, duplicate a sentence favorite or download two backups. Rating protection is scoped to the current word, sentence or pattern, so a fast intentional action on the next item remains usable.\n'''
    testing_path.write_text(testing)

print("Applied scoped start, rating, reading-completion and sentence-favorite guards.")
