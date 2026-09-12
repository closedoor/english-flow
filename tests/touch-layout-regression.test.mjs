import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
const styles = await readFile(new URL('../app/globals.css', import.meta.url), 'utf8');
const ast = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function arrow(name) {
  let result;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) result = node.initializer.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(result, `Missing actual production handler ${name}`);
  return result;
}
function fixture() {
  class Element { constructor(interactive = false) { this.interactive = interactive; } closest() { return this.interactive; } }
  const touchStart = { current: null };
  const code = ts.transpileModule(`const beginCardSwipe=${arrow('beginCardSwipe')}; const endCardSwipe=${arrow('endCardSwipe')};`, {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  const { beginCardSwipe, endCardSwipe } = new Function('touchStart', 'Element', `${code};return {beginCardSwipe,endCardSwipe};`)(touchStart, Element);
  const moved=[];
  return { touchStart, begin:beginCardSwipe, end:event=>endCardSwipe(event,direction=>moved.push(direction)), moved, Element };
}
const finger=(x,y=100,identifier=1)=>({clientX:x,clientY:y,identifier});
const event=(touches,changedTouches=[],target={})=>({touches,changedTouches,target});

test('single-finger horizontal swipes retain forward and backward navigation',()=>{
  const f=fixture();
  f.begin(event([finger(200)])); f.end(event([], [finger(80)]));
  f.begin(event([finger(80)])); f.end(event([], [finger(200)]));
  assert.deepEqual(f.moved,[1,-1]); assert.equal(f.touchStart.current,null);
});
test('pinching with two fingers cancels a swipe without navigating',()=>{
  const f=fixture();
  f.begin(event([finger(220)])); f.begin(event([finger(220),finger(50,100,2)]));
  f.end(event([finger(50,100,2)], [finger(80)])); f.end(event([], [finger(50,100,2)]));
  assert.deepEqual(f.moved,[]);
});
test('gestures starting with two fingers never become card navigation',()=>{
  const f=fixture();
  f.begin(event([finger(200),finger(10,100,2)])); f.end(event([], [finger(80)]));
  assert.deepEqual(f.moved,[]);
});
test('remaining fingers, empty touch lists and a different finger are ignored safely',()=>{
  const f=fixture();
  for (const end of [event([],[]),event([finger(50,100,2)],[finger(80)]),event([],[finger(80,100,2)]),event([],[finger(80),finger(10,100,2)])]) {
    f.begin(event([finger(200)])); assert.doesNotThrow(()=>f.end(end)); assert.equal(f.touchStart.current,null);
  }
  assert.deepEqual(f.moved,[]);
});
test('vertical scrolling and short movements cannot navigate or reuse stale gestures',()=>{
  const f=fixture();
  for (const end of [finger(100,260),finger(160),finger(130,170)]) {
    f.begin(event([finger(200)])); f.end(event([],[end]));
  }
  f.end(event([],[finger(10)])); assert.deepEqual(f.moved,[]);
});
test('touches beginning on interactive controls are not card swipes',()=>{
  const f=fixture(); f.begin(event([finger(200)],[],new f.Element(true))); f.end(event([],[finger(10)]));
  assert.deepEqual(f.moved,[]);
});
test('word and sentence cards share the guarded touch-ending handler',()=>{
  for (const move of ['moveCard','moveSentence']) assert.ok(source.includes(`onTouchEnd={(event) => endCardSwipe(event, ${move})}`));
  assert.equal((source.match(/onTouchCancel=\{\(\) => \{ touchStart.current = null; \}\}/g)||[]).length,2);
});
test('reading detail retains the device safe area instead of overriding it',()=>{
  assert.match(styles,/\.reading-detail-page\{padding-top:calc\(16px \+ env\(safe-area-inset-top\)\)\}/);
});
test('quiz pause text has a content-width column and cannot wrap into an icon slot',()=>{
  assert.match(styles,/\.quiz-page \.compact-header\{grid-template-columns:max-content minmax\(0,1fr\) 44px/);
  assert.match(styles,/\.quiz-page \.pause-quiz\{white-space:nowrap\}/);
});
