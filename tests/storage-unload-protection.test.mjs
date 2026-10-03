import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

// Execute the page's real effect and action callbacks with the real coordinator.
// This checks application decisions; a native browser separately verifies its
// beforeunload dialog policy. It does not emulate iOS lifecycle guarantees.
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const tree = ts.createSourceFile("page.tsx", page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = new Map();
let unloadEffect;
let latestAction;
function visit(node) {
  if (ts.isVariableDeclaration(node)) declarations.set(node.name.getText(tree), node.initializer?.getText(tree));
  if (ts.isCallExpression(node) && node.expression.getText(tree) === "useEffect"
      && node.arguments[0]?.getText(tree).includes("const protectUnsavedWork =")) {
    unloadEffect = node.arguments[0].getText(tree);
  }
  if (ts.isJsxOpeningElement(node) && node.tagName.getText(tree) === "button") {
    const attrs = node.attributes.properties;
    if (attrs.some((attr) => ts.isJsxAttribute(attr) && attr.name.getText(tree) === "ref"
        && attr.initializer?.getText(tree) === "{syncReloadRef}")) {
      const attr = attrs.find((candidate) => ts.isJsxAttribute(candidate) && candidate.name.getText(tree) === "onClick");
      assert.ok(attr?.initializer && ts.isJsxExpression(attr.initializer));
      latestAction = attr.initializer.expression.getText(tree);
    }
  }
  ts.forEachChild(node, visit);
}
visit(tree);
assert.ok(unloadEffect && latestAction, "test the installed unload effect and explicit latest-record action");
const compile = (source, module = ts.ModuleKind.ESNext) => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module },
}).outputText;
function evaluate(expression, globals = {}) {
  const module = { exports: {} };
  vm.runInNewContext(compile(`export default (${expression});`, ts.ModuleKind.CommonJS), {
    ...globals, module, exports: module.exports,
  });
  return module.exports.default;
}
async function load(name) {
  const source = await readFile(new URL(`../app/${name}`, import.meta.url), "utf8");
  return import(`data:text/javascript;base64,${Buffer.from(compile(source)).toString("base64")}`);
}
const { createLearningStorageCoordinator, LEARNING_STORAGE_LOCK } = await load("storage-coordination.ts");
const backup = await load("backup-data.ts");
const STORAGE = evaluate(declarations.get("STORAGE"));
const keys = Object.values(STORAGE);
assert.equal(keys.length, 19);

function storage() {
  const values = new Map([
    [STORAGE.mastered, "[]"], [STORAGE.difficult, "[]"], [STORAGE.sentenceSaved, "[]"],
    [STORAGE.session, '{"mode":"free","count":20,"path":"frequency"}'],
  ]);
  const quota = new Set();
  return {
    values, quota,
    getItem: (key) => values.get(key) ?? null,
    setItem(key, value) {
      if (quota.has(key)) throw new DOMException("Explicit test quota refusal", "QuotaExceededError");
      values.set(key, String(value));
    },
    removeItem(key) { values.delete(key); },
  };
}
function writer(disk, options = {}) {
  const presentation = { warning: false, conflict: false };
  const coordinator = createLearningStorageCoordinator({
    keys, initial: disk, storage: () => disk,
    onError() { presentation.warning = true; },
    onConflict() { presentation.conflict = true; },
    ...options,
  });
  return { coordinator, presentation };
}
function installed(coordinator, { hydrated = true, confirmedReloadRef = { current: false }, externalUpdateDetected = false } = {}) {
  const target = new EventTarget();
  const reloadEvents = [];
  const browser = {
    addEventListener: (...args) => target.addEventListener(...args),
    removeEventListener: (...args) => target.removeEventListener(...args),
    location: { reload() { reloadEvents.push(dispatch()); } },
  };
  function dispatch() {
    const event = new Event("beforeunload", { cancelable: true });
    // Node 22's generic Event has a getter-only boolean returnValue. The real
    // browser uses BeforeUnloadEvent's writable DOMString attribute instead.
    // Keep native dispatch/cancellation, and supply that browser-specific field.
    let returnValue = "";
    const returnValueAssignments = [];
    Object.defineProperty(event, "returnValue", {
      configurable: true,
      enumerable: true,
      get: () => returnValue,
      set: (value) => {
        returnValue = String(value);
        returnValueAssignments.push(returnValue);
      },
    });
    assert.equal(event.returnValue, "", "BeforeUnloadEvent starts with an empty DOMString");
    target.dispatchEvent(event);
    assert.equal(event.returnValue, "", "the handler retains the browser's empty-string returnValue contract");
    assert.deepEqual(returnValueAssignments, event.defaultPrevented ? [""] : [],
      "unsaved work writes returnValue; durable, unhydrated, confirmed and cleaned-up paths leave it untouched");
    return event.defaultPrevented;
  }
  const globals = {
    window: browser, hydrated, confirmedReloadRef, externalUpdateDetected,
    storageWriteError: false, storageCoordinatorRef: { current: coordinator },
  };
  const cleanup = evaluate(unloadEffect, globals)();
  assert.equal(typeof cleanup, "function", "the effect releases the installed event listener");
  return { dispatch, cleanup, globals, confirmedReloadRef, reloadEvents };
}

