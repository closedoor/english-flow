import assert from 'node:assert/strict';
import { navigate } from './browser-navigation.mjs';
import { selectSentenceMethod } from './browser-disclosures.mjs';
import { settleLearningStorage } from './storage-settlement-checks.mjs';

async function bounds(target) {
  return target.evaluate(element => {
    const box = element.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    const hit = document.elementFromPoint(x, y);
    return {
      top: box.top, bottom: box.bottom, height: box.height, width: box.width,
      position: getComputedStyle(element).position, scrollY,
      visible: x >= 0 && x < innerWidth && y >= 0 && y < innerHeight
        && Boolean(hit && element.contains(hit)),
    };
  });
}

async function reach(target) {
  await target.scrollIntoViewIfNeeded();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await target.page().evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const box = await bounds(target);
    if (box.visible) return box;
    await target.page().mouse.move(100, 100);
    await target.page().mouse.wheel(0, box.top - 50);
  }
  assert.fail(`Content or control remains covered after normal scrolling: ${JSON.stringify(await bounds(target))}`);
}

async function touch(target) {
  await reach(target);
  const box = await target.boundingBox();
  assert.ok(box && box.width >= 44 && box.height >= 44, 'Controls retain usable touch dimensions');
  await target.page().touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

export async function checkNoticeLayoutMatrix(browser, engine, origin, results, expectedCommit) {
  if (expectedCommit !== undefined) assert.match(expectedCommit, /^[0-9a-f]{40}$/, 'Live notice verification requires the full expected commit');
  const combinations = [['speech'], ['cache'], ['offline'], ['speech', 'cache'],
    ['speech', 'offline'], ['cache', 'offline'], ['speech', 'cache', 'offline']];
  const variants = [
    ...combinations.map(notices => ({ name: `word-${notices.join('-')}-200-percent`, kind: 'word', notices, width: 320, height: 568, font: 32 })),
    { name: 'word-three-notices-landscape-200-percent', kind: 'word', notices: ['speech', 'cache', 'offline'], width: 568, height: 320, font: 32 },
    { name: 'word-three-notices-normal-text', kind: 'word', notices: ['speech', 'cache', 'offline'], width: 390, height: 844, font: 16 },
    { name: 'sentence-three-notices-200-percent', kind: 'sentence', notices: ['speech', 'cache', 'offline'], width: 320, height: 568, font: 32 },
    { name: 'sentence-recall-three-notices-200-percent', kind: 'recall', notices: ['speech', 'cache', 'offline'], width: 320, height: 568, font: 32 },
    { name: 'word-no-notice-keeps-immersive-toolbar', kind: 'word', notices: [], width: 390, height: 844, font: 16 },
  ];
  for (const variant of variants) {
    const context = await browser.newContext({ viewport: { width: variant.width, height: variant.height }, hasTouch: true, serviceWorkers: 'block' });
    // Deterministic speech callbacks isolate layout. These are not physical audio tests.
    await context.addInitScript(() => {
      Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: class { constructor(text) { this.text = text; } } });
      Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
        getVoices: () => [], cancel() {}, pending: false, speaking: false, paused: false,
        speak(utterance) { queueMicrotask(() => { utterance.onstart?.({}); utterance.onend?.({}); }); },
        addEventListener() {}, removeEventListener() {},
      } });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const clientScripts = [];
    if (expectedCommit !== undefined) page.on('response', response => {
      const asset = new URL(response.url());
      if (response.request().resourceType() === 'script' && asset.origin === new URL(origin).origin && /\.m?js$/.test(asset.pathname)) {
        clientScripts.push(response.text().then(source => ({ url: asset.href, source }), () => ({ url: asset.href, source: '' })));
      }
    });
    let measurements;
    let identity;
    try {
      const url = new URL(origin);
      if (expectedCommit !== undefined) url.searchParams.set('ef-update', expectedCommit);
      const response = await page.goto(url.href);
      await page.locator('.bottom-nav').waitFor({ timeout: 30_000 });
      if (expectedCommit !== undefined) {
        assert.equal(response.status(), 200);
        assert.equal(await page.title(), '词流英语');
        assert.equal(await page.locator('meta[name="english-flow-build"]').getAttribute('content'), expectedCommit, 'The fresh HTML must match the released commit');
        const scripts = await Promise.all(clientScripts);
        assert.ok(scripts.some(script => script.source.includes(expectedCommit)), 'At least one actually loaded client JS asset must contain the full released commit');
        identity = { commit: expectedCommit, htmlMatched: true, loadedClientMatched: true, inspectedScripts: scripts.length };
      }
      await page.evaluate(font => { document.documentElement.style.fontSize = `${font}px`; }, variant.font);
      await navigate(page, variant.kind === 'word' ? '单词' : '句子');
      if (variant.kind !== 'word') {
        await page.waitForFunction(() => !document.querySelector('.sentence-page .setup-start')?.disabled);
        if (variant.kind === 'recall') await selectSentenceMethod(page, '看中文说英文');
      }
      await page.locator('.setup-start').click();
      await page.locator(variant.kind === 'word' ? '.word-card' : '.sentence-study-card').waitFor();
      await page.evaluate(notices => {
        if (notices.includes('speech')) window.dispatchEvent(new CustomEvent('english-flow-speech-error', { detail: 'not-allowed' }));
        if (notices.includes('cache')) window.dispatchEvent(new CustomEvent('english-flow-offline-cache-error'));
      }, variant.notices);
      if (variant.notices.includes('offline')) await context.setOffline(true);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const stack = page.locator('.status-toast-stack');
      assert.equal(await page.locator('.storage-warning').count(), 0, 'This regression covers notices without storage-warning fallback');
      assert.equal(await stack.count(), variant.notices.length ? 1 : 0);
      measurements = { stack: variant.notices.length ? await bounds(stack) : null, toolbar: await bounds(page.locator('.word-card-actions')) };
      if (variant.notices.length > 1) assert.equal(measurements.stack.position, 'static', 'Multiple notices share normal document scrolling');
      if (!variant.notices.length) assert.equal(measurements.toolbar.position, 'sticky', 'Ordinary lessons keep their immersive toolbar');
      if (variant.notices.includes('speech')) await reach(page.getByRole('button', { name: '关闭语音提示', exact: true }));
      if (variant.notices.includes('cache')) await reach(page.getByRole('button', { name: '关闭离线保存提示', exact: true }));
      const rating = page.getByRole('button', { name: '还不熟悉', exact: true });
      let previous;
      if (variant.kind === 'word') {
        await reach(page.locator('.word-heading h2'));
        await reach(page.locator('.example-box p'));
        previous = await page.locator('.word-heading h2').innerText();
      } else if (variant.kind === 'recall') {
        assert.equal(await page.locator('.sentence-english').count(), 0, 'Warnings must not reveal a recall answer');
        assert.equal(await page.getByRole('button', { name: '播放英文', exact: true }).isDisabled(), true);
        await reach(page.locator('.speak-prompt p'));
        await touch(page.getByRole('button', { name: '我说好了，查看英文答案', exact: true }));
        await page.locator('.sentence-english').waitFor();
        await reach(page.locator('.sentence-english'));
        previous = await page.locator('.sentence-english').innerText();
      } else {
        await reach(page.locator('.sentence-english'));
        await reach(page.locator('.sentence-translation'));
        previous = await page.locator('.sentence-english').innerText();
      }
      await touch(rating);
      await page.waitForFunction(({ kind, previous }) => document.querySelector(kind === 'word' ? '.word-heading h2' : '.sentence-english')?.textContent !== previous, { kind: variant.kind, previous });
      await settleLearningStorage(page);
      const storageKey = variant.kind === 'word' ? 'wordflow-active-session-v1' : 'wordflow-sentence-active-session-v1';
      const snapshot = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
      assert.equal(snapshot.index, 1, 'A real touch advances and persists the learning position');
      const firstId = variant.kind === 'word' ? snapshot.wordIds[0] : snapshot.sentenceIds[0];
      assert.equal(snapshot.ratings[firstId], 'difficult', 'Notice layout must not lose the actual rating');
      await touch(page.getByRole('button', { name: variant.kind === 'word' ? '退出学习并保留进度' : '返回句库设置并保留进度', exact: true }));
      await page.locator('.setup-start').waitFor();
      await settleLearningStorage(page);
      const paused = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
      assert.equal(paused.index, 1);
      assert.equal(paused.ratings[firstId], 'difficult');
      assert.equal(await page.getByRole('dialog').count(), 0, 'Ordinary exit pauses without an end confirmation');
      assert.deepEqual(errors, []);
      results.push({ engine, name: variant.name, status: 'PASS', ...(identity ? { identity } : {}) });
    } catch (error) {
      results.push({ engine, name: variant.name, status: 'FAIL', error: String(error), measurements, errors });
    } finally {
      console.log(JSON.stringify(results.at(-1)));
      await context.close();
    }
  }
}
