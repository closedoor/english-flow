import { navigate, openLegacyPatterns, openLegacyWords } from './browser-navigation.mjs';
import { openSetupDetails, selectSentenceMethod, sentenceChoices } from './browser-disclosures.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

if (!process.env.PLAYWRIGHT_MODULE) throw new Error('Set PLAYWRIGHT_MODULE to the isolated Playwright installation.');
const playwright = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const base = new URL(process.env.PRODUCTION_URL || 'https://english-flow-mwnn.onrender.com/');
if (!['https://english-flow-mwnn.onrender.com', 'http://127.0.0.1:4173'].includes(base.origin)) {
  throw new Error('Only the official English Flow site or its local rehearsal is allowed.');
}
const expected = process.env.EXPECTED_COMMIT;
assert.match(expected || '', /^[0-9a-f]{40}$/, 'EXPECTED_COMMIT must be a full Git commit SHA');
const later = expected === 'f'.repeat(40) ? 'e'.repeat(40) : 'f'.repeat(40);
const choices = { band: 'short', category: 'food', count: 20, mode: 'speak' };
const keys = {
  preferences: 'wordflow-sentence-preferences-v1', word: 'wordflow-active-session-v1',
  sentence: 'wordflow-sentence-active-session-v1', pattern: 'wordflow-pattern-active-session-v1',
  rotation: 'wordflow-practice-rotation-v1', mastered: 'wordflow-ngsl-mastered-v1', difficult: 'wordflow-ngsl-difficult-v1',
};
const stored = (page, key) => page.evaluate(key => JSON.parse(localStorage.getItem(key) || 'null'), key);
const records = page => page.evaluate(() => Object.fromEntries(
  Object.keys(localStorage).filter(key => key.startsWith('wordflow-')).sort().map(key => [key, localStorage.getItem(key)]),
));
const nav = navigate;
const results = [];

async function retainChoices(page) {
  assert.deepEqual(await stored(page, keys.preferences), choices);
  const summary = (await sentenceChoices(page)).join(' ');
  for (const label of ['看中文说英文', '短句', '餐饮']) assert.ok(summary.includes(label), summary);
}
async function beginWords(page) {
  await nav(page, '单词');

  await page.getByRole('button', { name: /^开始学习(?:句子)?$/, exact: true }).click();
  await page.locator('.word-card').waitFor();
}
async function tapVisible(page, locator, quizMode = null) {
  const box = await locator.evaluate(async (button, quizMode) => {
    const rectangle = (element) => {
      if (!element) return null;
      const r = element.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom,
        hit: element === hit || element.contains(hit) };
    };
    const measure = () => ({ ...rectangle(button), disabled: button.tagName === 'SUMMARY' ? button.getAttribute('aria-disabled') === 'true' : button.disabled, label: button.textContent,
      limit: document.querySelector('.bottom-nav')?.getBoundingClientRect().top ?? innerHeight, viewportWidth: innerWidth,
      ...(quizMode ? { quiz: {
        scrollY, overflow: document.documentElement.scrollWidth > innerWidth + 1,
        field: rectangle(document.querySelector('.answer-field')), actions: rectangle(document.querySelector('.quiz-actions')),
        primary: rectangle(document.querySelector('.quiz-page .sticky-start')), skip: rectangle(document.querySelector('.quiz-skip')),
        feedback: rectangle(document.querySelector('.feedback-box')), answer: rectangle(document.querySelector('.feedback-box p')),
        inputFocused: document.activeElement === document.querySelector('.quiz-page input'),
        primaryFocused: document.activeElement === document.querySelector('.quiz-page .sticky-start'),
      } } : {}),
    });
    if (!quizMode) return measure();
    // The quiz focus and navigation effects schedule scrolling on later paints.
    // Wait for the complete state, then use this same sample for one direct tap.
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const started = performance.now();
    let previous = null, stableSince = 0, latest;
    while (performance.now() - started < 12_000) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      latest = measure();
      const complete = (r, touchTarget = true) => Boolean(r && r.x >= -1 && r.x + r.width <= innerWidth + 1
        && r.y >= -1 && r.bottom <= innerHeight + 1 && r.hit && (!touchTarget || (r.width >= 44 && r.height >= 44)));
      const q = latest.quiz;
      const questionReady = !q.feedback && complete(q.field, false) && q.field.bottom <= q.actions?.y - 3
        && complete(q.skip) && q.inputFocused;
      const feedbackReady = complete(q.feedback, false) && q.feedback.bottom <= q.primary?.y - 3
        && (!q.answer || (complete(q.answer, false) && q.answer.bottom <= q.primary?.y - 3)) && q.primaryFocused;
      const ready = !latest.disabled && complete(latest) && complete(q.primary) && !q.overflow
        && (quizMode === 'feedback' ? feedbackReady : questionReady);
      const signature = ready ? JSON.stringify(latest) : null;
      if (!signature || signature !== previous) stableSince = performance.now();
      if (signature && signature === previous && performance.now() - stableSince >= 100) return latest;
      previous = signature;
    }
    throw new Error(`Live quiz ${quizMode} geometry, focus and hit targets did not stabilize: ${JSON.stringify(latest)}`);
  }, quizMode);
  assert.equal(box.disabled, false, JSON.stringify(box));
  assert.ok(box.x >= -1 && box.x + box.width <= box.viewportWidth + 1 && box.y >= -1
    && box.y + box.height <= box.limit + 1 && box.width >= 44 && box.height >= 44 && box.hit,
  `The visible control must receive a direct coordinate tap: ${JSON.stringify(box)}`);
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}
async function quizFeedbackVisible(page, answer) {
  await page.waitForFunction(() => {
    const feedback = document.querySelector('.feedback-box'), action = document.querySelector('.quiz-page .sticky-start');
    if (!feedback || !action) return false;
    const f = feedback.getBoundingClientRect(), a = action.getBoundingClientRect();
    return f.top >= -1 && f.bottom <= a.top - 3 && a.bottom <= innerHeight + 1;
  });
  assert.equal(await page.locator('.feedback-box strong').innerText(), answer, 'The complete correct answer is visible');
  assert.ok(await page.locator('.feedback-box p').evaluate(paragraph => {
    const p = paragraph.getBoundingClientRect(), a = document.querySelector('.quiz-page .sticky-start').getBoundingClientRect();
    return p.top >= -1 && p.bottom <= a.top - 3;
  }));
}
async function identify(page, scripts, beforeReady) {
  const url = new URL('/', base);
  url.searchParams.set('ef-update', expected);
  const response = await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  assert.equal(response.status(), 200);
  assert.equal(await page.title(), '词流英语');
  assert.equal(await page.locator('meta[name="english-flow-build"]').getAttribute('content'), expected);
  await beforeReady?.(page);
  await page.locator('.bottom-nav, .word-card, .quiz-page, .sentence-study-card, .pattern-prompt').first().waitFor();
  await nav(page, '进度');
  assert.ok((await page.locator('.app-version-panel').innerText()).includes(`当前版本 ${expected.slice(0, 7)}`),
    'The executing client must report the expected release');
  assert.ok((await Promise.all(scripts)).some(source => source.includes(expected)),
    'The full expected release identity must appear in a loaded client module');
}

