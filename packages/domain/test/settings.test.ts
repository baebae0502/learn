import { describe, expect, it } from 'vitest';
import { LearnError } from '../src/errors';
import { parseSetting, prefsSchema } from '../src/settings';
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
    expect(prefsSchema.parse({})).toEqual({ theme: 'system', density: 'comfortable', libraryRoot: null });
  });
  it('rejects invalid values', () => {
    expect(prefsSchema.safeParse({ theme: 'neon' }).success).toBe(false);
    expect(prefsSchema.safeParse({ libraryRoot: '' }).success).toBe(false);
  });
});

import { prefsSetInput } from '../src/ipc';

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
    expect(prefsSchema.parse({})).toEqual({ theme: 'system', density: 'comfortable', libraryRoot: null });
  });
});
