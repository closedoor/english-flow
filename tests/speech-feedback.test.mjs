import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../app/speech-check.tsx', import.meta.url), 'utf8');
const helper = source.slice(source.indexOf('export function speechFailureMessage'), source.indexOf('export default function SpeechCheck'));
const compiled = ts.transpileModule(helper, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { speechFailureMessage } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('native speech failures explain an actionable reason in the attempted language', () => {
  for (const [code, action] of [['audio-busy', '暂停其他音频'], ['audio-hardware', '蓝牙输出'], ['network', '检查网络'], ['text-too-long', '长度限制']]) {
    for (const prefix of ['', 'chinese-']) {
      const message = speechFailureMessage(prefix + code);
      assert.ok(message.startsWith(prefix ? '中文' : '英文'));
      assert.ok(message.includes(action), message);
      assert.ok(!message.includes(code), 'the notice should explain the failure instead of exposing a native code');
    }
  }
});

test('unknown synthesis errors retain a recovery action without exposing unbounded browser details', () => {
  for (const code of ['synthesis-unavailable', 'synthesis-failed', 'unexpected-detail-'.repeat(50)]) {
    const message = speechFailureMessage('chinese-' + code);
    assert.ok(message.startsWith('中文'));
    assert.ok(message.includes('重播') && message.includes('换个声音'));
    assert.ok(!message.includes(code));
    assert.ok(message.length < 100);
  }
});
