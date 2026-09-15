from pathlib import Path
import re

p = Path('app/page.tsx')
source = p.read_text()
for name, following, header, summary_id in [
    ('renderLearnSetup', 'renderCards', '{commonHeader("开始一组学习", "BUILD A SESSION")}', 'word-session-choice'),
    ('renderSentenceSetup', 'renderSentenceCards', '{commonHeader("学习长短句", "BUILD A SENTENCE SESSION")}', 'sentence-session-choice'),
]:
    start = source.index('  const ' + name + ' =')
    end = source.index('  const ' + following + ' =', start)
    section = source[start:end]
    summaries = re.findall(r'^      <p className="session-choice-summary"[^\n]+</p>\n', section, re.M)
    buttons = re.findall(r'^      <button className="sticky-start primary-action"[^\n]+>开始这组学习</button>\n', section, re.M)
    assert len(summaries) == len(buttons) == 1, name
    summary, button = summaries[0], buttons[0]
    assert section.count(header) == 1
    section = section.replace(summary, '').replace(button, '')
    button = button.replace('sticky-start primary-action', 'sticky-start primary-action setup-start').replace('<button ', f'<button aria-describedby="{summary_id}" ', 1)
    summary = summary.replace('<p ', f'<p id="{summary_id}" ', 1)
    panel = '\n      <div className="setup-start-panel">\n' + '  ' + button + '  ' + summary + '      </div>'
    section = section.replace(header, header + panel)
    source = source[:start] + section + source[end:]
p.write_text(source)

p = Path('app/globals.css')
p.write_text(p.read_text() + '''\n\n/* Group setup: primary start action comes immediately after the title.
   Keep it in normal flow; the quiz's bottom-sticky action is unchanged. */
.setup-start-panel{margin:16px 0 20px;min-width:0}
.setup-start-panel>.setup-start{position:static;bottom:auto;width:100%;min-height:53px;margin:0;padding:12px 16px;white-space:normal}
.setup-start-panel>.session-choice-summary{margin:8px 0 0;overflow-wrap:anywhere}
''')

p = Path('package.json')
s = p.read_text()
old = 'node scripts/browser-word-layout.mjs"'
assert s.count(old) == 1
p.write_text(s.replace(old, 'node scripts/browser-word-layout.mjs && node scripts/browser-setup-start.mjs"'))

p = Path('scripts/verify-live-pwa.mjs')
s = p.read_text()
anchor = "for(const name of ['chromium','webkit']){"
assert s.count(anchor) == 1
helper = '''async function verifyTopStart(page, module) {
  await page.waitForFunction(() => window.scrollY === 0);
  const metrics = await page.locator('.setup-start').evaluate(button => {
    const r = button.getBoundingClientRect();
    const section = button.closest('section');
    const header = section.querySelector('header').getBoundingClientRect();
    const firstOption = section.querySelector('.setup-block').getBoundingClientRect();
    return {top:r.top,bottom:r.bottom,height:r.height,headerBottom:header.bottom,firstOptionTop:firstOption.top,navTop:document.querySelector('.bottom-nav').getBoundingClientRect().top,hit:button.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)),count:section.querySelectorAll('.setup-start').length};
  });
  assert.equal(metrics.count, 1);
  assert.ok(metrics.top >= metrics.headerBottom && metrics.top < 260);
  assert.ok(metrics.bottom < metrics.firstOptionTop && metrics.bottom < metrics.navTop);
  assert.ok(metrics.height >= 44 && metrics.hit);
  console.log('LIVE_SETUP_START_PASS', JSON.stringify({module,commit:expected,...metrics}));
}
'''
s = s.replace(anchor, helper + anchor)
anchor = "    await page.locator('.bottom-nav button').filter({hasText:'学习'}).click();"
assert s.count(anchor) == 1
s = s.replace(anchor, anchor + "\n    await verifyTopStart(page, 'learn');")
anchor = '    assert.deepEqual(errors,[]);'
assert s.count(anchor) == 1
s = s.replace(anchor, '''    await page.locator('.bottom-nav button').filter({hasText:'句库'}).click();
    await page.waitForFunction(() => { const button=document.querySelector('.sentence-page .setup-start'); return button && !button.disabled; });
    await verifyTopStart(page, 'sentences');
    const startBox = await page.locator('.setup-start').boundingBox();
    await page.mouse.click(startBox.x+startBox.width/2, startBox.y+startBox.height/2);
    await page.locator('.sentence-study-card').waitFor();
    assert.equal(await page.evaluate(()=>localStorage.getItem('wordflow-active-session-v1')),snapshot);
''' + anchor)
p.write_text(s)

p = Path('TESTING.md')
p.write_text(p.read_text() + '''\n\n## Top-of-page group starts\n\nThe word setup and daily-sentence setup each render exactly one start button immediately after the page header, before the options and content browser. The existing reactive selection summary moves with it, below the button, and is connected with aria-describedby. The two setup buttons use a scoped normal-flow override; quiz actions, mobile card actions, automatic speech, resume guards and loading/empty-selection disabling remain unchanged. No storage, learning ID, backup or dependency changes.\n\n`scripts/browser-setup-start.mjs` verifies first-screen position and actual coordinate taps (no locator auto-scroll), both modules at small/standard/large phone sizes, browser-height constraints, larger text and desktop. It also verifies saved word choices, sentence mode/length/count, pending sentence-pack disablement/recovery, and the existing paused-sentence replacement confirmation. Local synthetic records only. Main production verification additionally measures both top starts against the real Render page and starts a sentence group in an isolated profile. The tests do not claim physical iPhone or audio-device acceptance.\n''')
print('Moved only the two group-setup actions and their selection summaries; speech, learning and storage handlers are unchanged.')
