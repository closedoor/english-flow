import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let visibility;
let navigation;
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect') {
    const callback = node.arguments[0]?.getText(ast) ?? '';
    if (callback.includes('const keepQuestionVisible')) {
      assert.equal(visibility, undefined, 'One actual quiz visibility effect');
      visibility = { callback, position: node.pos, dependencies: node.arguments[1]?.getText(ast) };
    }
    if (callback.includes('readingPositionReadyRef.current = tab === "read" && Boolean(readingId)')) {
      navigation = { callback, position: node.pos };
    }
  }
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(visibility && navigation, 'Execute the actual quiz visibility and preceding navigation effects');
const compile = (text) => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const copy = (value) => JSON.parse(JSON.stringify(value));

function harness(patch = {}) {
  const state = {
    hydrated: true, hasOpenDialog: false, tab: 'learn', learnStage: 'quiz', quizFeedback: 'wrong',
    feedbackBounds: { top: 580, bottom: 700 }, fieldBounds: { top: 220, bottom: 292 },
    actionsTop: 400, height: 568, toastBounds: null,
    networkOnline: true, offlineCacheWriteError: false, speechNotice: null, statusToastHeight: 0, quizIndex: 0,
    ...patch,
  };
  const calls = [];
  const frames = new Map();
  const listeners = new Map();
  let frameId = 0;
  const focus = (name) => ({ focus(options) { calls.push({ action: 'focus', name, options: copy(options) }); } });
  const target = (name, key) => ({
    getBoundingClientRect: () => ({ ...state[key] }),
    scrollIntoView(options) {
      calls.push({ action: 'scroll', name, options: copy(options) });
      const height = state[key].bottom - state[key].top;
      state[key] = { top: 200, bottom: 200 + height };
    },
  });
  const feedback = target('feedback', 'feedbackBounds');
  const field = target('field', 'fieldBounds');
  const input = { ...focus('input'), parentElement: field };
  const next = focus('next');
  const window = {
    innerHeight: state.height,
    requestAnimationFrame(callback) { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame(id) { frames.delete(id); },
    addEventListener(name, callback) { listeners.set(name, callback); },
    removeEventListener(name, callback) { if (listeners.get(name) === callback) listeners.delete(name); },
    scrollTo(options) { calls.push({ action: 'navigation', options: copy(options) }); },
    scrollBy(options) {
      calls.push({ action: 'adjust', options: copy(options) });
      for (const key of ['feedbackBounds', 'fieldBounds']) {
        state[key] = { top: state[key].top - options.top, bottom: state[key].bottom - options.top };
      }
    },
  };
  const toastRef = {};
  Object.defineProperty(toastRef, 'current', { get() {
    return state.toastBounds ? { getBoundingClientRect: () => ({ ...state.toastBounds }) } : null;
  } });
  const context = vm.createContext({
    ...state, window,
    quizFeedbackRef: { current: feedback }, quizInputRef: { current: input }, quizNextRef: { current: next },
    quizActionsRef: { current: { getBoundingClientRect: () => ({ top: state.actionsTop }) } },
    statusToastRef: toastRef,
    readingPositionReadyRef: { current: false }, readingPositionRef: { current: new Map() }, readingId: null,
    sentenceBrowserOriginRef: { current: null }, wordBrowserReturnRef: { current: false },
    wordBrowserOriginRef: { current: null }, sentenceSection: 'library', sentenceStage: 'setup',
  });
  const execute = (effect) => vm.runInContext(compile(`(${effect.callback})();`), context);
  const flush = () => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback());
  };
  const resize = (patch) => {
    Object.assign(state, patch);
    window.innerHeight = state.height;
    listeners.get('resize')?.();
  };
  return { state, calls, frames, listeners, context, flush, resize, execute };
}

test('wrong quiz feedback scrolls the complete answer above the action and preserves keyboard focus', () => {
  const app = harness();
  app.execute(visibility);
  assert.deepEqual(app.calls, [], 'Visibility waits for the rendered frame');
  app.flush();
  assert.deepEqual(app.calls, [
    { action: 'scroll', name: 'feedback', options: { block: 'center', behavior: 'auto' } },
    { action: 'focus', name: 'next', options: { preventScroll: true } },
  ]);
});

test('restored correct and wrong feedback runs after the actual navigation scroll', () => {
  assert.ok(navigation.position < visibility.position, 'Navigation registers its animation frame first');
  for (const quizFeedback of ['correct', 'wrong']) {
    const app = harness({ quizFeedback });
    app.execute(navigation);
    app.execute(visibility);
    app.flush();
    assert.deepEqual(app.calls.map((call) => [call.action, call.name]), [
      ['navigation', undefined], ['scroll', 'feedback'], ['focus', 'next'],
    ], `${quizFeedback} feedback stays visible after restoring a paused question`);
  }
});

