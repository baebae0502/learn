import { describe, expect, it } from 'vitest';
import { acceleratorKeys, acceleratorLabel } from '../src/accelerator';
import { ACCELERATOR_SYNTAX, COMMANDS, CONTEXT_MENU_KINDS, MAIN_OWNED_COMMANDS, availableMenuCommands, commandById, commandLabel, inPalette, isCommandAvailable, sameCommandContext, type CommandContextState, type CommandTargetInfo } from '../src/commands';
import { Channels } from '../src/ipc-channels';
import { EventChannels } from '../src/event-channels';
import { TAG_COLORS } from '../src/tag-colors';
import { readingLocatorSchema } from '../src/reading';

const flatten = (o: Record<string, Record<string, string>>): string[] => Object.values(o).flatMap((ns) => Object.values(ns));

describe('channels', () => {
  it('all request channels are ns:verb and unique', () => {
    const all = flatten(Channels);
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((c) => /^[a-z]+:[a-zA-Z]+$/.test(c))).toBe(true);
    expect(new Set(all).size).toBe(all.length);
  });
  it('event channels are evt:kebab and unique', () => {
    const all = Object.values(EventChannels);
    expect(all.every((c) => /^evt:[a-z-]+$/.test(c))).toBe(true);
    expect(new Set(all).size).toBe(all.length);
    const reqs = new Set(flatten(Channels));
    expect(all.some((c) => reqs.has(c))).toBe(false);
  });
});

const LIB: CommandContextState = { view: 'library', blocked: false, textSize: 13 };
const VIEWER: CommandContextState = { view: 'viewer', blocked: false, textSize: 13 };
const linkedMissing: CommandTargetInfo = { storageMode: 'linked', availability: 'missing' };
const managedOk: CommandTargetInfo = { storageMode: 'managed', availability: 'available' };

