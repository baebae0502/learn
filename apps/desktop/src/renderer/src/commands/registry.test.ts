import { describe, expect, it, vi } from 'vitest';
import { COMMANDS, type CommandId } from '@learn/domain';
import { COMMAND_HANDLERS, runCommand, type CommandEnv } from './registry';

const env = (over: Partial<CommandEnv> = {}): CommandEnv => ({
  view: 'library',
  blocked: false,
  importFiles: vi.fn(),
  back: vi.fn(),
  open: vi.fn(),
  relink: vi.fn(),
  ...over,
});
const ID = '7d3f3c3e-8a51-4f7e-9d7c-2b1f0f6f8f10';

describe('renderer command registry', () => {
  it('has a handler for every registry command and nothing else (no fake controls)', () => {
    expect(Object.keys(COMMAND_HANDLERS).sort()).toEqual(COMMANDS.map((c) => c.id).sort());
  });

  it('imports only from the library view', () => {
    const lib = env();
    expect(runCommand('file.importManaged', lib)).toBe(true);
    expect(runCommand('file.importLinked', lib)).toBe(true);
    expect(lib.importFiles).toHaveBeenNthCalledWith(1, 'managed');
    expect(lib.importFiles).toHaveBeenNthCalledWith(2, 'linked');
    const viewer = env({ view: 'viewer' });
    expect(runCommand('file.importManaged', viewer)).toBe(false);
    expect(viewer.importFiles).not.toHaveBeenCalled();
  });

  it('goes back only from the viewer', () => {
    const viewer = env({ view: 'viewer' });
    expect(runCommand('nav.back', viewer)).toBe(true);
    expect(viewer.back).toHaveBeenCalledTimes(1);
    const lib = env();
    expect(runCommand('nav.back', lib)).toBe(false);
    expect(lib.back).not.toHaveBeenCalled();
  });

  it('item commands need exactly one target item', () => {
    const e = env();
    expect(runCommand('item.open', e)).toBe(false);
    expect(runCommand('item.open', e, { itemIds: [ID, ID] })).toBe(false);
    expect(runCommand('item.open', e, { itemIds: [ID] })).toBe(true);
    expect(runCommand('item.relink', e, { itemIds: [ID] })).toBe(true);
    expect(e.open).toHaveBeenCalledWith(ID);
    expect(e.relink).toHaveBeenCalledWith(ID);
  });

  it('ignores everything while blocked (import running or a dialog open)', () => {
    const e = env({ blocked: true, view: 'viewer' });
    for (const c of COMMANDS) expect(runCommand(c.id, e, { itemIds: [ID] })).toBe(false);
    for (const fn of [e.importFiles, e.back, e.open, e.relink]) expect(fn).not.toHaveBeenCalled();
  });

  it('ignores unknown ids', () => {
    expect(runCommand('file.nope' as CommandId, env())).toBe(false);
  });
});
