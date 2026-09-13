from pathlib import Path
import json

page_path = Path("app/page.tsx")
page = page_path.read_text()

replacements = [
    (
        "  const cardActionLock = useRef(false);",
        "  const cardActionLock = useRef<number | null>(null);",
    ),
    (
        "  const backupActionLock = useRef(false);\n  const backupReadRequestRef = useRef(0);",
        "  const backupActionLock = useRef(false);\n  const backupExportStartedAtRef = useRef(0);\n  const backupReadRequestRef = useRef(0);",
    ),
    (
        "  const exportLearningBackup = async () => {\n    if (backupActionLock.current) return;\n    backupActionLock.current = true;",
        "  const exportLearningBackup = async () => {\n    const startedAt = Date.now();\n    if (backupActionLock.current || startedAt - backupExportStartedAtRef.current < 750) return;\n    backupExportStartedAtRef.current = startedAt;\n    backupActionLock.current = true;",
    ),
    (
        "  const finishCard = (known: boolean) => {\n    if (cardActionLock.current) return;\n    cardActionLock.current = true;\n    window.setTimeout(() => { cardActionLock.current = false; }, 350);\n    noteStudyDay();",
        "  const finishCard = (known: boolean) => {\n    const cardId = current.id;\n    if (cardActionLock.current === cardId) return;\n    cardActionLock.current = cardId;\n    window.setTimeout(() => {\n      if (cardActionLock.current === cardId) cardActionLock.current = null;\n    }, 350);\n    noteStudyDay();",
    ),
]

for old, new in replacements:
    count = page.count(old)
    if count != 1:
        raise SystemExit(f"Expected exactly one match, found {count}: {old[:90]!r}")
    page = page.replace(old, new)

page_path.write_text(page)

source = Path(".audit/daily-use-audit.mjs").read_text()
Path("scripts/browser-daily-use.mjs").write_text(source)

package_path = Path("package.json")
package = json.loads(package_path.read_text())
old_browser = "node scripts/browser-smoke.mjs && node scripts/browser-network.mjs && node scripts/browser-recovery.mjs && node scripts/browser-accessibility.mjs"
new_browser = old_browser + " && node scripts/browser-daily-use.mjs"
if package["scripts"].get("test:browser") != old_browser:
    raise SystemExit("Unexpected test:browser command")
package["scripts"]["test:browser"] = new_browser
package_path.write_text(json.dumps(package, ensure_ascii=False, indent=2) + "\n")

testing_path = Path("TESTING.md")
testing = testing_path.read_text()
marker = "## Daily-use stability coverage"
if marker not in testing:
    testing += """

## Daily-use stability coverage

The normal browser suite also exercises fast, real-world mobile behavior in Chromium and WebKit:

- reconnecting after a core word pack fails while the device is offline;
- preserving a rating when the learner refreshes immediately after tapping;
- preventing an accidental double-tap from downloading duplicate backup files;
- accepting a fast intentional rating on the next card while still rejecting duplicate taps on the same card;
- completing a full ten-word session, repeated navigation and viewport rotation;
- keeping the primary learning action reachable in a short landscape viewport while offline.
"""
    testing_path.write_text(testing)

print("Applied scoped backup-export and per-card interaction guards; added permanent daily-use browser coverage.")
