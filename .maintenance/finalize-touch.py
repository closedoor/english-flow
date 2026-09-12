from pathlib import Path
p = Path('app/globals.css')
s = p.read_text()
s += '\n/* Keep native pinch zoom available inside swipeable learning cards. */\n.word-card,.sentence-study-card{touch-action:pan-y pinch-zoom}\n'
p.write_text(s)
p = Path('scripts/browser-smoke.mjs')
s = p.read_text()
old = "else { await nav(page, '句库'); await page.locator('.sentence-result-list button').first().waitFor(); }"
new = "else await nav(page, '句库');"
assert s.count(old) == 1
s = s.replace(old,new)
old = '      await card.waitFor();'
new = "      await card.waitFor();\n      assert.ok(await card.evaluate(node => getComputedStyle(node).touchAction.includes('pinch-zoom')), 'Swipe cards must allow native pinch zoom');"
assert s.count(old) == 1
p.write_text(s.replace(old,new))
p = Path('tests/touch-layout-regression.test.mjs')
s = p.read_text()
s += "\ntest('swipe cards preserve native pinch zoom as well as vertical scrolling',()=>{\n  assert.ok(styles.includes('.word-card,.sentence-study-card{touch-action:pan-y pinch-zoom}'));\n});\n"
p.write_text(s)
print('Preserved native card zoom and corrected the sentence-start test readiness condition.')
