import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { acceleratorLabel, platformAccelerator } from '../../packages/domain/src/accelerator';
import { COMMANDS, availableMenuCommands, commandLabel, type CommandContextState, type MenuName } from '../../packages/domain/src/commands';
import { Channels } from '../../packages/domain/src/ipc-channels';
import {
  FIXTURES, NativeInputNotPermitted, importPaths, launch, mainWindow, menuItemEnabled, menuSnapshot, nativeKeystroke, openDialogCalls, openItem,
  recordedPopups, rowByTitle, runMenuCommand, stubContextMenu, stubOpenDialog, type MenuNode, type NativeKeystroke,
} from './helpers';

const PDF = path.join(FIXTURES, 'sample.pdf');
const IS_MAC = process.platform === 'darwin';

test.beforeAll(() => {
  if (!fs.existsSync(PDF)) throw new Error(`fixture missing: ${PDF} — run \`pnpm fixtures\``);
});

/** What an empty library reports first: no items, nothing selected. */
const EMPTY_LIBRARY: CommandContextState = { view: 'library', blocked: false, textSize: 13, libraryCount: 0, selectionCount: 0, selectionAvailable: 0, selectionRelinkable: 0 };
const TOP_LABELS: Record<MenuName, string> = { app: 'Learn', file: '파일', edit: '편집', view: '보기', go: '이동', window: '윈도우', help: '도움말' };
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
/** 보기 up to its full-screen item: the palette, the sidebar toggle, the text size group (with ⌘+'s hidden ⌘= twin). */
const VIEW_START = [
  [null, '명령 팔레트…'], ['-', ''], [null, '사이드바 가리기'], ['-', ''],
  [null, '글자 크게'], [null, '글자 크게'], [null, '글자 작게'], [null, '기본 글자 크기'], ['-', ''],
];

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
    // launch() returns after the first context report; poll anyway so a report that lands a moment later is not a failure.
    await expect.poll(() => menuItemEnabled(app, 'file.importManaged')).toBe(true);
    const menu = await menuSnapshot(app);
    expect(menu.map((m) => m.label)).toEqual([...(IS_MAC ? ['Learn'] : []), '파일', '편집', '보기', '이동', '윈도우', '도움말']);

    const all = flatten(menu);
    // Every visible label is Korean; the only exception is the macOS app menu, which carries the app's name.
    for (const n of all) {
      if (n.type === 'separator' || (IS_MAC && n === menu[0])) continue;
      expect(n.label, `menu label ${JSON.stringify(n.label)}`).toMatch(HANGUL);
    }
    const roles = all.map(roleOf);
    for (const banned of ['reload', 'forcereload', 'toggledevtools']) expect(roles).not.toContain(banned);

    // No two live items (role defaults filled in by Electron, hidden twins included) share a shortcut on this platform.
    const shortcuts = all.flatMap((n) => (n.accelerator ? [acceleratorLabel(n.accelerator, process.platform)] : []));
    expect(shortcuts.length).toBeGreaterThanOrEqual(8);
    expect(shortcuts.filter((a, i) => shortcuts.indexOf(a) !== i)).toEqual([]);
    if (!IS_MAC) expect(shortcuts.filter((a) => a.includes('Super'))).toEqual([]);
    expect(all.map((n) => n.label)).not.toContain('개발자 도구');

    // Registry-driven: each placed command appears exactly once, in its platform menu, with its id, platform label and
    // accelerator, enabled exactly when the shared predicate allows it in the library view.
    for (const c of COMMANDS) {
      const hits = all.filter((n) => n.id === c.id);
      if (!c.menu) {
        expect(hits, `${c.id} is context-menu only`).toHaveLength(0);
        continue;
      }
      expect(hits, c.id).toHaveLength(1);
      const menuName = c.menu.menu === 'app' && !IS_MAC ? 'file' : c.menu.menu;
      expect(flatten(topMenu(menu, TOP_LABELS[menuName])).filter((n) => n.id === c.id)).toEqual([
        expect.objectContaining({
          label: commandLabel(c, process.platform, { sidebar: 'shown' }), // the shell opens with the sidebar shown
          accelerator: c.accelerator ? platformAccelerator(c.accelerator, process.platform) : null,
          enabled: availableMenuCommands(EMPTY_LIBRARY).includes(c.id),
        }),
      ]);
    }
    // 설정… ends 파일 off macOS (S-2); on macOS it follows Learn에 관하여 in the app menu.
    expect(entries(topMenu(menu, '파일'))).toEqual([
      [null, '파일 가져오기…'], [null, '외부 파일 연결…'], ['-', ''],
      [null, IS_MAC ? 'Finder에서 보기' : '폴더에서 보기'], [null, '기본 앱으로 열기'], ['-', ''],
      ...(IS_MAC ? [] : [[null, '설정…'], ['-', '']]), ['close', IS_MAC ? '윈도우 닫기' : '창 닫기'],
    ]);
    if (IS_MAC) expect(entries(topMenu(menu, 'Learn')).slice(0, 4)).toEqual([['about', 'Learn에 관하여'], ['-', ''], [null, '설정…'], ['-', '']]);
    expect(topMenu(menu, '파일')[0]).toMatchObject({ id: 'file.importManaged', accelerator: 'CmdOrCtrl+O' });
    // The text size group; the second 글자 크게 is ⌘+'s hidden ⌘= twin (menuSnapshot does not carry `visible`).
    expect(entries(topMenu(menu, '보기'))).toEqual([...VIEW_START, IS_MAC ? [null, '전체 화면 시작'] : ['togglefullscreen', '전체 화면']]);
    expect(entries(topMenu(menu, '이동'))).toEqual([[null, '라이브러리로 돌아가기']]);
    expect(entries(topMenu(menu, '윈도우'))).toEqual(
      IS_MAC
        ? [['minimize', '최소화'], ['zoom', '확대/축소'], ['-', ''], ['front', '모두 앞으로 가져오기']]
        : [['minimize', '최소화']],
    );
    expect(entries(topMenu(menu, '도움말'))).toEqual(IS_MAC ? [[null, '단축키 도움말']] : [[null, '단축키 도움말'], ['-', ''], ['about', 'Learn 정보']]);
  } finally {
    await app.close();
  }
});

