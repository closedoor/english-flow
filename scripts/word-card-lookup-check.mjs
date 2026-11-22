import assert from 'node:assert/strict';
import { navigate } from './browser-navigation.mjs';
import { openSetupDetails } from './browser-disclosures.mjs';

export const revisedWordCards = [
  { id: 890, word: 'separate', phonetic: '/ˈsep.ər.ət/', meaning: '单独的；分开的', example: 'I have a separate notebook for each class.', translation: '我每门课都有一本单独的笔记本。' },
  { id: 1915, word: 'excuse', phonetic: '/ɪkˈskjuːs/', meaning: '借口；理由', example: 'Over-sleeping is no excuse for being late.', translation: '睡过头不是迟到的理由。' },
  { id: 1548, word: 'graduate', phonetic: '/ˈɡrædʒ.u.eɪt/', meaning: '毕业（动词）；毕业生（名词）', example: 'I hope to graduate from university next year.', translation: '我希望明年大学毕业。' },
];

export async function verifyExactWordLookup(page) {
  await navigate(page, '单词');
  await openSetupDetails(page, '.word-find');
  const search = page.getByRole('searchbox', { name: '搜索词库' });
  const rows = page.locator('.library-list button[data-word-id]');
  await search.fill('ＨＩ！');
  await page.waitForFunction(() => document.querySelector('.library-list button')?.dataset.wordId === '1826');
  assert.equal(await rows.count(), 24);
  assert.equal(await rows.first().locator('b').innerText(), 'hi');
  await rows.first().click();
  assert.equal(await page.locator('.word-heading h2').innerText(), 'hi');
  await page.getByRole('button', { name: '返回词库', exact: true }).click();
  await page.waitForFunction(() => document.activeElement?.getAttribute('data-word-id') === '1826');
  assert.equal(await search.inputValue(), 'ＨＩ！');
  assert.equal(await rows.first().getAttribute('data-word-id'), '1826');
  return { query: 'ＨＩ！', firstWord: 'hi', id: 1826, returnedToResult: true };
}

// Uses only visible learner controls: search the library, open the exact rank,
// then read the rendered card rather than asserting the raw dataset.
export async function verifyWordLookupCard(page, expected) {
  await navigate(page, '单词');
  await openSetupDetails(page, '.word-find');
  await page.getByRole('searchbox', { name: '搜索词库' }).fill(expected.word);
  await page.locator(`.library-list button[data-word-id="${expected.id}"]`).click();
  await page.locator('.word-card').waitFor();
  const observed = await page.locator('.word-card').evaluate(card => ({
    word: card.querySelector('.word-heading h2').textContent,
    phonetic: card.querySelector('.word-heading p').textContent,
    meaning: card.querySelector('.word-heading strong').textContent,
    example: card.querySelector('.example-box p').textContent,
    translation: card.querySelector('.example-box small').textContent,
  }));
  assert.equal(observed.word, expected.word);
  assert.equal(observed.example, expected.example);
  assert.equal(observed.translation, expected.translation);
  if (expected.phonetic) assert.equal(observed.phonetic, expected.phonetic);
  if (expected.meaning) assert.equal(observed.meaning, expected.meaning);
  assert.match(await page.locator('.scene-pill').innerText(), new RegExp(`#${expected.id}$`));
  return observed;
}
