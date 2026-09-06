import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../app/speech-playback.ts", import.meta.url), "utf8");
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const JavaScript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const speech = await import(`data:text/javascript;base64,${Buffer.from(JavaScript).toString("base64")}`);

test("long-form English is split into ordered, bounded speech segments", () => {
  const text = "This is the first sentence for a learner. The second sentence adds enough detail to make the passage longer. The third sentence finishes the example without losing any words.";
  const segments = speech.splitSpeechText(text, 70);
  assert.ok(segments.length >= 3);
  assert.ok(segments.every((segment) => segment && segment.length <= 70));
  assert.equal(segments.join(" "), text.replace(/\s+/g, " ").trim());
  assert.match(source, /maximumCharacters = 160/);
});

test("segmented speech queues each part and supports pause, resume and stop", () => {
  class FakeUtterance {
    constructor(text) { this.text = text; }
  }
  const spoken = [];
  let cancelCount = 0;
  let pauseCount = 0;
  let resumeCount = 0;
  const browserWindow = new EventTarget();
  browserWindow.speechSynthesis = {
    cancel() { cancelCount += 1; },
    getVoices() { return []; },
    pause() { pauseCount += 1; },
    resume() { resumeCount += 1; },
    speak(utterance) { spoken.push(utterance); utterance.onstart?.(); },
  };
  globalThis.window = browserWindow;
  globalThis.SpeechSynthesisUtterance = FakeUtterance;

  const states = [];
  browserWindow.addEventListener(speech.SPEECH_PLAYBACK_EVENT, (event) => states.push(event.detail));
  const text = `${"A practical English sentence has several useful words. ".repeat(8)}The article is complete.`;
  assert.equal(speech.startSegmentedSpeech(text), true);
  assert.ok(spoken.length === 1);
  assert.ok(states.includes("playing"));
  assert.equal(speech.toggleSegmentedSpeech(), "paused");
  assert.equal(pauseCount, 1);
  assert.equal(speech.toggleSegmentedSpeech(), "playing");
  assert.equal(resumeCount, 1);
  spoken[0].onend();
  assert.ok(spoken.length >= 2);
  speech.stopSpeech();
  assert.equal(states.at(-1), "idle");
  assert.ok(cancelCount >= 2);

  delete globalThis.window;
  delete globalThis.SpeechSynthesisUtterance;
});

test("browser speech failures are surfaced instead of failing silently", () => {
  class FakeUtterance {
    constructor(text) { this.text = text; }
  }
  const spoken = [];
  const browserWindow = new EventTarget();
  browserWindow.speechSynthesis = {
    cancel() {},
    getVoices() { return []; },
    speak(utterance) { spoken.push(utterance); },
  };
  globalThis.window = browserWindow;
  globalThis.SpeechSynthesisUtterance = FakeUtterance;

  const errors = [];
  browserWindow.addEventListener(speech.SPEECH_ERROR_EVENT, (event) => errors.push(event.detail));
  assert.equal(speech.speak("A useful sentence."), true);
  spoken[0].onerror({ error: "synthesis-failed" });
  assert.deepEqual(errors, ["synthesis-failed"]);

  delete globalThis.window;
  delete globalThis.SpeechSynthesisUtterance;
});

test("a browser cancel failure cannot escape or start overlapping speech", () => {
  class FakeUtterance {
    constructor(text) { this.text = text; }
  }
  let speakCount = 0;
  const browserWindow = new EventTarget();
  browserWindow.speechSynthesis = {
    cancel() { throw new Error("speech service unavailable"); },
    getVoices() { return []; },
    speak() { speakCount += 1; },
  };
  globalThis.window = browserWindow;
  globalThis.SpeechSynthesisUtterance = FakeUtterance;

  const errors = [];
  browserWindow.addEventListener(speech.SPEECH_ERROR_EVENT, (event) => errors.push(event.detail));
  assert.doesNotThrow(() => speech.stopSpeech());
  assert.equal(speech.speak("Do not overlap."), false);
  assert.equal(speech.startSegmentedSpeech("Do not overlap either."), false);
  assert.equal(speakCount, 0);
  assert.deepEqual(errors, ["unavailable", "unavailable", "unavailable"]);

  delete globalThis.window;
  delete globalThis.SpeechSynthesisUtterance;
});