test('already visible feedback and input keep their position without an unnecessary scroll', () => {
  for (const quizFeedback of ['wrong', 'correct', null]) {
    const app = harness({ quizFeedback, feedbackBounds: { top: 180, bottom: 320 } });
    app.execute(visibility);
    app.flush();
    assert.deepEqual(app.calls, [{ action: 'focus', name: quizFeedback ? 'next' : 'input', options: { preventScroll: true } }]);
  }
});

test('an unanswered low question moves its input rather than revealing or focusing feedback', () => {
  const app = harness({ quizFeedback: null, fieldBounds: { top: 480, bottom: 552 } });
  app.execute(visibility);
  app.flush();
  assert.deepEqual(app.calls, [
    { action: 'scroll', name: 'field', options: { block: 'center', behavior: 'auto' } },
    { action: 'focus', name: 'input', options: { preventScroll: true } },
  ]);
});

test('dialogs, other modules and other learning stages leave scrolling and focus alone', () => {
  for (const patch of [{ hasOpenDialog: true }, { tab: 'home' }, { tab: 'review' }, { learnStage: 'cards' }, { learnStage: 'result' }]) {
    const app = harness(patch);
    assert.equal(app.execute(visibility), undefined);
    app.flush();
    assert.deepEqual(app.calls, []);
    assert.equal(app.listeners.size, 0);
  }
});

test('resizing remeasures the available area and only scrolls when feedback is obscured', () => {
  const app = harness({ feedbackBounds: { top: 180, bottom: 320 }, actionsTop: 600, height: 844 });
  app.execute(visibility);
  app.flush();
  app.calls.length = 0;
  app.resize({ height: 568, actionsTop: 300 });
  assert.equal(app.calls[0].action, 'scroll');
  assert.equal(app.calls[0].name, 'feedback');
  app.calls.length = 0;
  app.resize({ height: 844, actionsTop: 600 });
  assert.deepEqual(app.calls, [{ action: 'focus', name: 'next', options: { preventScroll: true } }]);
});

test('stacked notices cannot cover an otherwise viewport-visible answer', () => {
  const app = harness({ feedbackBounds: { top: 333, bottom: 453 }, actionsTop: 483,
    toastBounds: { top: 303, bottom: 474 }, statusToastHeight: 171, networkOnline: false,
    offlineCacheWriteError: true, speechNotice: 'System speech failed' });
  app.execute(visibility);
  app.flush();
  assert.deepEqual(app.calls, [
    { action: 'scroll', name: 'feedback', options: { block: 'center', behavior: 'auto' } },
    { action: 'adjust', options: { top: 29, left: 0, behavior: 'auto' } },
    { action: 'focus', name: 'next', options: { preventScroll: true } },
  ]);
  assert.ok(app.state.feedbackBounds.bottom <= app.state.toastBounds.top - 12);
  app.calls.length = 0;
  app.resize({ toastBounds: null, height: 844, actionsTop: 720 });
  assert.deepEqual(app.calls, [{ action: 'focus', name: 'next', options: { preventScroll: true } }], 'Removing notices and enlarging the viewport must not move readable feedback');
});

test('offscreen notices do not reduce the usable answer area', () => {
  for (const toastBounds of [{ top: -200, bottom: -20 }, { top: 700, bottom: 850 }]) {
    const app = harness({ feedbackBounds: { top: 180, bottom: 320 }, toastBounds });
    app.execute(visibility);
    app.flush();
    assert.deepEqual(app.calls, [{ action: 'focus', name: 'next', options: { preventScroll: true } }]);
  }
});

test('notice changes and measured stack height are actual visibility-effect dependencies', () => {
  const app = harness();
  const initial = [...vm.runInContext(compile(visibility.dependencies), app.context)];
  for (const [key, value] of [['networkOnline', false], ['offlineCacheWriteError', true], ['speechNotice', 'Failed'], ['statusToastHeight', 171]]) {
    app.context[key] = value;
    const updated = [...vm.runInContext(compile(visibility.dependencies), app.context)];
    assert.ok(updated.some((dependency, index) => !Object.is(dependency, initial[index])), `${key} must rerun visibility after notices change`);
    app.context[key] = app.state[key];
  }
});

test('leaving the quiz cancels the pending frame and removes its resize callback', () => {
  const app = harness();
  const cleanup = app.execute(visibility);
  assert.equal(app.frames.size, 1);
  assert.equal(app.listeners.has('resize'), true);
  cleanup();
  app.flush();
  app.resize({ height: 350 });
  assert.deepEqual(app.calls, []);
  assert.equal(app.frames.size, 0);
  assert.equal(app.listeners.size, 0);
});
