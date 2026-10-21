import { describe, expect, it } from 'vitest';
import { ACCELERATOR_SYNTAX, COMMANDS, CONTEXT_MENU_KINDS, MAIN_OWNED_COMMANDS, availableMenuCommands, commandById, commandLabel, inPalette, isCommandAvailable, type CommandContextState, type CommandTargetInfo } from '../src/commands';
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

const LIB: CommandContextState = { view: 'library', blocked: false };
const VIEWER: CommandContextState = { view: 'viewer', blocked: false };
const linkedMissing: CommandTargetInfo = { storageMode: 'linked', availability: 'missing' };
const managedOk: CommandTargetInfo = { storageMode: 'managed', availability: 'available' };

describe('command registry', () => {
  it('has unique ids and resolves by id', () => {
    const ids = COMMANDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of COMMANDS) expect(commandById(c.id)).toBe(c);
  });
  it('gives every accelerator and every single key to one command (one native menu serves every view in M3)', () => {
    const accels = COMMANDS.flatMap((c) => (c.accelerator ? [c.accelerator] : []));
    expect(new Set(accels).size).toBe(accels.length);
    const keys = COMMANDS.flatMap((c) => (c.key ? [`${c.key.shift ? 'Shift+' : ''}${c.key.code}`] : []));
    expect(new Set(keys).size).toBe(keys.length);
    expect(accels).not.toContain('CmdOrCtrl+['); // ⌘[ / ⌘] belong to PDF history (M7, design-spec 7.4)
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
  });
  it('defines the registry commands with the design-spec labels and keys', () => {
    expect(COMMANDS.map((c) => c.id).sort()).toEqual(['file.importLinked', 'file.importManaged', 'item.open', 'item.relink', 'nav.back']);
    expect(commandById('file.importManaged')).toMatchObject({ label: '파일 가져오기…', accelerator: 'CmdOrCtrl+O' });
    expect(commandById('file.importLinked')).toMatchObject({ label: '외부 파일 연결…', accelerator: 'Alt+CmdOrCtrl+O' });
    expect(commandById('nav.back')).toMatchObject({ label: '라이브러리로 돌아가기', accelerator: 'CmdOrCtrl+1', contexts: ['viewer'] });
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
    expect(isCommandAvailable('item.relink', LIB, [{ storageMode: 'managed', availability: 'missing' }])).toBe(false);
    expect(isCommandAvailable('item.relink', LIB, [linkedMissing, linkedMissing])).toBe(false);
  });
  it('lists the menu-bar commands of a view (never item commands)', () => {
    expect(availableMenuCommands(LIB)).toEqual(['file.importManaged', 'file.importLinked']);
    expect(availableMenuCommands(VIEWER)).toEqual(['nav.back']);
    expect(availableMenuCommands({ ...LIB, blocked: true })).toEqual([...MAIN_OWNED_COMMANDS].filter((id) => commandById(id).menu));
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
