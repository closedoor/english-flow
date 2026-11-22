import assert from 'node:assert/strict';
import { openSetupDetails, selectSentenceMethod } from './browser-disclosures.mjs';
import { navigate } from './browser-navigation.mjs';

// Only the root font size is overridden to represent the learner's 200% text
// setting. Layout, content, touch controls, focus and scrolling are all real.
export async function verifyLongRecallAnswer(page, url, commit) {
  const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
  assert.equal(response.status(), 200);
  if (commit) assert.equal(await page.locator('meta[name="english-flow-build"]').getAttribute('content'), commit);
  await page.locator('.bottom-nav').waitFor();
  await navigate(page, '句子');
  await selectSentenceMethod(page, '看中文说英文');
  await openSetupDetails(page, '.sentence-find');
  await page.getByRole('searchbox', { name: '搜索长短句' }).fill('on the Tatoeba blog');
  await page.locator('.sentence-result-list button[data-sentence-id="2884"]').click();
  const card = page.locator('.sentence-study-card');
  await card.waitFor();
  await page.addStyleTag({ content: 'html{font-size:32px!important}' });
  assert.equal(await page.locator('.speak-answer').count(), 0);
  assert.equal(await page.getByRole('button', { name: '播放英文', exact: true }).isDisabled(), true);
  const before = await card.evaluate(el => ({
    bottom: el.getBoundingClientRect().bottom,
    promptBottom: el.querySelector('.speak-prompt').getBoundingClientRect().bottom,
    scroll: el.scrollTop,
  }));
  assert.equal(before.scroll, 0);
  assert.ok(before.promptBottom >= before.bottom, 'Fixture needs a real prompt longer than the card viewport: ' + JSON.stringify(before));
  const reveal = page.getByRole('button', { name: '我说好了，查看英文答案' });
  await reveal.click();
  // Do not use a locator action on the answer: Playwright would scroll to it
  // and hide the defect. Hit-test the first rendered English character in place.
  const result = await page.locator('.speak-answer').evaluate(el => {
    const paragraph = el.querySelector('p');
    const range = document.createRange();
    range.setStart(paragraph.firstChild, 0);
    range.setEnd(paragraph.firstChild, 1);
    const glyph = range.getBoundingClientRect();
    const hit = document.elementFromPoint(glyph.x + glyph.width / 2, glyph.y + glyph.height / 2);
    const card = el.closest('.sentence-study-card');
    const bounds = card.getBoundingClientRect();
    return {
      id: el.id, firstLineVisible: paragraph.contains(hit) && glyph.top >= bounds.top - 1 && glyph.bottom <= bounds.bottom + 1,
      focused: document.activeElement === el, cardScroll: card.scrollTop, glyphTop: glyph.top, cardBottom: bounds.bottom,
    };
  });
  assert.equal(result.id, 'sentence-answer-2884');
  assert.ok(result.focused && result.firstLineVisible && result.cardScroll > 0,
    'The first English line must be readable without a second gesture: ' + JSON.stringify(result));
  return result;
}
