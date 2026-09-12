from pathlib import Path
import re
import json

p = Path('app/page.tsx')
s = p.read_text()
old_ref = 'const touchStart = useRef<{ x: number; y: number } | null>(null);'
assert s.count(old_ref) == 1
s = s.replace(old_ref, 'const touchStart = useRef<{ x: number; y: number; identifier: number } | null>(null);')
old = '''  const beginCardSwipe = (event: React.TouchEvent<HTMLElement>) => {
    if (event.target instanceof Element && event.target.closest('button, a, input, textarea, select, [role="button"], [contenteditable="true"]')) {
      touchStart.current = null;
      return;
    }
    const touch = event.touches[0];
    touchStart.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
  };'''
new = '''  const beginCardSwipe = (event: React.TouchEvent<HTMLElement>) => {
    // A second finger cancels the gesture: browser pinch-to-zoom must never
    // navigate the learner to another card or mark any progress.
    if (event.touches.length !== 1 || (event.target instanceof Element && event.target.closest('button, a, input, textarea, select, [role="button"], [contenteditable="true"]'))) {
      touchStart.current = null;
      return;
    }
    const touch = event.touches[0];
    touchStart.current = touch ? { x: touch.clientX, y: touch.clientY, identifier: touch.identifier } : null;
  };

  const endCardSwipe = (event: React.TouchEvent<HTMLElement>, move: (direction: number) => void) => {
    const start = touchStart.current;
    touchStart.current = null;
    const touch = event.changedTouches[0];
    if (!start || event.touches.length !== 0 || event.changedTouches.length !== 1 || !touch || touch.identifier !== start.identifier) return;
    const distanceX = touch.clientX - start.x;
    const distanceY = touch.clientY - start.y;
    if (Math.abs(distanceX) > 55 && Math.abs(distanceX) > Math.abs(distanceY) * 1.25) move(distanceX < 0 ? 1 : -1);
  };'''
assert s.count(old) == 1, 'Swipe source drifted; refuse a blind patch'
s = s.replace(old, new)
for move in ['moveCard', 'moveSentence']:
    old_handler = 'onTouchEnd={(event) => { if (!touchStart.current) return; const distanceX = event.changedTouches[0].clientX - touchStart.current.x; const distanceY = event.changedTouches[0].clientY - touchStart.current.y; touchStart.current = null; if (Math.abs(distanceX) > 55 && Math.abs(distanceX) > Math.abs(distanceY) * 1.25) ' + move + '(distanceX < 0 ? 1 : -1); }}'
    assert s.count(old_handler) == 1, move
    s = s.replace(old_handler, 'onTouchEnd={(event) => endCardSwipe(event, ' + move + ')}')
p.write_text(s)
p = Path('app/globals.css')
s = p.read_text()
assert s.count('.reading-detail-page{padding-top:16px}') == 1
s = s.replace('.reading-detail-page{padding-top:16px}', '.reading-detail-page{padding-top:calc(16px + env(safe-area-inset-top))}')
s += '''
/* The quiz pause label needs its own content-width column, not an icon slot. */
.quiz-page .compact-header{grid-template-columns:max-content minmax(0,1fr) 44px;gap:8px}
.quiz-page .compact-header>div{min-width:0}
.quiz-page .pause-quiz{white-space:nowrap}
'''
p.write_text(s)

