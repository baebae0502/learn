// @p1 — M6 on macOS (the Mac suite `p1`; Linux runs the file too, the macOS-only captures recorded as skipped).
//
// One shared session in serial mode, as organize.evidence.ts: no check stops the run, each is recorded in m6-p1.json
// (`checks`) as it is measured, and the last test asserts them all with expect.soft. Task 4: the import queue's progress
// toast and the duplicate sheet's box. Tasks 6–10 add their tests above the verdict and their measurements to `results`.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { FIXTURES, KEY_CODE, createCollection, distinctPdfs, expectWindow, holdJob, importFiles, importPause, importPaths, importResume, launch, mainWindow, menuSnapshot, nativeKeyCode, releaseJob, rowByTitle, runMenuCommand, tokenColor, waitImportIdle, closeSheet, type MenuNode, type Session } from '../e2e/helpers';
import { IS_MAC, allShots, focusApp, fullScreenShot, writeJson } from './capture';

const TAG = { tag: '@p1' };
const PDF = path.join(FIXTURES, 'sample.pdf');
const KO_PDF = path.join(FIXTURES, '한글 경로 (테스트) #1.pdf');
const MP4 = path.join(FIXTURES, 'sample-h264-aac.mp4');
const results: Record<string, unknown> = {};
const shotFailures: Array<{ name: string; kind: string; description: string; error: string }> = [];
results['shotFailures'] = shotFailures;
/** Every check's verdict and the value it was judged on, in the order measured. `ok: null`: could not be read. */
const checks: Record<string, { ok: boolean | null; value: unknown }> = {};
const tally = () => {
  const oks = Object.values(checks).map((c) => c.ok);
  return { total: oks.length, ok: oks.filter((o) => o === true).length, unread: oks.filter((o) => o === null).length, failed: oks.filter((o) => o === false).length };
};
const save = () => writeJson('m6-p1.json', { ...results, checks, tally: tally(), platform: `${process.platform}-${process.arch}`, at: new Date().toISOString() }, 'M6 P1 measurements');
function check(name: string, ok: boolean | null, value: unknown): void {
  checks[name] = { ok, value };
}
const errorText = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message.split('\n')[0]}` : String(e));
async function guard(name: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (e) {
    check(name, false, { error: errorText(e) });
  }
}
let s: Session;
let tmp = '';
const shots = async (page: Page, name: string, description: string): Promise<void> => {
  for (const e of await allShots(s.app, page, name, description)) if (e.file === null && e.error) shotFailures.push({ name, kind: e.kind, description: e.description, error: e.error });
};
/** A run's result closes by itself after 5 s: the next test's captures start without it. */
const resultGone = () => expect(s.page.getByTestId('import-done')).toHaveCount(0, { timeout: 10_000 });
const setTheme = async (theme: 'light' | 'dark') => {
  await s.page.evaluate((t) => window.learn.prefs.set({ theme: t }), theme);
  await expect(s.page.locator('html')).toHaveAttribute('data-theme', theme);
};
/** A file named `name`: `src`'s bytes and a line of its own, zero-extended to `bytes`. */
function sized(src: string, name: string, bytes: number): string {
  const dir = path.join(tmp, 'incoming');
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, name);
  fs.writeFileSync(out, Buffer.concat([fs.readFileSync(src), Buffer.from(`\n% ${name}\n`)]));
  fs.truncateSync(out, bytes);
  return out;
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-m6-p1-'));
  s = await launch(path.join(tmp, 'library'), path.join(tmp, 'userdata'), { colorScheme: null });
  await importPaths(s.page, [PDF, KO_PDF]);
});

test.afterAll(async () => {
  save();
  await s?.app.close().catch(() => {});
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

test('M6 import: the progress toast runs in place — one toast, a 4 px bar on --meter, at most 10 notices a second (light and dark)', TAG, async () => {
  await (await mainWindow(s.app)).evaluate((w) => {
    const g = globalThis as { __sentProgress?: number[] };
    g.__sentProgress = [];
    const send = w.webContents.send.bind(w.webContents);
    w.webContents.send = (channel: string, ...args: unknown[]) => {
      if (channel === 'evt:import-progress') g.__sentProgress!.push(performance.now());
      send(channel, ...args);
    };
  });
  await s.page.evaluate(() => {
    const w = window as unknown as { __toastNodes: number };
    w.__toastNodes = 0;
    new MutationObserver((records) => {
      for (const r of records) for (const n of r.addedNodes) if (n instanceof Element) w.__toastNodes += n.matches('.toast') ? 1 : n.querySelectorAll('.toast').length;
    }).observe(document.body, { childList: true, subtree: true });
  });
  await importPause(s.app, 'beforeCommit');
  await importFiles(s, [sized(MP4, '강의 08 · 효소 조절.mp4', 4_200_000), sized(PDF, '세포생물학 3장.pdf', 1_500_000), sized(PDF, '세포생물학 4장.pdf', 1_500_000)]);
  const toast = s.page.getByTestId('import-progress');
  await expect(toast.locator('.pct')).toHaveText('29%');
  await guard('progress toast: 360 wide, a 4 px bar with the --meter fill over --bg-track, the count in tabular figures', async () => {
    const v = await toast.evaluate((t) => {
      const bar = t.querySelector('.progress')!;
      return {
        width: Math.round(t.getBoundingClientRect().width),
        barHeight: bar.getBoundingClientRect().height,
        fill: getComputedStyle(bar.querySelector('i')!).backgroundColor,
        track: getComputedStyle(bar).backgroundColor,
        numeric: getComputedStyle(t.querySelector('.t-count')!).fontVariantNumeric,
        file: t.querySelector('.t-file')?.textContent ?? null,
      };
    });
    const meter = await tokenColor(s.page, '--meter');
    const track = await tokenColor(s.page, '--bg-track');
    results['progressToast'] = { ...v, meter, track };
    check('progress toast: 360 wide, a 4 px bar with the --meter fill over --bg-track, the count in tabular figures', v.width === 360 && v.barHeight === 4 && v.fill === meter && v.track === track && v.numeric.includes('tabular-nums') && v.file === '강의 08 · 효소 조절.mp4', results['progressToast']);
  });
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(theme);
    if (IS_MAC) await focusApp(s.app);
    await shots(s.page, `m6-01-import-running-${theme}`, `the progress toast at 29%: 가져오는 중 · 0 / 3 (${theme})`);
  }
  await setTheme('light');
  await importResume(s.app);
  await expect(s.page.getByTestId('import-done')).toHaveText('자료 3개를 가져왔습니다');
  await guard('one toast from the first progress to the result (P-3: never closed and shown again)', async () => {
    const nodes = await s.page.evaluate(() => (window as unknown as { __toastNodes: number }).__toastNodes);
    check('one toast from the first progress to the result (P-3: never closed and shown again)', nodes === 1, { nodes });
  });
  await guard('progress notices: at most 10 in any second, as main sends them (spec 3.3, 14)', async () => {
    const sent = await s.app.evaluate(() => (globalThis as { __sentProgress?: number[] }).__sentProgress ?? []);
    const busiest = sent.length === 0 ? 0 : Math.max(...sent.map((t) => sent.filter((x) => x >= t && x < t + 1000).length));
    results['progressNotices'] = { sent: sent.length, busiest };
    check('progress notices: at most 10 in any second, as main sends them (spec 3.3, 14)', sent.length > 0 && busiest <= 10, results['progressNotices']);
  });
  await waitImportIdle(s.page);
  await resultGone();
  save();
});

test('M6 import: duplicates asked at the end — the sheet\'s box for the rest, the toast waiting under it (macOS: the real sheet)', TAG, async () => {
  const twice = ['molbio_ch06_signaling.pdf', 'molbio_ch07_receptors.pdf', 'molbio_ch08_kinases.pdf'].map((n) => sized(PDF, n, 1_000_000));
  await importPaths(s.page, twice);
  const sheet = await expectWindow(s.app, 'sheet', () => importFiles(s, twice));
  await guard('duplicate sheet: the box "남은 중복 파일 2개에도 같은 선택 적용" opens ticked; ↩ stays on 건너뛰기', async () => {
    const box = sheet.getByRole('checkbox');
    // RAC's Checkbox is a <label class="checkbox"> around a visually hidden input: the label's text is the name.
    const v = { label: (await sheet.locator('label.checkbox').textContent())?.trim() ?? null, checked: await box.isChecked(), focused: await sheet.getByTestId('dup-skip').evaluate((e) => e === document.activeElement) };
    results['duplicateBox'] = v;
    check('duplicate sheet: the box "남은 중복 파일 2개에도 같은 선택 적용" opens ticked; ↩ stays on 건너뛰기', v.label === '남은 중복 파일 2개에도 같은 선택 적용' && v.checked && v.focused, v);
  });
  await expect(s.page.getByTestId('import-progress')).toHaveAttribute('data-state', 'waiting-choice');
  await s.page.waitForTimeout(600);
  await fullScreenShot('m6-02-duplicate-rest', 'the duplicate sheet with its box, the toast 확인을 기다리는 중 under it');
  await shots(s.page, 'm6-02-import-waiting-choice', 'the toast under the duplicate question: 확인을 기다리는 중 · 0 / 3');
  await closeSheet(sheet, 'Escape');
  await waitImportIdle(s.page);
  await resultGone();
  save();
});

test('M6 import: waiting behind the work before it, then 취소 — the result in its place', TAG, async () => {
  await holdJob(s.app, 'backup');
  await importFiles(s, [sized(PDF, 'molbio_ch10_mitosis.pdf', 1_000_000), sized(PDF, 'molbio_ch11_meiosis.pdf', 1_000_000)]);
  const toast = s.page.getByTestId('import-progress');
  await expect(toast).toHaveAttribute('data-state', 'waiting-job');
  await shots(s.page, 'm6-03-import-waiting-job', 'the toast behind another job: 앞의 작업을 기다리는 중 · 2개');
  await toast.getByTestId('import-cancel').click();
  await expect(s.page.getByTestId('import-done')).toContainText('가져오기를 취소했습니다');
  await guard('취소 while waiting: "가져오기를 취소했습니다", an info toast in the progress toast\'s place', async () => {
    const kind = await s.page.getByTestId('import-done').getAttribute('data-kind');
    check('취소 while waiting: "가져오기를 취소했습니다", an info toast in the progress toast\'s place', kind === 'info', { kind });
  });
  await shots(s.page, 'm6-04-import-cancelled', 'the result after 취소: 가져오기를 취소했습니다 · 파일 2개를 가져오지 않았습니다.');
  await releaseJob(s.app);
  await waitImportIdle(s.page);
  save();
});

test('M6 trash: ⌘⌫ (a real key on macOS) moves the selection with 실행 취소; typed in the quick search it is the field\'s', TAG, async () => {
  const [a, b] = await importPaths(s.page, distinctPdfs(path.join(tmp, 'trash'), 2));
  await s.page.getByTestId('nav-scope-all').click();
  await rowByTitle(s.page, a!.title).click();
  if (!IS_MAC) {
    // Linux: the menu item, so the next test has a trash; the real keys are macOS's.
    await runMenuCommand(s.app, 'item.trash');
    check('⌘⌫ (a real key): the selected row goes to the trash, with 실행 취소', null, 'macOS only');
    check('⌘⌫ typed in the quick search deletes its text and moves nothing (Q-6e)', null, 'macOS only');
    save();
    return;
  }
  await guard('⌘⌫ (a real key): the selected row goes to the trash, with 실행 취소', async () => {
    await nativeKeyCode(s.app, KEY_CODE.delete, ['command']);
    const toast = s.page.getByTestId('trash-undo');
    await expect(toast).toBeVisible();
    const v = { toast: await toast.textContent(), gone: (await rowByTitle(s.page, a!.title).count()) === 0 };
    results['trashKey'] = v;
    check('⌘⌫ (a real key): the selected row goes to the trash, with 실행 취소', v.gone && (v.toast ?? '').includes('휴지통으로 옮겼습니다'), v);
  });
  await guard('⌘⌫ typed in the quick search deletes its text and moves nothing (Q-6e)', async () => {
    await rowByTitle(s.page, b!.title).click();
    const field = s.page.getByTestId('search-field').getByRole('searchbox');
    await field.fill('distinct');
    await nativeKeyCode(s.app, KEY_CODE.delete, ['command']);
    await s.page.waitForTimeout(500);
    const live = await s.page.evaluate(async () => {
      const r = await window.learn.library.list();
      return r.ok ? r.data.map((i) => i.id) : [];
    });
    // `value` says whether AppKit gave the key to the field before the menu (empty) or the menu took it (the guard kept the items).
    const v = { value: await field.inputValue(), kept: live.includes(b!.id) };
    results['trashKeyInField'] = v;
    check('⌘⌫ typed in the quick search deletes its text and moves nothing (Q-6e)', v.kept && v.value === '', v);
    await field.fill('');
  });
  save();
});

test('M6 trash: the trash view and its read-only panel, ⌘⌫ named 영구 삭제… there, and the purge sheet (macOS: the real sheet) — light and dark', TAG, async () => {
  // C-4c: one trashed collection row in the table, and the item panel open (the 1024 px Mac window folds it by default).
  const conf = await createCollection(s.page, '학회 준비');
  await s.page.evaluate((id) => window.learn.collections.remove({ collectionId: id }), conf);
  await s.page.getByTestId('nav-scope-trash').click();
  await expect(s.page.getByTestId('toolbar-title')).toHaveText('휴지통');
  await expect(s.page.getByTestId('trash-collection-row')).toHaveCount(1);
  await s.page.locator('[data-testid="item-row"]').first().click();
  await expect(s.page.getByTestId('inspector-restore')).toBeVisible();
  if ((await s.page.getByTestId('shell').getAttribute('data-inspector')) !== 'shown') await runMenuCommand(s.app, 'view.toggleInspector');
  await expect(s.page.getByTestId('shell')).toHaveAttribute('data-inspector', 'shown');
  await guard('파일 › ⌘⌫ reads 영구 삭제… in the trash view (P-11)', async () => {
    const flat = (nodes: MenuNode[]): MenuNode[] => nodes.flatMap((n) => [n, ...flat(n.submenu ?? [])]);
    const label = async () => flat(await menuSnapshot(s.app)).find((n) => n.id === 'item.trash')?.label ?? null;
    await expect.poll(label).toBe('영구 삭제…');
    check('파일 › ⌘⌫ reads 영구 삭제… in the trash view (P-11)', true, { label: await label() });
  });
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(theme);
    if (IS_MAC) await focusApp(s.app);
    await shots(s.page, `m6-10-trash-view-${theme}`, `the trash view, a row's read-only panel (${theme})`);
    // The same view with the panel closed: the table has the whole width, and its columns must fit without a sideways scroll (T6 re-check §1).
    await runMenuCommand(s.app, 'view.toggleInspector');
    await expect(s.page.getByTestId('shell')).toHaveAttribute('data-inspector', 'hidden');
    const fit = await s.page.getByTestId('library-scroller').evaluate((e) => ({ scrollWidth: e.scrollWidth, clientWidth: e.clientWidth }));
    results[`trashTableFit-${theme}`] = fit;
    check(`trash table (${theme}): no sideways scroll with the panel closed`, fit.scrollWidth <= fit.clientWidth, fit);
    // T7 C-1: the date cell shows its whole value; the real values here are "오늘 …", so also the longest ones are put in.
    const cellFit = await s.page.locator('[data-testid="item-row"] [data-col="deletedAt"] .ellipsis').first().evaluate((e) => {
      const was = e.textContent;
      const fitOf = (text: string) => {
        e.textContent = text;
        return { text, scrollWidth: e.scrollWidth, clientWidth: e.clientWidth };
      };
      const all = [fitOf(was ?? ''), fitOf('오늘 오후 12:59'), fitOf('2026. 12. 31.')];
      e.textContent = was;
      return all;
    });
    results[`trashDateFit-${theme}`] = cellFit;
    check(`trash table (${theme}): 삭제한 날짜 cells do not clip, the longest values included`, cellFit.every((f) => f.scrollWidth <= f.clientWidth), cellFit);
    await shots(s.page, `m6-10b-trash-table-${theme}`, `the trash view with the item panel closed (${theme})`);
    await runMenuCommand(s.app, 'view.toggleInspector');
    await expect(s.page.getByTestId('shell')).toHaveAttribute('data-inspector', 'shown');
    const sheet = await expectWindow(s.app, 'sheet', () => runMenuCommand(s.app, 'item.trash'));
    await guard(`purge sheet (${theme}): 취소 has the focus, the danger verb on its left`, async () => {
      const [danger, cancel] = await Promise.all([sheet.getByTestId('purge-confirm').boundingBox(), sheet.getByTestId('purge-cancel').boundingBox()]);
      const v = { focused: await sheet.getByTestId('purge-cancel').evaluate((e) => e === document.activeElement), dangerLeft: (danger?.x ?? 0) < (cancel?.x ?? 0), title: await sheet.getByTestId('purge-title').textContent() };
      results[`purgeSheet-${theme}`] = v;
      check(`purge sheet (${theme}): 취소 has the focus, the danger verb on its left`, v.focused && v.dangerLeft, v);
    });
    await s.page.waitForTimeout(600);
    if (IS_MAC) await fullScreenShot(`m6-11-purge-sheet-${theme}`, `the purge sheet over the trash view (${theme})`);
    await closeSheet(sheet, 'Escape');
  }
  await setTheme('light');
  save();
});

