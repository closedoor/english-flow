import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("page.tsx", page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let reviewEffect;
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect") {
    const [callback, dependencies] = node.arguments;
    if (dependencies && ts.isArrayLiteralExpression(dependencies) && callback.getText(ast).includes("reviewHeadingRef")) {
      reviewEffect = { callback: callback.getText(ast), dependencies: dependencies.elements.map((item) => item.getText(ast)) };
    }
  }
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(reviewEffect, "the actual review transition effect must exist");
const effectCode = ts.transpileModule(`(${reviewEffect.callback})`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

function harness() {
  const state = { currentReviewWordId: 1, hasOpenDialog: false, hydrated: true, tab: "review" };
  const frames = new Map();
  let frameId = 0, cleanup, dependencies = [];
  const visible = { scrollY: 124, focus: "old rating button" };
  const render = (patch = {}) => {
    Object.assign(state, patch);
    const next = reviewEffect.dependencies.map((key) => state[key]);
    if (dependencies.length && next.every((value, index) => value === dependencies[index])) return;
    cleanup?.();
    dependencies = next;
    const heading = state.currentReviewWordId === null ? "review completed" : `word ${state.currentReviewWordId}`;
    cleanup = vm.runInNewContext(effectCode, {
      ...state,
      window: {
        requestAnimationFrame(callback) { frames.set(++frameId, callback); return frameId; },
        cancelAnimationFrame(id) { frames.delete(id); },
        scrollTo({ top }) { visible.scrollY = top; },
      },
      reviewHeadingRef: { current: { focus() { visible.focus = heading; } } },
    })();
  };
  return { visible, render, flush() { for (const callback of frames.values()) callback(); frames.clear(); } };
}

test("rating the first review word moves to the next heading even when the index stays zero", () => {
  const app = harness();
  app.render(); app.flush();
  app.visible.scrollY = 124;
  app.visible.focus = "old rating button";
  app.render({ currentReviewWordId: 2 }); app.flush();
  assert.deepEqual(app.visible, { scrollY: 0, focus: "word 2" });
  app.render({ currentReviewWordId: null }); app.flush();
  assert.equal(app.visible.focus, "review completed");
});

test("leaving review or opening a dialog cancels pending review focus", () => {
  for (const patch of [{ tab: "home" }, { hasOpenDialog: true }]) {
    const app = harness();
    app.render();
    app.render(patch);
    app.flush();
    assert.deepEqual(app.visible, { scrollY: 124, focus: "old rating button" });
  }
});
