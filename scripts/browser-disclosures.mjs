// Use the same visible disclosure controls as a learner; never reveal hidden
// setup tools by changing DOM attributes from a test.
export async function openSetupDetails(page, selector) {
  const details = page.locator(selector);
  if (!await details.evaluate(element => element.open)) {
    await details.locator(':scope > summary').click();
    await page.waitForFunction(selector => document.querySelector(selector)?.open, selector);
  }
}
