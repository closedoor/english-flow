import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const compile = (source) => ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.React,
}, fileName: "reading.tsx" }).outputText;
const load = async (path) => import(`data:text/javascript;base64,${Buffer.from(compile(await readFile(new URL(path, import.meta.url), "utf8"))).toString("base64")}`);
const { readings, readingQuestions } = await load("../app/reading-data.ts");
const backup = await load("../app/backup-data.ts");
const ast = ts.createSourceFile("page.tsx", page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = new Map(), functions = new Map(), effects = [];
function visit(node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) declarations.set(node.name.text, node.initializer.getText(ast));
  if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node.getText(ast));
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect") effects.push(node.arguments[0].getText(ast));
  ts.forEachChild(node, visit);
}
visit(ast);
const run = (source, context = {}) => vm.runInNewContext(compile(source), { ...context });
const plain = (value) => JSON.parse(JSON.stringify(value));
const React = { createElement: (tag, props, ...children) => ({ tag, props: props ?? {}, children }), Fragment: "fragment" };
const textOf = (node) => node == null || typeof node === "boolean" ? "" : typeof node !== "object" ? String(node) : (Array.isArray(node) ? node : node.children).map(textOf).join("");
function find(node, predicate) {
  if (!node || typeof node !== "object") return undefined;
  if (!Array.isArray(node) && predicate(node)) return node;
  for (const child of Array.isArray(node) ? node : node.children) {
    const match = find(child, predicate);
    if (match) return match;
  }
}
const button = (tree, label) => {
  const result = find(tree, (node) => node.tag === "button" && textOf(node) === label);
  assert.ok(result, `button exists: ${label}`);
  return result;
};
const storageConstants = page.slice(page.indexOf("const STORAGE ="), page.indexOf("const tabItems:"));
const { STORAGE, STORAGE_KEYS, BACKUP_OPTIONAL_KEYS } = run(`${storageConstants}\n({ STORAGE, STORAGE_KEYS, BACKUP_OPTIONAL_KEYS });`);
const clean = run(`${functions.get("cleanReadingAnswers")}\ncleanReadingAnswers;`, { READING_IDS: new Set(readings.map((item) => item.id)) });
const persistenceEffect = effects.find((code) => code.includes("writeJson(STORAGE.readingAnswers"));
const navigationEffect = effects.find((code) => code.includes("readingHeadingRef.current?.focus"));
const feedbackEffect = effects.find((code) => code.includes("readingFeedbackStateRef.current"));
for (const effect of [persistenceEffect, navigationEffect, feedbackEffect]) assert.ok(effect, "real reading effect exists");

