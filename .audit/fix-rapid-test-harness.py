from pathlib import Path

progress_path = Path("tests/progress-boundaries-runtime.test.mjs")
progress = progress_path.read_text()
old_progress = '''    readingCompleted: completed,
    Date: class extends Date { constructor(...args) { super(...(args.length ? args : ["2026-09-05T12:00:00"])); } },'''
new_progress = '''    readingCompleted: completed,
    readingCompletionLock: { current: null },
    window: { setTimeout(callback) { callback(); } },
    Date: class extends Date { constructor(...args) { super(...(args.length ? args : ["2026-09-05T12:00:00"])); } },'''
if progress.count(old_progress) != 1:
    raise SystemExit("Unexpected reading progress harness")
progress_path.write_text(progress.replace(old_progress, new_progress))

browse_path = Path("tests/sentence-browse-runtime.test.mjs")
browse = browse_path.read_text()
old_window = '''    cancelAnimationFrame(id) { frames.delete(id); },
    scrollTo(options) { window.scrollY = options.top; scrollCalls.push({ ...options }); },
  };'''
new_window = '''    cancelAnimationFrame(id) { frames.delete(id); },
    scrollTo(options) { window.scrollY = options.top; scrollCalls.push({ ...options }); },
    setTimeout(callback) { callback(); return 1; },
  };'''
if browse.count(old_window) != 1:
    raise SystemExit("Unexpected sentence browser window harness")
browse = browse.replace(old_window, new_window)
old_context = '''    practiceRotationRef: { current: { word: 0, sentence: 0, pattern: 0 } },
    STORAGE: { practiceRotation: "rotation", sentencePreferences: "preferences" },'''
new_context = '''    practiceRotationRef: { current: { word: 0, sentence: 0, pattern: 0 } },
    wordStartLock: { current: false }, sentenceStartLock: { current: false }, patternStartLock: { current: false },
    STORAGE: { practiceRotation: "rotation", sentencePreferences: "preferences" },'''
if browse.count(old_context) != 1:
    raise SystemExit("Unexpected sentence browser context harness")
browse_path.write_text(browse.replace(old_context, new_context))

rapid_path = Path("tests/rapid-actions-stability.test.mjs")
rapid = rapid_path.read_text()
old_assertions = '''    assert.match(source, new RegExp(`if \\(${refName}\\.current\\) return`));
    assert.match(source, new RegExp(`${refName}\\.current = true`));
    assert.match(source, new RegExp(`${refName}\\.current = false`));'''
new_assertions = '''    assert.ok(source.includes(`if (${refName}.current) return;`));
    assert.ok(source.includes(`${refName}.current = true;`));
    assert.ok(source.includes(`${refName}.current = false;`));'''
if rapid.count(old_assertions) != 1:
    raise SystemExit("Unexpected rapid-action start assertions")
rapid_path.write_text(rapid.replace(old_assertions, new_assertions))

print("Updated isolated runtime harnesses for the new synchronous refs.")
