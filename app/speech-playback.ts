export type SpeechPlaybackState = "idle" | "loading" | "playing" | "paused";

export const SPEECH_PLAYBACK_EVENT = "english-flow-speech-playback";
export const SPEECH_ERROR_EVENT = "english-flow-speech-error";

let activeUtterance: SpeechSynthesisUtterance | null = null;
let activeUtteranceStarted = false;
let playbackRun = 0;
let playbackSegments: string[] = [];
let playbackLanguages: string[] = [];
let playbackRates: number[] = [];
let playbackIndex = 0;
let playbackRate = 0.74;
let playbackState: SpeechPlaybackState = "idle";
let pendingPlaybackStart: (() => void) | undefined;
let startupTimer: ReturnType<typeof setTimeout> | null = null;
let recoveryTimer: ReturnType<typeof setTimeout> | null = null;
const unavailableVoices = new Set<string>();

function clearStartupTimer() {
  if (startupTimer !== null) clearTimeout(startupTimer);
  if (recoveryTimer !== null) clearTimeout(recoveryTimer);
  startupTimer = null;
  recoveryTimer = null;
}

function emitPlaybackState(state: SpeechPlaybackState) {
  playbackState = state;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<SpeechPlaybackState>(SPEECH_PLAYBACK_EVENT, { detail: state }));
  }
}

function emitSpeechError(error: string) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<string>(SPEECH_ERROR_EVENT, { detail: error }));
  }
}

function watchSpeechStartup(run: number, utterance: SpeechSynthesisUtterance) {
  clearStartupTimer();
  // A queue can be accepted silently for any segment, including a single word.
  // User-paused queues are watched only after the user resumes playback.
  if (playbackState === "paused") return;
  startupTimer = setTimeout(() => {
    if (run !== playbackRun || activeUtterance !== utterance || activeUtteranceStarted) return;
    emitSpeechError(utterance.lang === "zh-CN" ? "chinese-start-timeout" : "start-timeout");
    stopSpeech();
  }, 8_000);
}

function voiceLanguage(voice: SpeechSynthesisVoice) {
  return voice.lang.replace(/_/g, "-").toLowerCase();
}

function voiceKey(voice: SpeechSynthesisVoice) {
  return `${voice.voiceURI || voice.name || ""}:${voiceLanguage(voice)}`;
}

function preferredVoice(language: string) {
  try {
    const voices = window.speechSynthesis.getVoices().filter((voice) => !unavailableVoices.has(voiceKey(voice))
      && (language === "zh-CN" ? /^(zh-cn|zh-hans|zh-sg|cmn)(-|$)/.test(voiceLanguage(voice)) : /^en(-|$)/.test(voiceLanguage(voice))));
    const score = (voice: SpeechSynthesisVoice) => (voice.localService === true ? 4 : 0)
      + (voiceLanguage(voice) === language.toLowerCase() ? 2 : 0) + (voice.default ? 1 : 0);
    return voices.sort((a, b) => score(b) - score(a))[0];
  } catch { return undefined; }
}

function createUtterance(text: string, rate: number, language = "en-US", usePlatformVoice = false) {
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = language;
  utterance.rate = rate;
  const voice = usePlatformVoice ? undefined : preferredVoice(language);
  if (voice) utterance.voice = voice;
  return utterance;
}

