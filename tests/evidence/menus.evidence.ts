// @evidence — M5 Task 4: the native menu bar's 보기 › 정렬 기준 ▸ open on macOS (the Mac suite `evidence`); Linux runs the
// launch and the JSON checks and records the captures as skipped.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { FIXTURES, importPaths, launch, menuItemEnabled, menuSnapshot, runMenuCommand, type Session } from '../e2e/helpers';
import { IS_MAC, captureOpenSubmenu, menuItemNames, writeJson } from './capture';

const TAG = { tag: '@evidence' };
const PDF = path.join(FIXTURES, 'sample.pdf');
const results: Record<string, unknown> = {};

test.describe.configure({ mode: 'serial' });
let s: Session;
let tmp = '';

test.beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-m5-menus-'));
  s = await launch(path.join(tmp, 'library'), path.join(tmp, 'userdata'), { colorScheme: null });
  const files = ['a', 'b', 'c'].map((name) => {
    const file = path.join(tmp, `${name}.pdf`);
    fs.writeFileSync(file, Buffer.concat([fs.readFileSync(PDF), Buffer.from(`\n% ${name}\n`)]));
    return file;
  });
  await importPaths(s.page, files);
  await expect(s.page.getByTestId('item-row')).toHaveCount(3);
});

test.afterAll(async () => {
  writeJson('m5-menus.json', { ...results, platform: `${process.platform}-${process.arch}`, at: new Date().toISOString() }, 'M5 menu measurements');
  await s?.app.close().catch(() => {});
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

/** The sort submenu's rows as the menu bar's JSON has them: on rows by name. */
const marked = async () => {
  const flat = (nodes: Awaited<ReturnType<typeof menuSnapshot>>): typeof nodes => nodes.flatMap((n) => [n, ...flat(n.submenu ?? [])]);
  const head = flat(await menuSnapshot(s.app)).find((n) => n.id === 'library.sortBy');
  return (head?.submenu ?? []).filter((n) => n.checked).map((n) => n.label);
};

test('M5 menus: 보기 › 정렬 기준 ▸ open — the sort in force on, then the direction changed from the menu', TAG, async () => {
  await expect.poll(() => menuItemEnabled(s.app, 'library.sortBy')).toBe(true);
  expect(await marked()).toEqual(['추가일', '내림차순']);
  if (!IS_MAC) {
    results['skipped'] = 'native menu captures are macOS only';
    return;
  }
  const pid = s.app.process().pid!;
  const names = (await menuItemNames(pid, 5)) ?? [];
  const at = names.indexOf('정렬 기준');
  expect(at, `정렬 기준 is in 보기: ${JSON.stringify(names)}`).toBeGreaterThan(0);
  const reachable = names.slice(0, at).filter((n) => n !== '-').length;
  // Whether the first ↓ only opens the menu or also lands on its first row depends on the system: try both counts.
  const open = async (prefix: string, what: string) => {
    for (const rowsDown of [reachable - 1, reachable]) {
      const captured = await captureOpenSubmenu(s.app, pid, 5, '정렬 기준', rowsDown, prefix, what);
      if (captured.rows !== null) return captured;
    }
    return captureOpenSubmenu(s.app, pid, 5, '정렬 기준', reachable - 1, prefix, what);
  };
  const on = (rows: Array<{ name: string; mark: string }> | null) => (rows ?? []).filter((r) => r.mark !== '').map((r) => r.name);

  const first = await open('m5-04-menu-view-sort', '보기 › 정렬 기준 ▸ open: 추가일 and 내림차순 on');
  results['first'] = first;
  expect.soft((first.rows ?? []).map((r) => r.name), 'the rows').toEqual(['제목', '저자', '연도', '종류', '추가일', '-', '오름차순', '내림차순']);
  expect.soft(on(first.rows), 'the marks').toEqual(['추가일', '내림차순']);

  await runMenuCommand(s.app, 'library.sortBy', { direction: 'asc' });
  await expect.poll(marked).toEqual(['추가일', '오름차순']);
  const second = await open('m5-04b-menu-view-sort-asc', '보기 › 정렬 기준 ▸ open after 오름차순: 추가일 and 오름차순 on');
  results['second'] = second;
  expect.soft(on(second.rows), 'the marks after the change').toEqual(['추가일', '오름차순']);
});
