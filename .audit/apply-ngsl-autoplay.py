from pathlib import Path
import json

def once(text, old, new):
    assert text.count(old) == 1, f'Expected one patch target: {old[:100]}'
    return text.replace(old, new, 1)

p = Path('app/speech-playback.ts')
s = p.read_text()
s = once(s, 'export function toggleSegmentedSpeech()', '''// Each repetition is a complete utterance. Advance only on its end event,
// never on an estimated reading duration. The shared run token means every
// existing stop/manual-speech action also cancels all remaining repetitions.
export function startRepeatedSpeech(text: string, repetitions = 3, rate = 0.82) {
  if (!isSpeechSupported() || !text.trim() || !Number.isInteger(repetitions) || repetitions < 1 || repetitions > 10) return false;
  if (!stopSpeech()) return false;
  playbackSegments = Array.from({ length: repetitions }, () => text.trim());
  playbackIndex = 0;
  playbackRate = rate;
  emitPlaybackState("loading");
  return playCurrentSegment(playbackRun);
}

export function toggleSegmentedSpeech()''')
p.write_text(s)

p = Path('app/page.tsx')
s = p.read_text()
s = once(s, 'speak, startSegmentedSpeech, stopSpeech,', 'speak, startRepeatedSpeech, startSegmentedSpeech, stopSpeech,')
s = once(s, '  const [wordSessionKind, setWordSessionKind]', '''  // This visit's playback choice deliberately stays outside learning backups.
  const [autoWordExamples, setAutoWordExamples] = useState(true);
  const wordExampleStartedRef = useRef<string | null>(null);
  const [wordSessionKind, setWordSessionKind]''')
old = '''  useEffect(() => {
    window.addEventListener("pagehide", stopSpeech);
    return () => {
      stopSpeech();
      window.removeEventListener("pagehide", stopSpeech);
    };
  }, [current?.id, currentPattern?.id, currentReviewWordId, currentSentence?.id, learnStage, patternDrillIndex, patternStage, quizWord?.id, readingId, reviewView, sentenceSection, sentenceStage, tab]);'''
new = '''  useEffect(() => {
    const automatic = hydrated && autoWordExamples && !hasOpenDialog && tab === "learn"
      && learnStage === "cards" && sessionPath === "frequency" && wordSessionKind === "group" && current;
    const signature = current ? `${current.id}:${current.example}` : null;
    // iOS needs the first speak() in a real input handler. Do not cancel the
    // new card's already-started queue when React commits that same transition.
    if (automatic && signature && wordExampleStartedRef.current === signature) {
      wordExampleStartedRef.current = null;
      return;
    }
    wordExampleStartedRef.current = null;
    stopSpeech();
    // A restored page may not have audio permission yet. Keep the explicit
    // replay control usable instead of repeatedly prompting or faking a click.
    if (automatic && !document.hidden && navigator.userActivation?.hasBeenActive !== false) {
      startRepeatedSpeech(current.example, 3);
    }
  }, [autoWordExamples, current?.id, current?.example, currentPattern?.id, currentReviewWordId, currentSentence?.id, hasOpenDialog, hydrated, learnStage, patternDrillIndex, patternStage, quizWord?.id, readingId, reviewView, sentenceSection, sentenceStage, sessionPath, tab, wordSessionKind]);

  useEffect(() => {
    window.addEventListener("pagehide", stopSpeech);
    return () => {
      stopSpeech();
      window.removeEventListener("pagehide", stopSpeech);
    };
  }, []);'''
s = once(s, old, new)
helper = '''  const playAutomaticWordExample = (word: WordItem | undefined, selectedPath: LearnPath = sessionPath, kind = wordSessionKind, enabled = autoWordExamples) => {
    if (!enabled || selectedPath !== "frequency" || kind !== "group" || !word || document.hidden) return;
    wordExampleStartedRef.current = `${word.id}:${word.example}`;
    // Start synchronously in the click/touch handler, including the first card.
    if (!startRepeatedSpeech(word.example, 3)) {
      setSpeechNotice("例句朗读未能启动，请点一次“重播三遍”，或检查设备的英文语音设置。");
    }
  };

  const replayWordExample = () => {
    if (!current || document.hidden) return;
    wordExampleStartedRef.current = null;
    if (!startRepeatedSpeech(current.example, 3)) {
      setSpeechNotice("例句朗读未能启动，请点一次“重播三遍”，或检查设备的英文语音设置。");
    }
  };

  const toggleWordExamples = () => {
    stopSpeech();
    wordExampleStartedRef.current = null;
    setAutoWordExamples(!autoWordExamples);
    if (!autoWordExamples) playAutomaticWordExample(current, sessionPath, wordSessionKind, true);
  };

'''
s = once(s, '  const startSession = (pathOverride?', helper + '  const startSession = (pathOverride?')
s = once(s, '    saveSessionPreferences({ path: selectedPath, mode: selectedMode, count: selectedCount });', '    playAutomaticWordExample(selected[0], selectedPath, "group");\n    saveSessionPreferences({ path: selectedPath, mode: selectedMode, count: selectedCount });')
s = once(s, '    if (wrappedIndex >= 0) setIndex(wrappedIndex);', '''    if (wrappedIndex >= 0) {
      playAutomaticWordExample(sessionWords[wrappedIndex]);
      setIndex(wrappedIndex);
    }''')
