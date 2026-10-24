// 사본 내보내기… (spec 7) and the busy toast of a slow first copy (spec 8). The save panel is stubbed in main
// (no native panel on CI); main's copies are held (helpers holdCopies) to make them slow.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type ElectronApplication } from '@playwright/test';
import {
  FIXTURES, holdCopies, holdSaveDialog, importPaths, launch, menuItemEnabled, openItem, releaseCopies, releaseSaveDialog, rowByTitle, runMenuCommand, saveDialogCalls,
  saveDialogLog, shellCalls, stubContextMenu, stubSaveDialog, stubShell,
} from './helpers';

const PDF = path.join(FIXTURES, 'sample.pdf');
const MPEG4 = path.join(FIXTURES, 'sample-mpeg4part2.mp4');
const REVEAL = process.platform === 'darwin' ? 'Finder에서 보기' : '폴더에서 보기';
const dirs = (i: { outputPath(...p: string[]): string }) => [i.outputPath('library'), i.outputPath('userdata')] as const;
/** A folder's entries, hidden ones (a temporary .part) included. */
const names = (dir: string) => (fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []);
/** A folder for the copies, made empty. */
const folder = (i: { outputPath(...p: string[]): string }, name: string) => {
  const dir = i.outputPath(name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

test.beforeAll(() => {
  for (const f of [PDF, MPEG4]) if (!fs.existsSync(f)) throw new Error(`fixture missing: ${f} — run \`pnpm fixtures\``);
});

test('사본 내보내기… from the 파일 menu, the item menu and the palette: the title-named default, a whole copy, 사본을 저장했습니다 with 폴더에서 보기', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    const [item] = await importPaths(page, [PDF]);
    await page.evaluate((itemId) => window.learn.library.updateMetadata({ itemId, title: '세포 신호: 개요' }), item!.id);
    const row = rowByTitle(page, '세포 신호: 개요');
    await expect(row).toBeVisible();
    const out = folder(testInfo, 'exports');
    const chosen = path.join(out, '내 사본.pdf');
    await stubSaveDialog(app, chosen);
    await stubShell(app);

    // The 파일 menu runs it on the selection: one row, its file there.
    await row.click();
    await runMenuCommand(app, 'item.exportCopy');
    const done = page.getByTestId('export-done');
    await expect(done).toContainText('사본을 저장했습니다');
    const downloads = await app.evaluate(({ app }) => app.getPath('downloads'));
    expect(await saveDialogLog(app)).toEqual([
      {
        parent: true, // a sheet on the main window
        title: '사본 내보내기',
        defaultPath: path.join(downloads, '세포 신호 개요.pdf'), // 기본 앱으로 열기's name for its copy (L/openable.ts)
        properties: expect.arrayContaining(['createDirectory', 'showOverwriteConfirmation']),
        extensions: ['pdf'],
      },
    ]);
    expect(fs.readFileSync(chosen)).toEqual(fs.readFileSync(PDF));
    expect(names(out)).toEqual(['내 사본.pdf']); // no temporary file beside it
    await expect(page.getByTestId('file-busy')).toHaveCount(0); // a quick copy says nothing

    // 폴더에서 보기 on the toast: main shows the copy it remembered (the page never sees the path); the toast goes.
    const reveal = done.getByTestId('export-reveal');
    await expect(reveal).toHaveText(REVEAL);
    await reveal.click();
    await expect.poll(() => shellCalls(app)).toEqual([['reveal', chosen]]);
    await expect(done).toHaveCount(0);

    // The item menu, next to 폴더에서 보기: the panel opens in the folder chosen last.
    await stubContextMenu(app, '사본 내보내기…');
    await row.click({ button: 'right' });
    await expect.poll(() => saveDialogCalls(app)).toBe(2);
    expect((await saveDialogLog(app))[1]!.defaultPath).toBe(path.join(out, '세포 신호 개요.pdf'));
    await expect(page.getByTestId('export-done')).toBeVisible();

    // The palette lists it for the one selected item.
    await runMenuCommand(app, 'app.palette');
    await page.getByTestId('palette-input').fill('내보내기');
    await expect(page.locator('[data-testid="palette-item"][data-command-id="item.exportCopy"]')).toBeVisible();
    await page.keyboard.press('Escape');

    // A cancelled panel writes nothing and says nothing.
    await stubSaveDialog(app, null);
    await runMenuCommand(app, 'item.exportCopy');
    await expect.poll(() => saveDialogCalls(app)).toBe(1);
    await page.waitForTimeout(300);
    expect(names(out)).toEqual(['내 사본.pdf']);
    await expect(page.getByTestId('export-failed')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('the save panel holds the window and never shows a busy toast; a copy still running 300 ms after it closed says 내보내는 중…', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await importPaths(page, [PDF]);
    const out = folder(testInfo, 'exports');
    const chosen = path.join(out, 'sample.pdf');
    await holdSaveDialog(app, chosen);
    await rowByTitle(page, 'sample').click();
    await runMenuCommand(app, 'item.exportCopy');
    // The panel is a sheet: the window is held as under 다시 연결…'s panel (no second panel from the menu bar) …
    await expect.poll(() => menuItemEnabled(app, 'item.exportCopy')).toBe(false);
    expect(await menuItemEnabled(app, 'file.importManaged')).toBe(false);
    // … and the time the user spends choosing is not work: no busy toast under it.
    await page.waitForTimeout(800);
    await expect(page.getByTestId('file-busy')).toHaveCount(0);

    await holdCopies(app);
    await releaseSaveDialog(app);
    const busy = page.getByTestId('file-busy');
    await expect(busy).toHaveAttribute('data-kind', 'busy');
    await expect(busy).toContainText('내보내는 중…');
    await expect(busy).toContainText('sample');
    await expect(busy.getByRole('button')).toHaveCount(0); // it goes with the work, not by a ×
    await expect.poll(() => menuItemEnabled(app, 'file.importManaged')).toBe(true); // the copy holds nothing
    expect(fs.existsSync(chosen)).toBe(false);
    await releaseCopies(app);
    await expect(busy).toHaveCount(0);
    await expect(page.getByTestId('export-done')).toBeVisible();
    expect(names(out)).toEqual(['sample.pdf']);
  } finally {
    await app.close();
  }
});

/** Renames onto `target` wait until releaseRename: the export's last step, after its copy is whole. */
const holdRename = (app: ElectronApplication, target: string) =>
  app.evaluate((_electron, to) => {
    const fsp = process.getBuiltinModule('node:fs/promises');
    const g = globalThis as { __learnReleaseRename?: () => void };
    const real = fsp.rename;
    const held = new Promise<void>((resolve) => (g.__learnReleaseRename = resolve));
    fsp.rename = (async (from: Parameters<typeof real>[0], dest: Parameters<typeof real>[1]) => {
      if (String(dest) === to) await held;
      return real(from, dest);
    }) as typeof real;
  }, target);
const releaseRename = (app: ElectronApplication) => app.evaluate(() => (globalThis as { __learnReleaseRename?: () => void }).__learnReleaseRename?.());

test('the chosen path never holds part of a file: a hidden temporary copy, then a rename; a copy that fails leaves nothing and says why', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await importPaths(page, [PDF]);
    const out = folder(testInfo, 'exports');
    const chosen = path.join(out, 'sample.pdf');
    await stubSaveDialog(app, chosen);
    await holdRename(app, chosen);
    await rowByTitle(page, 'sample').click();
    await runMenuCommand(app, 'item.exportCopy');
    // The copy is whole under its hidden temporary name beside the target; the chosen name is still free.
    await expect.poll(() => names(out)).toEqual([expect.stringMatching(/^\.sample\.pdf\.learn-export-[0-9a-f-]{36}\.part$/)]);
    expect(fs.statSync(path.join(out, names(out)[0]!)).size).toBe(fs.statSync(PDF).size);
    expect(fs.existsSync(chosen)).toBe(false);
    await releaseRename(app);
    await expect(page.getByTestId('export-done')).toBeVisible();
    expect(names(out)).toEqual(['sample.pdf']);

    // A disk that fills up during the copy: the half-written temporary file goes and the toast says why and what next.
    await app.evaluate(() => {
      const fsp = process.getBuiltinModule('node:fs/promises');
      const real = fsp.copyFile;
      fsp.copyFile = (async (from: Parameters<typeof real>[0], to: Parameters<typeof real>[1], mode?: number) => {
        await real(from, to, mode);
        if (!String(to).includes('.learn-export-')) return;
        await fsp.truncate(to, 10);
        throw Object.assign(new Error('no space left on device'), { code: 'ENOSPC' });
      }) as typeof real;
    });
    const full = folder(testInfo, 'full-disk');
    await stubSaveDialog(app, path.join(full, 'sample.pdf'));
    await runMenuCommand(app, 'item.exportCopy');
    const failed = page.getByTestId('export-failed');
    await expect(failed).toContainText('사본을 저장하지 못했습니다');
    await expect(failed).toContainText('디스크 공간이 부족합니다. 공간을 확보하거나 다른 폴더를 고르세요.');
    expect(names(full)).toEqual([]);
  } finally {
    await app.close();
  }
});