// Control for the test above: the "no 개발자 도구" result comes from LEARN_E2E=1, not from a menu that never has it.
test('menu: an unpackaged run without LEARN_E2E=1 does show 개발자 도구', async ({}, testInfo) => {
  const { app } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'), { env: { LEARN_E2E: '' } });
  try {
    const view = topMenu(await menuSnapshot(app), '보기');
    expect(entries(view)).toEqual([...VIEW_START, IS_MAC ? [null, '전체 화면 시작'] : ['togglefullscreen', '전체 화면'], ['-', ''], ['toggledevtools', '개발자 도구']]);
  } finally {
    await app.close();
  }
});

test('menu command 파일 가져오기… opens the (stubbed) dialog once and adds the item', async ({}, testInfo) => {
  const { app, page } = await session(testInfo);
  try {
    await expect(page.getByTestId('empty-state')).toBeVisible();
    await stubOpenDialog(app, [PDF]);
    await runMenuCommand(app, 'file.importManaged');
    await expect(page.getByTestId('item-row')).toHaveCount(1);
    await expect(rowByTitle(page, 'sample')).toBeVisible();
    expect(await openDialogCalls(app)).toBe(1);
  } finally {
    await app.close();
  }
});

// A real OS-level ⌘O (System Events keystroke): Playwright's CDP keys never reach NSMenu key equivalents.
test('⌘O (파일 가져오기…) opens the dialog exactly once', async ({}, testInfo) => {
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
    // …and no duplicate sheet window opened over it.
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
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

test('item context menu: right-click a row, pick 열기 → the viewer opens; 다시 연결… only for a missing linked file', async ({}, testInfo) => {
  const { app, page } = await session(testInfo);
  try {
    await importOnePdf(page);
    await stubContextMenu(app, '열기');
    await page.getByTestId('item-row').click({ button: 'right' });
    await expect(page.getByTestId('viewer-title')).toHaveText('sample');
    await expect(page.getByTestId('pdf-page-indicator')).toHaveText('1 / 3쪽');
    // Exactly one native popup (the row's preventDefault keeps the edit context menu away), with the registry items.
    const popups = await recordedPopups(app);
    expect(popups).toHaveLength(1);
    expect(popups[0]!.filter((i) => i.type !== 'separator').map((i) => i.label)).toEqual(['열기', process.platform === 'darwin' ? 'Finder에서 보기' : '폴더에서 보기']);
  } finally {
    await app.close();
  }
});

test('menu: enabled state follows the reported view (ui:reportContext)', async ({}, testInfo) => {
  const { app, page } = await session(testInfo);
  try {
    await importOnePdf(page);
    expect(await menuItemEnabled(app, 'file.importManaged')).toBe(true);
    expect(await menuItemEnabled(app, 'nav.back')).toBe(false);
    await openItem(page, 'sample');
    await expect.poll(() => menuItemEnabled(app, 'nav.back')).toBe(true);
    expect(await menuItemEnabled(app, 'file.importManaged')).toBe(false);
    await runMenuCommand(app, 'nav.back');
    await expect(page.getByTestId('library-table')).toBeVisible();
    await expect.poll(() => menuItemEnabled(app, 'nav.back')).toBe(false);
    // The payload is validated strictly (later tasks add fields to the schema and the type together).
    expect(await page.evaluate(() => window.learn.ui.reportContext({ view: 'viewer', blocked: false, extra: 1 } as never))).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
  } finally {
    await app.close();
  }
});

// What main was told, read back (main keeps the last accepted report for tests). The selection counts stay 0 until
// the table has a selection; the fatal screen reports the same zeros, or no report would pass the schema.
test('menu: the reported context carries the library count and no selection yet; the fatal screen reports zeros', async ({}, testInfo) => {
  const reported = (app: ElectronApplication) => app.evaluate(() => (globalThis as { __learnMenuContext?: CommandContextState }).__learnMenuContext ?? null);
  const { app, page } = await session(testInfo);
  try {
    await expect.poll(() => reported(app)).toEqual({ ...EMPTY_LIBRARY, sidebar: 'shown' });
    await importOnePdf(page);
    await expect.poll(async () => (await reported(app))?.libraryCount).toBe(1);
    expect(await reported(app)).toMatchObject({ selectionCount: 0, selectionAvailable: 0, selectionRelinkable: 0 });
  } finally {
    await app.close();
  }
  const broken = testInfo.outputPath('broken');
  fs.mkdirSync(broken, { recursive: true });
  fs.writeFileSync(path.join(broken, 'library.sqlite'), 'not a database');
  const fatal = await launch(broken, testInfo.outputPath('userdata-broken'));
  try {
    await expect(fatal.page.getByTestId('fatal-screen')).toBeVisible();
    expect(await reported(fatal.app)).toEqual({ ...EMPTY_LIBRARY, blocked: true });
  } finally {
    await fatal.app.close();
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
      ['-', ''],
      [null, '빠른 검색'],
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
    // The native theme follows the page once it shows the change (T13R4-m1), within THEME_FOLLOW_MS at most.
    await expect.poll(() => app.evaluate(({ nativeTheme }) => nativeTheme.themeSource), { timeout: 2000 }).toBe('dark');
    await app.close();

    ({ app, page } = await launch(lib, ud));
    expect(await page.evaluate(() => window.learn.prefs.get())).toMatchObject({ ok: true, data: { theme: 'dark' } });
    expect(await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe('dark');
  } finally {
    await app.close().catch(() => {}); // never mask a failed relaunch's own error
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
    await app.close().catch(() => {}); // never mask a failed relaunch's own error
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

test('ui.windowState() answers the current fullscreen and focus state that main sees', async ({}, testInfo) => {
  const { app, page } = await session(testInfo);
  try {
    const mainSees = async () => (await mainWindow(app)).evaluate((w) => ({ fullscreen: w.isFullScreen(), focused: w.isFocused(), sheetOpen: false }));
    const query = () => page.evaluate(() => window.learn.ui.windowState());
    expect(await query()).toEqual({ ok: true, data: await mainSees() });
    expect((await mainSees()).fullscreen).toBe(false);
    // macOS animates native fullscreen into its own Space and leaving mid-transition hangs (first-session.spec), so the
    // toggle runs where the switch is immediate.
    if (!IS_MAC) {
      const setFullScreen = async (on: boolean) => (await mainWindow(app)).evaluate((w, on) => w.setFullScreen(on), on);
      await setFullScreen(true);
      await expect.poll(async () => (await query()).ok && (await mainSees()).fullscreen).toBe(true);
      expect(await query()).toEqual({ ok: true, data: await mainSees() });
      await setFullScreen(false);
      await expect.poll(async () => (await mainSees()).fullscreen).toBe(false);
      expect(await query()).toEqual({ ok: true, data: await mainSees() });
    }
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
    // Still exactly one after the list refresh settles: a late duplicate push (or a refresh that re-broadcasts) fails here.
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (window as unknown as { __libraryChanged: unknown[][] }).__libraryChanged)).toEqual([
      [{ reason: 'import', itemIds: [item!.id] }],
    ]);
  } finally {
    await app.close();
  }
});