test('M6 duplicates and edited copies: 남김 in secondary text (white on the focused selected row), the group line, 중복 N묶음 모두 정리, the edited copy card (light and dark)', TAG, async () => {
  const kinase = sized(PDF, 'Kinase Cascades A Primer.pdf', 900_000);
  const molbio = sized(PDF, '분자생물학 6장 · 신호 전달.pdf', 1_100_000);
  const [k1] = await importPaths(s.page, [kinase]);
  const [m1] = await importPaths(s.page, [molbio]);
  await importPaths(s.page, [kinase], { allowDuplicate: true });
  await importPaths(s.page, [kinase], { allowDuplicate: true });
  await importPaths(s.page, [molbio], { allowDuplicate: true });
  const row = (id: string) => s.page.locator(`[data-testid="item-row"][data-item-id="${id}"]`);
  await s.page.getByTestId('nav-scope-duplicates').click();
  await expect(row(m1!.id)).toBeVisible();
  if (IS_MAC) await focusApp(s.app);
  await row(m1!.id).click();
  const name = 'duplicates: 남김 --text-secondary on a plain row and --text-on-accent on the focused selected one; the group line --separator; the button names the groups';
  await guard(name, async () => {
    const v = await s.page.evaluate(([kept, plain]) => {
      const mark = (id: string) => document.querySelector(`[data-testid="item-row"][data-item-id="${id}"] [data-testid="kept-mark"]`);
      const line = document.querySelector('[data-testid="item-row"][data-group-start]');
      return {
        inactive: document.documentElement.hasAttribute('data-window-inactive'),
        selectedKept: mark(kept) ? getComputedStyle(mark(kept)!).color : null,
        plainKept: mark(plain) ? getComputedStyle(mark(plain)!).color : null,
        line: line ? getComputedStyle(line, '::before').backgroundColor : null,
        button: document.querySelector('[data-testid="keep-all-duplicates"]')?.textContent ?? null,
      };
    }, [m1!.id, k1!.id] as const);
    const [secondary, onAccent, separator] = await Promise.all(['--text-secondary', '--text-on-accent', '--separator'].map((token) => tokenColor(s.page, token)));
    results['duplicatesView'] = { ...v, secondary, onAccent, separator };
    check(name, v.inactive ? null : v.selectedKept === onAccent && v.plainKept === secondary && v.line === separator && /^중복 \d+묶음 모두 정리$/.test(v.button ?? ''), results['duplicatesView']);
  });
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(theme);
    if (IS_MAC) await focusApp(s.app);
    await row(m1!.id).click();
    await shots(s.page, `m6-10-duplicates-${theme}`, `중복 항목: 남김, the line between the groups, 중복 N묶음 모두 정리 (${theme})`);
  }
  await setTheme('light');

  // An edited copy kept aside under its name and time, read when the panel shows the item again.
  const folder = path.join(tmp, 'library', 'derived', 'open', m1!.assetId);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, '분자생물학 6장 · 신호 전달 (수정본 2026-10-30 1412).pdf'), Buffer.concat([fs.readFileSync(molbio), Buffer.from('% edited in another app\n')]));
  await row(k1!.id).click();
  await row(m1!.id).click();
  const card = s.page.getByTestId('edited-copies');
  await expect(card).toBeVisible();
  const cardCheck = 'edited copy card: the line with the count, 새 자료로 가져오기 and the platform name of Finder에서 보기';
  await guard(cardCheck, async () => {
    const v = { head: await card.getByTestId('edited-copies-head').textContent(), buttons: await card.locator('button').allTextContents() };
    check(cardCheck, v.head === '다른 앱에서 고친 수정본 1개' && v.buttons.join('|') === `새 자료로 가져오기|${IS_MAC ? 'Finder에서 보기' : '폴더에서 보기'}`, v);
  });
  await card.scrollIntoViewIfNeeded();
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(theme);
    if (IS_MAC) await focusApp(s.app);
    await shots(s.page, `m6-11-edited-copy-${theme}`, `the item panel's 다른 앱에서 고친 수정본 card (${theme})`);
  }
  await setTheme('light');
  // No duplicates left for the tests after this one.
  await s.page.evaluate(() => window.learn.library.keepOneOfAllDuplicates());
  await s.page.getByTestId('nav-scope-all').click();
  save();
});

test('M6 P1: verdict of every check above (m6-p1.json checks)', TAG, async () => {
  save();
  for (const [name, c] of Object.entries(checks)) expect.soft(c.ok, `${name}: ${JSON.stringify(c.value)}`).not.toBe(false);
});
