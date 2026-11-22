import assert from 'node:assert/strict';
import { openSetupDetails } from './browser-disclosures.mjs';

export async function verifyPunctuationPrompt(page) {
  await openSetupDetails(page, '.sentence-find');
  const search = page.getByRole('searchbox', { name: '搜索长短句' });
  const hint = page.locator('.sentence-browser [role="status"]').filter({ hasText: '请输入中文、英文或数字' });
  for (const query of ['？', '。…']) {
    await search.fill(query);
    await hint.waitFor();
    assert.equal(await page.locator('.sentence-result-list').count(), 0);
    assert.equal(await page.locator('.sentence-load-error').count(), 0);
    assert.equal(await page.locator('.sentence-browser .row-heading small').innerText(), '支持中英文');
  }
  await search.fill('');
  await hint.waitFor({ state: 'detached' });
  return search;
}
