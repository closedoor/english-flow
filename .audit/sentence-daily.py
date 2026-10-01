from pathlib import Path
import json

def replace(s, old, new, count=1):
    assert s.count(old)==count, (old[:110], s.count(old), count)
    return s.replace(old,new)

p=Path('app/speech-playback.ts');s=p.read_text()
s=replace(s,'let playbackSegments: string[] = [];','let playbackSegments: string[] = [];\nlet playbackLanguages: string[] = [];\nlet playbackRates: number[] = [];')
s=replace(s,'function createUtterance(text: string, rate: number) {','''function preferredChineseVoice() {
  try {
    const voices = window.speechSynthesis.getVoices();
    const language = (voice: SpeechSynthesisVoice) => voice.lang.replace(/_/g, "-").toLowerCase();
    return voices.find((voice) => language(voice) === "zh-cn")
      ?? voices.find((voice) => /^(zh-hans|zh-sg|cmn)(-|$)/.test(language(voice)));
  } catch { return undefined; }
}

function createUtterance(text: string, rate: number, language = "en-US") {''')
s=replace(s,'  utterance.lang = "en-US";','  utterance.lang = language;')
s=replace(s,'  const voice = preferredEnglishVoice();','  const voice = language === "zh-CN" ? preferredChineseVoice() : preferredEnglishVoice();')
s=replace(s,'  playbackSegments = [];\n  playbackIndex = 0;','  playbackSegments = [];\n  playbackLanguages = [];\n  playbackRates = [];\n  playbackIndex = 0;')
s=replace(s,'utterance = createUtterance(text, playbackRate);','utterance = createUtterance(text, playbackRates[playbackIndex] ?? playbackRate, playbackLanguages[playbackIndex] ?? "en-US");')
s=replace(s,'emitSpeechError("start-timeout");','emitSpeechError(utterance.lang === "zh-CN" ? "chinese-start-timeout" : "start-timeout");')
start=s.index('function playCurrentSegment(');end=s.index('\nexport function startSegmentedSpeech',start)
block=s[start:end]
block=replace(block,'emitSpeechError(event.error || "unavailable");','emitSpeechError(utterance.lang === "zh-CN" ? "chinese-unavailable" : event.error || "unavailable");')
s=s[:start]+block+s[end:]
anchor='export function toggleSegmentedSpeech() {'
s=replace(s,anchor,'''// One shared cancellation token owns all four utterances. Never estimate
// duration or route Chinese through the selected English voice.
export function startBilingualSentenceSpeech(english: string, chinese: string) {
  if (!isSpeechSupported() || !english.trim() || !chinese.trim()) return false;
  if (!stopSpeech()) return false;
  playbackSegments = [english.trim(), english.trim(), english.trim(), chinese.trim()];
  playbackLanguages = ["en-US", "en-US", "en-US", "zh-CN"];
  playbackRates = [0.76, 0.76, 0.76, 0.88];
  playbackIndex = 0;
  emitPlaybackState("loading");
  return playCurrentSegment(playbackRun);
}

'''+anchor)
p.write_text(s)

p=Path('app/page.tsx');s=p.read_text()
s=replace(s,'speak, startRepeatedSpeech, startSegmentedSpeech','speak, startBilingualSentenceSpeech, startRepeatedSpeech, startSegmentedSpeech')
s=replace(s,'  const [sentenceTranslationOpen, setSentenceTranslationOpen] = useState(false);','''  const [sentenceTranslationOpen, setSentenceTranslationOpen] = useState(false);
  const [autoSentenceExamples, setAutoSentenceExamples] = useState(true);
  const sentenceExampleStartedRef = useRef<string | null>(null);''')
s=replace(s,'''    const handleSpeechError = () => {
      setSpeechNotice("系统英文语音没有成功播放，请检查设备静音设置，或改用最新版 Safari、Chrome 或 Edge。");
    };''','''    const handleSpeechError = (event: Event) => {
      const error = (event as CustomEvent<string>).detail;
      setSpeechNotice(error?.startsWith("chinese-")
        ? "中文语音未能完成，译文仍可直接阅读。请检查设备的中文语音后重播。"
        : "系统语音没有成功播放，请检查设备的语音与音量设置，或点一次重播。");
    };''')
