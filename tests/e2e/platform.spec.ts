import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { COMMANDS, type MenuName } from '../../packages/domain/src/commands';
import { Channels } from '../../packages/domain/src/ipc-channels';
import {
  FIXTURES, NativeInputNotPermitted, importPaths, launch, menuSnapshot, nativeKeystroke, openDialogCalls, openItem, recordedPopups,
  runMenuCommand, stubContextMenu, stubOpenDialog, type MenuNode, type NativeKeystroke,
} from './helpers';

const PDF = path.join(FIXTURES, 'sample.pdf');
const IS_MAC = process.platform === 'darwin';

test.beforeAll(() => {
  if (!fs.existsSync(PDF)) throw new Error(`fixture missing: ${PDF} — run \`pnpm fixtures\``);
});

const TOP_LABELS: Record<MenuName, string> = { file: '파일', edit: '편집', view: '보기', go: '이동', window: '윈도우' };
const HANGUL = /[가-힣]/;

const flatten = (nodes: readonly MenuNode[]): MenuNode[] => nodes.flatMap((n) => [n, ...flatten(n.submenu ?? [])]);
/** Runtime roles are lower-case (`selectall`); compare case-insensitively. */
const roleOf = (n: MenuNode): string | null => n.role?.toLowerCase() ?? null;
const topMenu = (menu: readonly MenuNode[], label: string): MenuNode[] => {
  const top = menu.find((m) => m.label === label);
  if (!top?.submenu) throw new Error(`no top-level menu ${label}`);
  return top.submenu;
};
/** Submenu entries as [role, label]; a separator is ['-', '']. */
const entries = (items: readonly MenuNode[]) => items.map((n) => [n.type === 'separator' ? '-' : roleOf(n), n.label]);

async function session(testInfo: { outputPath(...p: string[]): string }) {
  return launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
}

async function importOnePdf(page: Page): Promise<string> {
  const [item] = await importPaths(page, [PDF]);
  await expect(page.getByTestId('item-row')).toHaveCount(1); // the list follows libraryChanged
  return item!.id;
}

test('menu: Korean top-level menus built from the registry, no reload or developer tools', async ({}, testInfo) => {
  const { app } = await session(testInfo);
  try {
    const menu = await menuSnapshot(app);
    expect(menu.map((m) => m.label)).toEqual([...(IS_MAC ? ['Learn'] : []), '파일', '편집', '보기', '이동', '윈도우']);

    const all = flatten(menu);
    // Every visible label is Korean; the only exception is the macOS app menu, which carries the app's name.
    for (const n of all) {
      if (n.type === 'separator' || (IS_MAC && n === menu[0])) continue;
      expect(n.label, `menu label ${JSON.stringify(n.label)}`).toMatch(HANGUL);
    }
    const roles = all.map(roleOf);
    for (const banned of ['reload', 'forcereload', 'toggledevtools']) expect(roles).not.toContain(banned);
    expect(all.map((n) => n.label)).not.toContain('개발자 도구');

    // Registry-driven: each placed command appears exactly once, in its menu, with its id, label and accelerator.
    for (const c of COMMANDS) {
      const hits = all.filter((n) => n.id === c.id);
      if (!c.menu) {
        expect(hits, `${c.id} is context-menu only`).toHaveLength(0);
        continue;
      }
      expect(hits, c.id).toHaveLength(1);
      expect(flatten(topMenu(menu, TOP_LABELS[c.menu.menu])).filter((n) => n.id === c.id)).toEqual([
        expect.objectContaining({ label: c.label, accelerator: c.accelerator ?? null, enabled: true }),
      ]);
    }
    expect(entries(topMenu(menu, '파일'))).toEqual([[null, '자료 가져오기…'], [null, '외부 파일 연결…'], ['-', ''], ['close', '창 닫기']]);
    expect(topMenu(menu, '파일')[0]).toMatchObject({ id: 'file.importManaged', accelerator: 'CmdOrCtrl+O' });
    expect(entries(topMenu(menu, '보기'))).toEqual([['togglefullscreen', '전체 화면']]);
    expect(entries(topMenu(menu, '이동'))).toEqual([[null, '라이브러리로 돌아가기']]);
    expect(entries(topMenu(menu, '윈도우'))).toEqual(
      IS_MAC
        ? [['minimize', '최소화'], ['zoom', '확대/축소'], ['-', ''], ['front', '모두 앞으로 가져오기']]
        : [['minimize', '최소화']],
    );
  } finally {
    await app.close();
  }
});

// Control for the test above: the "no 개발자 도구" result comes from LEARN_E2E=1, not from a menu that never has it.
test('menu: an unpackaged run without LEARN_E2E=1 does show 개발자 도구', async ({}, testInfo) => {
  const { app } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'), { env: { LEARN_E2E: '' } });
  try {
    const view = topMenu(await menuSnapshot(app), '보기');
    expect(entries(view)).toEqual([['togglefullscreen', '전체 화면'], ['-', ''], ['toggledevtools', '개발자 도구']]);
  } finally {
    await app.close();
  }
});