function app(patch = {}) {
  const state = { hydrated: true, externalUpdateDetected: false, hasOpenDialog: false, tab: "read",
    readingId: "r1", readingLevel: 1, readingFilter: "all", readingRetryId: null, readingAnswers: {},
    readingCompleted: [], readingLast: null, showTranslation: false, readingSpeechState: "idle", readingSpeechRate: 0.8,
    ...patch,
  };
  const saved = new Map(), calls = [];
  const frames = new Map(); let frameId = 0;
  const readingReturnIdRef = { current: null };
  const readingFeedbackStateRef = { current: { id: null, answer: undefined } };
  const heading = { focus: () => calls.push("heading") };
  const context = {
    React, readings, readingQuestions, STORAGE, READING_TOTAL: 15, useMemo: (compute) => compute(),
    READING_SPEECH_RATES: [{ value: 0.8, label: "标准", detail: "0.8×" }], readingLoadError: false, networkOnline: true,
    allStudyWords: [], difficult: [], readingReturnIdRef, readingFeedbackStateRef,
    readingHeadingRef: { current: heading }, readingFeedbackRef: { current: { focus: () => calls.push("feedback") } },
    readingListRef: { current: {
      querySelector(selector) { const id = selector.match(/data-reading-id="([^"]+)"/)?.[1]; return state.visibleReadings?.some((item) => item.id === id) ? { scrollIntoView: () => calls.push(`scroll ${id}`), focus: () => calls.push(`focus ${id}`) } : null; },
      scrollIntoView: () => calls.push("scroll list"), focus: () => calls.push("focus list"),
    } },
    readingQuestionOptionsRef: { current: { querySelectorAll: () => [0, 1, 2].map((index) => ({ focus: () => calls.push(`option ${index}`) })) } },
    window: { requestAnimationFrame(fn) { frames.set(++frameId, fn); return frameId; }, cancelAnimationFrame(id) { frames.delete(id); } },
    noteStudyDay: () => calls.push("studied"), stopSpeech: () => calls.push("speech stopped"),
    controlReadingSpeech() {}, addDifficult() {}, commonHeader: () => null,
    writeJson: (key, value) => saved.set(key, JSON.stringify(value)), removeStoredValue: (key) => saved.delete(key),
  };
  for (const key of Object.keys(state)) context[`set${key[0].toUpperCase()}${key.slice(1)}`] = (value) => { state[key] = typeof value === "function" ? value(state[key]) : value; };
  function render() {
    Object.assign(context, state);
    context.completedReadingSet = new Set(state.readingCompleted);
    context.activeReading = readings.find((item) => item.id === state.readingId) ?? null;
    context.lastReading = readings.find((item) => item.id === state.readingLast?.id) ?? null;
    context.activeReadingQuestion = context.activeReading ? readingQuestions[context.activeReading.id] : null;
    const derived = ["selectedReadingAnswer", "readingsAtLevel", "readingNeedsReview", "visibleReadings", "nextReading", "readingCompletionPercent"];
    Object.assign(context, run(`${derived.map((name) => `const ${name} = ${declarations.get(name)};`).join("\n")}\n({ ${derived.join(",")} });`, context));
    state.visibleReadings = context.visibleReadings;
    const handlers = ["openReading", "returnToReadings", "toggleReadingCompleted", "retryReadingQuestion"];
    Object.assign(context, run(`${handlers.map((name) => `const ${name} = ${declarations.get(name)};`).join("\n")}\n({ ${handlers.join(",")} });`, context));
    const tree = run(`${functions.get("readingWordCount")}\n${functions.get("readingMinutes")}\n(${declarations.get("renderRead")})();`, context);
    return { tree, next: context.nextReading, selected: context.selectedReadingAnswer, ...Object.fromEntries(handlers.map((name) => [name, context[name]])) };
  }
  const effect = (source) => run(`(${source})();`, context);
  const flush = () => { for (const [id, fn] of [...frames]) { frames.delete(id); fn(); } };
  return { state, saved, calls, context, render, effect, flush };
}

test("reading answers reject invalid records without losing valid results", () => {
  assert.equal(readings.length, 15);
  assert.ok(Object.values(readingQuestions).every((question) => question.options.length === 3));
  assert.deepEqual(plain(clean({ r1: 0, r2: 2, r3: -1, r4: 3, r5: 0.5, r6: "1", r15: 1, r16: 1 })), { r1: 0, r2: 2, r15: 1 });
  for (const value of [null, [], "bad", 12]) assert.deepEqual(plain(clean(value)), {});
});

test("an actual comprehension answer persists and is restored after reload; stale windows cannot overwrite it", () => {
  const a = app();
  const choice = readingQuestions.r1.options[1];
  button(a.render().tree, `B${choice}`).props.onClick();
  a.render(); a.effect(persistenceEffect);
  const restored = app({ readingAnswers: plain(clean(JSON.parse(a.saved.get(STORAGE.readingAnswers)))) });
  assert.equal(restored.render().selected, 1);
  assert.equal(button(restored.render().tree, `B${choice}`).props["aria-pressed"], true);
  assert.equal(button(restored.render().tree, `B${choice}`).props.disabled, true);
  assert.deepEqual(a.state.readingCompleted, [], "answering is distinct from marking the article read");
  a.state.externalUpdateDetected = true;
  a.state.readingAnswers = {};
  a.render(); a.effect(persistenceEffect);
  assert.deepEqual(JSON.parse(a.saved.get(STORAGE.readingAnswers)), { r1: 1 });
});

test("retrying keeps the saved mistake until a replacement answer is actually submitted", () => {
  const wrong = (readingQuestions.r15.answer + 1) % 3;
  const a = app({ readingId: "r15", readingLevel: 3, readingAnswers: { r15: wrong } });
  a.render().retryReadingQuestion("r15", wrong); a.flush();
  assert.deepEqual(a.state.readingAnswers, { r15: wrong });
  const retry = a.render();
  assert.equal(retry.selected, undefined);
  assert.ok(a.calls.includes(`option ${wrong}`));
  a.effect(persistenceEffect);
  assert.deepEqual(JSON.parse(a.saved.get(STORAGE.readingAnswers)), { r15: wrong }, "closing during a retry retains the last result");
  const correct = readingQuestions.r15.answer;
  button(retry.tree, `${String.fromCharCode(65 + correct)}${readingQuestions.r15.options[correct]}`).props.onClick();
  a.state.readingId = null; a.state.readingFilter = "review";
  const list = a.render();
  assert.deepEqual(a.state.visibleReadings, []);
  assert.match(textOf(list.tree), /当前没有待巩固的文章/);
  assert.deepEqual(a.state.readingCompleted, []);
});

