export type SpeechPlaybackState = "idle" | "loading" | "playing" | "paused";

export const SPEECH_PLAYBACK_EVENT = "english-flow-speech-playback";
export const SPEECH_ERROR_EVENT = "english-flow-speech-error";

let activeUtterance: SpeechSynthesisUtterance | null = null;
let activeUtteranceStarted = false;
let playbackRun = 0;
let playbackSegments: string[] = [];
let playbackIndex = 0;
let playbackRate = 0.74;
let playbackState: SpeechPlaybackState = "idle";
let pendingPlaybackStart: (() => void) | undefined;
let startupTimer: ReturnType<typeof setTimeout> | null = null;

function clearStartupTimer() {
  if (startupTimer !== null) clearTimeout(startupTimer);
  startupTimer = null;
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
    emitSpeechError("start-timeout");
    stopSpeech();
  }, 8_000);
}

function preferredEnglishVoice() {
  try {
    const voices = window.speechSynthesis.getVoices();
    return voices.find((voice) => voice.lang.startsWith("en-US"))
      ?? voices.find((voice) => voice.lang.startsWith("en"));
  } catch {
    return undefined;
  }
}

function createUtterance(text: string, rate: number) {
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-US";
  utterance.rate = rate;
  const voice = preferredEnglishVoice();
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
  playbackRun += 1;
  clearStartupTimer();
  pendingPlaybackStart = undefined;
  playbackSegments = [];
  playbackIndex = 0;
  activeUtterance = null;
  activeUtteranceStarted = false;
  let stopped = true;
  if (isSpeechSupported()) {
    try {
      window.speechSynthesis.cancel();
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

export function speak(text: string, rate = 0.82) {
  if (!isSpeechSupported()) return false;
  if (!stopSpeech()) return false;
  const run = playbackRun;
  let utterance: SpeechSynthesisUtterance;
  try {
    utterance = createUtterance(text, rate);
  } catch {
    emitSpeechError("unavailable");
    return false;
  }
  activeUtterance = utterance;
  activeUtteranceStarted = false;
  utterance.onstart = () => {
    if (run !== playbackRun || activeUtterance !== utterance) return;
    activeUtteranceStarted = true;
    clearStartupTimer();
  };
  utterance.onend = () => {
    if (run === playbackRun && activeUtterance === utterance) {
      clearStartupTimer();
      activeUtterance = null;
    }
  };
  utterance.onerror = (event) => {
    if (run === playbackRun && activeUtterance === utterance) {
      clearStartupTimer();
      activeUtterance = null;
      emitSpeechError(event.error || "unavailable");
    }
  };
  watchSpeechStartup(run, utterance);
  try {
    window.speechSynthesis.speak(utterance);
  } catch {
    if (run === playbackRun && activeUtterance === utterance) {
      clearStartupTimer();
      activeUtterance = null;
    }
    emitSpeechError("unavailable");
    return false;
  }
  return true;
}

function playCurrentSegment(run: number) {
  if (!isSpeechSupported() || run !== playbackRun || playbackState === "idle") return false;
  const text = playbackSegments[playbackIndex];
  if (!text) {
    stopSpeech();
    return false;
  }
  let utterance: SpeechSynthesisUtterance;
  try {
    utterance = createUtterance(text, playbackRate);
  } catch {
    emitSpeechError("unavailable");
    stopSpeech();
    return false;
  }
  activeUtterance = utterance;
  activeUtteranceStarted = false;
  utterance.onstart = () => {
    if (run !== playbackRun || activeUtterance !== utterance) return;
    activeUtteranceStarted = true;
    clearStartupTimer();
    if (playbackState !== "paused") emitPlaybackState("playing");
    const onStart = pendingPlaybackStart;
    pendingPlaybackStart = undefined;
    onStart?.();
  };
  utterance.onend = () => {
    if (run !== playbackRun || activeUtterance !== utterance) return;
    clearStartupTimer();
    activeUtterance = null;
    playbackIndex += 1;
    if (playbackIndex >= playbackSegments.length) stopSpeech();
    else playCurrentSegment(run);
  };
  utterance.onerror = (event) => {
    if (run === playbackRun && activeUtterance === utterance) {
      emitSpeechError(event.error || "unavailable");
      stopSpeech();
    }
  };
  if (playbackState !== "paused") emitPlaybackState("loading");
  watchSpeechStartup(run, utterance);
  try {
    window.speechSynthesis.speak(utterance);
  } catch {
    emitSpeechError("unavailable");
    stopSpeech();
    return false;
  }
  return run === playbackRun;
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
