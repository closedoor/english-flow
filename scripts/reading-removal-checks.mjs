import assert from 'node:assert/strict';
import { navigate } from './browser-navigation.mjs';

export function legacyReadingRecords() {
  return {
    'wordflow-reading-completed-v1': ['r1', 'r3'],
    'wordflow-reading-last-v1': { id: 'r2', updatedAt: Date.now() - 86_400_000 },
    'wordflow-reading-answers-v1': { r1: 0, r2: 2 },
  };
}

// Fresh test profiles only. Removing a module must not erase its saved records.
export async function verifyReadingRemoval(page, records) {
  const labels = ['首页', '单词', '句子'];
  await navigate(page, '首页');
  await page.locator('.home-dashboard').waitFor();
  assert.deepEqual(await page.locator('.bottom-nav button small').allTextContents(), labels);
  assert.equal(await page.locator('.dashboard-progress-row').count(), 2);
  assert.equal(await page.locator('.home-reading-progress,.reading-page').count(), 0);
  const geometry = await page.locator('.bottom-nav').evaluate(nav => {
    const r = nav.getBoundingClientRect();
    return { right: r.right, buttons: [...nav.querySelectorAll('button')].map(button => {
      const b = button.getBoundingClientRect();
      const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
      return { x: b.x, y: b.y, width: b.width, height: b.height, right: b.right,
        tappable: (button === hit || button.contains(hit)) && b.y >= 0 && b.bottom <= innerHeight + 1 };
    }) };
  });
  assert.ok(geometry.right - geometry.buttons.at(-1).right <= 16, 'No empty fourth navigation column');
  for (const [index, label] of labels.entries()) {
    const b = geometry.buttons[index];
    assert.ok(b.width >= 44 && b.height >= 44 && b.tappable, 'Navigation is directly tappable');
    await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
    await page.waitForFunction(({ label, title }) =>
      document.querySelector('.bottom-nav button[aria-current="page"] small')?.textContent === label
      && document.querySelector('.page h1')?.textContent === title,
    { label, title: label === '首页' ? '本周节奏' : label });
    assert.equal(await page.locator('.bottom-nav button[aria-current="page"] small').innerText(), label);
    assert.equal(await page.locator('.reading-page').count(), 0);
  }
  const saved = await page.evaluate(keys => Object.fromEntries(keys.map(key => [key, JSON.parse(localStorage.getItem(key))])), Object.keys(records));
  assert.deepEqual(saved, records, 'Legacy reading records survive normal navigation');
  await navigate(page, '首页');
  await page.locator('.home-dashboard').waitFor();
  assert.equal(await page.locator('.home-reading-progress').count(), 0);
  return { threeMainTabs: true, readingEntryRemoved: true, noEmptyNavigationColumn: true, legacyReadingRecordsPreserved: true };
}