test('a first named copy past 300 ms says 여는 중… for 기본 앱으로 열기 without holding the window; the copy reused next time says nothing', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await importPaths(page, [MPEG4]);
    await stubShell(app);
    await openItem(page, 'sample-mpeg4part2'); // unplayable: the notice has 폴더에서 보기 and 기본 앱으로 열기 (design-spec 10.7)
    await expect(page.getByTestId('codec-open')).toBeVisible();
    await holdCopies(app);
    await page.getByTestId('codec-open').click();
    const busy = page.getByTestId('file-busy');
    await expect(busy).toContainText('여는 중…');
    await expect(busy).toContainText('sample-mpeg4part2');
    expect(await menuItemEnabled(app, 'nav.back')).toBe(true); // work in main, not a sheet: the window is not held
    await releaseCopies(app);
    await expect(busy).toHaveCount(0);
    await expect.poll(() => shellCalls(app)).toEqual([['open', expect.stringMatching(/[\\/]derived[\\/]open[\\/][0-9a-f-]{36}[\\/]sample-mpeg4part2\.mp4$/)]]);
    // The named copy is there now: 폴더에서 보기 reuses it at once, so nothing says busy.
    await page.getByTestId('codec-reveal').click();
    await expect.poll(async () => (await shellCalls(app)).length).toBe(2);
    await page.waitForTimeout(400);
    await expect(busy).toHaveCount(0);
  } finally {
    await app.close();
  }
});