describe('command registry', () => {
  it('has unique ids and resolves by id', () => {
    const ids = COMMANDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of COMMANDS) expect(commandById(c.id)).toBe(c);
  });
  it('gives every accelerator and every single key to one command (one native menu serves every view in M3)', () => {
    // Compared per platform after mapping (⌃⌘ → Ctrl+Shift off macOS) and sorting modifiers, so 'Shift+CmdOrCtrl+X'
    // and 'CmdOrCtrl+Shift+X' collide. Hidden twins and Electron's role defaults are checked in app-menu.test.ts.
    for (const platform of ['darwin', 'linux', 'win32']) {
      const accels = COMMANDS.flatMap((c) => (c.accelerator ? [acceleratorLabel(c.accelerator, platform)] : []));
      expect(accels.filter((a, i) => accels.indexOf(a) !== i), platform).toEqual([]);
    }
    // A bare Cmd (without the OrCtrl part, and not the ⌃⌘ pair) would be the Super key on Linux/Windows.
    for (const c of COMMANDS) {
      if (!c.accelerator) continue;
      for (const platform of ['linux', 'win32']) expect(acceleratorKeys(c.accelerator, platform), c.id).not.toContain('Super');
    }
    const keys = COMMANDS.flatMap((c) => (c.key ? [`${c.key.shift ? 'Shift+' : ''}${c.key.code}`] : []));
    expect(new Set(keys).size).toBe(keys.length);
    // ⌘[ / ⌘] belong to PDF history (M7, design-spec 7.4).
    const mac = COMMANDS.flatMap((c) => (c.accelerator ? [acceleratorLabel(c.accelerator, 'darwin')] : []));
    expect(mac).not.toContain('⌘[');
    expect(mac).not.toContain('⌘]');
  });
  it('labels every command in Korean; placements use known menus; context menus use known kinds', () => {
    for (const c of COMMANDS) {
      expect(c.label, c.id).toMatch(/[가-힣]/);
      if (c.menu) expect(['app', 'file', 'edit', 'view', 'go', 'window', 'help'], c.id).toContain(c.menu.menu);
      for (const kind of c.contextMenu?.kinds ?? []) expect(CONTEXT_MENU_KINDS, c.id).toContain(kind);
      if (c.contextMenu?.kinds.includes('item')) expect(c.contexts, c.id).toContain('item');
    }
  });
  it('accepts every accelerator shape the design spec uses (7.4)', () => {
    const re = ACCELERATOR_SYNTAX;
    for (const a of ['CmdOrCtrl+,', 'CmdOrCtrl+/', 'Ctrl+Tab', 'Ctrl+Shift+Tab', 'CmdOrCtrl+Plus', 'CmdOrCtrl+-', 'CmdOrCtrl+0', 'CmdOrCtrl+Backspace', 'Ctrl+Cmd+S', 'Alt+CmdOrCtrl+I', 'Shift+CmdOrCtrl+R', 'CmdOrCtrl+[', 'CmdOrCtrl+1', 'Ctrl+Cmd+F']) {
      expect(a).toMatch(re);
    }
    for (const c of COMMANDS) if (c.accelerator) expect(c.accelerator, c.id).toMatch(re);
  });
  it('gives palette commands Korean search words (초성 search works on them)', () => {
    for (const c of COMMANDS.filter(inPalette)) {
      expect(c.keywords?.length ?? 0, c.id).toBeGreaterThan(0);
      expect(c.keywords!.some((k) => /[가-힣]/.test(k)), c.id).toBe(true);
    }
    expect(inPalette(commandById('item.open'))).toBe(false);
    expect(inPalette(commandById('file.importManaged'))).toBe(true);
    expect(inPalette(commandById('app.palette'))).toBe(false); // the palette does not list itself
  });
  it('defines the registry commands with the design-spec labels and keys', () => {
    expect(COMMANDS.map((c) => c.id).sort()).toEqual([
      'app.palette', 'app.settings', 'app.shortcuts', 'file.importLinked', 'file.importManaged', 'item.open', 'item.openExternally', 'item.relink', 'item.showInFolder', 'nav.back',
      'view.textBigger', 'view.textReset', 'view.textSmaller', 'view.toggleSidebar',
    ]);
    expect(commandById('file.importManaged')).toMatchObject({ label: '파일 가져오기…', accelerator: 'CmdOrCtrl+O' });
    expect(commandById('file.importLinked')).toMatchObject({ label: '외부 파일 연결…', accelerator: 'Alt+CmdOrCtrl+O' });
    expect(commandById('nav.back')).toMatchObject({ label: '라이브러리로 돌아가기', accelerator: 'CmdOrCtrl+1', contexts: ['viewer'] });
    expect(commandById('view.toggleSidebar')).toMatchObject({
      label: '사이드바 보기/가리기', accelerator: 'Ctrl+Cmd+S', menu: { menu: 'view', group: 2, order: 1 }, contexts: ['app'],
      stateLabels: { sidebar: { shown: '사이드바 가리기', hidden: '사이드바 보기' } },
    });
    expect(commandById('app.shortcuts')).toMatchObject({
      label: '단축키 도움말', accelerator: 'CmdOrCtrl+/', menu: { menu: 'help', group: 1, order: 1 }, contexts: ['app'],
    });
    // ⌘, (design-spec 7.4): the macOS app menu, the end of 파일 elsewhere; main runs it (MAIN_OWNED_COMMANDS).
    expect(commandById('app.settings')).toMatchObject({ label: '설정…', accelerator: 'CmdOrCtrl+,', menu: { menu: 'app', group: 1, order: 1 }, contexts: ['app'] });
    // ⌘+ / ⌘− / ⌘0: the library's text size (design-spec 7.4 라이브러리), one 보기 group.
    expect(commandById('view.textBigger')).toMatchObject({ label: '글자 크게', accelerator: 'CmdOrCtrl+Plus', menu: { menu: 'view', group: 3, order: 1 }, contexts: ['library'] });
    expect(commandById('view.textSmaller')).toMatchObject({ label: '글자 작게', accelerator: 'CmdOrCtrl+-', menu: { menu: 'view', group: 3, order: 2 }, contexts: ['library'] });
    expect(commandById('view.textReset')).toMatchObject({ label: '기본 글자 크기', accelerator: 'CmdOrCtrl+0', menu: { menu: 'view', group: 3, order: 3 }, contexts: ['library'] });
    // ⌘K heads 보기; last in the registry (R-10: menu-bar and palette lists keep the registry order).
    expect(commandById('app.palette')).toMatchObject({
      label: '명령 팔레트…', accelerator: 'CmdOrCtrl+K', menu: { menu: 'view', group: 1, order: 1 }, contexts: ['app'], palette: false,
    });
    expect(COMMANDS.at(-1)!.id).toBe('app.palette');
  });
});

