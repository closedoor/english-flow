import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

import ts from "typescript";

const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("page.tsx", page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = new Map();
const effects = [];
const restoreDisabledExpressions = new Map();

function visit(node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
    declarations.set(node.name.text, node.initializer.getText(ast));
  }
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect") {
    const [callback, dependencies] = node.arguments;
    if (dependencies && ts.isArrayLiteralExpression(dependencies)) {
      const names = dependencies.elements.map((item) => item.getText(ast));
      if (names.length === 1 && ["hasOpenDialog", "activeDialog"].includes(names[0])) {
        effects.push({ dependency: names[0], callback: callback.getText(ast) });
      }
    }
  }
  if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
    if (node.tagName.getText(ast) === "button") {
      const attributes = new Map(node.attributes.properties
        .filter(ts.isJsxAttribute).map((item) => [item.name.getText(ast), item.initializer]));
      const className = attributes.get("className");
      const ref = attributes.get("ref");
      const name = ref?.getText(ast) === "{restoreCancelRef}" ? "cancel"
        : className && ts.isStringLiteral(className) && className.text === "restore-confirm" ? "confirm" : null;
      const disabled = attributes.get("disabled");
      if (name && disabled && ts.isJsxExpression(disabled) && disabled.expression) {
        restoreDisabledExpressions.set(name, disabled.expression.getText(ast));
      }
    }
  }
  ts.forEachChild(node, visit);
}
visit(ast);
assert.equal(effects.length, 2, "the real page must expose one shared lock and one active-dialog effect");
assert.equal(restoreDisabledExpressions.size, 2, "both real restore buttons need disabled expressions");

function javascript(source) {
  return ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
}

function createDialogHarness() {
  const state = {
    externalUpdateDetected: false, pendingBackup: null, resetProgressOpen: false,
    discardRequest: null, installOpen: false, backupBusy: null,
  };
  const listeners = new Map();
  const calls = [];
  const dispatch = (type, event) => {
    for (const listener of [...(listeners.get(type) ?? [])]) listener(event);
  };
  class FakeNode {}
  class FakeElement extends FakeNode {
    constructor(name, children = []) {
      super();
      this.name = name;
      this.children = children;
      this.isConnected = true;
      this.disabled = false;
    }
    contains(element) {
      return this === element || this.children.some((child) => child.contains(element));
    }
    querySelectorAll() { return this.children.filter((child) => !child.disabled); }
    focus() {
      if (!this.isConnected || this.disabled) return;
      document.activeElement = this;
      dispatch("focusin", { target: this });
    }
  }
  const trigger = new FakeElement("original reset trigger");
  const background = new FakeElement("background quiz input");
  const document = {
    activeElement: trigger,
    body: { style: { overflow: "auto" } },
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
  };
  const dialogs = Object.fromEntries(["sync", "restore", "reset", "discard", "install"].map((name) => {
    const buttons = [new FakeElement(`${name} initial`)];
    if (name !== "sync") buttons.push(new FakeElement(`${name} confirm`));
    return [name, new FakeElement(`${name} dialog`, buttons)];
  }));
  const ref = (value) => ({ current: value });
  const refs = {
    syncDialogRef: ref(dialogs.sync), syncReloadRef: ref(dialogs.sync.children[0]),
    restoreDialogRef: ref(dialogs.restore), restoreCancelRef: ref(dialogs.restore.children[0]),
    resetDialogRef: ref(dialogs.reset), resetCancelRef: ref(dialogs.reset.children[0]),
    discardDialogRef: ref(dialogs.discard), discardCancelRef: ref(dialogs.discard.children[0]),
    installSheetRef: ref(dialogs.install), installCloseRef: ref(dialogs.install.children[0]),
  };
  const backupActionLock = { current: false };
  const setter = (key) => (value) => { calls.push([key, value]); state[key] = value; };
  const context = vm.createContext({
    document, Node: FakeNode, HTMLElement: FakeElement, ...refs, backupActionLock,
    setPendingBackup: setter("pendingBackup"), setResetProgressOpen: setter("resetProgressOpen"),
    setDiscardRequest: setter("discardRequest"), setInstallOpen: setter("installOpen"),
  });
  const mountedEffects = effects.map((effect) => ({ ...effect, previous: Symbol("initial"), cleanup: null }));
  let activeDialog = null;

  function render(patch = {}) {
    Object.assign(state, patch);
    Object.assign(context, state);
    context.activeDialog = vm.runInContext(javascript(`(${declarations.get("activeDialog")})`), context);
    context.hasOpenDialog = vm.runInContext(javascript(`(${declarations.get("hasOpenDialog")})`), context);
    activeDialog = context.activeDialog;
    // React commits the new DOM before passive effect cleanups and setups.
    for (const [name, dialog] of Object.entries(dialogs)) {
      dialog.isConnected = name === activeDialog;
      for (const button of dialog.children) button.isConnected = dialog.isConnected;
    }
    for (const [index, key] of ["cancel", "confirm"].entries()) {
      dialogs.restore.children[index].disabled = vm.runInContext(
        javascript(`(${restoreDisabledExpressions.get(key)})`), context,
      );
    }
    const changed = mountedEffects.filter((effect) => effect.previous !== context[effect.dependency]);
    for (const effect of changed) effect.cleanup?.();
    for (const effect of changed) {
      effect.previous = context[effect.dependency];
      // Capture render values exactly as a React callback closure does.
      const callback = vm.runInContext(javascript(
        `(function(activeDialog, hasOpenDialog) { return (${effect.callback}); })(activeDialog, hasOpenDialog)`,
      ), context);
      effect.cleanup = callback();
    }
  }

  function key(key, shiftKey = false) {
    const event = {
      key, shiftKey, defaultPrevented: false, propagationStopped: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.propagationStopped = true; },
    };
    dispatch("keydown", event);
    render();
    return event;
  }
  render();
  return {
    state, document, trigger, background, dialogs, backupActionLock, calls, render, key,
    get activeDialog() { return activeDialog; },
    listenerCount(type) { return listeners.get(type)?.size ?? 0; },
  };
}

