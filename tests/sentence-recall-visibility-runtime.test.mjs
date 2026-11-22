import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const file = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("page.tsx", file, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback;
function visit(node) {
  if (ts.isCallExpression(node) && ["useEffect", "useLayoutEffect"].includes(node.expression.getText(ast))
      && node.arguments[0].getText(ast).includes("sentenceAnswerRef.current")) callback = node.arguments[0].getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(callback);
const js = ts.transpileModule(`(${callback})();`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function scenario({ top = 500, bottom = 1200, cardTop = 90, cardBottom = 410, ...patch } = {}) {
  const calls = [];
  const answer = {
    getBoundingClientRect: () => ({ top, bottom }),
    closest: () => ({ getBoundingClientRect: () => ({ top: cardTop, bottom: cardBottom }) }),
    focus: () => calls.push("focus"),
    scrollIntoView: ({ block }) => calls.push("scroll:" + block),
  };
  const env = vm.createContext({
    tab: "sentences", sentenceSection: "library", sentenceStage: "cards", sentenceMode: "speak",
    hasOpenDialog: false, sentenceTranslationOpen: true, presentedSentenceAnswerRef: { current: null },
    sentenceAnswerRef: { current: answer }, wordActionsRef: { current: { getBoundingClientRect: () => ({ top: 425 }) } },
    window: { innerHeight: 568 }, ...patch,
  });
  return { env, calls, run: () => vm.runInContext(js, env) };
}

test("revealing offscreen English shows the beginning even if the full answer is taller than the nested card", () => {
  const app = scenario();
  app.run();
  assert.deepEqual(app.calls, ["focus", "scroll:start"]);
  app.env.hasOpenDialog = true;
  app.run();
  app.env.hasOpenDialog = false;
  app.run();
  assert.deepEqual(app.calls, ["focus", "scroll:start"], "Closing a dialog must not jump back after manual reading");
  const offscreenCard = scenario({ top: -330, bottom: -120, cardTop: -420, cardBottom: -80 });
  offscreenCard.run();
  assert.deepEqual(offscreenCard.calls, ["focus", "scroll:start"], "In a document-scrolling layout the whole card can be above the tapped toolbar");
});

test("visible answers keep position and no pending frame interferes with later navigation", () => {
  const app = scenario({ top: 103, bottom: 399 });
  app.run();
  assert.deepEqual(app.calls, ["focus"]);
  for (const patch of [{ tab: "home" }, { sentenceSection: "patterns" }, { sentenceStage: "setup" }, { hasOpenDialog: true }, { sentenceTranslationOpen: false }]) {
    const inactive = scenario(patch);
    inactive.run();
    assert.deepEqual(inactive.calls, []);
  }
});