start=s.index('  useEffect(() => {\n    const automatic = hydrated && autoWordExamples');end=s.index('\n\n  useEffect(',start+1)
s=s[:start]+'''  useEffect(() => {
    const automatic = hydrated && autoWordExamples && !hasOpenDialog && tab === "learn"
      && learnStage === "cards" && sessionPath === "frequency" && wordSessionKind === "group" && current;
    const automaticSentence = hydrated && autoSentenceExamples && !hasOpenDialog && tab === "sentences"
      && sentenceSection === "library" && sentenceStage === "cards" && sentenceMode === "bilingual" && currentSentence;
    const signature = current ? `${current.id}:${current.example}` : null;
    const sentenceSignature = currentSentence ? `${currentSentence.id}:${currentSentence.text}:${currentSentence.translation}` : null;
    // Preserve speech started synchronously inside the very click that changed
    // the card. One effect owns cancellation for both learning modules.
    const alreadyStarted = (automatic && signature && wordExampleStartedRef.current === signature)
      || (automaticSentence && sentenceSignature && sentenceExampleStartedRef.current === sentenceSignature);
    wordExampleStartedRef.current = null;
    sentenceExampleStartedRef.current = null;
    if (alreadyStarted) return;
    stopSpeech();
    if (document.hidden || navigator.userActivation?.hasBeenActive === false) return;
    if (automatic) startRepeatedSpeech(current.example, 3);
    else if (automaticSentence) startBilingualSentenceSpeech(currentSentence.text, currentSentence.translation);
  }, [autoWordExamples, autoSentenceExamples, current?.id, current?.example, currentPattern?.id, currentReviewWordId, currentSentence, hasOpenDialog, hydrated, learnStage, patternDrillIndex, patternStage, quizWord?.id, readingId, reviewView, sentenceMode, sentenceSection, sentenceStage, sessionPath, tab, wordSessionKind, current]);'''+s[end:]
anchor='  const startSentenceSession = (reviewOnly = false, singleSentence?: SentenceItem) => {'
start=s.index(anchor);end=s.index('\n\n  const resumeSentenceSession',start)
s=s[:start]+'''  const startSentenceSession = (reviewOnly = false, singleSentence?: SentenceItem, forceNew = false) => {
    const snapshot = newestSnapshot(cleanSentenceSession(readJson<unknown>(STORAGE.sentenceActiveSession, null)), sentenceResumeSnapshotRef.current);
    if (sentenceStage === "setup" && sentenceSessionIds.length && snapshot) {
      const sameChoices = snapshot.band === sentenceBand && snapshot.category === sentenceCategory
        && snapshot.count === sentenceCount && snapshot.mode === sentenceMode;
      // Returning to the same practice means resume, not discard and restart.
      if (!forceNew && !reviewOnly && !singleSentence && sameChoices) {
        resumeSentenceSession();
        return;
      }
      // An untouched first card has no position or ratings to discard.
      if (snapshot.index > 0 || Object.keys(snapshot.ratings).length > 0) {
        setDiscardRequest({ sentence: true, sentenceStart: { reviewOnly, singleSentence } });
        return;
      }
    }
    beginSentenceSession(reviewOnly, singleSentence);
  };'''+s[end:]
