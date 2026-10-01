import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const backupSource = await readFile(new URL("../app/backup-data.ts", import.meta.url), "utf8");
const compile = (source) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
}).outputText;
const backup = await import(`data:text/javascript;base64,${Buffer.from(compile(backupSource)).toString("base64")}`);
const extract = (start, end) => {
  const from = page.indexOf(start);
  const to = page.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `actual source exists: ${start}`);
  return page.slice(from, to);
};
const constants = extract("const STORAGE =", "const tabItems:");
const STORAGE = vm.runInNewContext(compile(`${constants}\nSTORAGE;`));
const keys = Object.values(STORAGE);
const ast = ts.createSourceFile("page.tsx", page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let syncElement;
function findSync(node) {
  if (ts.isJsxElement(node) && node.openingElement.attributes.properties.some(attribute =>
    ts.isJsxAttribute(attribute) && attribute.name.getText(ast) === "className"
      && ts.isStringLiteral(attribute.initializer) && attribute.initializer.text.includes("sync-backdrop"))) syncElement = node;
  ts.forEachChild(node, findSync);
}
findSync(ast);
assert.ok(syncElement, "render the actual stale-window dialog JSX");
const code = compile(`${constants}\n${extract("const exportLearningBackup =", "const chooseBackupFile =")}\nglobalThis.renderSync = () => (${syncElement.getText(ast)});`);
const nodes = tree => tree && typeof tree === "object"
  ? [tree, ...(tree.children ?? []).flatMap(nodes)] : [];
const text = tree => tree == null || typeof tree === "boolean" ? ""
  : typeof tree === "object" ? (tree.children ?? []).map(text).join("") : String(tree);
const button = (tree, label) => nodes(tree).find(node => node.type === "button" && text(node) === label);

function memory() {
  return {
    mastered: [1, 2], difficult: [4], schedule: { 4: { due: 1234, stage: 0 } },
    studyDays: ["2026-09-30"], preferences: { mode: "free", count: 10, path: "frequency" },
    readingCompleted: ["r1"], readingLast: { id: "r2", updatedAt: 2000 }, readingAnswers: { r1: 0 },
    sentenceSaved: [1], sentenceSeen: [1, 2], sentenceMastered: [1], sentenceDifficult: [2],
    patternMastered: ["p01"], patternDifficult: ["p02"],
    activeSessionResumeSnapshotRef: { current: { version: 1, kind: "group", path: "frequency", mode: "free", stage: "cards", wordIds: [1,2,3], index: 2, ratings: { 2: "known" }, updatedAt: 2001 } },
    sentenceSetupPreferencesRef: { current: { band: "short", category: "all", count: 10, mode: "bilingual" } },
    sentenceResumeSnapshotRef: { current: { version: 1, band: "short", category: "all", count: 10, mode: "bilingual", sentenceIds: [1, 2], index: 1, ratings: { 1: "known" }, updatedAt: 2002 } },
    patternResumeSnapshotRef: { current: { version: 1, category: "all", patternIds: ["p01", "p02"], index: 1, drillIndex: 2, ratings: { p01: "known" }, updatedAt: 2003 } },
    practiceRotationRef: { current: { word: 2, sentence: 3, pattern: 4 } },
  };
}

function app(mode = "success") {
  const current = memory();
  const state = { file: null, mode, shares: 0, reloads: 0, storageAccess: 0, notices: [] };
  const persistent = new Map([[STORAGE.mastered, "[1,3]"]]);
  const original = new Map(persistent);
  let finish;
  const pendingShare = new Promise(resolve => { finish = resolve; });
  const context = vm.createContext({
    ...current, ...backup, File, DOMException,
    React: { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }) },
    backupActionLock: { current: false }, backupBusy: null,
    backupNotice: { kind: "success", message: "old completed export" },
    externalUpdateDetected: true, syncDialogRef: { current: null }, syncReloadRef: { current: null },
    setBackupBusy(value) { context.backupBusy = value; },
    setBackupNotice(value) { context.backupNotice = value; state.notices.push(value); },
    navigator: {
      canShare: () => true,
      async share(payload) {
        state.shares += 1;
        state.file = payload.files[0];
        if (state.mode === "cancel") throw new DOMException("Simulated share cancellation", "AbortError");
        if (state.mode === "fail") throw new DOMException("Simulated share failure", "NotAllowedError");
        if (state.mode === "hold") await pendingShare;
      },
    },
    URL: { createObjectURL() { throw new Error("Simulated download fallback failure"); } },
    document: { createElement() { throw new Error("Unexpected fallback"); } },
    window: { location: { reload() { state.reloads += 1; } } },
  });
  Object.defineProperty(context.window, "localStorage", { get() {
    state.storageAccess += 1;
    return {
      getItem: key => persistent.get(key) ?? null,
      setItem: (key, value) => persistent.set(key, value),
      removeItem: key => persistent.delete(key),
    };
  } });
  vm.runInContext(code, context);
  const render = () => context.renderSync();
  const exportPage = () => {
    const action = button(render(), "导出本页备份");
    assert.ok(action, "the actual dialog exposes the rescue action");
    assert.equal(Boolean(action.props.disabled), false);
    return action.props.onClick();
  };
  const untouched = () => {
    assert.deepEqual(persistent, original, "do not replace the newer window's records");
    assert.equal(state.storageAccess, 0, "export must use the paused page's in-memory snapshot");
    assert.equal(state.reloads, 0, "an export never reloads the stale page");
    assert.equal(context.externalUpdateDetected, true, "the page remains paused");
  };
  return { context, state, render, exportPage, untouched, finish };
}