function splitLongSegment(segment: string, maximumCharacters: number) {
  const pieces: string[] = [];
  let current = "";
  for (const word of segment.split(/\s+/).filter(Boolean)) {
    const next = current ? `${current} ${word}` : word;
    if (current && next.length > maximumCharacters) {
      pieces.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

export function splitSpeechText(text: string, maximumCharacters = 160) {
  const normalizedText = text.replace(/\s+/g, " ").trim();
  if (!normalizedText) return [];
  const sentences = normalizedText.match(/[^.!?]+(?:[.!?]+["'’]?|$)/g)?.map((sentence) => sentence.trim()).filter(Boolean) ?? [normalizedText];
  const segments: string[] = [];
  let current = "";

  for (const sentence of sentences.flatMap((item) => item.length > maximumCharacters ? splitLongSegment(item, maximumCharacters) : [item])) {
    const next = current ? `${current} ${sentence}` : sentence;
    if (current && next.length > maximumCharacters) {
      segments.push(current);
      current = sentence;
    } else {
      current = next;
    }
  }
  if (current) segments.push(current);
  return segments;
}

export function isSpeechSupported() {
  return typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
}

export function stopSpeech() {
  const hadActiveUtterance = activeUtterance !== null;
  playbackRun += 1;
  clearStartupTimer();
  pendingPlaybackStart = undefined;
  playbackSegments = [];
  playbackLanguages = [];
  playbackRates = [];
  playbackIndex = 0;
  activeUtterance = null;
  activeUtteranceStarted = false;
  let stopped = true;
  if (isSpeechSupported()) {
    try {
      // Older WebKit can apply cancel() to speech queued immediately afterward.
      // Do not cancel a native queue which is already confirmed empty.
      if (hadActiveUtterance || window.speechSynthesis.speaking !== false || window.speechSynthesis.pending !== false) {
        window.speechSynthesis.cancel();
      }
      // cancel() clears the queue but does not clear the engine's paused flag.
      // A new word or article must not inherit a stopped article's pause.
      if (window.speechSynthesis.paused) window.speechSynthesis.resume();
    } catch {
      stopped = false;
      emitSpeechError("unavailable");
    }
  }
  emitPlaybackState("idle");
  return stopped;
}

function queueUtterance(run: number, text: string, rate: number, language: string,
  onStart: () => void, onEnd: () => void, onFailure: (error: string) => void,
  recovery = { used: false }, usePlatformVoice = false) {
  if (!isSpeechSupported() || run !== playbackRun) return false;
  let utterance: SpeechSynthesisUtterance;
  try {
    utterance = createUtterance(text, rate, language, usePlatformVoice);
  } catch {
    onFailure("unavailable");
    return false;
  }
  activeUtterance = utterance;
  activeUtteranceStarted = false;
  const current = () => run === playbackRun && activeUtterance === utterance;
  const recover = (platformVoice: boolean) => {
    if (!current() || activeUtteranceStarted || recovery.used) return false;
    recovery.used = true;
    clearStartupTimer();
    // Failed utterances may deliver end/start after their error. Invalidate
    // them before scheduling the replacement so they cannot skip a repeat.
    activeUtterance = null;
    activeUtteranceStarted = false;
    // The first speak stays in the input handler, preserving iOS activation.
    // Retry only an unstarted, lost/failed utterance, after native cancellation.
    recoveryTimer = setTimeout(() => {
      recoveryTimer = null;
      if (run === playbackRun && activeUtterance === null) queueUtterance(run, text, rate, language, onStart, onEnd, onFailure, recovery, platformVoice);
    }, 0);
    return true;
  };
  utterance.onstart = () => {
    if (!current()) return;
    activeUtteranceStarted = true;
    clearStartupTimer();
    onStart();
  };
  utterance.onend = () => {
    if (!current()) return;
    clearStartupTimer();
    activeUtterance = null;
    onEnd();
  };
  utterance.onerror = (event) => {
    if (!current()) return;
    const error = event.error || "unavailable";
    if (!activeUtteranceStarted) {
      if ((error === "canceled" || error === "interrupted") && recover(false)) return;
      if (utterance.voice && ["voice-unavailable", "language-unavailable", "synthesis-unavailable", "synthesis-failed"].includes(error)) {
        unavailableVoices.add(voiceKey(utterance.voice));
        if (recover(true)) return;
      }
    }
    clearStartupTimer();
    activeUtterance = null;
    onFailure(error);
  };
  watchSpeechStartup(run, utterance);
  if (!recovery.used && playbackState !== "paused") {
    const checkNativeQueue = () => {
      recoveryTimer = null;
      if (!current() || activeUtteranceStarted || playbackState === "paused") return;
      const engine = window.speechSynthesis;
      if (engine.speaking === false && engine.pending === false) {
        recover(Boolean(utterance.voice));
      } else if (typeof engine.speaking === "boolean" && typeof engine.pending === "boolean") {
        // A native cancel may finish after the first check. The existing
        // eight-second startup deadline bounds these checks as well.
        recoveryTimer = setTimeout(checkNativeQueue, 250);
      }
    };
    recoveryTimer = setTimeout(checkNativeQueue, 250);
  }
  try {
    window.speechSynthesis.speak(utterance);
  } catch {
    if (current()) {
      clearStartupTimer();
      activeUtterance = null;
      onFailure("unavailable");
    }
    return false;
  }
  return run === playbackRun;
}

export function speak(text: string, rate = 0.82) {
  if (!isSpeechSupported() || !text.trim()) return false;
  if (!stopSpeech()) return false;
  return queueUtterance(playbackRun, text, rate, "en-US", () => {}, () => {}, emitSpeechError);
}

function playCurrentSegment(run: number) {
  if (!isSpeechSupported() || run !== playbackRun || playbackState === "idle") return false;
  const text = playbackSegments[playbackIndex];
  if (!text) {
    stopSpeech();
    return false;
  }
  const language = playbackLanguages[playbackIndex] ?? "en-US";
  if (playbackState !== "paused") emitPlaybackState("loading");
  return queueUtterance(run, text, playbackRates[playbackIndex] ?? playbackRate, language, () => {
    if (playbackState !== "paused") emitPlaybackState("playing");
    const onStart = pendingPlaybackStart;
    pendingPlaybackStart = undefined;
    onStart?.();
  }, () => {
    playbackIndex += 1;
    if (playbackIndex >= playbackSegments.length) stopSpeech();
    else playCurrentSegment(run);
  }, (error) => {
    emitSpeechError(language === "zh-CN" ? "chinese-unavailable" : error);
    stopSpeech();
  });
}

export function startSegmentedSpeech(text: string, rate = 0.74, onStart?: () => void) {
  if (!isSpeechSupported()) return false;
  const segments = splitSpeechText(text);
  if (!segments.length) return false;
  if (!stopSpeech()) return false;
  playbackSegments = segments;
  playbackIndex = 0;
  playbackRate = rate;
  pendingPlaybackStart = onStart;
  emitPlaybackState("loading");
  const run = playbackRun;
  return playCurrentSegment(run);
}

// Each repetition is a complete utterance. Advance only on its end event,
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

// One shared cancellation token owns all four utterances. Never estimate
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

export function toggleSegmentedSpeech() {
  if (!isSpeechSupported() || playbackState === "idle" || !playbackSegments.length) return "idle" as const;
  if (playbackState === "loading") return "loading" as const;
  try {
    if (playbackState === "paused") {
      emitPlaybackState(activeUtteranceStarted ? "playing" : "loading");
      if (activeUtterance && !activeUtteranceStarted) watchSpeechStartup(playbackRun, activeUtterance);
      window.speechSynthesis.resume();
      return playbackState;
    }
    window.speechSynthesis.pause();
    emitPlaybackState("paused");
    return "paused" as const;
  } catch {
    emitSpeechError("unavailable");
    stopSpeech();
    return "idle" as const;
  }
}
