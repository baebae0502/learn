// @p1 — M6 on macOS (the Mac suite `p1`; Linux runs the file too, the macOS-only captures recorded as skipped).
//
// One shared session in serial mode, as organize.evidence.ts: no check stops the run, each is recorded in m6-p1.json
// (`checks`) as it is measured, and the last test asserts them all with expect.soft. Task 4: the import queue's progress
// toast and the duplicate sheet's box. Tasks 6–10 add their tests above the verdict and their measurements to `results`.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { FIXTURES, expectWindow, holdJob, importFiles, importPause, importPaths, importResume, launch, mainWindow, releaseJob, tokenColor, waitImportIdle, closeSheet, type Session } from '../e2e/helpers';
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
  await expect(toast.locator('.pct')).toHaveText('58%');
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
    await shots(s.page, `m6-01-import-running-${theme}`, `the progress toast at 58%: 가져오는 중 · 0 / 3 (${theme})`);
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
  await shots(s.page, 'm6-03-import-waiting-job', 'the toast behind another job: 앞의 작업을 기다리는 중 · 0 / 2');
  await toast.getByTestId('import-cancel').click();
  await expect(s.page.getByTestId('import-done')).toHaveText('2개 중 0개를 가져왔습니다');
  await guard('취소 while waiting: "2개 중 0개를 가져왔습니다", an info toast in the progress toast\'s place', async () => {
    const kind = await s.page.getByTestId('import-done').getAttribute('data-kind');
    check('취소 while waiting: "2개 중 0개를 가져왔습니다", an info toast in the progress toast\'s place', kind === 'info', { kind });
  });
  await shots(s.page, 'm6-04-import-cancelled', 'the result after 취소: 2개 중 0개를 가져왔습니다');
  await releaseJob(s.app);
  await waitImportIdle(s.page);
  save();
});

test('M6 P1: verdict of every check above (m6-p1.json checks)', TAG, async () => {
  save();
  for (const [name, c] of Object.entries(checks)) expect.soft(c.ok, `${name}: ${JSON.stringify(c.value)}`).not.toBe(false);
});
