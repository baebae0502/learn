// V/settle.ts — waits the @perf suites share: a timing starts only once what came before it has finished.
import type { ElectronApplication, Page } from '@playwright/test';
import { ipcCalls } from '../e2e/helpers';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Call counts once none has changed for `quietMs`: what an action started has finished. */
export async function settleCalls(app: ElectronApplication, quietMs = 300): Promise<Record<string, number>> {
  let last = JSON.stringify(await ipcCalls(app));
  let since = Date.now();
  while (Date.now() - since < quietMs) {
    await sleep(60);
    const now = JSON.stringify(await ipcCalls(app));
    if (now !== last) {
      last = now;
      since = Date.now();
    }
  }
  return JSON.parse(last) as Record<string, number>;
}
export const grew = (before: Record<string, number>, after: Record<string, number>, channel: string) => (after[channel] ?? 0) - (before[channel] ?? 0);

/** The search index is built at an idle moment after each list (useSearch): wait until no new build starts, so that long task lands in no timing. */
export async function settleIndex(page: Page, app: ElectronApplication): Promise<void> {
  let last = -1;
  for (let i = 0; i < 30; i++) {
    const n = await page.evaluate(() => performance.getEntriesByName('learn:search:index', 'measure').length);
    if (n > 0 && n === last) break;
    last = n;
    await sleep(700);
  }
  await settleCalls(app, 500);
}

/**
 * After a change that reads the list again (a restore, a purge): the index is built again at the next idle moment, and the
 * timeline keeps only the newest build (timed()). Waits for a build that began after `since` (the page's clock), at most
 * `timeoutMs` — a change the index does not follow builds nothing — then for the calls to stop.
 */
export async function settleIndexSince(page: Page, app: ElectronApplication, since: number, timeoutMs = 5000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const at = await page.evaluate(() => performance.getEntriesByName('learn:search:index', 'measure').at(-1)?.startTime ?? -1);
    if (at > since) break;
    await sleep(100);
  }
  await settleCalls(app, 300);
}
