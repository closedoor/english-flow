import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("page.tsx", page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let action, navigationEffect;
function visit(node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "openSentenceBrowser") {
    action = node.initializer?.getText(ast);
  }
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect") {
    const callback = node.arguments[0];
    if (ts.isArrowFunction(callback) && ts.isArrowFunction(callback.body)
      && callback.body.body.getText(ast).includes("sentenceBrowserPresentationRef.current")) {
      navigationEffect = node.getText(ast);
    }
  }
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(action, "extract the actual sentence browser action");
assert.ok(navigationEffect, "extract the actual navigation/unmount cancellation effect");
const compile = (source) => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const actionCode = compile(`const openSentenceBrowser = ${action}; openSentenceBrowser;`);
const navigationCode = compile(navigationEffect);

function fixture() {
  const frames = new Map(), listeners = new Map();
  let serial = 0, cleanup, dependencies;
  const openingButton = { name: "opening button" };
  const document = { body: { name: "body" }, activeElement: openingButton };
  const list = { scrollTop: 50 };
  const browser = {
    querySelector() { return list; },
    scrollIntoView() { window.scrollY = 500; },
    focus() { document.activeElement = this; },
  };
  const window = {
    scrollY: 100,
    requestAnimationFrame(callback) { frames.set(++serial, callback); return serial; },
    cancelAnimationFrame(id) { frames.delete(id); },
    addEventListener(name, callback) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(callback);
    },
    removeEventListener(name, callback) { listeners.get(name)?.delete(callback); },
  };
  const state = {}, presentation = { current: null };
  const context = vm.createContext({
    document, window, tab: "sentences", sentenceSection: "library", sentenceStage: "setup",
    sentenceBrowserPresentationRef: presentation,
    sentenceBrowserOriginRef: { current: { id: 1 } }, sentenceBrowserRef: { current: browser },
    ...Object.fromEntries(["SentenceBrowserOpen", "SentenceSavedOnly", "SentenceReviewOnly", "SentenceSearch", "SentenceResultLimit"]
      .map((name) => [`set${name}`, (value) => { state[name] = value; }])),
    useEffect(callback, nextDependencies) {
      if (dependencies && nextDependencies.length === dependencies.length
        && nextDependencies.every((value, index) => Object.is(value, dependencies[index]))) return;
      cleanup?.();
      cleanup = callback();
      dependencies = [...nextDependencies];
    },
  });
  const open = vm.runInContext(actionCode, context);
  const render = (next = {}) => { Object.assign(context, next); vm.runInContext(navigationCode, context); };
  const flush = () => {
    for (const [id, callback] of [...frames]) { frames.delete(id); callback(); }
  };
  const emit = (name) => { for (const callback of [...(listeners.get(name) ?? [])]) callback(); };
  const listenerCount = () => [...listeners.values()].reduce((total, set) => total + set.size, 0);
  render();
  return { open, render, flush, emit, listenerCount, frames, state, presentation, document, browser, list, window, unmount: () => cleanup?.() };
}

function assertReleased(app) {
  assert.equal(app.frames.size, 0, "no stale animation frame remains");
  assert.equal(app.listenerCount(), 0, "all temporary interaction observers are removed");
  assert.equal(app.presentation.current, null, "the finished request releases its cancellation reference");
}

test("untouched saved, difficult and search openings still present the browser, including a layout-clamped return", () => {
  for (const [savedOnly, reviewOnly] of [[true, false], [false, true], [false, false]]) {
    const app = fixture();
    app.open(savedOnly, reviewOnly);
    assert.equal(app.frames.size, 1);
    assert.equal(app.listenerCount(), 4);
    // Removing the old search-return button/list can clamp the viewport and
    // leave body focused. Those layout changes are not a new user operation.
    if (!savedOnly && !reviewOnly) { app.window.scrollY = 20; app.document.activeElement = app.document.body; }
    app.flush();
    assert.equal(app.document.activeElement, app.browser);
    assert.equal(app.window.scrollY, 500);
    assert.equal(app.list.scrollTop, 0);
    assert.equal(app.state.SentenceBrowserOpen, true);
    assert.equal(app.state.SentenceSavedOnly, savedOnly);
    assert.equal(app.state.SentenceReviewOnly, reviewOnly);
    assert.equal(app.state.SentenceSearch, "");
    assert.equal(app.state.SentenceResultLimit, 30);
    assertReleased(app);
  }
});

for (const event of ["pointerdown", "keydown", "wheel", "touchmove"]) {
  test(`a later ${event} cancels sentence browser positioning without losing focus or scroll`, () => {
    const app = fixture();
    app.open(true);
    const focus = app.document.activeElement;
    app.window.scrollY = 250;
    app.list.scrollTop = 23;
    app.emit(event);
    assertReleased(app);
    app.flush();
    assert.equal(app.document.activeElement, focus);
    assert.equal(app.window.scrollY, 250);
    assert.equal(app.list.scrollTop, 23);
  });
}

test("a newly focused search keeps its text, viewport and result position", () => {
  const app = fixture(), input = { name: "search", value: "hotel" };
  app.open(false);
  app.document.activeElement = input;
  app.window.scrollY = 250;
  app.list.scrollTop = 23;
  app.flush();
  assert.equal(app.document.activeElement, input);
  assert.equal(input.value, "hotel");
  assert.equal(app.window.scrollY, 250);
  assert.equal(app.list.scrollTop, 23);
  assertReleased(app);
});

test("replacing an opening makes the old callback inert and only presents the newest selection", () => {
  const app = fixture();
  app.open(true);
  const oldCallback = [...app.frames.values()][0];
  app.open(false, true);
  const newestRequest = app.presentation.current;
  assert.equal(app.frames.size, 1);
  assert.equal(app.listenerCount(), 4, "replacement does not leak the previous observers");
  oldCallback();
  assert.equal(app.window.scrollY, 100);
  assert.equal(app.list.scrollTop, 50);
  assert.equal(app.presentation.current, newestRequest, "a stale callback cannot cancel the new request");
  assert.equal(app.frames.size, 1);
  app.flush();
  assert.equal(app.state.SentenceSavedOnly, false);
  assert.equal(app.state.SentenceReviewOnly, true);
  assert.equal(app.document.activeElement, app.browser);
  assert.equal(app.window.scrollY, 500);
  assertReleased(app);
});

test("the actual navigation effect cancels pending openings when leaving the tab, section, stage or component", () => {
  for (const next of [{ tab: "home" }, { sentenceSection: "patterns" }, { sentenceStage: "cards" }, null]) {
    const app = fixture();
    app.open(true);
    const focus = app.document.activeElement;
    if (next) app.render(next); else app.unmount();
    assertReleased(app);
    app.flush();
    assert.equal(app.document.activeElement, focus);
    assert.equal(app.window.scrollY, 100);
    assert.equal(app.list.scrollTop, 50);
  }
});