# All call sites start the first utterance in the actual user gesture.
helper='''  const playAutomaticSentenceExample = (item: SentenceItem | null | undefined, selectedMode: SentenceLearningMode = sentenceMode, enabled = autoSentenceExamples) => {
    if (!enabled || selectedMode !== "bilingual" || !item || document.hidden) return;
    setSpeechNotice(null);
    sentenceExampleStartedRef.current = `${item.id}:${item.text}:${item.translation}`;
    if (!startBilingualSentenceSpeech(item.text, item.translation)) {
      setSpeechNotice("句子朗读未能启动，请点一次“重播本句”，并检查设备的英文和中文语音。");
    }
  };

  const replaySentenceExample = () => {
    if (!currentSentence || sentenceMode !== "bilingual" || document.hidden) return;
    sentenceExampleStartedRef.current = null;
    setSpeechNotice(null);
    if (!startBilingualSentenceSpeech(currentSentence.text, currentSentence.translation)) {
      setSpeechNotice("句子朗读未能启动，请检查设备的英文和中文语音后重播。");
    }
  };

  const toggleSentenceExamples = () => {
    stopSpeech();
    sentenceExampleStartedRef.current = null;
    setAutoSentenceExamples(!autoSentenceExamples);
    if (!autoSentenceExamples) playAutomaticSentenceExample(currentSentence, sentenceMode, true);
  };

'''
s=replace(s,'  const beginSentenceSession = (reviewOnly = false, singleSentence?: SentenceItem) => {',helper+'  const beginSentenceSession = (reviewOnly = false, singleSentence?: SentenceItem) => {')
s=replace(s,'    setSentenceSessionIds(selected.map((item) => item.id));','    playAutomaticSentenceExample(selected[0]);\n    setSentenceSessionIds(selected.map((item) => item.id));')
start=s.index('  const resumeSentenceSession =');end=s.index('\n\n  const finishSentenceCard',start);b=s[start:end]
b=replace(b,'    if (!snapshot) return;','    if (!snapshot) return;\n    playAutomaticSentenceExample(sentenceItemById.get(snapshot.sentenceIds[snapshot.index]), snapshot.mode);')
s=s[:start]+b+s[end:]
s=replace(s,'    if (wrappedIndex >= 0) {\n      setSentenceIndex(wrappedIndex);','    if (wrappedIndex >= 0) {\n      playAutomaticSentenceExample(sentenceSessionItems[wrappedIndex]);\n      setSentenceIndex(wrappedIndex);')
s=replace(s,'    const nextIndex = Math.min(Math.max(safeSentenceIndex + direction, 0), sentenceSessionItems.length - 1);\n    setSentenceIndex(nextIndex);','    const nextIndex = Math.min(Math.max(safeSentenceIndex + direction, 0), sentenceSessionItems.length - 1);\n    if (nextIndex === safeSentenceIndex) return;\n    playAutomaticSentenceExample(sentenceSessionItems[nextIndex]);\n    setSentenceIndex(nextIndex);')
start=s.index('  const retryDifficultSentences =');end=s.index('\n\n  const beginPatternSession',start);b=s[start:end]
b=replace(b,'    if (!retryIds.length) return;','    if (!retryIds.length) return;\n    playAutomaticSentenceExample(sentenceItemById.get(retryIds[0]));')
s=s[:start]+b+s[end:]
s=replace(s,'playAutomaticWordExample(current); setTab(item.id);','playAutomaticWordExample(current); if (item.id === "sentences" && tab !== "sentences" && sentenceSection === "library" && sentenceStage === "cards") playAutomaticSentenceExample(currentSentence); setTab(item.id);')
# The primary button still uses its existing name and position; only a deliberate
# request for a new group replaces a matching paused group.
resume='{canResumeSentence && <button className="resume-session-card" onClick={resumeSentenceSession}'
assert resume in s
line=next(line for line in s.splitlines() if resume in line)
s=replace(s,line,line+'\n      {canResumeSentence && <button className="sentence-new-group text-button" onClick={() => startSentenceSession(false, undefined, true)}>另开新一组</button>}')
s=replace(s,'<small>先看英文，再查看中文</small>','<small>中英直接显示 · 英文三遍、中文一遍</small>')
start=s.index('  const renderSentenceCards =');end=s.index('\n  const ',start+8);b=s[start:end]
old='<button className="sentence-listen" onClick={() => playSpeech(currentSentence.text, .76)}><span aria-hidden="true">♪</span><b>播放英文</b><small>系统英文语音 · 慢速</small></button>'
b=replace(b,old,'<button className="sentence-listen" onClick={replaySentenceExample}><span aria-hidden="true">♪</span><b>重播本句</b><small>英文三遍 · 中文一遍</small></button>')
old='<button className="sentence-translation-toggle" aria-expanded={sentenceTranslationOpen} onClick={() => setSentenceTranslationOpen((open) => !open)}>{sentenceTranslationOpen ? currentSentence.translation : "点击显示中文翻译"}</button>'
b=replace(b,old,'<div className="sentence-translation" lang="zh-CN">{currentSentence.translation}</div>')
b=replace(b,'      {currentSentence && <div className="sentence-pager"','      <div className="word-card-actions sentence-card-actions">\n      {currentSentence && <div className="sentence-pager"')
footer='''      </div>
      {currentSentence && sentenceMode === "bilingual" && <div className="sentence-auto-controls" role="group" aria-label="句库自动朗读设置">
        <button type="button" aria-pressed={autoSentenceExamples} onClick={toggleSentenceExamples}>自动朗读：{autoSentenceExamples ? "开" : "关"}</button>
        <button type="button" onClick={stopSpeech}>停止朗读</button>
        <p>每次切换：英文三遍 → 中文一遍。切换卡片会停止上一句；刷新后无声时可点“重播本句”。</p>
      </div>}
'''
assert b.count('    </section>')==1
b=b.replace('    </section>',footer+'    </section>');s=s[:start]+b+s[end:]
p.write_text(s)

