import { describe, expect, it } from 'vitest';
import { COMMANDS, commandById } from '../src/commands';
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

describe('command registry', () => {
  it('has unique ids and resolves by id', () => {
    const ids = COMMANDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of COMMANDS) expect(commandById(c.id)).toBe(c);
  });
  it('has no duplicate accelerators within a context', () => {
    const seen = new Set<string>();
    for (const c of COMMANDS) {
      if (!c.accelerator) continue;
      for (const ctx of c.contexts) {
        const k = `${ctx}|${c.accelerator}`;
        expect(seen.has(k), k).toBe(false);
        seen.add(k);
      }
    }
  });
  it('menu commands have non-empty labels; all labels non-empty', () => {
    for (const c of COMMANDS) {
      expect(c.label.trim().length, c.id).toBeGreaterThan(0);
      if (c.menu) expect(Number.isInteger(c.menu.group) && Number.isInteger(c.menu.order)).toBe(true);
    }
  });
  it('accelerators use valid syntax', () => {
    const re = /^((CmdOrCtrl|Alt|Shift|Ctrl)\+)*([A-Za-z0-9]|\[|\]|F\d{1,2}|Enter|Delete|Backspace)$/;
    for (const c of COMMANDS) if (c.accelerator) expect(c.accelerator, c.id).toMatch(re);
  });
  it('defines the M2 commands', () => {
    expect(COMMANDS.map((c) => c.id).sort()).toEqual(['file.importLinked', 'file.importManaged', 'item.open', 'item.relink', 'nav.back']);
    expect(commandById('file.importManaged').accelerator).toBe('CmdOrCtrl+O');
    expect(commandById('nav.back').contexts).toContain('viewer');
    expect(commandById('item.relink').contextMenu).toBe(true);
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
