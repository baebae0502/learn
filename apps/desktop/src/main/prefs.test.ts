import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LearnError } from '@learn/domain';
import { PREFS_FILE, openPrefsStore, resolveLibraryRoot } from './prefs';

let dir: string;
const file = () => path.join(dir, PREFS_FILE);
const DEFAULTS = { theme: 'system', density: 'comfortable', libraryRoot: null };
const ABS = path.resolve(os.tmpdir(), 'learn-lib');

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-prefs-'));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('prefs store', () => {
  it('uses defaults when the file is missing and does not create it until a change', () => {
    const store = openPrefsStore(dir);
    expect(store.get()).toEqual(DEFAULTS);
    expect(fs.existsSync(file())).toBe(false);
  });

  it('merges a patch over the stored prefs and persists it', () => {
    const store = openPrefsStore(dir);
    expect(store.set({ theme: 'dark' })).toEqual({ ...DEFAULTS, theme: 'dark' });
    expect(store.set({ density: 'compact' })).toEqual({ ...DEFAULTS, theme: 'dark', density: 'compact' });
    expect(JSON.parse(fs.readFileSync(file(), 'utf8'))).toEqual({ ...DEFAULTS, theme: 'dark', density: 'compact' });
    expect(openPrefsStore(dir).get()).toEqual({ ...DEFAULTS, theme: 'dark', density: 'compact' });
  });

  it('ignores keys that are present but undefined (no silent reset to defaults)', () => {
    const store = openPrefsStore(dir);
    store.set({ theme: 'light' });
    expect(store.set({ theme: undefined, density: 'compact' })).toEqual({ ...DEFAULTS, theme: 'light', density: 'compact' });
  });

  it('get() returns a copy', () => {
    const store = openPrefsStore(dir);
    (store.get() as { theme: string }).theme = 'dark';
    expect(store.get().theme).toBe('system');
  });

  it('writes atomically: no temp files are left behind', () => {
    const store = openPrefsStore(dir);
    store.set({ theme: 'dark' });
    store.set({ theme: 'light' });
    expect(fs.readdirSync(dir)).toEqual([PREFS_FILE]);
  });

  it('accepts an absolute libraryRoot and clears it with null; rejects a relative one', () => {
    const store = openPrefsStore(dir);
    expect(store.set({ libraryRoot: ABS }).libraryRoot).toBe(ABS);
    expect(store.set({ libraryRoot: null }).libraryRoot).toBeNull();
    let err: unknown;
    try {
      store.set({ libraryRoot: 'relative/lib' });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(LearnError);
    expect((err as LearnError).code).toBe('VALIDATION_FAILED');
    expect(store.get().libraryRoot).toBeNull();
  });

  it('a hand-edited relative libraryRoot does not block other changes', () => {
    fs.writeFileSync(file(), JSON.stringify({ libraryRoot: 'rel/lib' }));
    expect(openPrefsStore(dir).set({ theme: 'dark' })).toEqual({ ...DEFAULTS, theme: 'dark', libraryRoot: 'rel/lib' });
  });

  it('fills defaults for keys missing from an older file and drops unknown keys', () => {
    fs.writeFileSync(file(), JSON.stringify({ theme: 'dark', future: 1 }));
    expect(openPrefsStore(dir).get()).toEqual({ ...DEFAULTS, theme: 'dark' });
  });

  it.each([
    ['unparseable JSON', '{ theme: dark'],
    ['schema mismatch', JSON.stringify({ theme: 'blue' })],
    ['not an object', '[]'],
  ])('quarantines a corrupt file (%s) and starts from defaults', (_label, body) => {
    fs.writeFileSync(file(), body);
    const store = openPrefsStore(dir, { now: () => new Date('2026-10-21T01:02:03.456Z') });
    expect(store.get()).toEqual(DEFAULTS);
    expect(fs.existsSync(file())).toBe(false);
    const kept = path.join(dir, 'preferences.invalid-2026-10-21T01-02-03-456Z.json');
    expect(fs.readFileSync(kept, 'utf8')).toBe(body);
    expect(console.warn).toHaveBeenCalledWith('PREFS_INVALID');
    store.set({ theme: 'dark' });
    expect(fs.readFileSync(kept, 'utf8')).toBe(body); // preserved after the next save
  });

  it('does not overwrite an earlier quarantined file with the same timestamp', () => {
    const now = () => new Date('2026-10-21T01:02:03.456Z');
    fs.writeFileSync(file(), 'first');
    openPrefsStore(dir, { now });
    fs.writeFileSync(file(), 'second');
    openPrefsStore(dir, { now });
    const kept = fs.readdirSync(dir).filter((f) => f.startsWith('preferences.invalid-')).sort();
    expect(kept).toHaveLength(2);
    expect(kept.map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).sort()).toEqual(['first', 'second']);
  });

  it('keeps the in-memory prefs when saving fails', () => {
    const store = openPrefsStore(dir);
    fs.rmSync(dir, { recursive: true, force: true }); // directory gone → write fails
    expect(() => store.set({ theme: 'dark' })).toThrow(LearnError);
    expect(store.get().theme).toBe('system');
  });
});

describe('resolveLibraryRoot', () => {
  const userData = path.resolve(os.tmpdir(), 'ud');
  const prefs = (libraryRoot: string | null) => ({ theme: 'system', density: 'comfortable', libraryRoot }) as const;

  it('LEARN_LIBRARY_DIR wins over prefs.libraryRoot', () => {
    expect(resolveLibraryRoot({ envDir: '/env/lib', prefs: prefs(ABS), userData })).toBe('/env/lib');
  });
  it('uses prefs.libraryRoot when no env override', () => {
    expect(resolveLibraryRoot({ envDir: undefined, prefs: prefs(ABS), userData })).toBe(ABS);
    expect(resolveLibraryRoot({ envDir: '', prefs: prefs(ABS), userData })).toBe(ABS);
  });
  it('falls back to userData/Library (also for a hand-edited relative libraryRoot)', () => {
    expect(resolveLibraryRoot({ envDir: undefined, prefs: prefs(null), userData })).toBe(path.join(userData, 'Library'));
    expect(resolveLibraryRoot({ envDir: undefined, prefs: prefs('rel/lib'), userData })).toBe(path.join(userData, 'Library'));
  });
});
