from pathlib import Path
import json


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Expected one match in {path}, found {count}: {old[:90]!r}")
    file.write_text(text.replace(old, new, 1))


# A failed core pack already leaves the successful packs in the content cache.
# Retry only the missing content in the same document so the learner does not
# lose their current browser state or need an unnecessary full reload.
replace_once(
    "app/page.tsx",
    "已保存成功下载的数据；重新载入页面可恢复缺少部分。",
    "已保存成功下载的数据；可以先重试缺少部分，仍失败时再重新载入页面。",
)
replace_once(
    "app/page.tsx",
    '{wordDataLoadError && <button onClick={() => window.location.reload()}>重新载入页面</button>}',
    '{wordDataLoadError && <div className="app-loading-actions"><button disabled={!networkOnline} onClick={() => { setWordDataLoadError(false); setWordDataLoadedPacks(0); setWordDataLoadAttempt((value) => value + 1); }}>重试核心词库</button><button onClick={() => window.location.reload()}>重新载入页面</button></div>}',
)

styles = Path("app/globals.css")
css = styles.read_text()
marker = "/* Deep audit: in-page core recovery and WCAG AA secondary-text contrast. */"
if marker not in css:
    css += f'''\n\n{marker}\n.app-loading-actions{{display:flex;flex-wrap:wrap;justify-content:center;gap:9px;margin-top:10px;max-width:100%;padding:0 16px}}\n.app-loading-actions button{{min-width:130px;min-height:46px;padding:0 16px;border:1px solid var(--green-dark);border-radius:14px;font-size:13px;font-weight:800}}\n.app-loading-actions button:first-child{{background:var(--green-dark);color:#fff}}\n.app-loading-actions button:last-child{{background:#fff;color:var(--green-dark)}}\n.app-loading-actions button:disabled{{opacity:.55;cursor:not-allowed}}\n.section-heading button,\n.scene-card small,\n.mode-grid small,\n.path-card small,\n.scene-list small,\n.count-switch button:not(.selected),\n.rank-switch button:not(.selected),\n.library-list button>span,\n.library-note,\n.session-choice-summary,\n.sentence-section-switch button:not(.selected),\n.sentence-mode-grid button small,\n.sentence-band-switch button:not(.selected),\n.sentence-band-switch button small,\n.level-switch button:not(.selected),\n.level-switch button small,\n.reading-number,\n.reading-card p,\n.reading-card>i,\n.reading-overview small,\n.reading-resume small,\n.reading-resume p,\n.reading-zh-title,\n.reading-meta,\n.content-load-state,\n.content-load-state>span,\n.segment-control button:not(.selected),\n.empty-state p,\n.review-top,\n.review-card>p,\n.review-pager span,\n.mini-example small,\n.sentence-progress-panel p small,\n.data-management small{{color:#526071}}\n.percent{{color:var(--green-dark)}}\n@media(max-width:340px){{.app-loading-actions{{width:100%;flex-direction:column}}.app-loading-actions button{{width:100%}}}}\n'''
    styles.write_text(css)

# Promote the isolated audit into the normal browser regression suite. Wait for
# lazy content before scanning the ordinary screens so the check audits what a
# learner actually uses, while the dedicated failure test still covers the
# core-loading error screen.
audit = Path(".audit/deep-audit.mjs").read_text()
audit = audit.replace(
    '    await page.locator(".page").first().waitFor();\n    const current = await page.evaluate(async () => {',
    '''    await page.locator(".page").first().waitFor();\n    if (label === "句库") await page.waitForFunction(() => { const button = document.querySelector(".sentence-page .sticky-start"); return button && !button.disabled; });\n    if (label === "阅读") await page.locator(".reading-card").first().waitFor({ timeout: 30_000 });\n    const current = await page.evaluate(async () => {''',
)
audit = audit.replace('DEEP_AUDIT_SUMMARY', 'ACCESSIBILITY_BROWSER_SUMMARY')
Path("scripts/browser-accessibility.mjs").write_text(audit)