test('menu command 자료 가져오기… opens the (stubbed) dialog once and adds the item', async ({}, testInfo) => {
  const { app, page } = await session(testInfo);
  try {
    await expect(page.getByTestId('empty-state')).toBeVisible();
    await stubOpenDialog(app, [PDF]);
    await runMenuCommand(app, 'file.importManaged');
    await expect(page.getByTestId('item-row')).toHaveCount(1);
    await expect(page.locator('[data-testid="open-item"][data-title="sample"]')).toBeVisible();
    expect(await openDialogCalls(app)).toBe(1);
  } finally {
    await app.close();
  }
});

// A real OS-level ⌘O (System Events keystroke): Playwright's CDP keys never reach NSMenu key equivalents.
test('⌘O (자료 가져오기…) opens the dialog exactly once', async ({}, testInfo) => {
  test.skip(
    !IS_MAC,
    'Linux/xvfb: CDP-synthesized keys never reach native menu accelerators (Task 4: 0 dialog calls) and there is no ' +
      'OS-level keystroke here. The menu click path is covered by the runMenuCommand test; this runs on the macOS lane.',
  );
  const { app, page } = await session(testInfo);
  try {
    await stubOpenDialog(app, [PDF]);
    let sent: NativeKeystroke;
    try {
      sent = await nativeKeystroke(app, 'o', ['command']);
    } catch (e) {
      if (!(e instanceof NativeInputNotPermitted)) throw e;
      testInfo.annotations.push({ type: 'osascript', description: `not permitted: ${e.message}` });
      test.skip(true, `OS-level keystrokes not permitted: ${e.message}`);
      throw e; // unreachable: test.skip throws
    }
    testInfo.annotations.push(
      { type: 'frontmost', description: `${sent.frontmost.name} (pid ${sent.frontmost.pid})` },
      { type: 'osascript', description: JSON.stringify({ script: sent.script, output: sent.output }) },
    );
    console.log('[measure] native ⌘O', JSON.stringify(sent));
    await expect(page.getByTestId('item-row')).toHaveCount(1);
    expect(await openDialogCalls(app)).toBe(1);
    // A second dispatch (e.g. a renderer key handler on top of the accelerator) would land right behind the first.
    await page.waitForTimeout(500);
    expect(await openDialogCalls(app)).toBe(1);
    await expect(page.getByTestId('item-row')).toHaveCount(1);
    await expect(page.getByTestId('duplicate-dialog')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('menu command 라이브러리로 돌아가기 returns from the PDF viewer to the library', async ({}, testInfo) => {
  const { app, page } = await session(testInfo);
  try {
    await importOnePdf(page);
    await openItem(page, 'sample');
    await expect(page.getByTestId('viewer-title')).toHaveText('sample');
    await expect(page.getByTestId('pdf-page-indicator')).toHaveText('1 / 3쪽');
    await runMenuCommand(app, 'nav.back');
    await expect(page.getByTestId('library-table')).toBeVisible();
    await expect(page.getByTestId('viewer-title')).toHaveCount(0);
    await expect(page.getByTestId('item-row')).toHaveCount(1);
  } finally {
    await app.close();
  }
});

test('item context menu: right-click a row, pick 열기 → the viewer opens; 다시 연결… is listed disabled', async ({}, testInfo) => {
  const { app, page } = await session(testInfo);
  try {
    await importOnePdf(page);
    await stubContextMenu(app, '열기');
    await page.getByTestId('item-row').click({ button: 'right' });
    await expect(page.getByTestId('viewer-title')).toHaveText('sample');
    await expect(page.getByTestId('pdf-page-indicator')).toHaveText('1 / 3쪽');
    // Exactly one native popup (the row's preventDefault keeps the edit context menu away), with the registry items.
    expect(await recordedPopups(app)).toEqual([
      [
        { id: 'item.open', label: '열기', enabled: true, type: 'normal' },
        { id: 'item.relink', label: '다시 연결…', enabled: false, type: 'normal' },
      ],
    ]);
  } finally {
    await app.close();
  }
});

// No text input exists in M2, so the native edit roles can only be checked in the menu JSON.
test('menu: 편집 carries the native edit roles with Korean labels', async ({}, testInfo) => {
  const { app } = await session(testInfo);
  try {
    expect(entries(topMenu(await menuSnapshot(app), '편집'))).toEqual([
      ['undo', '실행 취소'],
      ['redo', '실행 복귀'],
      ['-', ''],
      ['cut', '오려두기'],
      ['copy', '복사하기'],
      ['paste', '붙여넣기'],
      ['selectall', '모두 선택'],
    ]);
  } finally {
    await app.close();
  }
});

test('prefs: theme dark survives a restart and drives nativeTheme.themeSource', async ({}, testInfo) => {
  const lib = testInfo.outputPath('library');
  const ud = testInfo.outputPath('userdata');
  let { app, page } = await launch(lib, ud);
  try {
    expect(await page.evaluate(() => window.learn.prefs.get())).toMatchObject({ ok: true, data: { theme: 'system' } });
    expect(await page.evaluate(() => window.learn.prefs.set({ theme: 'dark' }))).toMatchObject({ ok: true, data: { theme: 'dark' } });
    expect(await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe('dark');
    await app.close();

    ({ app, page } = await launch(lib, ud));
    expect(await page.evaluate(() => window.learn.prefs.get())).toMatchObject({ ok: true, data: { theme: 'dark' } });
    expect(await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe('dark');
  } finally {
    await app.close();
  }
});

test('settings: library.sort survives a restart; an unregistered key is VALIDATION_FAILED', async ({}, testInfo) => {
  const lib = testInfo.outputPath('library');
  const ud = testInfo.outputPath('userdata');
  const sort = { column: 'title', direction: 'asc' };
  let { app, page } = await launch(lib, ud);
  try {
    expect(await page.evaluate(() => window.learn.settings.get({ key: 'library.sort' }))).toEqual({ ok: true, data: null });
    expect(await page.evaluate((value) => window.learn.settings.set({ key: 'library.sort', value }), sort)).toMatchObject({ ok: true });
    await app.close();

    ({ app, page } = await launch(lib, ud));
    expect(await page.evaluate(() => window.learn.settings.get({ key: 'library.sort' }))).toEqual({ ok: true, data: sort });
    expect(await page.evaluate(() => window.learn.settings.set({ key: 'library.notRegistered', value: 1 }))).toMatchObject({
      ok: false,
      code: 'VALIDATION_FAILED',
    });
    expect(await page.evaluate(() => window.learn.settings.get({ key: 'library.notRegistered' }))).toMatchObject({
      ok: false,
      code: 'VALIDATION_FAILED',
    });
  } finally {
    await app.close();
  }
});

test('preload: window.learn has only the declared invokers, no generic IPC; on() rejects unknown events', async ({}, testInfo) => {
  const { app, page } = await session(testInfo);
  try {
    const scan = await page.evaluate(() => {
      const GENERIC = new Set([
        'invoke', 'send', 'sendSync', 'sendTo', 'sendToHost', 'postMessage', 'ipcRenderer', 'once', 'addListener', 'removeAllListeners',
      ]);
      const functions: string[] = [];
      const generic: string[] = [];
      const seen = new Set<unknown>();
      const walk = (value: unknown, at: string): void => {
        if (value === null || (typeof value !== 'object' && typeof value !== 'function') || seen.has(value)) return;
        seen.add(value);
        for (const key of Object.keys(value)) {
          const child = (value as Record<string, unknown>)[key];
          const where = at ? `${at}.${key}` : key;
          if (GENERIC.has(key)) generic.push(where);
          if (typeof child === 'function') {
            functions.push(where);
            if (GENERIC.has(child.name)) generic.push(`${where} (named ${child.name})`);
          }
          walk(child, where);
        }
      };
      walk(window.learn, '');
      const throws = (fn: () => unknown) => {
        try {
          fn();
          return false;
        } catch {
          return true;
        }
      };
      const learn = window.learn as unknown as { on(name: unknown, cb: unknown): unknown };
      return {
        functions: functions.sort(),
        generic,
        windowIpc: typeof (window as unknown as { ipcRenderer?: unknown }).ipcRenderer,
        unknownEventThrows: throws(() => learn.on('notAllowed', () => {})),
        protoKeyThrows: throws(() => learn.on('toString', () => {})),
        badCallbackThrows: throws(() => learn.on('libraryChanged', 'not a function')),
        knownEventReturns: typeof learn.on('libraryChanged', () => {}),
      };
    });
    const declared = Object.entries(Channels).flatMap(([ns, verbs]) => Object.keys(verbs).map((verb) => `${ns}.${verb}`));
    expect(scan.functions).toEqual([...declared, 'on', 'pathForFile'].sort());
    expect(scan.generic).toEqual([]);
    expect(scan.windowIpc).toBe('undefined');
    expect(scan.unknownEventThrows).toBe(true);
    expect(scan.protoKeyThrows).toBe(true);
    expect(scan.badCallbackThrows).toBe(true);
    expect(scan.knownEventReturns).toBe('function');
  } finally {
    await app.close();
  }
});

test('push: libraryChanged{import} reaches the renderer with the payload only', async ({}, testInfo) => {
  const { app, page } = await session(testInfo);
  try {
    await page.evaluate(() => {
      const w = window as unknown as { __libraryChanged: unknown[][] };
      w.__libraryChanged = [];
      window.learn.on('libraryChanged', (...args: unknown[]) => {
        w.__libraryChanged.push(args);
      });
    });
    const [item] = await importPaths(page, [PDF]);
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __libraryChanged: unknown[][] }).__libraryChanged))
      .toEqual([[{ reason: 'import', itemIds: [item!.id] }]]);
    await expect(page.getByTestId('item-row')).toHaveCount(1);
  } finally {
    await app.close();
  }
});