test("reading controls expose play, pause, resume and stop actions", () => {
  assert.match(page, /startSegmentedSpeech\(reading\.text, readingSpeechRate, noteStudyDay\)/);
  assert.match(page, /READING_SPEECH_RATES/);
  assert.match(page, /toggleSegmentedSpeech\(\)/);
  assert.match(page, /暂停朗读/);
  assert.match(page, /继续朗读/);
  assert.match(page, /停止全文朗读/);
  assert.match(page, /系统英文语音 · 自动分段/);
});

test("stopping paused reading clears the engine pause before the next word or article", () => {
  const browserWindow = new EventTarget();
  const audible = [];
  browserWindow.speechSynthesis = {
    paused: false,
    cancel() {}, // The real API preserves paused here.
    pause() { this.paused = true; },
    resume() { this.paused = false; },
    getVoices() { return []; },
    speak(utterance) { if (!this.paused) { audible.push(utterance); utterance.onstart?.(); } },
  };
  globalThis.window = browserWindow;
  globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  try {
    assert.equal(speech.startSegmentedSpeech("The first article."), true);
    assert.equal(speech.toggleSegmentedSpeech(), "paused");
    assert.equal(speech.stopSpeech(), true);
    assert.equal(browserWindow.speechSynthesis.paused, false);
    assert.equal(speech.speak("hello"), true);
    assert.equal(speech.startSegmentedSpeech("The second article."), true);
    assert.equal(speech.toggleSegmentedSpeech(), "paused");
    assert.equal(speech.startSegmentedSpeech("A restarted article."), true);
    assert.deepEqual(audible.map((item) => item.text), ["The first article.", "hello", "The second article.", "A restarted article."]);
  } finally {
    speech.stopSpeech();
    delete globalThis.window;
    delete globalThis.SpeechSynthesisUtterance;
  }
});

test("failed article startup returns false and stale events cannot restart it", () => {
  const browserWindow = new EventTarget();
  let failedUtterance;
  browserWindow.speechSynthesis = {
    cancel() {},
    getVoices() { return []; },
    speak(utterance) { failedUtterance = utterance; throw new Error("unavailable"); },
  };
  globalThis.window = browserWindow;
  globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  const states = [];
  browserWindow.addEventListener(speech.SPEECH_PLAYBACK_EVENT, (event) => states.push(event.detail));
  try {
    assert.equal(speech.startSegmentedSpeech("A failed article."), false);
    assert.equal(states.at(-1), "idle");
    const stateCount = states.length;
    failedUtterance.onend();
    assert.equal(states.length, stateCount);
    globalThis.SpeechSynthesisUtterance = class { constructor() { throw new Error("constructor unavailable"); } };
    assert.equal(speech.startSegmentedSpeech("Cannot construct speech."), false);
    assert.equal(states.at(-1), "idle");
  } finally {
    speech.stopSpeech();
    delete globalThis.window;
    delete globalThis.SpeechSynthesisUtterance;
  }
});

function delayedSpeech(t) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const browserWindow = new EventTarget();
  const spoken = [];
  const states = [];
  const errors = [];
  browserWindow.speechSynthesis = {
    cancel() {}, getVoices() { return []; },
    speak(utterance) { spoken.push(utterance); },
  };
  browserWindow.addEventListener(speech.SPEECH_PLAYBACK_EVENT, (event) => states.push(event.detail));
  browserWindow.addEventListener(speech.SPEECH_ERROR_EVENT, (event) => errors.push(event.detail));
  globalThis.window = browserWindow;
  globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  t.after(() => {
    speech.stopSpeech();
    delete globalThis.window;
    delete globalThis.SpeechSynthesisUtterance;
  });
  return { spoken, states, errors };
}

test("queued reading counts activity only once audio starts, including across segments", (t) => {
  const { spoken, states, errors } = delayedSpeech(t);
  let studyCount = 0;
  assert.equal(speech.startSegmentedSpeech("A useful sentence with several words. ".repeat(12), 0.74, () => studyCount++), true);
  assert.equal(states.at(-1), "loading");
  assert.equal(speech.toggleSegmentedSpeech(), "loading");
  assert.equal(studyCount, 0);
  spoken[0].onstart();
  assert.equal(states.at(-1), "playing");
  assert.equal(studyCount, 1);
  spoken[0].onend();
  spoken[1].onstart();
  assert.equal(studyCount, 1);
  t.mock.timers.tick(8_000);
  assert.deepEqual(errors, []);
  assert.equal(states.at(-1), "playing");
});

