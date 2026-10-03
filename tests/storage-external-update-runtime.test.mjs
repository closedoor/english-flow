import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const parsed = ts.createSourceFile("page.tsx", page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let effectSource;
function findEffect(node) {
  if (ts.isCallExpression(node) && node.expression.getText(parsed) === "useEffect") {
    const callback = node.arguments[0];
    if (callback?.getText(parsed).includes("const handleExternalStorageUpdate")) effectSource = callback.getText(parsed);
  }
  ts.forEachChild(node, findEffect);
}
findEffect(parsed);
assert.ok(effectSource, "execute the real cross-window storage-event effect");
const compiled = ts.transpileModule(`globalThis.installStorageListener = ${effectSource};`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const keys = [...page.slice(page.indexOf("const STORAGE ="), page.indexOf("type StorageKey"))
  .matchAll(/\w+: "(wordflow-[^"]+)"/g)].map((match) => match[1]);
assert.equal(keys.length, 19);
const STORAGE_ERROR_EVENT = /const STORAGE_ERROR_EVENT = "([^"]+)"/.exec(page)?.[1];
assert.ok(STORAGE_ERROR_EVENT);

function listener({ hydrated = true, alreadyDetected = false, getterFails = false } = {}) {
  const local = { label: "localStorage" }, session = { label: "sessionStorage" };
  const observations = { pauses: 0, stops: 0, notices: [], conflicts: [], errors: [], getterReads: 0, listeners: 0 };
  let handler;
  const window = {
    addEventListener(name, callback) { assert.equal(name, "storage"); handler = callback; observations.listeners += 1; },
    removeEventListener(name, callback) { assert.equal(name, "storage"); assert.equal(callback, handler); handler = undefined; observations.listeners -= 1; },
    dispatchEvent(event) { assert.equal(event.type, STORAGE_ERROR_EVENT); observations.errors.push(true); return true; },
  };
  Object.defineProperty(window, "localStorage", { get() {
    observations.getterReads += 1;
    if (getterFails) throw new DOMException("Simulated runtime storage getter refusal", "SecurityError");
    return local;
  } });
  const context = vm.createContext({
    window, Event, STORAGE_ERROR_EVENT, hydrated, externalUpdateDetected: alreadyDetected, STORAGE_KEYS: keys,
    storageCoordinatorRef: { current: { pause() { observations.pauses += 1; } } },
    stopSpeech() { observations.stops += 1; },
    setBackupNotice(value) { observations.notices.push(value); },
    setExternalUpdateDetected(value) { observations.conflicts.push(value); },
    setStorageWriteError(value) { observations.errors.push(value); },
  });
  vm.runInContext(compiled, context);
  const cleanup = context.installStorageListener();
  return { local, session, observations, cleanup, dispatch: (key, storageArea = local) => handler?.({ key, storageArea }) };
}

test("every actual learning-key update pauses saving and exposes recovery before further user work", () => {
  for (const key of keys) {
    const app = listener();
    app.dispatch(key);
    assert.equal(app.observations.pauses, 1);
    assert.equal(app.observations.stops, 1);
    assert.deepEqual(app.observations.conflicts, [true]);
    assert.deepEqual(app.observations.notices, [null]);
    assert.deepEqual(app.observations.errors, []);
  }
});

test("a real local-storage clear still pauses the page and retains its in-memory rescue flow", () => {
  const app = listener();
  app.dispatch(null);
  assert.equal(app.observations.pauses, 1);
  assert.deepEqual(app.observations.conflicts, [true]);
});

test("unrelated local keys and identifiable session-storage changes do not pause learning", () => {
  const app = listener();
  app.dispatch("unrelated-preference");
  app.dispatch("wordflow-unrelated-future-key");
  app.dispatch(keys[0], app.session);
  assert.equal(app.observations.pauses, 0);
  assert.equal(app.observations.stops, 0);
  assert.deepEqual(app.observations.conflicts, []);
  assert.deepEqual(app.observations.errors, []);
});

test("temporary localStorage getter refusal cannot bypass cross-window protection or throw an uncaught error", () => {
  for (const key of [keys[0], null]) {
    const app = listener({ getterFails: true });
    assert.doesNotThrow(() => app.dispatch(key));
    assert.equal(app.observations.pauses, 1, "unavailable storage must remain paused after an external learning update");
    assert.equal(app.observations.stops, 1);
    assert.deepEqual(app.observations.conflicts, [true]);
    assert.deepEqual(app.observations.notices, [null]);
    assert.deepEqual(app.observations.errors, [true], "the access fault remains visible alongside stale-page recovery");
  }
});

test("unrelated events stay harmless when browser storage access is already unavailable", () => {
  const app = listener({ getterFails: true });
  assert.doesNotThrow(() => app.dispatch("unrelated-preference"));
  assert.equal(app.observations.getterReads, 0, "irrelevant events do not need protected storage access");
  assert.equal(app.observations.pauses, 0);
  assert.deepEqual(app.observations.errors, []);
});

test("repeat learning events preserve the rescue notice, and listener cleanup removes the actual callback", () => {
  const app = listener({ alreadyDetected: true });
  app.dispatch(keys[0]);
  assert.equal(app.observations.pauses, 1);
  assert.deepEqual(app.observations.notices, [], "another event must not erase an already visible export result");
  assert.equal(app.observations.listeners, 1);
  app.cleanup();
  assert.equal(app.observations.listeners, 0);
  app.dispatch(keys[1]);
  assert.equal(app.observations.pauses, 1);
});

test("unhydrated loading never attaches the cross-window listener", () => {
  const app = listener({ hydrated: false });
  assert.equal(app.observations.listeners, 0);
  assert.equal(app.cleanup, undefined);
});
