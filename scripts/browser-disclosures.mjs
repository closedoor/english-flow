// Use the same visible disclosure controls as a learner; never reveal hidden
// setup tools by changing DOM attributes from a test.
export async function openSetupDetails(page, selector) {
  const details = page.locator(selector);
  if (!await details.evaluate(element => element.open)) {
    await details.locator(':scope > summary').click();
    await page.waitForFunction(selector => document.querySelector(selector)?.open, selector);
  }
}

export async function selectSentenceMethod(page, label) {
  const method = page.locator('.practice-methods button').filter({ hasText: label });
  if (!await method.isVisible()) await openSetupDetails(page, '.sentence-range');
  await method.click();
}

export async function resumePausedSentence(page) {
  await openSetupDetails(page, '.sentence-range');
  await page.locator('.sentence-resume-action').click();
}

export async function sentenceChoices(page) {
  await openSetupDetails(page, '.sentence-range');
  return page.locator('.sentence-range button[aria-pressed="true"]').allTextContents();
}