test("asynchronous startup failures do not record a study day", (t) => {
  const { spoken, states, errors } = delayedSpeech(t);
  let studyCount = 0;
  speech.startSegmentedSpeech("A failed article.", 0.74, () => studyCount++);
  spoken[0].onerror({ error: "synthesis-failed" });
  spoken[0].onstart();
  t.mock.timers.tick(8_000);
  assert.equal(studyCount, 0);
  assert.equal(states.at(-1), "idle");
  assert.deepEqual(errors, ["synthesis-failed"]);
});

test("a silent speech engine times out and leaves a working retry with stale starts ignored", (t) => {
  const { spoken, states, errors } = delayedSpeech(t);
  let studyCount = 0;
  speech.startSegmentedSpeech("Never started.", 0.74, () => studyCount++);
  t.mock.timers.tick(7_999);
  assert.equal(states.at(-1), "loading");
  t.mock.timers.tick(1);
  assert.equal(states.at(-1), "idle");
  assert.deepEqual(errors, ["start-timeout"]);
  assert.equal(studyCount, 0);
  speech.startSegmentedSpeech("Retry succeeds.", 0.74, () => studyCount++);
  spoken[0].onstart();
  assert.equal(states.at(-1), "loading");
  assert.equal(studyCount, 0);
  spoken[1].onstart();
  assert.equal(states.at(-1), "playing");
  assert.equal(studyCount, 1);
});

test("stopping during preparation cancels both the study callback and timeout", (t) => {
  const { spoken, states, errors } = delayedSpeech(t);
  let studyCount = 0;
  speech.startSegmentedSpeech("Stopped before playback.", 0.74, () => studyCount++);
  speech.stopSpeech();
  spoken[0].onstart();
  t.mock.timers.tick(8_000);
  assert.equal(studyCount, 0);
  assert.equal(states.at(-1), "idle");
  assert.deepEqual(errors, []);
});

test("every reading segment has a startup timeout and ignores stale events", (t) => {
  const { spoken, states, errors } = delayedSpeech(t);
  let studyCount = 0;
  speech.startSegmentedSpeech("A useful sentence with several words. ".repeat(12), 0.74, () => studyCount++);
  spoken[0].onstart();
  spoken[0].onend();
  assert.equal(states.at(-1), "loading");
  spoken[0].onstart();
  t.mock.timers.tick(8_000);
  assert.equal(states.at(-1), "idle");
  assert.deepEqual(errors, ["start-timeout"]);
  spoken[1].onstart();
  spoken[1].onend();
  assert.equal(spoken.length, 2);
  assert.equal(studyCount, 1);
});

test("word and sentence audio detects silent startup and permits a clean retry", (t) => {
  const { spoken, errors } = delayedSpeech(t);
  assert.equal(speech.speak("hello"), true);
  t.mock.timers.tick(8_000);
  assert.deepEqual(errors, ["start-timeout"]);
  assert.equal(speech.speak("Try again."), true);
  spoken[0].onstart?.();
  spoken[1].onstart();
  t.mock.timers.tick(8_000);
  assert.deepEqual(errors, ["start-timeout"]);
  spoken[1].onend();
});

test("a segment queued at a pause boundary waits until resume before timing out", (t) => {
  const { spoken, states, errors } = delayedSpeech(t);
  window.speechSynthesis.pause = () => {};
  window.speechSynthesis.resume = () => {};
  speech.startSegmentedSpeech("A useful sentence with several words. ".repeat(12));
  spoken[0].onstart();
  assert.equal(speech.toggleSegmentedSpeech(), "paused");
  spoken[0].onend();
  t.mock.timers.tick(60_000);
  assert.equal(states.at(-1), "paused");
  assert.deepEqual(errors, []);
  assert.equal(speech.toggleSegmentedSpeech(), "loading");
  t.mock.timers.tick(8_000);
  assert.equal(states.at(-1), "idle");
  assert.deepEqual(errors, ["start-timeout"]);
});

test("a resumed queued segment can start synchronously without a later false timeout", (t) => {
  const { spoken, states, errors } = delayedSpeech(t);
  window.speechSynthesis.pause = () => {};
  window.speechSynthesis.resume = () => spoken.at(-1).onstart();
  speech.startSegmentedSpeech("A useful sentence with several words. ".repeat(12));
  spoken[0].onstart();
  speech.toggleSegmentedSpeech();
  spoken[0].onend();
  assert.equal(speech.toggleSegmentedSpeech(), "playing");
  t.mock.timers.tick(8_000);
  assert.equal(states.at(-1), "playing");
  assert.deepEqual(errors, []);
});
