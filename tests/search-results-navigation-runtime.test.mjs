import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = new Map();
const effects = new Map();
let normalizeSource;
function visit(node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) declarations.set(node.name.text, node.initializer.getText(ast));
  if (ts.isFunctionDeclaration(node) && node.name?.text === "normalized") normalizeSource = node.getText(ast);
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect") {
    const callback = node.arguments[0].getText(ast);
    for (const kind of ["word", "sentence"]) {
      if (callback.includes(`${kind}BrowserQueryRef.current`)) {
        assert.equal(effects.has(kind), false, `One actual ${kind} query effect`);
        effects.set(kind, { callback, dependencies: node.arguments[1].getText(ast) });
      }
    }
  }
  ts.forEachChild(node, visit);
}
visit(ast);
const javascript = text => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;

function harness(patch = {}) {
  const state = {
    hydrated: true, tab: "learn", learnStage: "setup", libraryBand: 1, librarySearch: "", libraryLimit: 24,
    sentenceSection: "library", sentenceStage: "setup", sentenceSearch: "I", sentenceBand: "short", sentenceCategory: "food",
    sentenceSavedOnly: false, sentenceReviewOnly: false, sentenceResultLimit: 30, sentencePacks: {},
    ...patch,
  };
  const lists = { word: { scrollTop: 0 }, sentence: { scrollTop: 0 } };
  const refs = { word: { current: null }, sentence: { current: null } };
  const context = vm.createContext({
    wordBrowserQueryRef: refs.word, sentenceBrowserQueryRef: refs.sentence,
    wordBrowserRef: { current: null }, sentenceBrowserRef: { current: null },
  });
  vm.runInContext(javascript(normalizeSource), context);
  const previousDependencies = new Map();
  function render(next = {}) {
    Object.assign(state, next);
    Object.assign(context, state);
    context.wordBrowserRef.current = state.tab === "learn" && state.learnStage === "setup" ? { querySelector: () => lists.word } : null;
    context.sentenceBrowserRef.current = state.tab === "sentences" && state.sentenceSection === "library" && state.sentenceStage === "setup" ? { querySelector: () => lists.sentence } : null;
    for (const kind of ["word", "sentence"]) {
      const key = `${kind}BrowserQuery`;
      context[key] = vm.runInContext(javascript(declarations.get(key)), context);
      const effect = effects.get(kind);
      assert.ok(effect, `${kind} result-navigation effect exists`);
      const dependencies = vm.runInContext(javascript(effect.dependencies), context);
      const previous = previousDependencies.get(kind);
      if (!previous || dependencies.some((value, index) => !Object.is(value, previous[index]))) {
        previousDependencies.set(kind, [...dependencies]);
        vm.runInContext(javascript(`(${effect.callback})();`), context);
      }
    }
    return state;
  }
  render();
  return { state, lists, refs, render };
}

test("a new word band or search starts at the first result", () => {
  const app = harness();
  app.lists.word.scrollTop = 1000;
  app.render({ libraryBand: 2 });
  assert.equal(app.lists.word.scrollTop, 0);
  app.lists.word.scrollTop = 900;
  app.render({ librarySearch: "e" });
  assert.equal(app.lists.word.scrollTop, 0);
  app.lists.word.scrollTop = 500;
  app.render({ librarySearch: "water" });
  assert.equal(app.lists.word.scrollTop, 0);
});

test("only a changed effective word query resets an existing result position", () => {
  const app = harness({ librarySearch: "water" });
  app.lists.word.scrollTop = 600;
  app.render({ libraryLimit: 48 });
  assert.equal(app.lists.word.scrollTop, 600, "showing more is the same search");
  app.render({ librarySearch: " WATER " });
  assert.equal(app.lists.word.scrollTop, 600, "case and surrounding spaces do not change the search");
  app.render({ libraryBand: 3 });
  assert.equal(app.lists.word.scrollTop, 600, "a full-library query does not depend on the stored band");
  app.render({ librarySearch: "  " });
  assert.equal(app.lists.word.scrollTop, 0, "clearing a query returns to its selected word band");
});

test("a new sentence query resets scroll, while late packs and more results retain it", () => {
  const app = harness({ tab: "sentences" });
  app.lists.sentence.scrollTop = 1200;
  app.render({ sentenceSearch: "you" });
  assert.equal(app.lists.sentence.scrollTop, 0);
  app.lists.sentence.scrollTop = 600;
  app.render({ sentencePacks: { 1: [], 2: [] }, sentenceResultLimit: 60 });
  assert.equal(app.lists.sentence.scrollTop, 600);
  app.render({ sentenceBand: "long", sentenceCategory: "travel" });
  assert.equal(app.lists.sentence.scrollTop, 600, "practice choices do not change a full-library search");
  app.render({ sentenceSearch: " YOU! " });
  assert.equal(app.lists.sentence.scrollTop, 600, "equivalent normalized queries keep their position");
});

test("switching saved, reinforcement and search results starts each new view at the top", () => {
  const app = harness({ tab: "sentences", sentenceSearch: "", sentenceSavedOnly: true });
  app.lists.sentence.scrollTop = 600;
  app.render({ sentenceSavedOnly: false, sentenceReviewOnly: true });
  assert.equal(app.lists.sentence.scrollTop, 0);
  app.lists.sentence.scrollTop = 400;
  app.render({ sentenceBand: "long", sentenceCategory: "travel" });
  assert.equal(app.lists.sentence.scrollTop, 400, "saved/reinforcement contents span practice choices");
  app.render({ sentenceReviewOnly: false, sentenceSearch: "airport" });
  assert.equal(app.lists.sentence.scrollTop, 0);
});

test("returning from a single card does not erase its restored result scroll", () => {
  for (const kind of ["word", "sentence"]) {
    const app = harness({ tab: kind === "word" ? "learn" : "sentences" });
    const stage = kind === "word" ? "learnStage" : "sentenceStage";
    const list = app.lists[kind];
    list.scrollTop = 900;
    app.render({ [stage]: "cards" });
    app.render({ [stage]: "setup" });
    assert.equal(list.scrollTop, 900, `${kind} lookup return is still the same query`);
    app.render({ tab: "home" });
    app.render({ tab: kind === "word" ? "learn" : "sentences" });
    assert.equal(list.scrollTop, 900, `${kind} remount cannot overwrite restored results`);
  }
});

test("a new query selected while its list is unmounted resets when results become visible", () => {
  const app = harness({ tab: "sentences" });
  app.lists.sentence.scrollTop = 700;
  app.render({ sentenceSection: "patterns", sentenceSearch: "train" });
  assert.equal(app.lists.sentence.scrollTop, 700, "an absent list is untouched");
  app.render({ sentenceSection: "library" });
  assert.equal(app.lists.sentence.scrollTop, 0);
});