s = once(s, '''    const next = Math.min(Math.max(index + direction, 0), sessionWords.length - 1);
    setIndex(next);''', '''    const next = Math.min(Math.max(index + direction, 0), sessionWords.length - 1);
    if (next === index) return;
    playAutomaticWordExample(sessionWords[next]);
    setIndex(next);''')
control = '''      {sessionPath === "frequency" && wordSessionKind === "group" && <div className="word-auto-controls">
        <div role="group" aria-label="例句自动朗读设置">
          <button type="button" aria-pressed={autoWordExamples} onClick={toggleWordExamples}>自动例句三遍：{autoWordExamples ? "开" : "关"}</button>
          <button type="button" onClick={replayWordExample}>重播三遍</button>
        </div>
        <p>{autoWordExamples ? "切换词卡后自动朗读例句三遍。" : "本次已关闭自动朗读。"}刷新后若没有声音，点一次“重播三遍”。手动播放会结束当前自动朗读。</p>
      </div>}
'''
s = once(s, '      <div className="sentence-pager" role="group" aria-label="切换词卡">', control + '      <div className="sentence-pager" role="group" aria-label="切换词卡">')
p.write_text(s)

p = Path('app/globals.css')
p.write_text(p.read_text() + '''

/* NGSL playback controls retain readable labels and touch targets at 320px. */
.word-auto-controls { margin: 12px 0; }
.word-auto-controls > div { display: flex; flex-wrap: wrap; gap: 8px; }
.word-auto-controls button { min-height: 44px; padding: 8px 12px; border: 1px solid #c9ced6; border-radius: 12px; background: #fff; color: #334155; font-size: 14px; font-weight: 600; }
.word-auto-controls button[aria-pressed="true"] { border-color: #64748b; background: #edf2f7; }
.word-auto-controls button:focus-visible { outline: 2px solid #334155; outline-offset: 3px; }
.word-auto-controls p { margin: 8px 0 0; color: #526071; font-size: 12px; line-height: 1.6; }
''')
p = Path('package.json')
s = once(p.read_text(), 'node scripts/browser-daily.mjs"', 'node scripts/browser-daily.mjs && node scripts/browser-autoplay.mjs"')
json.loads(s)
p.write_text(s)
p = Path('TESTING.md')
p.write_text(p.read_text() + '''

## NGSL automatic example playback

NGSL grouped word cards (10 or 20 words, free study or study-plus-quiz) now play the full example three times on entry and actual card changes. First playback starts in the click/touch handler for iOS speech activation; the commit effect avoids canceling that queue. Each complete utterance's end event starts the next, not a duration estimate. Quiz, scene groups and single-word lookups do not auto-play. A visit-local toggle and an explicit three-repeat replay are available without adding storage keys or modifying backup formats. Restored pages without user activation wait for input. All existing manual audio, navigation, hidden-page and pagehide cancellation applies to pending repetitions.

`tests/speech-repeat-runtime.test.mjs` checks queue length, full text, cancellation, stale events, startup errors and ordinary speech compatibility. `scripts/browser-autoplay.mjs` exercises first-card activation, next/previous/rated cards, manual interruption, toggling, modal/quiz/navigation exits, visibility and restoration in Chromium and WebKit. Browser speech is instrumented to inspect exact utterances and callbacks, not to pretend that physical speakers or Bluetooth audio have been tested. Existing browser suites continue to run. The separate one-earbud clipping report remains outside this change.
''')
print('Applied NGSL triple-example playback without learning schema or dependency changes.')