describe('availability (one predicate for the menu bar, palette, toolbar and context menus)', () => {
  it('follows the view, and nothing runs while blocked', () => {
    expect(isCommandAvailable('file.importManaged', LIB)).toBe(true);
    expect(isCommandAvailable('file.importManaged', VIEWER)).toBe(false);
    expect(isCommandAvailable('nav.back', LIB)).toBe(false);
    expect(isCommandAvailable('nav.back', VIEWER)).toBe(true);
    for (const c of COMMANDS) expect(isCommandAvailable(c.id, { ...VIEWER, blocked: true }, [linkedMissing]), c.id).toBe(MAIN_OWNED_COMMANDS.has(c.id));
  });
  it('item commands need targets: 열기 one item, 다시 연결… one linked item whose file is missing', () => {
    expect(isCommandAvailable('item.open', LIB)).toBe(false);
    expect(isCommandAvailable('item.open', LIB, [managedOk])).toBe(true);
    expect(isCommandAvailable('item.open', LIB, [managedOk, managedOk])).toBe(false);
    expect(isCommandAvailable('item.relink', LIB, [linkedMissing])).toBe(true);
    expect(isCommandAvailable('item.relink', LIB, [managedOk])).toBe(false);
    expect(isCommandAvailable('item.relink', LIB, [{ storageMode: 'linked', availability: 'available' }])).toBe(false);
    expect(isCommandAvailable('item.relink', LIB, [{ storageMode: 'managed', availability: 'missing' }])).toBe(false);
    expect(isCommandAvailable('item.relink', LIB, [linkedMissing, linkedMissing])).toBe(false);
  });
  it('Finder에서 보기 / 기본 앱으로 열기 need one item whose file exists', () => {
    for (const id of ['item.showInFolder', 'item.openExternally'] as const) {
      expect(isCommandAvailable(id, LIB, [managedOk])).toBe(true);
      expect(isCommandAvailable(id, VIEWER, [{ storageMode: 'linked', availability: 'available' }])).toBe(true);
      expect(isCommandAvailable(id, LIB, [linkedMissing])).toBe(false);
      expect(isCommandAvailable(id, LIB, [managedOk, managedOk])).toBe(false);
      expect(isCommandAvailable(id, LIB)).toBe(false);
    }
    expect(commandLabel(commandById('item.showInFolder'), 'darwin')).toBe('Finder에서 보기');
    expect(commandLabel(commandById('item.showInFolder'), 'linux')).toBe('폴더에서 보기');
    expect(commandById('item.showInFolder')).toMatchObject({ contexts: ['item'], contextMenu: { kinds: ['item'], group: 2, order: 1 } });
    // Not an item context-menu entry (design-spec 7.3 has none, C-1): only the unplayable-video notice's button.
    expect(commandById('item.openExternally')).toMatchObject({ label: '기본 앱으로 열기', contexts: ['item'] });
    expect(commandById('item.openExternally').contextMenu).toBeUndefined();
    // No accelerator yet: ⇧⌘R needs the table selection (M4).
    expect(commandById('item.showInFolder').accelerator).toBeUndefined();
    expect(commandById('item.openExternally').accelerator).toBeUndefined();
  });
  it('lists the menu-bar commands of a view (never item commands)', () => {
    expect(availableMenuCommands(LIB)).toEqual(['file.importManaged', 'file.importLinked', 'view.toggleSidebar', 'app.shortcuts', 'app.settings', 'view.textBigger', 'view.textSmaller', 'app.palette']);
    expect(availableMenuCommands(VIEWER)).toEqual(['nav.back', 'view.toggleSidebar', 'app.shortcuts', 'app.settings', 'app.palette']);
    expect(availableMenuCommands({ ...LIB, blocked: true })).toEqual([...MAIN_OWNED_COMMANDS].filter((id) => commandById(id).menu));
    expect(availableMenuCommands({ ...LIB, blocked: true })).toEqual(['app.settings']);
  });
  it('settings is main-owned: available even while blocked', () => {
    expect(MAIN_OWNED_COMMANDS.has('app.settings')).toBe(true);
    expect(isCommandAvailable('app.settings', { ...LIB, blocked: true })).toBe(true);
  });
  it('text size steps stay within 12–15 and reset only away from 13', () => {
    expect(isCommandAvailable('view.textBigger', { ...LIB, textSize: 15 })).toBe(false);
    expect(isCommandAvailable('view.textBigger', { ...LIB, textSize: 14 })).toBe(true);
    expect(isCommandAvailable('view.textSmaller', { ...LIB, textSize: 12 })).toBe(false);
    expect(isCommandAvailable('view.textSmaller', { ...LIB, textSize: 13 })).toBe(true);
    expect(isCommandAvailable('view.textReset', LIB)).toBe(false);
    expect(isCommandAvailable('view.textReset', { ...LIB, textSize: 14 })).toBe(true);
    expect(isCommandAvailable('view.textReset', { ...LIB, textSize: 12 })).toBe(true);
    expect(isCommandAvailable('view.textBigger', { ...VIEWER, textSize: 13 })).toBe(false); // library scope (design-spec 7.4)
    expect(isCommandAvailable('view.textReset', { ...LIB, textSize: 14, blocked: true })).toBe(false);
  });
  it('compares reported contexts field by field (main skips a report that changes nothing)', () => {
    expect(sameCommandContext(LIB, { view: 'library', blocked: false, textSize: 13 })).toBe(true);
    expect(sameCommandContext(LIB, { ...LIB, textSize: 14 })).toBe(false);
    expect(sameCommandContext(LIB, VIEWER)).toBe(false);
    expect(sameCommandContext(LIB, { ...LIB, blocked: true })).toBe(false);
    // A field only one side has (a later task's field against an older report) is a difference.
    expect(sameCommandContext(LIB, { ...LIB, extra: 1 } as CommandContextState)).toBe(false);
    // The sidebar state is part of the report (it relabels the menu), so a change is a new context.
    expect(sameCommandContext({ ...LIB, sidebar: 'shown' }, { ...LIB, sidebar: 'shown' })).toBe(true);
    expect(sameCommandContext({ ...LIB, sidebar: 'shown' }, { ...LIB, sidebar: 'hidden' })).toBe(false);
  });
  it('a toggle is named by what it does now (Mac pattern, design-spec 7.4); the neutral name where no state applies', () => {
    const c = commandById('view.toggleSidebar');
    for (const platform of ['darwin', 'linux', 'win32']) {
      expect(commandLabel(c, platform, { sidebar: 'shown' })).toBe('사이드바 가리기');
      expect(commandLabel(c, platform, { sidebar: 'hidden' })).toBe('사이드바 보기');
      expect(commandLabel(c, platform)).toBe('사이드바 보기/가리기');
    }
    // The sidebar state never decides availability.
    expect(isCommandAvailable('view.toggleSidebar', { ...LIB, sidebar: 'hidden' })).toBe(true);
    expect(commandLabel(commandById('nav.back'), 'darwin', { sidebar: 'hidden' })).toBe('라이브러리로 돌아가기');
  });
  it('names macOS apps only on macOS', () => {
    const c = { ...commandById('file.importManaged'), labelOff: '다른 이름' };
    expect(commandLabel(c, 'darwin')).toBe('파일 가져오기…');
    expect(commandLabel(c, 'linux')).toBe('다른 이름');
    expect(commandLabel(commandById('file.importManaged'), 'linux')).toBe('파일 가져오기…');
  });
});