test("the stale-window rescue controls are outside the inert previous page", () => {
  for (let node = syncElement.parent; node; node = node.parent) {
    if (ts.isJsxElement(node)) assert.equal(node.openingElement.attributes.properties.some(attribute =>
      ts.isJsxAttribute(attribute) && attribute.name.getText(ast) === "inert"), false);
  }
  const a = app();
  const dialog = nodes(a.render()).find(node => node.props.role === "alertdialog");
  assert.ok(dialog);
  assert.ok(button(dialog, "导出本页备份"));
  assert.ok(button(dialog, "载入最新记录"));
});

test("the real sync export rescues all 19 memory records without touching another window's storage", async () => {
  const a = app();
  await a.exportPage();
  const exported = JSON.parse(await a.state.file.text());
  assert.equal(backup.isLearningBackup(exported, keys), true);
  assert.equal(Object.keys(exported.data).length, 19);
  assert.deepEqual(exported.data[STORAGE.mastered], [1, 2]);
  assert.equal(exported.data[STORAGE.activeSession].index, 2);
  assert.equal(exported.data[STORAGE.sentenceActiveSession].index, 1);
  assert.equal(exported.data[STORAGE.patternActiveSession].drillIndex, 2);
  assert.equal(a.context.backupActionLock.current, false);
  assert.equal(a.context.backupBusy, null);
  const notice = nodes(a.render()).find(node => node.props.className?.includes("backup-notice success"));
  assert.ok(notice, "export success is visible inside the actual alert dialog");
  assert.equal(notice.props.role, "status");
  a.untouched();
});

test("canceling another export clears the previous success and retains a usable paused dialog", async () => {
  const a = app("cancel");
  await a.exportPage();
  assert.equal(nodes(a.render()).some(node => node.props.className?.includes("backup-notice success")), false);
  assert.equal(Boolean(button(a.render(), "导出本页备份").props.disabled), false);
  assert.equal(Boolean(button(a.render(), "载入最新记录").props.disabled), false);
  assert.equal(a.context.backupActionLock.current, false);
  a.untouched();
});

test("share and fallback failure are reported inside the paused dialog and a new export can succeed", async () => {
  const a = app("fail");
  await a.exportPage();
  const error = nodes(a.render()).find(node => node.props.className?.includes("backup-notice error"));
  assert.ok(error);
  assert.equal(error.props.role, "alert");
  assert.equal(Boolean(button(a.render(), "导出本页备份").props.disabled), false);
  a.untouched();
  a.state.mode = "success";
  await a.exportPage();
  assert.equal(nodes(a.render()).some(node => node.props.className?.includes("backup-notice error")), false);
  assert.equal(nodes(a.render()).some(node => node.props.className?.includes("backup-notice success")), true);
  assert.equal(a.state.shares, 2);
  a.untouched();
});

test("a pending export disables the real dialog controls and duplicate export never starts a second share", async () => {
  const a = app("hold");
  const initial = a.render();
  const pending = button(initial, "导出本页备份").props.onClick();
  const busy = a.render();
  const dialog = nodes(busy).find(node => node.props.role === "alertdialog");
  assert.equal(dialog.props["aria-busy"], true);
  assert.equal(button(busy, "正在导出…").props.disabled, true);
  assert.equal(button(busy, "载入最新记录").props.disabled, true);
  await button(initial, "导出本页备份").props.onClick();
  assert.equal(a.state.shares, 1, "the shared real export lock rejects a stale duplicate callback");
  a.untouched();
  a.finish();
  await pending;
  assert.equal(Boolean(button(a.render(), "导出本页备份").props.disabled), false);
  assert.equal(Boolean(button(a.render(), "载入最新记录").props.disabled), false);
  a.untouched();
});