# Retain the tested browser scenarios in the existing project, not the scratch branch.
p = Path('.maintenance/browser-audit.mjs')
s = p.read_text()
s = s.replace("import { pathToFileURL } from 'node:url';", "import { pathToFileURL } from 'node:url';\nimport os from 'node:os';\nimport path from 'node:path';")
s = s.replace("const playwright = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);", "if (!process.env.PLAYWRIGHT_MODULE) throw new Error('Set PLAYWRIGHT_MODULE to the installed playwright/index.mjs path; see TESTING.md.');\nconst playwright = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);")
s = s.replace("const origin = 'http://127.0.0.1:4173';", "const origin = process.env.BROWSER_TEST_URL || 'http://127.0.0.1:4173';\nif (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname)) throw new Error('Browser fixtures may run only against a local test server, never the live site.');\nconst evidence = process.env.BROWSER_EVIDENCE_DIR || path.join(os.tmpdir(), 'english-flow-evidence');")
s = s.replace("await mkdir('/tmp/english-flow-evidence', { recursive: true });", "await mkdir(evidence, { recursive: true });")
s = s.replace("await page.locator('.bottom-nav').waitFor({ timeout: 30000 });", "await page.locator('.bottom-nav, .quiz-page').first().waitFor({ timeout: 30000 });")
s = s.replace("const detail = {engine,name,status:'FAIL',error:String(error),stack:error.stack,body:await page.locator('body').innerText().catch(()=>''),pageErrors:errors};", "const detail = {engine,name,status:'FAIL',error:String(error),stack:error.stack,body:(await page.locator('body').innerText().catch(()=>'')).slice(0,3000),pageErrors:errors};")
s = s.replace("path:`/tmp/english-flow-evidence/${engine}-${name}.png`", "path:path.join(evidence, `${engine}-${name}.png`)")
s = '\n'.join(line for line in s.split('\n') if 'SENTENCE_START_HINT' not in line and 'SENTENCE_BUTTONS' not in line and 'PATTERN_BUTTONS' not in line)
s = s.replace("await page.locator('.bottom-nav').waitFor({timeout:30000});", "await page.locator('.bottom-nav').waitFor({timeout:30000});")
s = s.replace("return {left:r.left,right:r.right,text:child.textContent};", "return {left:r.left,right:r.right,height:r.height,text:child.textContent};")
s = s.replace("assert.ok(boxes[0].right<=boxes[1].left+1,JSON.stringify(boxes));", "assert.ok(boxes[0].height<=56, `Pause label must not wrap vertically: ${JSON.stringify(boxes)}`);\n    assert.ok(boxes[0].right<=boxes[1].left+1,JSON.stringify(boxes));")
# Chromium supports full Service Worker offline-navigation automation. WebKit's
# network-offline automation fails internally on reload; exercise loaded content
# there without claiming a physical Safari/PWA cold-start test.
s = s.replace("await check('offline-reload-all-modules',", "await check(engine === 'chromium' ? 'offline-reload-all-modules' : 'offline-loaded-content-navigation',")
s = s.replace("await page.evaluate(()=>navigator.serviceWorker.ready);", "await page.waitForFunction(async () => (await navigator.serviceWorker.getRegistration())?.active?.state === 'activated', null, {timeout:30000});")
old_offline = "    await context.setOffline(true);\n    await page.reload({waitUntil:'domcontentloaded'}); await page.locator('.bottom-nav').waitFor({timeout:30000});"
new_offline = "    const documentId = await page.evaluate(() => { window.__auditDocumentId = Math.random(); return window.__auditDocumentId; });\n    await context.setOffline(true);\n    if (engine === 'chromium') {\n      await page.reload({waitUntil:'domcontentloaded'});\n      await page.locator('.bottom-nav').waitFor({timeout:30000});\n      assert.notEqual(await page.evaluate(() => window.__auditDocumentId), documentId, 'Offline test must create a new document');\n    }\n    await page.locator('.offline-status').waitFor();"
assert old_offline in s
s = s.replace(old_offline,new_offline)
extra = '''  for (const kind of ['word', 'sentence']) {
    await check(`${kind}-pinch-and-swipe`, async page => {
      await ready(page);
      if (kind === 'word') await nav(page, '学习');
      else { await nav(page, '句库'); await page.locator('.sentence-result-list button').first().waitFor(); }
      await page.getByRole('button', {name:'开始这组学习', exact:true}).click();
      const card = page.locator(kind === 'word' ? '.word-card' : '.sentence-study-card');
      const key = kind === 'word' ? keys.word : keys.sentence;
      await card.waitFor();
      await persisted(page, key, value => value && value.index === 0);
      const gesture = async (multi) => card.evaluate((node, multi) => {
        const touch = (x, identifier) => ({clientX:x, clientY:160, identifier});
        const send = (type,touches,changedTouches) => {
          const event = new Event(type, {bubbles:true});
          Object.defineProperties(event, {touches:{value:touches},changedTouches:{value:changedTouches}});
          node.dispatchEvent(event);
        };
        send('touchstart', [touch(240,1)], []);
        if (multi) send('touchstart', [touch(240,1),touch(60,2)], []);
        send('touchend', multi ? [touch(60,2)] : [], [touch(80,1)]);
        if (multi) send('touchend', [], [touch(60,2)]);
      }, multi);
      await gesture(true);
      await page.waitForTimeout(350);
      assert.equal((await stored(page,key)).index,0, 'Pinch must not navigate');
      assert.deepEqual((await stored(page,key)).ratings,{}, 'Pinch must not rate a card');
      await gesture(false);
      await persisted(page,key,value=>value?.index===1);
      assert.deepEqual((await stored(page,key)).ratings,{}, 'Swipe navigation must not award mastery');
    });
  }
'''
assert "  await browser.close();" in s
s = s.replace("  await browser.close();",extra + "  await browser.close();")
s = s.replace("console.log('BROWSER_AUDIT_SUMMARY'", "console.log('BROWSER_SMOKE_SUMMARY'")
Path('scripts/browser-smoke.mjs').write_text(s)

p = Path('package.json')
data = json.loads(p.read_text())
data['scripts']['test:browser'] = 'node scripts/browser-smoke.mjs'
p.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')

p = Path('.github/workflows/validate.yml')
s = p.read_text()
assert s.count('  validate:\n') == 1
s = s.replace('  validate:\n', '  validate:\n    needs: browser\n')
s += '''
  browser:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    env:
      RENDER_EXTERNAL_URL: http://127.0.0.1:4173
      PLAYWRIGHT_MODULE: /tmp/english-flow-browser/node_modules/playwright/index.mjs
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 22.13.0
          cache: npm
      - run: npm ci
      - run: npm run build:render
      - name: Install isolated browser tools
        run: |
          npm install --prefix /tmp/english-flow-browser --no-save --package-lock=false playwright@1.56.1
          node /tmp/english-flow-browser/node_modules/playwright/cli.js install --with-deps chromium webkit > /tmp/browser-install.log 2>&1 || { tail -100 /tmp/browser-install.log; exit 1; }
      - name: Test production UI, persistence and offline behavior
        run: |
          python3 -m http.server 4173 --bind 127.0.0.1 --directory dist/client > /tmp/english-flow-http.log 2>&1 &
          SERVER_PID=$!
          trap 'kill "$SERVER_PID"' EXIT
          npm run test:browser
'''
p.write_text(s)
print('Applied scoped touch, layout and browser-regression improvements; local data schemas unchanged.')