test("the review list finds mistakes across levels while unread filtering respects the selected level", () => {
  const a = app({ readingId: null, readingLevel: 1, readingFilter: "review", readingCompleted: ["r1"], readingAnswers: { r15: (readingQuestions.r15.answer + 1) % 3, r2: readingQuestions.r2.answer } });
  a.render();
  assert.deepEqual(a.state.visibleReadings.map((item) => item.id), ["r15"]);
  a.state.readingFilter = "unread"; a.render();
  assert.deepEqual(a.state.visibleReadings.map((item) => item.id), ["r2", "r7", "r8", "r9"]);
  a.state.readingCompleted = ["r1", "r2", "r7", "r8", "r9"];
  assert.match(textOf(a.render().tree), /这个等级的文章都已读完/);
});

test("next reading skips completed articles, prioritizes the same level and never awards an unread completion", () => {
  const a = app({ readingId: "r8", readingLevel: 1, readingCompleted: ["r1", "r9"] });
  assert.equal(a.render().next.id, "r2", "wrap to an unread article at the same level before increasing difficulty");
  a.state.readingCompleted = ["r1", "r2", "r7", "r9"];
  const view = a.render();
  assert.equal(view.next.id, "r3");
  const before = [...a.state.readingCompleted];
  find(view.tree, (node) => node.props.className === "reading-next").props.onClick();
  assert.equal(a.state.readingId, "r3");
  assert.equal(a.state.readingLevel, 2);
  assert.deepEqual(a.state.readingCompleted, before);
  a.state.readingCompleted = readings.map((item) => item.id);
  assert.equal(a.render().next, null);
  assert.equal(find(a.render().tree, (node) => node.props.className === "reading-next"), undefined);
});

test("article navigation focuses its main title and returns to the relevant list item or an empty list", () => {
  const a = app({ readingAnswers: { r1: 0 } });
  const view = a.render();
  assert.equal(find(view.tree, (node) => node.tag === "h1").props.lang, "en");
  a.effect(navigationEffect); a.effect(feedbackEffect); a.flush();
  assert.deepEqual(a.calls, ["heading"], "a restored answer must not steal focus from the article title");
  view.returnToReadings(); a.render(); a.effect(navigationEffect); a.flush();
  assert.ok(a.calls.includes("focus r1"));
  a.state.readingId = "r1"; a.state.readingFilter = "unread"; a.state.readingCompleted = ["r1"];
  a.render().returnToReadings(); a.render(); a.effect(navigationEffect); a.flush();
  assert.ok(a.calls.includes("focus list"), "a filtered-out article has a usable focus fallback");
});

test("reading answers round-trip in backups and previous backups still restore without the optional record", () => {
  const data = Object.fromEntries(STORAGE_KEYS.map((key) => [key, null]));
  data[STORAGE.readingAnswers] = { r1: 0, r15: 2 };
  const current = backup.createLearningBackup({ getItem: (key) => JSON.stringify(data[key]) }, STORAGE_KEYS);
  assert.equal(backup.isLearningBackup(current, STORAGE_KEYS, BACKUP_OPTIONAL_KEYS), true);
  const saved = new Map();
  const storage = { getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value), removeItem: (key) => saved.delete(key) };
  assert.equal(backup.restoreLearningBackupData(storage, STORAGE_KEYS, current), true);
  assert.deepEqual(plain(clean(JSON.parse(saved.get(STORAGE.readingAnswers)))), { r1: 0, r15: 2 });
  const old = structuredClone(current); delete old.data[STORAGE.readingAnswers];
  assert.equal(backup.isLearningBackup(old, STORAGE_KEYS, BACKUP_OPTIONAL_KEYS), true);
  assert.equal(backup.restoreLearningBackupData(storage, STORAGE_KEYS, old), true);
  assert.equal(saved.has(STORAGE.readingAnswers), false, "restoring an old backup clears newer answers rather than mixing records");
});