test("quota failure remains protected after dismissing the warning and completing the queue", async () => {
  const disk = storage(), { coordinator, presentation } = writer(disk);
  disk.quota.add(STORAGE.mastered);
  const effect = installed(coordinator);
  try {
    coordinator.write(STORAGE.mastered, "[1]");
    await coordinator.flush();
    assert.equal(presentation.warning, true);
    assert.equal(coordinator.isIdle(), true, "the queue is finished; failed durability still matters");
    presentation.warning = false;
    assert.equal(disk.getItem(STORAGE.mastered), "[]");
    assert.equal(effect.dispatch(), true, "dismissing a presentation cannot discard rescuable memory");
  } finally { effect.cleanup(); coordinator.dispose(); }
});

test("another field succeeding cannot clear a failed field; the same-key retry releases protection", async () => {
  const disk = storage(), { coordinator } = writer(disk), effect = installed(coordinator);
  try {
    disk.quota.add(STORAGE.mastered);
    coordinator.write(STORAGE.mastered, "[1]");
    await coordinator.flush();
    coordinator.write(STORAGE.difficult, "[2]");
    await coordinator.flush();
    assert.equal(disk.getItem(STORAGE.difficult), "[2]");
    assert.equal(effect.dispatch(), true);
    disk.quota.delete(STORAGE.mastered);
    coordinator.write(STORAGE.mastered, "[1]");
    await coordinator.flush();
    assert.equal(disk.getItem(STORAGE.mastered), "[1]");
    assert.equal(effect.dispatch(), false, "durable repair must not leave a permanent unload warning");
  } finally { effect.cleanup(); coordinator.dispose(); }
});

test("queued saves protect immediately, while an unhydrated loading page does not prompt", async () => {
  let grant;
  const gate = new Promise((resolve) => { grant = resolve; });
  const locks = { async request(name, options, callback) {
    assert.equal(name, LEARNING_STORAGE_LOCK);
    await gate;
    if (options.signal.aborted) throw new DOMException("Aborted", "AbortError");
    return callback();
  } };
  const disk = storage(), { coordinator } = writer(disk, { locks });
  const loading = installed(coordinator, { hydrated: false });
  const hydrated = installed(coordinator);
  try {
    coordinator.write(STORAGE.mastered, "[1]");
    assert.equal(disk.getItem(STORAGE.mastered), "[]");
    assert.equal(loading.dispatch(), false);
    assert.equal(hydrated.dispatch(), true);
    grant(); await coordinator.flush();
    assert.equal(hydrated.dispatch(), false);
  } finally { grant(); loading.cleanup(); hydrated.cleanup(); coordinator.dispose(); }
});

test("a paused stale page retains unload protection for its own unsaved records", async () => {
  const disk = storage(), a = writer(disk), b = writer(disk);
  const effect = installed(b.coordinator, { externalUpdateDetected: true });
  try {
    a.coordinator.write(STORAGE.mastered, "[1]"); await a.coordinator.flush();
    b.coordinator.write(STORAGE.mastered, "[2]"); await b.coordinator.flush();
    assert.equal(b.presentation.conflict, true);
    assert.equal(b.coordinator.isIdle(), false);
    assert.equal(disk.getItem(STORAGE.mastered), "[1]");
    assert.equal(effect.dispatch(), true, "the sync sheet is not permission to discard this page's memory");
  } finally { effect.cleanup(); a.coordinator.dispose(); b.coordinator.dispose(); }
});

test("the explicit latest-record click authorizes replacement without an accidental unload block", async () => {
  const disk = storage(), { coordinator } = writer(disk), effect = installed(coordinator);
  try {
    disk.quota.add(STORAGE.mastered);
    coordinator.write(STORAGE.mastered, "[1]"); await coordinator.flush(); coordinator.pause();
    assert.equal(effect.dispatch(), true);
    evaluate(latestAction, effect.globals)();
    assert.equal(effect.confirmedReloadRef.current, true);
    assert.deepEqual(effect.reloadEvents, [false], "the actual explicit action sets confirmation before reloading");
  } finally { effect.cleanup(); coordinator.dispose(); }
});

