import { describe, expect, it, vi } from 'vitest';
import { COMMANDS, type CommandId, type CommandTargetInfo } from '@learn/domain';
import { COMMAND_HANDLERS, contextOf, isCommandEnabled, runCommand, runPicked, type CommandEnv } from './registry';

const ID = '7d3f3c3e-8a51-4f7e-9d7c-2b1f0f6f8f10';
const missingLinked: CommandTargetInfo = { storageMode: 'linked', availability: 'missing' };
const env = (over: Partial<CommandEnv> = {}): CommandEnv => ({
  view: 'library',
  blocked: false,
  textSize: 13,
  targetsOf: (ids) => ids.map(() => missingLinked),
  importFiles: vi.fn(),
  back: vi.fn(),
  open: vi.fn(),
  relink: vi.fn(),
  toggleSidebar: vi.fn(),
  showShortcuts: vi.fn(),
  openPalette: vi.fn(),
  showInFolder: vi.fn(),
  openExternally: vi.fn(),
  openSettings: vi.fn(),
  setTextSize: vi.fn(),
  focusPane: vi.fn(),
  ...over,
});

describe('renderer command registry', () => {
  it('has a handler for every registry command and nothing else (no fake controls)', () => {
    expect(Object.keys(COMMAND_HANDLERS).sort()).toEqual(COMMANDS.map((c) => c.id).sort());
  });
  it('reports only the context fields, never the handlers', () => {
    expect(contextOf(env({ view: 'viewer' }))).toEqual({ view: 'viewer', blocked: false, textSize: 13 });
    expect(contextOf(env({ textSize: 15, sidebar: 'hidden' }))).toEqual({ view: 'library', blocked: false, textSize: 15, sidebar: 'hidden' });
  });
  it('runs through the shared availability predicate', () => {
    const lib = env();
    expect(runCommand('file.importManaged', lib)).toBe(true);
    expect(runCommand('file.importLinked', lib)).toBe(true);
    expect(lib.importFiles).toHaveBeenNthCalledWith(1, 'managed');
    expect(lib.importFiles).toHaveBeenNthCalledWith(2, 'linked');
    expect(runCommand('nav.back', lib)).toBe(false);
    const viewer = env({ view: 'viewer' });
    expect(runCommand('nav.back', viewer)).toBe(true);
    expect(viewer.back).toHaveBeenCalledTimes(1);
  });
  it('⌃⌘S toggles the sidebar in every view, but not while the window is blocked', () => {
    for (const view of ['library', 'viewer'] as const) {
      const e = env({ view });
      expect(runCommand('view.toggleSidebar', e)).toBe(true);
      expect(e.toggleSidebar).toHaveBeenCalledTimes(1);
    }
    const blocked = env({ blocked: true });
    expect(runCommand('view.toggleSidebar', blocked)).toBe(false);
    expect(blocked.toggleSidebar).not.toHaveBeenCalled();
  });
  it('⌘/ opens the shortcut sheet in every view, but not while the window is blocked (a sheet is already up)', () => {
    for (const view of ['library', 'viewer'] as const) {
      const e = env({ view });
      expect(runCommand('app.shortcuts', e)).toBe(true);
      expect(e.showShortcuts).toHaveBeenCalledTimes(1);
    }
    const blocked = env({ blocked: true });
    expect(runCommand('app.shortcuts', blocked)).toBe(false);
    expect(blocked.showShortcuts).not.toHaveBeenCalled();
  });
  it('⌘K opens the palette in every view, but not while the window is blocked (an import or a sheet holds it)', () => {
    for (const view of ['library', 'viewer'] as const) {
      const e = env({ view });
      expect(runCommand('app.palette', e)).toBe(true);
      expect(e.openPalette).toHaveBeenCalledTimes(1);
    }
    const blocked = env({ blocked: true });
    expect(runCommand('app.palette', blocked)).toBe(false);
    expect(blocked.openPalette).not.toHaveBeenCalled();
  });
  it('F6 / ⇧F6 move to the next / previous pane in every view, but not while the window is blocked', () => {
    for (const view of ['library', 'viewer'] as const) {
      const e = env({ view });
      expect(runCommand('view.nextPane', e)).toBe(true);
      expect(runCommand('view.previousPane', e)).toBe(true);
      expect(vi.mocked(e.focusPane).mock.calls).toEqual([[1], [-1]]);
    }
    const blocked = env({ blocked: true });
    expect(runCommand('view.nextPane', blocked)).toBe(false);
    expect(blocked.focusPane).not.toHaveBeenCalled();
  });
  it('⌘, opens the settings window in every view, even while the window is blocked (main-owned)', () => {
    for (const e of [env(), env({ view: 'viewer' }), env({ blocked: true })]) {
      expect(runCommand('app.settings', e)).toBe(true);
      expect(e.openSettings).toHaveBeenCalledTimes(1);
    }
  });
  it('steps the text size: ⌘+ / ⌘− one point within 12–15 from the latest size (a functional update), ⌘0 back to 13, in the library only', () => {
    const at = (textSize: 12 | 13 | 14 | 15, view: 'library' | 'viewer' = 'library') => env({ textSize, view });
    /** The update a command passed, applied to `current` (the newest size, which may be ahead of env.textSize). */
    const applied = (e: CommandEnv, current: 12 | 13 | 14 | 15) => vi.mocked(e.setTextSize).mock.calls.at(-1)![0](current);
    let e = at(13);
    expect(runCommand('view.textBigger', e)).toBe(true);
    expect(applied(e, 13)).toBe(14);
    expect(applied(e, 14)).toBe(15); // a second ⌘+ before prefsChanged came back steps on from 14
    expect(applied(e, 15)).toBe(15);
    e = at(13);
    expect(runCommand('view.textSmaller', e)).toBe(true);
    expect(applied(e, 13)).toBe(12);
    expect(applied(e, 12)).toBe(12);
    e = at(15);
    expect(runCommand('view.textBigger', e)).toBe(false);
    expect(runCommand('view.textReset', e)).toBe(true);
    expect(applied(e, 15)).toBe(13);
    expect(e.setTextSize).toHaveBeenCalledTimes(1);
    e = at(12);
    expect(runCommand('view.textSmaller', e)).toBe(false);
    expect(runCommand('view.textReset', at(13))).toBe(false);
    e = at(14, 'viewer');
    expect(runCommand('view.textBigger', e)).toBe(false); // the reader zooms its own content (M7)
    expect(runCommand('view.textReset', e)).toBe(false);
    expect(e.setTextSize).not.toHaveBeenCalled();
  });
  it('item commands use the targets of the given items', () => {
    const e = env();
    expect(isCommandEnabled('item.relink', e, { itemIds: [ID] })).toBe(true);
    expect(isCommandEnabled('item.relink', env({ targetsOf: () => [{ storageMode: 'managed', availability: 'available' }] }), { itemIds: [ID] })).toBe(false);
    expect(runCommand('item.open', e, { itemIds: [ID] })).toBe(true);
    expect(e.open).toHaveBeenCalledWith(ID);
  });
  it('Finder에서 보기 / 기본 앱으로 열기 run for one item whose file exists, in any view, never while blocked', () => {
    const available = (): CommandTargetInfo[] => [{ storageMode: 'managed', availability: 'available' }];
    for (const view of ['library', 'viewer'] as const) {
      const e = env({ view, targetsOf: available });
      expect(runCommand('item.showInFolder', e, { itemIds: [ID] })).toBe(true);
      expect(runCommand('item.openExternally', e, { itemIds: [ID] })).toBe(true);
      expect(e.showInFolder).toHaveBeenCalledWith(ID);
      expect(e.openExternally).toHaveBeenCalledWith(ID);
    }
    const missing = env();
    expect(runCommand('item.showInFolder', missing, { itemIds: [ID] })).toBe(false);
    expect(runCommand('item.openExternally', missing, { itemIds: [ID] })).toBe(false);
    const blocked = env({ blocked: true, targetsOf: available });
    expect(runCommand('item.openExternally', blocked, { itemIds: [ID] })).toBe(false);
    expect(blocked.openExternally).not.toHaveBeenCalled();
    expect(missing.showInFolder).not.toHaveBeenCalled();
  });
  it('runs a context-menu pick (main already judged it) unless the window is blocked', () => {
    const e = env({ targetsOf: () => [] });
    expect(runPicked('item.relink', e, [ID])).toBe(true);
    expect(e.relink).toHaveBeenCalledWith(ID);
    expect(runPicked('item.open', env({ blocked: true }), [ID])).toBe(false);
  });
  it('ignores unknown ids', () => {
    expect(runCommand('file.nope' as CommandId, env())).toBe(false);
    expect(runPicked('file.nope' as CommandId, env(), [ID])).toBe(false);
    expect(runPicked('toString' as CommandId, env(), [ID])).toBe(false); // not fooled by Object.prototype
  });
});