package_path = Path("package.json")
package_data = json.loads(package_path.read_text())
old_browser = "node scripts/browser-smoke.mjs && node scripts/browser-network.mjs && node scripts/browser-recovery.mjs"
if package_data["scripts"].get("test:browser") != old_browser:
    raise SystemExit(f"Unexpected test:browser script: {package_data['scripts'].get('test:browser')}")
package_data["scripts"]["test:browser"] = old_browser + " && node scripts/browser-accessibility.mjs"
package_path.write_text(json.dumps(package_data, ensure_ascii=False, indent=2) + "\n")

workflow = Path(".github/workflows/validate.yml")
workflow_text = workflow.read_text()
workflow_text = workflow_text.replace(
    "      PLAYWRIGHT_MODULE: /tmp/english-flow-browser/node_modules/playwright/index.mjs\n",
    "      PLAYWRIGHT_MODULE: /tmp/english-flow-browser/node_modules/playwright/index.mjs\n      AXE_SOURCE: /tmp/english-flow-browser/node_modules/axe-core/axe.min.js\n",
    1,
)
workflow_text = workflow_text.replace(
    "npm install --prefix /tmp/english-flow-browser --no-save --package-lock=false playwright@1.56.1",
    "npm install --prefix /tmp/english-flow-browser --no-save --package-lock=false playwright@1.56.1 axe-core@4.10.3",
    1,
)
workflow.write_text(workflow_text)

testing = Path("TESTING.md")
testing_text = testing.read_text()
testing_text = testing_text.replace(
    "npm install --prefix /tmp/english-flow-browser --no-save --package-lock=false playwright@1.56.1",
    "npm install --prefix /tmp/english-flow-browser --no-save --package-lock=false playwright@1.56.1 axe-core@4.10.3",
)
testing_text = testing_text.replace(
    "PLAYWRIGHT_MODULE=/tmp/english-flow-browser/node_modules/playwright/index.mjs npm run test:browser",
    "PLAYWRIGHT_MODULE=/tmp/english-flow-browser/node_modules/playwright/index.mjs AXE_SOURCE=/tmp/english-flow-browser/node_modules/axe-core/axe.min.js npm run test:browser",
)
section = """

## Core-content recovery and accessibility

The browser command injects a transient failure into one NGSL data pack in Chromium and WebKit. It verifies that the loading screen can retry inside the same document, preserve local records, reuse the packs already cached successfully and still retain full-page reload as a fallback. The suite also checks reduced-motion behavior and runs axe-core WCAG A/AA rules on the six primary screens after their lazy content is ready. Critical or serious violations fail CI. The audit dependency remains isolated from the application dependency graph and does not change the lock file or production bundle.
"""
if "## Core-content recovery and accessibility" not in testing_text:
    testing_text += section
testing.write_text(testing_text)

Path("tests/deep-audit-regression.test.mjs").write_text('''import assert from "node:assert/strict";\nimport { readFile } from "node:fs/promises";\nimport test from "node:test";\n\nconst page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");\nconst styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");\nconst packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));\nconst workflow = await readFile(new URL("../.github/workflows/validate.yml", import.meta.url), "utf8");\n\ntest("a failed core word pack can retry in place before a full reload", () => {\n  assert.match(page, /重试核心词库/);\n  assert.match(page, /setWordDataLoadedPacks\\(0\\)/);\n  assert.match(page, /setWordDataLoadAttempt\\(\\(value\\) => value \\+ 1\\)/);\n  assert.match(page, /app-loading-actions/);\n  assert.match(page, /重新载入页面/);\n});\n\ntest("WCAG and reduced-motion browser checks are part of the normal validation path", () => {\n  assert.match(packageJson.scripts["test:browser"], /browser-accessibility\\.mjs/);\n  assert.match(workflow, /axe-core@4\\.10\\.3/);\n  assert.match(workflow, /AXE_SOURCE/);\n  assert.match(styles, /Deep audit: in-page core recovery and WCAG AA secondary-text contrast/);\n  assert.match(styles, /prefers-reduced-motion:reduce/);\n});\n''')

print("Applied in-page core retry, WCAG contrast repairs and permanent accessibility regression coverage.")
