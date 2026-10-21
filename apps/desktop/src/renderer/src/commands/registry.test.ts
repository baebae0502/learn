import { describe, expect, it, vi } from 'vitest';
import { COMMANDS, type CommandId, type CommandTargetInfo } from '@learn/domain';
import { COMMAND_HANDLERS, contextOf, isCommandEnabled, runCommand, runPicked, type CommandEnv } from './registry';

const ID = '7d3f3c3e-8a51-4f7e-9d7c-2b1f0f6f8f10';
const missingLinked: CommandTargetInfo = { storageMode: 'linked', availability: 'missing' };
const env = (over: Partial<CommandEnv> = {}): CommandEnv => ({
  view: 'library',
  blocked: false,
  targetsOf: (ids) => ids.map(() => missingLinked),
  importFiles: vi.fn(),
  back: vi.fn(),
  open: vi.fn(),
  relink: vi.fn(),
  toggleSidebar: vi.fn(),
  showShortcuts: vi.fn(),
  showInFolder: vi.fn(),
  openExternally: vi.fn(),
  ...over,
});

describe('renderer command registry', () => {
  it('has a handler for every registry command and nothing else (no fake controls)', () => {
    expect(Object.keys(COMMAND_HANDLERS).sort()).toEqual(COMMANDS.map((c) => c.id).sort());
  });
  it('reports only the context fields, never the handlers', () => {
    expect(contextOf(env({ view: 'viewer' }))).toEqual({ view: 'viewer', blocked: false });
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
