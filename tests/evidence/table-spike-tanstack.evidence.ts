// @perf — M4 Task 1 table spike, the fallback (branch m4-spike only, never merged): TanStack Virtual rows in a
// hand-made role="grid" (?window=spike&impl=tanstack), measured on the budgets the table alone decides — the same
// checks as table-spike.evidence.ts — into table-spike-tanstack.json. Report only.
import { test } from '@playwright/test';
import { launch, type Session } from '../e2e/helpers';
import { createReport, measureFilter, measureMount, measureRefresh, measureScroll, measureSort } from './spike-measure';

const TAG = { tag: '@perf' };
const QUERY = '&impl=tanstack';
const report = createReport('tanstack', 'table-spike-tanstack.json', 'M4 Task 1 table spike, fallback: TanStack Virtual, 10,000 rows (ADR-0004 M4 표)');

test.describe.configure({ mode: 'serial' });
let s: Session;
test.beforeAll(async ({}, testInfo) => {
  s = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
});
test.afterAll(async () => {
  report.save();
  await s?.app.close();
});

test('spike tanstack: 10,000 rows mount virtualized; list arrives → first row painted', TAG, async () => {
  test.setTimeout(120_000);
  await measureMount(s.page, report, QUERY, 'm4-spike-11-tanstack-rows');
});
test('spike tanstack: scroll frames (idle, 3 rows a frame, empty row slots, a jump)', TAG, async () => {
  test.setTimeout(120_000);
  await measureScroll(s.page, report, QUERY);
});
test('spike tanstack: header sort — order, aria-sort, header click → painted', TAG, async () => {
  test.setTimeout(120_000);
  await measureSort(s.page, report, QUERY, null);
});
test('spike tanstack: a refreshed list with one changed item re-renders that row only', TAG, async () => {
  test.setTimeout(60_000);
  await measureRefresh(s.page, report, QUERY);
});
test('spike tanstack: filtering rows (a search stand-in) → painted, 10 times each way', TAG, async () => {
  test.setTimeout(60_000);
  await measureFilter(s.page, report, QUERY);
  report.save();
});