test("the actual successful restore awaits replacement and explicitly authorizes its reload", async () => {
  const disk = storage(), { coordinator } = writer(disk), effect = installed(coordinator);
  try {
    disk.quota.add(STORAGE.mastered);
    coordinator.write(STORAGE.mastered, "[1]"); await coordinator.flush();
    assert.equal(effect.dispatch(), true);
    disk.quota.clear();
    const incoming = backup.createLearningBackup({ getItem: (key) => key === STORAGE.mastered ? "[9]" : disk.getItem(key) }, keys);
    await evaluate(declarations.get("restoreLearningBackup"), {
      ...effect.globals, ...backup, STORAGE_KEYS: keys, pendingBackup: incoming,
      backupActionLock: { current: false },
      setBackupBusy() {}, setPendingBackup() {},
      setStorageWriteError() { assert.fail("successful restore must not report a failure"); },
      setBackupNotice() { assert.fail("successful restore must not report a failure"); },
    })();
    assert.equal(disk.getItem(STORAGE.mastered), "[9]");
    assert.equal(coordinator.isIdle(), true);
    assert.equal(effect.confirmedReloadRef.current, true);
    assert.deepEqual(effect.reloadEvents, [false]);
  } finally { effect.cleanup(); coordinator.dispose(); }
});

test("a failed real restore leaves confirmation unset and preserves unload protection", async () => {
  const disk = storage(), { coordinator } = writer(disk), effect = installed(coordinator);
  try {
    disk.quota.add(STORAGE.mastered);
    coordinator.write(STORAGE.mastered, "[1]"); await coordinator.flush();
    const incoming = backup.createLearningBackup({ getItem: (key) => key === STORAGE.mastered ? "[9]" : disk.getItem(key) }, keys);
    let failure = false;
    await evaluate(declarations.get("restoreLearningBackup"), {
      ...effect.globals, ...backup, STORAGE_KEYS: keys, pendingBackup: incoming,
      backupActionLock: { current: false },
      setBackupBusy() {}, setPendingBackup() {}, setStorageWriteError(value) { failure = value; }, setBackupNotice() {},
    })();
    assert.equal(failure, true);
    assert.equal(effect.confirmedReloadRef.current, false);
    assert.deepEqual(effect.reloadEvents, []);
    assert.equal(effect.dispatch(), true);
  } finally { effect.cleanup(); coordinator.dispose(); }
});

test("a successful partial progress reset retains protection for a bookmark whose save failed", async () => {
  const disk = storage();
  disk.values.delete(STORAGE.mastered);
  const { coordinator } = writer(disk), effect = installed(coordinator);
  const memory = { sentenceSaved: [123] };
  try {
    disk.quota.add(STORAGE.sentenceSaved);
    disk.quota.add(STORAGE.mastered);
    coordinator.write(STORAGE.mastered, "[1]");
    coordinator.write(STORAGE.sentenceSaved, JSON.stringify(memory.sentenceSaved));
    await coordinator.flush();
    assert.equal(effect.dispatch(), true);
    const reset = declarations.get("resetLearningProgress");
    const setterNames = [...new Set(reset.match(/\bset[A-Z]\w+(?=\()/g))];
    assert.equal(setterNames.includes("setSentenceSaved"), false, "reset deliberately retains bookmarks");
    const setters = Object.fromEntries(setterNames.map((name) => [name, (value) => {
      if (name === "setStorageWriteError") assert.fail("the partial reset must succeed");
    }]));
    await evaluate(reset, {
      ...effect.globals, ...backup, ...setters, STORAGE,
      backupActionLock: { current: false }, words: [{ id: 1 }], count: 10,
      activeSessionResumeSnapshotRef: { current: null }, readingPositionRef: { current: new Map() },
      sentenceResumeSnapshotRef: { current: null }, patternResumeSnapshotRef: { current: null },
      practiceRotationRef: { current: { word: 0, sentence: 0, pattern: 0 } }, restoreSentenceSetupPreferences() {},
    })();
    assert.equal(disk.getItem(STORAGE.sentenceSaved), "[]");
    assert.equal(disk.getItem(STORAGE.mastered), null, "an intentional empty reset may already equal disk and perform no write");
    assert.deepEqual(memory.sentenceSaved, [123]);
    assert.equal(coordinator.isIdle(), true);
    assert.equal(effect.confirmedReloadRef.current, false);
    assert.equal(effect.dispatch(), true, "resetting other fields cannot certify an unsaved retained bookmark");
    disk.quota.clear(); coordinator.write(STORAGE.sentenceSaved, "[123]"); await coordinator.flush();
    assert.equal(effect.dispatch(), false, "repairing the retained bookmark clears dirtiness because the reset explicitly replaced its other no-op target");
  } finally { effect.cleanup(); coordinator.dispose(); }
});

test("effect cleanup removes the actual listener instead of retaining stale protection", async () => {
  const disk = storage(), { coordinator } = writer(disk), effect = installed(coordinator);
  disk.quota.add(STORAGE.mastered);
  coordinator.write(STORAGE.mastered, "[1]"); await coordinator.flush();
  assert.equal(effect.dispatch(), true);
  effect.cleanup();
  assert.equal(effect.dispatch(), false);
  assert.equal(coordinator.hasUnsavedChanges(), true, "listener removal is not a fabricated successful save");
  coordinator.dispose();
});