p=Path('app/globals.css');p.write_text(p.read_text()+'''
/* Sentence study: visible translation, optional audio below primary actions. */
.sentence-translation{display:block;width:100%;margin-top:16px;padding:15px 14px;border:1px solid #dbe6e1;border-radius:17px;background:#eef7f4;color:#355f52;font-size:.875rem;line-height:1.7;text-align:center;overflow-wrap:anywhere}
.sentence-auto-controls{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px;padding-top:12px;border-top:1px solid var(--line)}
.sentence-auto-controls button{min-height:44px;padding:8px 12px;border:1px solid #bfcfc8;border-radius:12px;background:#fff;color:#284d40;font-size:13px;font-weight:700}
.sentence-auto-controls button[aria-pressed="true"]{background:#e7f4ee;border-color:#6a9785}
.sentence-auto-controls p{flex-basis:100%;margin:0;color:#526071;font-size:12px;line-height:1.6}
''')
# Replace only obsolete UI assertions, not the protective new-session tests.
for p in [*Path('tests').glob('*.mjs'),*Path('scripts').glob('browser-*.mjs')]:
    text=p.read_text()
    if 'sentence-translation-toggle' in text or '点击显示中文翻译' in text or 'paused-sentence' in text or 'sentenceStage ===' in text:
        print('REVIEW_TEST',p, '\n'.join(line for line in text.splitlines() if any(k in line for k in ['sentence-translation-toggle','点击显示中文翻译','paused-sentence','sentenceStage ==='])))
p=Path('package.json');s=p.read_text();data=json.loads(s);data['scripts']['test:browser']+=' && node scripts/browser-sentence-daily.mjs';p.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
p=Path('TESTING.md');p.write_text(p.read_text()+'''

## Sentence daily listening and same-session resumption

Returning from sentence cards to unchanged setup and pressing Start resumes the saved IDs, ratings and position without a discard dialog or new practice rotation. Deliberate replacement of a progressed session still requires confirmation; an untouched first card does not. A separate new-group action remains explicit. Storage keys, snapshot formats, English word playback and the currency-converter files are unchanged.

Bilingual sentence cards show their Chinese translation directly. Every actual card transition starts three full English utterances and one Mandarin utterance, in order, using the shared cancellation token and end callbacks. Chinese gets zh-CN and a matching voice or the platform language default, never the English voice. Speaking-first mode still hides the English answer and never auto-reads it. Settings are visit-local and below navigation/rating controls. Native speech is instrumented in tests, not a claim of physical iPhone/headset listening.
''')
print('PATCH_COMPLETE: sentence resume and bilingual listening; persistent schemas untouched.')