for (const engine of ['chromium', 'webkit']) {
  const browser = await playwright[engine].launch({ headless: true });
  async function check(name, body, seed = {}, beforeReady) {
    // Fresh, disposable profiles only. Real Service Worker acceptance is separate
    // in verify-live-pwa.mjs; these UI checks must not intercept a learner's cache.
    const context = await browser.newContext({ viewport: { width: 390, height: 650 }, hasTouch: true, acceptDownloads: true,
      isMobile: true, serviceWorkers: 'block' });
    await context.addInitScript(({ values, simulateStartupReadFault, masteredKey }) => {
      const storage = window.localStorage;
      const get = Storage.prototype.getItem, set = Storage.prototype.setItem, remove = Storage.prototype.removeItem;
      for (const [key, value] of Object.entries(values)) set.call(storage, key, JSON.stringify(value));
      if (simulateStartupReadFault) {
        // API fault in this disposable profile only; this is not a Safari disk test.
        const readRecords = () => Object.fromEntries(Object.keys(values).map(key => [key, get.call(storage, key)]));
        const fault = { failures: 0, writes: [], original: readRecords(), readRecords,
          documentId: `${Date.now()}-${Math.random()}` };
        window.__maintenanceStorageFault = fault;
        Storage.prototype.getItem = function (key) {
          if (this === storage && key === masteredKey && fault.failures === 0) {
            fault.failures++;
            throw new DOMException('Simulated transient learning-record read failure', 'SecurityError');
          }
          return get.call(this, key);
        };
        Storage.prototype.setItem = function (key, value) {
          if (this === storage) fault.writes.push({ operation: 'set', key, value });
          return set.call(this, key, value);
        };
        Storage.prototype.removeItem = function (key) {
          if (this === storage) fault.writes.push({ operation: 'remove', key });
          return remove.call(this, key);
        };
      }
      const speech = { fail: false, log: [] };
      window.__maintenanceSpeech = speech;
      window.__maintenanceQuizTaps = [];
      for (const type of ['touchstart', 'touchend', 'click']) document.addEventListener(type, event => {
        if (!document.querySelector('.quiz-page')) return;
        const target = event.target instanceof Element ? event.target.closest('button,input') ?? event.target : null;
        const point = event.changedTouches?.[0] ?? event;
        window.__maintenanceQuizTaps.push({ type, x: point.clientX, y: point.clientY, scrollY,
          label: target?.textContent?.trim().slice(0, 80), top: target?.getBoundingClientRect().top,
          feedback: Boolean(document.querySelector('.feedback-box')), active: document.activeElement?.tagName });
        if (window.__maintenanceQuizTaps.length > 24) window.__maintenanceQuizTaps.shift();
      }, { capture: true });
      Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true,
        value: class { constructor(text) { this.text = text; } } });
      Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
        paused: false, getVoices() { return []; }, cancel() {}, resume() {},
        speak(utterance) {
          speech.log.push({ text: utterance.text, lang: utterance.lang });
          if (speech.fail) utterance.onerror?.({ error: 'not-allowed' }); else utterance.onstart?.();
        },
      } });
    }, { values: seed, simulateStartupReadFault: Boolean(beforeReady), masteredKey: keys.mastered });
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    const errors = [], scripts = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {
      if (response.request().resourceType() === 'script' && new URL(response.url()).origin === base.origin) {
        scripts.push(response.text().catch(() => ''));
      }
    });
    try {
      await identify(page, scripts, beforeReady);
      const detail = await body(page, context);
      assert.deepEqual(errors, [], 'No uncaught errors in the deployed client');
      results.push({ engine, name, status: 'PASS', commit: expected, ...detail });
      console.log('LIVE_MAINTENANCE_PASS', JSON.stringify(results.at(-1)));
    } catch (error) {
      const quiz = await page.evaluate(() => document.querySelector('.quiz-page') ? {
        session: JSON.parse(localStorage.getItem('wordflow-active-session-v1') || 'null'),
        scrollY, active: document.activeElement?.tagName, taps: window.__maintenanceQuizTaps ?? [],
      } : null).catch(() => null);
      results.push({ engine, name, status: 'FAIL', commit: expected, error: String(error), errors, quiz });
      console.error('LIVE_MAINTENANCE_FAIL', JSON.stringify(results.at(-1)));
      process.exitCode = 1;
    } finally {
      await context.close();
    }
  }

  await check('merged-dashboard-progress-and-review-shortcuts', async page => {
    await nav(page,'首页');
    assert.deepEqual(await page.locator('.bottom-nav button small').allTextContents(),['首页','单词','句子','阅读']);
    assert.equal(await page.locator('.hero-card,.quick-practice-grid,.scene-strip').count(),0);
    assert.equal(await page.locator('.home-dashboard .week-card').count(),1);
    assert.match(await page.locator('.home-word-progress').innerText(),/已学习 4 \/ 2809 个/);
    assert.match(await page.locator('.home-sentence-progress').innerText(),/已学习 2 \/ 3,000 句/);
    assert.match(await page.locator('.home-reading-progress').innerText(),/1\/15 篇已读/);
    for(const selector of ['.home-word-progress','.home-sentence-progress','.home-reading-progress']) {
      const value=await page.locator(selector).innerText();
      assert.match(value, /\d+(?:\.\d+)?%/);
    }
    const position=await page.evaluate(()=>({week:document.querySelector('.week-card').getBoundingClientRect().top,progress:document.querySelector('.home-word-progress').getBoundingClientRect().top,review:document.querySelector('.home-review-entry').getBoundingClientRect().top}));
    assert.ok(position.week < position.progress && position.progress < position.review,'Weekly rhythm precedes simple progress and review');
    await page.locator('.home-review-entry').click();
    await page.locator('.review-page').waitFor();
    await nav(page,'生词本');
    await page.locator('.review-card').waitFor();
    assert.deepEqual(await stored(page,keys.difficult),[10]);
    assert.equal(await page.locator('.review-card .review-reveal').count(),1,'Wordbook starts with recall');
    return {fourMainTabs:true,weeklyRhythmFirst:true,wordSentenceAndReadingCountsVisible:true,reviewAndWordbookAccessible:true};
  },{[keys.mastered]:[1,2,3],[keys.difficult]:[10],'wordflow-sentence-mastered-v1':[1,1001],'wordflow-reading-completed-v1':['r1'],'wordflow-days':[new Date().toISOString().slice(0,10)]});

  await check('simple-practice-entry-and-visible-disclosure-controls' , async page => {
    await nav(page, '单词');
    assert.equal(await page.locator('h1').innerText(), '单词');
    for (const selector of ['.word-range', '.word-find']) assert.equal(await page.locator(selector).evaluate(e => e.open), false);
    assert.equal(await page.getByRole('searchbox', { name: '搜索词库' }).isVisible(), false);
    await tapVisible(page, page.locator('.word-range>summary'));
    assert.equal(await page.locator('.scene-list button').first().isVisible(), true);
    await page.locator('.word-range>summary').click();
    await openSetupDetails(page, '.word-find');
    await page.getByRole('searchbox', { name: '搜索词库' }).fill('the');
    await page.locator('.library-list button').first().waitFor();
    await nav(page, '句子');
    await page.waitForFunction(() => !document.querySelector('.sentence-page .setup-start')?.disabled);
    assert.equal(await page.locator('h1').innerText(), '句子');
    for (const selector of ['.sentence-range', '.sentence-find']) assert.equal(await page.locator(selector).evaluate(e => e.open), false);
    assert.equal(await page.locator('.sentence-section-switch').count(), 0);
    assert.equal(await page.locator('.practice-methods button').count(), 2);
    assert.equal(await page.getByRole('button',{name:'核心句型',exact:true}).count(),0);
    assert.equal(await page.locator('.practice-methods button[aria-pressed="true"]').count(),1);
    assert.equal(await page.locator('.practice-methods').isVisible(), false);
    assert.equal(await page.locator('.session-choice-summary,.resume-session-card,.setup-footnote').count(),0);
    await selectSentenceMethod(page, '看中文说英文');
    assert.match((await sentenceChoices(page)).join(' '), /看中文说英文/);
    assert.equal(await page.locator('.sentence-range .practice-methods').isVisible(),true);
    return { secondaryToolsInitiallyFolded: true, practiceMethodsInsideRange: true, sentenceSummaryAndProgressHidden: true, wordSearchUsable: true };
  });

  await check('cross-range-sentence-lists-search-and-practice-preferences', async page => {
    await nav(page, '句子');
    await page.waitForFunction(() => !document.querySelector('.sentence-page .setup-start')?.disabled);
    for (const label of ['收藏句子', '待加强']) {
      await openSetupDetails(page, '.sentence-find');
      await page.locator('.sentence-summary button').filter({ hasText: label }).click();
      await page.waitForFunction(() => document.querySelectorAll('.sentence-result-list button[data-sentence-id]').length === 3);
      assert.deepEqual(await page.locator('.sentence-result-list button[data-sentence-id]').evaluateAll(
        buttons => buttons.map(button => Number(button.dataset.sentenceId))), [1, 1001, 2001]);
      await retainChoices(page);
      await page.getByRole('button', { name: '‹ 返回句库搜索', exact: true }).click();
    }
    await openSetupDetails(page, '.sentence-find');
    const search = page.getByRole('searchbox', { name: '搜索长短句' });
    for (const query of ['airport', '机场']) {
      await search.fill(query);
      await page.locator('.sentence-result-list button[data-sentence-id]').first().waitFor();
      await retainChoices(page);
    }
    await page.getByRole('button', { name: /^开始学习(?:句子)?$/, exact: true }).click();
    await page.locator('.sentence-study-card').waitFor();
    const session = await stored(page, keys.sentence);
    for (const [key, value] of Object.entries(choices)) assert.equal(session[key], value);
    assert.equal(session.continuous,true); assert.ok(session.sentenceIds.length>20);
    assert.equal(await page.locator('.sentence-english').count(), 0, 'Recall mode does not reveal the English answer');
    return { collectionAndReinforcementIds: [1, 1001, 2001], queries: ['airport', '机场'], practiceChoicesPreserved: true };
  }, {
    [keys.preferences]: choices, 'wordflow-sentence-saved-v1': [1, 1001, 2001],
    'wordflow-sentence-difficult-v1': [1, 1001, 2001],
  });

  await check('pattern-start-resumes-rated-group-and-substitution-with-hidden-answer', async page => {
    await openLegacyPatterns(page);
    await page.getByRole('button', { name: '返回句型设置并保留进度', exact: true }).click();
    await openSetupDetails(page, '.pattern-range');
    await page.locator('.pattern-category-grid button').filter({ hasText: '全部' }).click();
    const start = () => page.getByRole('button', { name: '开始句型替换练习', exact: true }).click();
    const reveal = () => page.getByRole('button', { name: '我说好了，查看参考答案', exact: true }).click();
    await start();
    await page.locator('.pattern-prompt').waitFor();
    for (let drill = 0; drill < 3; drill++) {
      await reveal();
      if (drill < 2) await page.getByRole('button', { name: '下一组 ›', exact: true }).click();
    }
    await page.getByRole('button', { name: '掌握句型', exact: true }).click();
    await page.waitForFunction(() => Object.keys(JSON.parse(localStorage.getItem('wordflow-pattern-active-session-v1'))?.ratings || {}).length === 1);
    await reveal();
    await page.getByRole('button', { name: '下一组 ›', exact: true }).click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('wordflow-pattern-active-session-v1'))?.drillIndex === 1);
    const before = await stored(page, keys.pattern), beforeRotation = await stored(page, keys.rotation);
    assert.equal(before.index, 1);
    assert.equal(before.drillIndex, 1);
    assert.equal(Object.keys(before.ratings).length, 1);
    for (let attempt = 0; attempt < 2; attempt++) {
      await page.getByRole('button', { name: '返回句型设置并保留进度', exact: true }).click();
      await start();
      assert.equal(await page.locator('#discard-title').count(), 0);
      await page.locator('.pattern-prompt').waitFor();
      assert.deepEqual(await stored(page, keys.pattern), before, 'Same-settings Start resumes IDs, position, ratings and timestamp');
      assert.deepEqual(await stored(page, keys.rotation), beforeRotation);
      assert.equal(await page.locator('.pattern-answer').count(), 0, 'Resumed recall does not reveal the reference answer');
    }
    assert.equal(await page.evaluate(() => window.__maintenanceSpeech.log.length), 0, 'Recall does not automatically speak the answer');
    return { patternIndex: before.index, substitutionIndex: before.drillIndex, ratingCount: 1,
      repeatedStartResumesWithoutDiscard: true, rotationPreserved: true, recallAnswerHidden: true, instrumentedSpeech: true };
  }, {[keys.pattern]:{version:1,updatedAt:Date.now(),category:'all',patternIds:Array.from({length:10},(_,index)=>`p${String(index+1).padStart(2,'0')}`),index:0,drillIndex:0,ratings:{}}});

  await check('small-phone-pattern-top-start-substitutions-and-final-rating-receive-direct-taps', async page => {
    await page.setViewportSize({ width: 320, height: 568 });
    await openLegacyPatterns(page);
    await page.getByRole('button', { name: '返回句型设置并保留进度', exact: true }).click();
    await page.waitForFunction(() => scrollY <= 1);
    const start = page.getByRole('button', { name: '开始句型替换练习', exact: true });
    assert.equal(await start.count(), 1);
    assert.equal(await start.evaluate(button => button.compareDocumentPosition(document.querySelector('.pattern-category-grid')) & Node.DOCUMENT_POSITION_FOLLOWING), 4,
      'Pattern Start precedes the category options');
    await tapVisible(page, start);
    await page.locator('.pattern-prompt').waitFor();
    const original = await stored(page, keys.pattern);
    for (let drill = 0; drill < 3; drill++) {
      assert.equal(await page.locator('.pattern-answer').count(), 0, 'Each substitution starts with recall');
      assert.equal(await page.locator('.pattern-card-actions .learn-actions').count(), 0, 'Rating waits for the final revealed substitution');
      const reveal = page.getByRole('button', { name: '我说好了，查看参考答案', exact: true });
      // A committed storage snapshot can precede the navigation animation frame.
      // Let the rendered question settle before scrolling its recall control.
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await reveal.evaluate(button => button.scrollIntoView({ block: 'center', behavior: 'auto' }));
      await tapVisible(page, reveal);
      await page.locator('.pattern-answer').waitFor();
      await page.waitForFunction(() => document.activeElement === document.querySelector('.pattern-answer'));
      await page.evaluate(() => scrollTo(0, 0));
      await page.waitForFunction(() => scrollY <= 1);
      if (drill < 2) {
        await tapVisible(page, page.getByRole('button', { name: '下一组 ›', exact: true }));
        await page.waitForFunction(drill => JSON.parse(localStorage.getItem('wordflow-pattern-active-session-v1'))?.drillIndex === drill, drill + 1);
      }
    }
    await tapVisible(page, page.getByRole('button', { name: '掌握句型', exact: true }));
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('wordflow-pattern-active-session-v1'))?.index === 1);
    const after = await stored(page, keys.pattern);
    assert.equal(after.drillIndex, 0);
    assert.deepEqual(after.patternIds, original.patternIds);
    assert.deepEqual(after.ratings, { [original.patternIds[0]]: 'known' });
    assert.equal(await page.locator('.pattern-answer').count(), 0);
    assert.equal(await page.evaluate(() => window.__maintenanceSpeech.log.length), 0, 'Recall never automatically speaks the answer');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    return { viewport: { width: 320, height: 568 }, topStartReceivedCoordinateTap: true,
      threeSubstitutionsAndFinalRatingReceivedCoordinateTaps: true, nextPatternAnswerHidden: true, instrumentedSpeech: true };
  }, {[keys.pattern]:{version:1,updatedAt:Date.now(),category:'all',patternIds:Array.from({length:10},(_,index)=>`p${String(index+1).padStart(2,'0')}`),index:0,drillIndex:0,ratings:{}}});

  const quizReadyWord = {
    version: 1, kind: 'group', updatedAt: Date.now(), path: 'frequency', mode: 'test', wordIds: [1, 2, 3],
    index: 2, ratings: { 1: 'known', 2: 'known' }, stage: 'cards', quizIndex: 0,
    quizAnswer: '', quizFeedback: null, quizResults: [],
  };
  await check('small-phone-quiz-wrong-answer-and-empty-skip-keep-feedback-and-actions-visible', async page => {
    await page.setViewportSize({ width: 320, height: 568 });
    await openLegacyWords(page);
    await page.locator('.learn-actions .primary-action').click();
    await page.locator('.quiz-page input').waitFor();
    assert.equal(await page.locator('.feedback-box').count(), 0);
    await page.locator('.quiz-page input').fill('unrecognized');
    await tapVisible(page, page.locator('.quiz-page .sticky-start'), 'question');
    await page.locator('.feedback-box.wrong').waitFor();
    await quizFeedbackVisible(page, 'The');
    let session = await stored(page, keys.word);
    assert.equal(session.quizIndex, 0);
    assert.deepEqual(session.quizResults, [false]);
    await tapVisible(page, page.getByRole('button', { name: '下一题', exact: true }), 'feedback');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('wordflow-active-session-v1'))?.quizIndex === 1);
    assert.equal(await page.locator('.feedback-box').count(), 0);
    assert.equal(await page.locator('.quiz-page input').inputValue(), '');
    assert.equal(await page.locator('.quiz-page .sticky-start').isDisabled(), true);
    await tapVisible(page, page.locator('.quiz-skip'), 'question');
    await page.locator('.feedback-box.wrong').waitFor();
    await quizFeedbackVisible(page, 'Be');
    session = await stored(page, keys.word);
    assert.equal(session.quizIndex, 1);
    assert.equal(session.quizAnswer, '');
    assert.deepEqual(session.quizResults, [false, false]);
    await tapVisible(page, page.getByRole('button', { name: '下一题', exact: true }), 'feedback');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('wordflow-active-session-v1'))?.quizIndex === 2);
    assert.deepEqual((await stored(page, keys.word)).quizResults, [false, false], 'Next does not submit a second result');
    assert.equal(await page.locator('.feedback-box').count(), 0);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    return { viewport: { width: 320, height: 568 }, wrongAndEmptySkipReceivedCoordinateTaps: true,
      completeAnswersVisible: ['The', 'Be'], nextQuestionReceivedCoordinateTaps: true, instrumentedSpeech: true };
  }, {
    [keys.word]: quizReadyWord, [keys.mastered]: [1, 2],
    'wordflow-session-preferences-v1': { mode: 'test', count: 10, path: 'frequency' },
  });

  const reviewSchedule = { 1: { due: Date.now() - 60_000, stage: 3 }, 2: { due: Date.now() - 59_999, stage: 1 }, 3: { due: Date.now() - 59_998, stage: 2 } };
  await check('review-undo-can-immediately-correct-the-rating-and-preserve-other-records', async page => {
    await nav(page, '复习');
    await page.getByRole('button', { name: '显示答案', exact: true }).click();
    await page.evaluate(() => {
      window.__maintenanceReviewClicks = [];
      document.addEventListener('click', event => {
        const text = event.target.closest('button')?.textContent || '';
        if (/忘了|撤销上次|记得/.test(text)) window.__maintenanceReviewClicks.push({ text, at: performance.now() });
      }, true);
    });
    const before = Date.now();
    await page.getByRole('button', { name: '忘了 10 分钟后', exact: true }).click();
    await page.getByRole('button', { name: '撤销上次', exact: true }).click();
    await page.getByRole('button', { name: '记得 14 天后', exact: true }).click();
    const after = Date.now(), clicks = await page.evaluate(() => window.__maintenanceReviewClicks);
    assert.equal(clicks.length, 3, 'Rating, undo and correction are actual pointer clicks');
    const correctionMilliseconds = clicks[2].at - clicks[0].at;
    assert.ok(correctionMilliseconds < 350, `Correction exercises the previous rating-lock interval: ${correctionMilliseconds} ms`);
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('wordflow-ngsl-mastered-v1') || '[]').includes(1)
      && !JSON.parse(localStorage.getItem('wordflow-ngsl-difficult-v1') || '[]').includes(1));
    assert.deepEqual((await stored(page, keys.mastered)).sort(), [1, 3]);
    assert.deepEqual(await stored(page, keys.difficult), [2]);
    const schedule = await stored(page, 'wordflow-ngsl-schedule-v1');
    assert.deepEqual(schedule[2], reviewSchedule[2]);
    assert.deepEqual(schedule[3], reviewSchedule[3]);
    assert.equal(schedule[1].stage, 4);
    assert.ok(schedule[1].due >= before + 14 * 86_400_000 && schedule[1].due <= after + 14 * 86_400_000);
    return { immediateCorrectionPersisted: true, correctionMilliseconds: Math.round(correctionMilliseconds), otherWordRecordsPreserved: true };
  }, { [keys.mastered]: [3], [keys.difficult]: [1, 2], 'wordflow-ngsl-schedule-v1': reviewSchedule });

  await check('paused-window-exports-its-memory-backup-without-overwriting-the-other-window', async (page, context) => {
    await beginWords(page);
    await page.locator('.learn-actions .primary-action').click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('wordflow-active-session-v1'))?.index === 1);
    const original = await stored(page, keys.word);
    assert.deepEqual(await stored(page, keys.mastered), [1]);
    const newer = await context.newPage(), scripts = [], newerErrors = [];
    newer.setDefaultTimeout(30_000);
    newer.on('pageerror', error => newerErrors.push(error.message));
    newer.on('response', response => {
      if (response.request().resourceType() === 'script' && new URL(response.url()).origin === base.origin) scripts.push(response.text().catch(() => ''));
    });
    await identify(newer, scripts);
    await nav(newer, '单词');
    await newer.getByRole('button',{name:'开始学习',exact:true}).click();
    await newer.locator('.learn-actions .primary-action').click();
    await newer.waitForFunction(() => localStorage.getItem('wordflow-ngsl-mastered-v1') === '[1,2]');
    await page.locator('.sync-dialog').waitFor();
    const before = await records(newer);
    await page.evaluate(() => {
      window.__maintenanceSyncDocument = 'same-paused-document';
      // Select the real download fallback; native OS sharing remains untested.
      Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => false });
    });
    const rescue = page.locator('.sync-dialog').getByRole('button', { name: '导出本页备份', exact: true });
    assert.equal(await rescue.isEnabled(), true);
    assert.equal(await rescue.evaluate(button => Boolean(button.closest('[inert]'))), false);
    const pending = page.waitForEvent('download');
    await rescue.click();
    const download = await pending;
    const backup = JSON.parse(await readFile(await download.path(), 'utf8'));
    assert.equal(backup.formatVersion, 1);
    assert.equal(Object.keys(backup.data).length, 19);
    assert.deepEqual(backup.data[keys.mastered], [1], 'A exports its own memory, rather than the newer B records');
    assert.deepEqual(backup.data[keys.word], original);
    await page.locator('.sync-dialog .backup-notice.success').waitFor();
    assert.equal(await page.locator('.sync-dialog').count(), 1, 'The old window remains paused');
    assert.equal(await page.evaluate(() => window.__maintenanceSyncDocument), 'same-paused-document');
    assert.deepEqual(await records(page), before, 'Export never writes the old window over shared records');
    assert.deepEqual(await records(newer), before);
    assert.deepEqual(newerErrors, []);
    return { twoActualIsolatedProfileWindows: true, downloadedMemoryMastered: [1], newerDiskMastered: [1, 2],
      otherWindowFullRecordsPreserved: true, pausedDocumentPreserved: true, downloadFallbackSelected: true, nativeShareVerified: false };
  });

  await check('word-and-sentence-new-search-reset-results-with-more-and-lookup-return-preserved', async page => {
    await nav(page, '单词');
    await openSetupDetails(page, '.word-find');
    const words = page.locator('.library-list');
    await words.evaluate(element => { element.scrollTop = 1000; });
    await page.locator('.rank-switch button').nth(1).click();
    await page.waitForFunction(() => document.querySelector('.library-list').scrollTop === 0);
    assert.equal(await words.locator('button').first().getAttribute('data-word-id'), '1001');
    await words.evaluate(element => { element.scrollTop = 1000; });
    const wordSearch = page.getByRole('searchbox', { name: '搜索词库' });
    await wordSearch.fill('e');
    await page.waitForFunction(() => document.querySelector('.library-list').scrollTop === 0);
    assert.equal(await words.locator('button').first().getAttribute('data-word-id'), '1');
    await words.evaluate(element => { element.scrollTop = 500; });
    await page.locator('.library-more').click();
    await page.waitForFunction(() => document.querySelectorAll('.library-list button').length === 48);
    assert.equal(await words.evaluate(element => element.scrollTop), 500, 'More words retains the existing result position');
    const word = words.locator('button').nth(10);
    await word.scrollIntoViewIfNeeded();
    const wordOrigin = await page.evaluate(() => ({ top: scrollY, list: document.querySelector('.library-list').scrollTop }));
    const wordId = await word.getAttribute('data-word-id');
    await word.click();
    await page.locator('.word-card').waitFor();
    await page.getByRole('button', { name: '返回词库', exact: true }).click();
    await page.waitForFunction(({ top, list }) => Math.abs(scrollY - top) <= 2 && document.querySelector('.library-list')?.scrollTop === list, wordOrigin);
    assert.equal(await page.locator('button:focus').getAttribute('data-word-id'), wordId);
    assert.equal(await words.locator('button').count(), 48);
    await wordSearch.fill('   ');
    await page.waitForFunction(() => document.querySelector('.library-list').scrollTop === 0);
    assert.equal(await page.locator('.rank-switch button').nth(1).getAttribute('aria-pressed'), 'true');
    assert.equal(await words.locator('button').first().getAttribute('data-word-id'), '1001');
    assert.ok(!(await page.locator('.library-block .row-heading small').innerText()).includes('全库'));

    await nav(page, '句子');
    await openSetupDetails(page, '.sentence-find');
    const search = page.getByRole('searchbox', { name: '搜索长短句' });
    await search.fill('I');
    await page.locator('.sentence-result-list button[data-sentence-id]').first().waitFor();
    await page.waitForFunction(() => !document.querySelector('.sentence-result-list .browser-hint'));
    const sentences = page.locator('.sentence-result-list');
    await sentences.evaluate(element => { element.scrollTop = 1000; });
    await search.fill('you');
    await page.waitForFunction(() => document.querySelector('.sentence-result-list').scrollTop === 0);
    assert.equal(await sentences.locator('button[data-sentence-id]').first().getAttribute('data-sentence-id'), '1');
    const more = sentences.locator('.library-more');
    await more.scrollIntoViewIfNeeded();
    const position = await sentences.evaluate(element => element.scrollTop);
    await more.click();
    await page.waitForFunction(() => document.querySelectorAll('.sentence-result-list button[data-sentence-id]').length === 60);
    assert.equal(await sentences.evaluate(element => element.scrollTop), position, 'More sentences retain the existing result position');
    const sentence = sentences.locator('button[data-sentence-id]').nth(35);
    await sentence.scrollIntoViewIfNeeded();
    const sentenceOrigin = await page.evaluate(() => ({ top: scrollY, list: document.querySelector('.sentence-result-list').scrollTop }));
    const sentenceId = await sentence.getAttribute('data-sentence-id');
    await sentence.click();
    await page.locator('.sentence-study-card').waitFor();
    await page.getByRole('button', { name: '返回句库设置并保留进度', exact: true }).click();
    await page.waitForFunction(({ top, list }) => Math.abs(scrollY - top) <= 2 && document.querySelector('.sentence-result-list')?.scrollTop === list, sentenceOrigin);
    assert.equal(await page.locator('button:focus').getAttribute('data-sentence-id'), sentenceId);
    assert.equal(await sentences.locator('button[data-sentence-id]').count(), 60);
    return { changedQueriesStartAtFirstResult: true, rankBandStartsAtFirstResult: true,
      wordExpandedCount: 48, sentenceExpandedCount: 60, lookupScrollAndFocusPreserved: true };
  });

  await check('unrated-third-word-exit-protects-current-position', async page => {
    await beginWords(page);
    for (let index = 1; index <= 2; index++) {
      await page.getByRole('button', { name: '下一张 ›', exact: true }).click();
      await page.waitForFunction(index => JSON.parse(localStorage.getItem('wordflow-active-session-v1'))?.index === index, index);
    }
    const before = await stored(page, keys.word);
    assert.deepEqual(before.ratings, {});
    await page.getByRole('button', { name: '退出学习并保留进度', exact: true }).click();
    assert.equal(await page.locator('#discard-title').count(),0,'Exiting preserves progress without a replacement prompt');
    assert.deepEqual(await stored(page, keys.word),before);
    await page.getByRole('button',{name:'开始学习',exact:true}).click();
    await page.locator('.word-card').waitFor();
    assert.deepEqual(await stored(page,keys.word),before);
    await page.getByRole('button',{name:'退出学习并保留进度',exact:true}).click();
    await openSetupDetails(page,'.word-range');
    await page.locator('.scene-list button').first().click();
    await page.getByRole('button',{name:'开始学习',exact:true}).click();
    await page.locator('#discard-title').waitFor();
    await page.getByRole('button',{name:'保留进度',exact:true}).click();
    assert.deepEqual(await stored(page,keys.word),before);
    return {index:2,ratingCount:0,exitResumesWithoutDialog:true,replacementProtected:true};
  });

  const pausedWord = {
    version: 1, kind: 'group', updatedAt: Date.now(), path: 'frequency', mode: 'free',
    wordIds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], index: 4,
    ratings: { 1: 'known', 2: 'known', 3: 'known', 4: 'difficult' }, stage: 'cards',
    quizIndex: 0, quizAnswer: '', quizFeedback: null, quizResults: [],
  };
  await check('startup-read-failure-pauses-without-writes-and-retries-the-paused-group', async page => {
    await nav(page, '单词');
    await page.getByRole('button',{name:'开始学习',exact:true}).click();
    await page.locator('.word-card').waitFor();
    assert.equal((await stored(page,keys.word)).index,4);
    assert.equal(await page.locator('.word-heading h2').innerText(),'to');
    assert.deepEqual(await stored(page, keys.mastered), [1, 2, 3]);
    assert.deepEqual(await stored(page, keys.difficult), [4]);
    assert.deepEqual(await stored(page, keys.word), pausedWord);
    const fault = await page.evaluate(() => ({ documentId: window.__maintenanceStorageFault.documentId,
      expectedDocumentId: window.__maintenanceFaultDocument, failures: window.__maintenanceStorageFault.failures }));
    assert.equal(fault.documentId, fault.expectedDocumentId, 'Recovery keeps the document that showed the startup fault');
    assert.equal(fault.failures, 1);
    assert.equal(await page.getByText('学习记录暂时无法读取', { exact: true }).count(), 0);
    return { simulatedStorageReadFault: true, startupWrites: 0, rawRecordsPreservedDuringFault: true,
      retryInSameDocument: true, pausedWordIndex: 4, restoredMastered: [1, 2, 3], restoredDifficult: [4] };
  }, {
    [keys.mastered]: [1, 2, 3], [keys.difficult]: [4], [keys.word]: pausedWord,
    'wordflow-session-preferences-v1': { mode: 'free', count: 10, path: 'frequency' },
    [keys.rotation]: { word: 2, sentence: 0, pattern: 0 },
  }, async page => {
    await page.getByText('学习记录暂时无法读取', { exact: true }).waitFor();
    assert.equal(await page.locator('.app-loading[role="alert"]').count(), 1);
    assert.equal(await page.locator('.bottom-nav').count(), 0, 'Failed startup cannot expose default learning navigation');
    assert.equal(await page.locator('.word-card, .sentence-study-card, .pattern-study-card').count(), 0);
    const fault = await page.evaluate(() => {
      const state = window.__maintenanceStorageFault;
      window.__maintenanceFaultDocument = state.documentId;
      return { original: state.original, current: state.readRecords(), writes: state.writes, failures: state.failures };
    });
    assert.deepEqual(fault.current, fault.original, 'Every seeded raw record survives the failed read unchanged');
    assert.deepEqual(fault.writes, [], 'No normalization, removal or autosave occurs before a successful read');
    assert.equal(fault.failures, 1);
    await page.getByRole('button', { name: '重试读取记录', exact: true }).click();
  });

  await check('reading-module-return-restores-the-current-paragraph', async page => {
    await nav(page, '阅读');
    await page.locator('.level-switch button').filter({ hasText: 'Level 3' }).click();
    await page.locator('.reading-card').first().click();
    const title = await page.locator('.reading-detail h1').innerText();
    await page.locator('.reading-question').scrollIntoViewIfNeeded();
    const position = await page.evaluate(() => scrollY);
    assert.ok(position > 500);
    for (const label of ['今天', '进度']) {
      await nav(page, label);
      await nav(page, '阅读');
      await page.waitForFunction(position => Math.abs(scrollY - position) <= 2, position);
      assert.equal(await page.locator('.reading-detail h1').innerText(), title);
    }
    return { title, position, readingPositionPreserved: true };
  });

  await check('speech-warning-keeps-the-next-word-directly-tappable', async page => {
    await beginWords(page);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('english-flow-speech-error', { detail: 'not-allowed' })));
    await page.getByRole('button', { name: '关闭语音提示', exact: true }).waitFor();
    const next = page.getByRole('button', { name: '下一张 ›', exact: true });
    await page.waitForFunction(() => {
      const button = document.querySelector('.learn-page .sentence-pager button:last-child');
      const box = button.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return button === hit || button.contains(hit);
    });
    const box = await next.boundingBox();
    assert.ok(box && box.y >= 0 && box.y + box.height < 650, 'Next remains in the visible viewport');
    const placement = await page.evaluate(() => ({
      toastBottom: document.querySelector('.status-toast-stack').getBoundingClientRect().bottom,
      actionsTop: document.querySelector('.word-card-actions').getBoundingClientRect().top,
    }));
    assert.ok(placement.toastBottom <= placement.actionsTop - 4, JSON.stringify(placement));
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('wordflow-active-session-v1'))?.index === 1);
    return { nextReceivedCoordinateTap: true, instrumentedSpeech: true, warningEventSimulated: true };
  });

  await check('speech-warning-keeps-the-next-sentence-directly-tappable', async page => {
    await nav(page, '句子');
    await page.waitForFunction(() => !document.querySelector('.sentence-page .setup-start')?.disabled);
    await page.getByRole('button', { name: /^开始学习(?:句子)?$/, exact: true }).click();
    await page.locator('.sentence-study-card').waitFor();
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('english-flow-speech-error', { detail: 'not-allowed' })));
    await page.getByRole('button', { name: '关闭语音提示', exact: true }).waitFor();
    await page.waitForFunction(() => {
      const button = document.querySelector('.sentence-learn-page .sentence-pager button:last-child');
      const box = button.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return button === hit || button.contains(hit);
    });
    const placement = await page.evaluate(() => ({
      toastBottom: document.querySelector('.status-toast-stack').getBoundingClientRect().bottom,
      actionsTop: document.querySelector('.sentence-card-actions').getBoundingClientRect().top,
    }));
    assert.ok(placement.toastBottom <= placement.actionsTop - 4, JSON.stringify(placement));
    const box = await page.getByRole('button', { name: '下一句 ›', exact: true }).boundingBox();
    assert.ok(box && box.y >= 0 && box.y + box.height < 650);
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('wordflow-sentence-active-session-v1'))?.index === 1);
    return { nextSentenceReceivedCoordinateTap: true, instrumentedSpeech: true, warningEventSimulated: true };
  });

  await check('reset-persists-zero-rotation-and-reaches-update-preflight', async (page, context) => {
    await beginWords(page);
    await nav(page, '进度');
    await page.getByRole('button', { name: '重置', exact: true }).click();
    await page.getByRole('button', { name: '确认重置', exact: true }).click();
    await page.waitForFunction(() => localStorage.getItem('wordflow-practice-rotation-v1') === '{"word":0,"sentence":0,"pattern":0}');
    assert.deepEqual(await stored(page, keys.rotation), { word: 0, sentence: 0, pattern: 0 });
    // Safety-flow simulation only: no future release is claimed or installed.
    // The real current HTML/client were verified before these two routes exist.
    await context.route('**/build-info.json?*', route => route.fulfill({ json: {
      app: 'english-flow', title: '词流英语', origin: base.origin, commit: later,
    } }));
    const preflightUrls = [];
    await context.route(url => url.origin === base.origin && url.pathname === '/' && url.searchParams.get('ef-update') === later,
      route => {
        preflightUrls.push(route.request().url());
        return route.fulfill({ contentType: 'text/html', body: `<!doctype html><title>词流英语</title><meta name="english-flow-build" content="${expected}">` });
      });
    await page.evaluate(commit => { window.__maintenanceDocument = commit; }, expected);
    await page.getByRole('button', { name: '检查更新', exact: true }).click();
    await page.getByRole('button', { name: '更新并保留进度', exact: true }).waitFor();
    const before = await records(page);
    for (let attempt = 1; attempt <= 2; attempt++) {
      const response = page.waitForResponse(response => {
        const url = new URL(response.url());
        return url.origin === base.origin && url.pathname === '/' && url.searchParams.get('ef-update') === later;
      });
      await page.getByRole('button', { name: '更新并保留进度', exact: true }).click();
      await response;
      await page.waitForFunction(() => [...document.querySelectorAll('.app-version-actions button')]
        .some(button => button.textContent === '更新并保留进度' && !button.disabled));
      await page.getByText('新页面暂未就绪，或有记录尚未保存。已保留当前页面，请稍后重试或先导出备份。', { exact: true }).waitFor();
      assert.equal(preflightUrls.length, attempt, 'Reset records pass the save guard on every retry');
      assert.equal(await page.evaluate(() => window.__maintenanceDocument), expected);
      assert.deepEqual(await records(page), before, 'Neither stale-page preflight changes learning records');
    }
    assert.notEqual(preflightUrls[0], preflightUrls[1], 'A retry uses a fresh URL so an old installed worker cannot pin stale HTML');
    for (const href of preflightUrls) {
      const url = new URL(href);
      assert.equal(url.searchParams.get('ef-update'), later);
      assert.ok(url.searchParams.get('ef-preflight'), 'Each preflight carries an explicit attempt nonce');
    }
    assert.equal(await page.getByText('请先到首页的“记录与设置”再更新。若有记录尚未保存，请先导出备份；不会强制刷新。', { exact: true }).count(), 0);
    return { persistedRotation: { word: 0, sentence: 0, pattern: 0 }, updatePreflightReached: true,
      preflightAttempts: 2, distinctRetryUrls: true, simulatedFutureVersionAndStaleHtml: true, releaseSwitchVerified: false };
  });

  await browser.close();
}

console.log('LIVE_MAINTENANCE_SUMMARY', JSON.stringify({ commit: expected,
  passed: results.filter(result => result.status === 'PASS').length,
  failed: results.filter(result => result.status === 'FAIL').length, total: results.length,
  freshIsolatedProfiles: true, physicalAudioVerified: false }));
