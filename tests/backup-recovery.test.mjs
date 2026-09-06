import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const backupSource = await readFile(new URL("../app/backup-data.ts", import.meta.url), "utf8");
const sentenceData = await readFile(new URL("../app/sentence-data.ts", import.meta.url), "utf8");
const backupJavaScript = ts.transpileModule(backupSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const backupModule = await import(`data:text/javascript;base64,${Buffer.from(backupJavaScript).toString("base64")}`);

const storageBlock = page.split("const STORAGE =", 2)[1].split("} as const;", 1)[0];
const storageKeys = [...storageBlock.matchAll(/:\s*"(wordflow-[^"]+)"/g)].map((match) => match[1]);
const optionalBackupKeys = ["wordflow-reading-completed-v1", "wordflow-reading-last-v1", "wordflow-practice-rotation-v1", "wordflow-reading-answers-v1"];

class MemoryStorage {
  constructor(initial = {}) { this.values = new Map(Object.entries(initial)); }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

class QuotaStorage extends MemoryStorage {
  constructor(initial, capacity) { super(initial); this.capacity = capacity; }
  setItem(key, value) {
    const nextSize = [...this.values.entries()].reduce((size, [entryKey, entryValue]) => size + (entryKey === key ? 0 : entryValue.length), String(value).length);
    if (nextSize > this.capacity) throw new Error("QuotaExceededError");
    super.setItem(key, value);
  }
}

function emptyBackupData() {
  return Object.fromEntries(storageKeys.map((key) => [key, null]));
}

test("backup serializes every existing local learning key and tolerates one corrupt value", () => {
  assert.equal(storageKeys.length, 19);
  assert.equal(new Set(storageKeys).size, storageKeys.length);
  const storage = new MemoryStorage({
    [storageKeys[0]]: JSON.stringify([1, 2]),
    [storageKeys[1]]: "{broken-json",
  });
  const backup = backupModule.createLearningBackup(storage, storageKeys, "2026-08-23T10:00:00.000Z");
  assert.deepEqual(backup.data[storageKeys[0]], [1, 2]);
  assert.equal(backup.data[storageKeys[1]], null);
  assert.ok(storageKeys.every((key) => Object.hasOwn(backup.data, key)));
  assert.equal(backup.app, "english-flow");
  assert.equal(backup.formatVersion, 1);
});

test("restore validation accepts old backups but rejects missing core, extra, oversized and wrong-version data", () => {
  const valid = { app: "english-flow", formatVersion: 1, exportedAt: "2026-08-23T10:00:00.000Z", data: emptyBackupData() };
  assert.equal(backupModule.isLearningBackup(valid, storageKeys, optionalBackupKeys), true);
  const previousVersion = structuredClone(valid);
  optionalBackupKeys.forEach((key) => delete previousVersion.data[key]);
  assert.equal(backupModule.isLearningBackup(previousVersion, storageKeys, optionalBackupKeys), true);
  const missing = structuredClone(valid);
  delete missing.data[storageKeys[0]];
  assert.equal(backupModule.isLearningBackup(missing, storageKeys, optionalBackupKeys), false);
  const extra = structuredClone(valid);
  extra.data["wordflow-unknown"] = [];
  assert.equal(backupModule.isLearningBackup(extra, storageKeys, optionalBackupKeys), false);
  const oversized = structuredClone(valid);
  oversized.data[storageKeys[0]] = "x".repeat(500_001);
  assert.equal(backupModule.isLearningBackup(oversized, storageKeys, optionalBackupKeys), false);
  assert.equal(backupModule.isLearningBackup({ ...valid, formatVersion: 2 }, storageKeys, optionalBackupKeys), false);
});

test("restore replaces all records successfully", () => {
  const storage = new MemoryStorage({ [storageKeys[0]]: JSON.stringify([99]) });
  const backup = { app: "english-flow", formatVersion: 1, exportedAt: "2026-08-23T10:00:00.000Z", data: emptyBackupData() };
  backup.data[storageKeys[0]] = [1, 2, 3];
  backup.data[storageKeys[4]] = { mode: "test", count: 20, path: "daily" };
  assert.equal(backupModule.restoreLearningBackupData(storage, storageKeys, backup), true);
  assert.deepEqual(JSON.parse(storage.getItem(storageKeys[0])), [1, 2, 3]);
  assert.deepEqual(JSON.parse(storage.getItem(storageKeys[4])), { mode: "test", count: 20, path: "daily" });
  assert.equal(storage.getItem(storageKeys[1]), null);
});

test("restoring a previous-version backup clears unsupported newer reading records", () => {
  const storage = new MemoryStorage({
    [optionalBackupKeys[0]]: JSON.stringify(["r1", "r2"]),
    [optionalBackupKeys[1]]: JSON.stringify({ id: "r2", updatedAt: 1 }),
  });
  const backup = { app: "english-flow", formatVersion: 1, exportedAt: "2026-08-23T10:00:00.000Z", data: emptyBackupData() };
  optionalBackupKeys.forEach((key) => delete backup.data[key]);
  assert.equal(backupModule.isLearningBackup(backup, storageKeys, optionalBackupKeys), true);
  assert.equal(backupModule.restoreLearningBackupData(storage, storageKeys, backup), true);
  assert.equal(storage.getItem(optionalBackupKeys[0]), null);
  assert.equal(storage.getItem(optionalBackupKeys[1]), null);
});

test("a failed restore rolls every already-written record back", () => {
  const original = Object.fromEntries(storageKeys.map((key, index) => [key, JSON.stringify([index])]));
  const storage = new MemoryStorage(original);
  let failedOnce = false;
  const originalSetItem = storage.setItem.bind(storage);
  storage.setItem = (key, value) => {
    if (!failedOnce && key === storageKeys[4]) {
      failedOnce = true;
      throw new Error("simulated quota failure");
    }
    originalSetItem(key, value);
  };
  const backup = { app: "english-flow", formatVersion: 1, exportedAt: "2026-08-23T10:00:00.000Z", data: Object.fromEntries(storageKeys.map((key) => [key, ["new"]])) };
  assert.equal(backupModule.restoreLearningBackupData(storage, storageKeys, backup), false);
  assert.deepEqual(Object.fromEntries(storage.values), original);
});

test("quota exhaustion rolls back growth before restoring earlier shrunken records", () => {
  const original = { a: '"aaaaaaaaaa"', b: '"b"', c: '"c"', unrelated: '"keep"' };
  const storage = new QuotaStorage(original, 31);
  const backup = { data: { a: "a", b: "bbbbbbbbbbbbbbbbb", c: "cccccccccc" } };
  assert.equal(backupModule.restoreLearningBackupData(storage, ["a", "b", "c"], backup), false);
  assert.deepEqual(Object.fromEntries(storage.values), original);
});

test("a fitting backup frees space before expanding a different record", () => {
  const storage = new QuotaStorage({ a: '"a"', b: '"bbbbbbbbbbbbbbbbb"', c: '"c"' }, 25);
  const backup = { data: { a: "aaaaaaaaaa", b: "b", c: "c" } };
  assert.equal(backupModule.restoreLearningBackupData(storage, ["a", "b", "c"], backup), true);
  assert.equal(storage.getItem("a"), '"aaaaaaaaaa"');
  assert.equal(storage.getItem("b"), '"b"');
});

test("backup preparation failures never mutate existing records", () => {
  const original = { a: '"original"', b: '"untouched"' };
  const storage = new MemoryStorage(original);
  const cyclic = {}; cyclic.self = cyclic;
  assert.equal(backupModule.restoreLearningBackupData(storage, ["a", "b"], { data: { a: "new", b: cyclic } }), false);
  assert.deepEqual(Object.fromEntries(storage.values), original);
  storage.getItem = (key) => { if (key === "b") throw new Error("blocked"); return original[key]; };
  assert.equal(backupModule.restoreLearningBackupData(storage, ["a", "b"], { data: { a: "new", b: "new" } }), false);
  assert.deepEqual(Object.fromEntries(storage.values), original);
});

test("one blocked rollback record does not prevent restoring other records", () => {
  const original = { a: '"aaaaaa"', b: '"bbbbbb"', c: '"c"' };
  const storage = new MemoryStorage(original);
  storage.setItem = (key, value) => {
    if (key === "c" || (key === "b" && value === original.b)) throw new Error("blocked key");
    storage.values.set(key, value);
  };
  assert.equal(backupModule.restoreLearningBackupData(storage, ["a", "b", "c"], { data: { a: "a", b: "b", c: "new" } }), false);
  assert.equal(storage.getItem("a"), original.a);
  assert.equal(storage.getItem("c"), original.c);
});

test("iPhone backup safely falls back when file sharing is unavailable or throws", () => {
  const exportBlock = page.split("const exportLearningBackup", 2)[1].split("const chooseBackupFile", 1)[0];
  assert.match(exportBlock, /typeof navigator\.share === "function"/);
  assert.match(exportBlock, /typeof navigator\.canShare === "function"/);
  assert.match(exportBlock, /navigator\.canShare\(shareData\)/);
  assert.match(exportBlock, /URL\.createObjectURL\(file\)/);
  assert.match(exportBlock, /finally \{[\s\S]*?backupActionLock\.current = false/);
});

test("restore is confirmed, protected from double taps and reloads only after success", () => {
  assert.match(page, /恢复这份学习记录/);
  assert.match(page, /恢复后会替换这台设备当前的全部学习记录和偏好/);
  assert.match(page, /restoreLearningBackupData\(window\.localStorage, STORAGE_KEYS, pendingBackup\)/);
  const restoreBlock = page.split("const restoreLearningBackup", 2)[1].split("const resetLearningProgress", 1)[0];
  assert.match(restoreBlock, /let restored = false/);
  assert.match(restoreBlock, /try \{[\s\S]*restoreLearningBackupData\(window\.localStorage/);
  assert.match(restoreBlock, /catch \{[\s\S]*if \(!restored\)/);
  assert.match(restoreBlock, /backupActionLock\.current = false/);
  assert.match(page, /isLearningBackup\(value, STORAGE_KEYS, BACKUP_OPTIONAL_KEYS\)/);
  assert.match(page, /STORAGE\.readingCompleted\)} 篇已读文章/);
  assert.match(page, /backupActionLock\.current/);
  assert.match(page, /aria-busy=\{backupBusy === "restore"\}/);
  assert.match(page, /window\.location\.reload\(\)/);
  assert.match(page, /restoreCancelRef\.current\?\.focus\(\)/);
  assert.match(page, /if \(!backupActionLock\.current\) setPendingBackup\(null\)/);
});

test("partial sentence recovery and phone-sized controls remain present", () => {
  assert.match(page, /Promise\.allSettled\(packs\.map/);
  assert.match(page, /result\.status === "fulfilled"/);
  assert.match(page, /results\.some\(\(result\) => result\.status === "rejected"\)/);
  assert.doesNotMatch(sentenceData, /sentencePackCache\.clear\(\)/);
  assert.match(page, /离线模式 · 已加载内容和本机记录仍可使用/);
  assert.match(styles, /\.backup-actions button\{[^}]*min-height:46px/);
  assert.match(styles, /\.backup-notice button\{[^}]*width:44px;height:44px/);
});
