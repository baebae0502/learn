import { describe, expect, it } from 'vitest';
import { LearnError } from '../src/errors';
import { DEFAULT_PREFS, parseSetting, prefsSchema } from '../src/settings';
import { newId } from '../src/ids';

const code = (fn: () => unknown): string | undefined => {
  try { fn(); } catch (e) { return e instanceof LearnError ? e.code : 'other'; }
  return undefined;
};

describe('settings registry', () => {
  it('accepts valid values', () => {
    expect(parseSetting('library.sort', { column: 'title', direction: 'asc' })).toEqual({ column: 'title', direction: 'asc' });
    expect(parseSetting('layout.panes', { sidebar: 240 })).toEqual({ sidebar: 240 });
    expect(parseSetting('ui.lastOpenItemId', null)).toBeNull();
    const id = newId();
    expect(parseSetting('ui.lastOpenItemId', id)).toBe(id);
  });
  it('rejects unregistered keys and bad values with VALIDATION_FAILED', () => {
    expect(code(() => parseSetting('nope', 1))).toBe('VALIDATION_FAILED');
    expect(code(() => parseSetting('library.sort', { column: 'title', direction: 'up' }))).toBe('VALIDATION_FAILED');
    expect(code(() => parseSetting('layout.panes', { sidebar: 5000 }))).toBe('VALIDATION_FAILED');
    expect(code(() => parseSetting('ui.lastOpenItemId', 'not-a-uuid'))).toBe('VALIDATION_FAILED');
    expect(code(() => parseSetting('toString', 1))).toBe('VALIDATION_FAILED');
  });
});

describe('prefs', () => {
  it('has defaults', () => {
    expect(prefsSchema.parse({})).toEqual({ theme: 'system', density: 'regular', fontSize: 13, libraryRoot: null });
    // What a window shows when reading prefs failed (renderer Boot falls back to it).
    expect(DEFAULT_PREFS).toEqual(prefsSchema.parse({}));
    expect(Object.isFrozen(DEFAULT_PREFS)).toBe(true);
  });
  it('rejects invalid values', () => {
    expect(prefsSchema.safeParse({ theme: 'neon' }).success).toBe(false);
    expect(prefsSchema.safeParse({ libraryRoot: '' }).success).toBe(false);
  });
});

import { prefsPatchInput, prefsSetInput } from '../src/ipc';

describe('prefs patch input', () => {
  it('keeps omitted keys omitted', () => {
    expect(prefsSetInput.parse({ theme: 'dark' })).toEqual({ theme: 'dark' });
    expect(prefsSetInput.parse({})).toEqual({});
  });
  it('rejects unknown keys and bad values', () => {
    expect(prefsSetInput.safeParse({ nope: 1 }).success).toBe(false);
    expect(prefsSetInput.safeParse({ theme: 'neon' }).success).toBe(false);
  });
  it('full prefs schema still defaults', () => {
    expect(prefsSchema.parse({})).toEqual({ theme: 'system', density: 'regular', fontSize: 13, libraryRoot: null });
  });
});

describe('prefs values follow the design spec', () => {
  it('accepts the three densities and the four text sizes only', () => {
    for (const density of ['compact', 'regular', 'comfortable'] as const) expect(prefsSetInput.parse({ density })).toEqual({ density });
    for (const fontSize of [12, 13, 14, 15] as const) expect(prefsSetInput.parse({ fontSize })).toEqual({ fontSize });
    expect(prefsSetInput.safeParse({ density: 'cozy' }).success).toBe(false);
    expect(prefsSetInput.safeParse({ fontSize: 16 }).success).toBe(false);
  });
});

describe('prefs inputs (R4)', () => {
  it('the renderer cannot set libraryRoot; main can', () => {
    expect(prefsSetInput.safeParse({ libraryRoot: '/tmp/lib' }).success).toBe(false);
    expect(prefsSetInput.parse({ fontSize: 14, density: 'compact' })).toEqual({ fontSize: 14, density: 'compact' });
    expect(prefsPatchInput.parse({ libraryRoot: '/tmp/lib' })).toEqual({ libraryRoot: '/tmp/lib' });
  });
});

describe('library table settings (M4 spec 3.1, 3.2)', () => {
  it('library.sort takes the new sort columns', () => {
    for (const column of ['updatedAt', 'storageMode', 'size', 'originalName'] as const) {
      expect(parseSetting('library.sort', { column, direction: 'desc' })).toEqual({ column, direction: 'desc' });
    }
  });
  it('library.columns keeps ids it does not know (a later milestone adds or drops columns) and bounds the widths', () => {
    const later = { visible: ['title', 'tags'], order: ['title', 'tags', 'year'], widths: { tags: 120, year: 70 } };
    expect(parseSetting('library.columns', later)).toEqual(later);
    expect(code(() => parseSetting('library.columns', { visible: ['title'], order: [], widths: { year: 1201 } }))).toBe('VALIDATION_FAILED');
    expect(code(() => parseSetting('library.columns', { visible: ['title'], order: [], widths: { year: 70.5 } }))).toBe('VALIDATION_FAILED');
    expect(code(() => parseSetting('library.columns', { visible: ['title'], order: [] }))).toBe('VALIDATION_FAILED');
    expect(code(() => parseSetting('library.columns', { visible: 'title', order: [], widths: {} }))).toBe('VALIDATION_FAILED');
  });
  it('library.columns bounds how many ids it stores: 64 of each, a 65th width is refused (Q-95)', () => {
    const ids = Array.from({ length: 64 }, (_, i) => `later-${i}`);
    const widths = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`later-${i}`, 100]));
    expect(parseSetting('library.columns', { visible: ['title'], order: ids, widths: widths(64) })).toEqual({ visible: ['title'], order: ids, widths: widths(64) });
    expect(code(() => parseSetting('library.columns', { visible: ['title'], order: [], widths: widths(65) }))).toBe('VALIDATION_FAILED');
    expect(code(() => parseSetting('library.columns', { visible: ['title'], order: [...ids, 'one-more'], widths: {} }))).toBe('VALIDATION_FAILED');
  });
  it('keeps the palette history as known command ids, twenty at most (palette.recent, spec §4.4)', () => {
    expect(parseSetting('palette.recent', ['app.settings', 'view.textBigger'])).toEqual(['app.settings', 'view.textBigger']);
    expect(parseSetting('palette.recent', [])).toEqual([]);
    expect(code(() => parseSetting('palette.recent', ['app.nope']))).toBe('VALIDATION_FAILED');
    expect(code(() => parseSetting('palette.recent', 'app.settings'))).toBe('VALIDATION_FAILED');
    expect(code(() => parseSetting('palette.recent', Array.from({ length: 21 }, () => 'app.settings')))).toBe('VALIDATION_FAILED');
  });
});