test("stacked reset and restore dialogs release the original scroll lock only after both close", () => {
  const app = createDialogHarness();
  app.render({ resetProgressOpen: true });
  assert.equal(app.document.activeElement, app.dialogs.reset.children[0]);
  app.render({ pendingBackup: { exportedAt: "2026-09-05T00:00:00.000Z" } });
  assert.equal(app.activeDialog, "restore");
  assert.equal(app.listenerCount("keydown"), 1);
  assert.equal(app.listenerCount("focusin"), 1);
  assert.equal(app.document.body.style.overflow, "hidden");
  app.key("Escape");
  assert.equal(app.state.pendingBackup, null);
  assert.equal(app.state.resetProgressOpen, true, "only the top dialog handles Escape");
  assert.equal(app.activeDialog, "reset");
  assert.equal(app.document.activeElement, app.dialogs.reset.children[0]);
  assert.equal(app.document.body.style.overflow, "hidden");
  app.key("Escape");
  assert.equal(app.activeDialog, null);
  assert.equal(app.document.body.style.overflow, "auto");
  assert.equal(app.document.activeElement, app.trigger);
  assert.equal(app.listenerCount("keydown"), 0);
  assert.equal(app.listenerCount("focusin"), 0);
});

test("a synchronization alert supersedes reset and keeps Escape and Tab inside the alert", () => {
  const app = createDialogHarness();
  app.render({ resetProgressOpen: true });
  app.render({ externalUpdateDetected: true });
  assert.equal(app.activeDialog, "sync");
  assert.equal(app.listenerCount("keydown"), 1);
  const escape = app.key("Escape");
  assert.equal(escape.defaultPrevented, true);
  assert.equal(app.state.resetProgressOpen, true, "the lower reset handler has been removed");
  assert.deepEqual(app.calls, []);
  for (const shiftKey of [false, true]) {
    const event = app.key("Tab", shiftKey);
    assert.equal(event.defaultPrevented, true);
    assert.equal(app.document.activeElement, app.dialogs.sync.children[0]);
    assert.equal(app.document.body.style.overflow, "hidden");
  }
});

test("restoring blocks Escape and retains focus when both restore buttons are disabled", () => {
  const app = createDialogHarness();
  app.backupActionLock.current = true;
  app.render({ pendingBackup: { exportedAt: "2026-09-05T00:00:00.000Z" }, backupBusy: "restore" });
  assert.ok(app.dialogs.restore.children.every((button) => button.disabled));
  assert.equal(app.document.activeElement, app.dialogs.restore, "disabled initial button falls back to the dialog");
  app.key("Escape");
  assert.notEqual(app.state.pendingBackup, null);
  assert.deepEqual(app.calls, []);
  for (const shiftKey of [false, true]) {
    assert.equal(app.key("Tab", shiftKey).defaultPrevented, true);
    assert.equal(app.document.activeElement, app.dialogs.restore);
  }
  app.backupActionLock.current = false;
  app.render({ backupBusy: null });
  app.key("Escape");
  assert.equal(app.activeDialog, null);
  assert.equal(app.document.body.style.overflow, "auto");
});

test("late background focus cannot escape the active dialog, including a locked restore", () => {
  const app = createDialogHarness();
  app.render({ resetProgressOpen: true });
  app.background.focus();
  assert.equal(app.document.activeElement, app.dialogs.reset.children[0]);
  app.render({ externalUpdateDetected: true });
  app.background.focus();
  assert.equal(app.document.activeElement, app.dialogs.sync.children[0]);
  app.render({ externalUpdateDetected: false, pendingBackup: {}, backupBusy: "restore" });
  app.background.focus();
  assert.equal(app.document.activeElement, app.dialogs.restore);
  // Recover even if an unusual browser focus change omitted focusin.
  app.document.activeElement = app.background;
  assert.equal(app.key("Tab").defaultPrevented, true);
  assert.equal(app.document.activeElement, app.dialogs.restore);
});
