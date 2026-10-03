// React publishes the next screen before passive persistence effects acquire
// their origin lock. Observe after effects and the same native FIFO lock have
// settled, retaining the exact disk assertions that follow this barrier.
export async function settleLearningStorage(page) {
  await page.evaluate(async () => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (navigator.locks) {
      const controller = new AbortController();
      const deadline = setTimeout(() => controller.abort(), 5_000);
      try {
        await navigator.locks.request('english-flow-learning-storage-v1', { signal: controller.signal }, () => undefined);
      } finally {
        clearTimeout(deadline);
      }
    }
  });
}
