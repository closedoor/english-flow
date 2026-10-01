/** Navigate using the same visible controls as a learner; synthetic profiles only. */
export async function navigate(page, label) {
  const destination = label === '今天' ? '首页' : label;
  if (!await page.locator('.bottom-nav').isVisible()) {
    const pause = page.getByRole('button', { name: '退出学习并保留进度', exact: true });
    const lookup = page.getByRole('button', { name: '返回词库', exact: true });
    const quiz = page.getByRole('button', { name: '暂停考试并保留进度', exact: true });
    const completed = page.getByRole('button', { name: '回到首页', exact: true });
    if (await pause.isVisible()) await pause.click();
    else if (await lookup.isVisible()) await lookup.click();
    else if (await quiz.isVisible()) await quiz.click();
    else if (await completed.isVisible()) await completed.click();
    await page.locator('.bottom-nav').waitFor();
  }
  if (['复习', '生词本', '进度'].includes(destination)) {
    await page.locator('.bottom-nav button').filter({ hasText: '首页' }).click();
    const selector = destination === '复习' ? '.home-review-entry' : destination === '生词本' ? '.home-wordbook-entry' : '.home-settings-entry';
    await page.locator(selector).click();
    return;
  }
  await page.locator('.bottom-nav button').filter({ hasText: destination }).click();
}

export async function openLegacyPatterns(page) {
  await navigate(page, '进度');
  const details = page.locator('.legacy-practice');
  if (!await details.evaluate(element => element.open)) await details.locator('summary').click();
  await page.locator('.legacy-pattern-resume').click();
}

export async function openLegacyWords(page) {
  await navigate(page, '进度');
  const details = page.locator('.legacy-practice');
  if (!await details.evaluate(element => element.open)) await details.locator('summary').click();
  await page.locator('.legacy-word-resume').click();
}