describe('tag colors and reading locator', () => {
  it('has 8 unique colors', () => {
    expect(TAG_COLORS).toHaveLength(8);
    expect(new Set(TAG_COLORS.map((c) => c.id)).size).toBe(8);
    expect(TAG_COLORS.every((c) => /^#[0-9a-f]{6}$/.test(c.hex))).toBe(true);
  });
  it('discriminates locator kinds', () => {
    expect(readingLocatorSchema.safeParse({ kind: 'pdf', pageIndex: 3, scale: 1.5 }).success).toBe(true);
    expect(readingLocatorSchema.safeParse({ kind: 'video', timeMs: 1000 }).success).toBe(true);
    expect(readingLocatorSchema.safeParse({ kind: 'pdf', pageIndex: -1 }).success).toBe(false);
    expect(readingLocatorSchema.safeParse({ kind: 'pdf', pageIndex: 1.5 }).success).toBe(false);
    expect(readingLocatorSchema.safeParse({ kind: 'video', timeMs: 1.5 }).success).toBe(false);
    expect(readingLocatorSchema.safeParse({ kind: 'epub', cfi: 'x' }).success).toBe(false);
    expect(readingLocatorSchema.safeParse({ kind: 'pdf', pageIndex: 0, scale: 0 }).success).toBe(false);
  });
});
