import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LearnError } from '@learn/domain';
import { PREFS_FILE, openPrefsStore, resolveLibraryRoot } from './prefs';

let dir: string;
const file = () => path.join(dir, PREFS_FILE);
const DEFAULTS = { theme: 'system', density: 'regular', fontSize: 13, libraryRoot: null };
const ABS = path.resolve(os.tmpdir(), 'learn-lib');
const errno = (code: string) => Object.assign(new Error(code), { code });

/** Make reads of one path fail with `code`; every other read goes through. */
function failReadOf(target: string, code: string): void {
  const real = fs.readFileSync;
  vi.spyOn(fs, 'readFileSync').mockImplementation(((p: fs.PathOrFileDescriptor, o?: unknown) => {
    if (p === target) throw errno(code);
    return real(p, o as never);
  }) as typeof fs.readFileSync);
}

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

  it('writes atomically: a unique tmp file in the same directory, then rename — never in place', () => {
    const realOpen = fs.openSync;
    const realRename = fs.renameSync;
    const openedForWrite: string[] = [];
    const renames: Array<{ from: string; to: string; targetExisted: boolean; tmpContent: string }> = [];
    vi.spyOn(fs, 'openSync').mockImplementation(((p: fs.PathLike, flags?: fs.OpenMode, mode?: fs.Mode) => {
      if (flags === 'w') openedForWrite.push(String(p));
      return realOpen(p, flags as fs.OpenMode, mode);
    }) as typeof fs.openSync);
    vi.spyOn(fs, 'renameSync').mockImplementation((from: fs.PathLike, to: fs.PathLike) => {
      renames.push({ from: String(from), to: String(to), targetExisted: fs.existsSync(String(to)), tmpContent: fs.readFileSync(from, 'utf8') });
      realRename(from, to);
    });
    const store = openPrefsStore(dir);
    store.set({ theme: 'dark' });
    store.set({ theme: 'light' });

    expect(openedForWrite).not.toContain(file()); // the real file is never opened for writing
    expect(renames).toHaveLength(2);
    const host = os.hostname().replace(/[^A-Za-z0-9.-]/g, '_').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const tmpName = new RegExp(`^preferences\\.json\\.tmp-${process.pid}-${host}-[0-9a-f]{12}$`);
    for (const r of renames) {
      expect(r.to).toBe(file());
      expect(path.dirname(r.from)).toBe(dir);
      expect(path.basename(r.from)).toMatch(tmpName);
      expect(openedForWrite).toContain(r.from);
    }
    expect(renames[0]!.targetExisted).toBe(false); // the file first appears through the rename
    expect(JSON.parse(renames[0]!.tmpContent)).toEqual({ ...DEFAULTS, theme: 'dark' }); // complete before it is renamed
    expect(renames[0]!.from).not.toBe(renames[1]!.from); // unique per write
    expect(fs.readdirSync(dir)).toEqual([PREFS_FILE]); // no temp files left behind
  });

  it('fsyncs the directory after the rename, ignoring platforms that cannot open a directory', () => {
    const realOpen = fs.openSync;
    const realRename = fs.renameSync;
    const events: string[] = [];
    vi.spyOn(fs, 'renameSync').mockImplementation((from: fs.PathLike, to: fs.PathLike) => {
      events.push('rename');
      realRename(from, to);
    });
    vi.spyOn(fs, 'openSync').mockImplementation(((p: fs.PathLike, flags?: fs.OpenMode, mode?: fs.Mode) => {
      if (String(p) === dir) events.push(`open-dir:${String(flags)}`);
      return realOpen(p, flags as fs.OpenMode, mode);
    }) as typeof fs.openSync);
    const fsync = vi.spyOn(fs, 'fsyncSync');
    openPrefsStore(dir).set({ theme: 'dark' });
    expect(events).toEqual(['rename', 'open-dir:r']);
    expect(fsync).toHaveBeenCalledTimes(2); // tmp file, then directory

    for (const code of ['EISDIR', 'EPERM', 'EINVAL']) {
      vi.mocked(fs.openSync).mockImplementation(((p: fs.PathLike, flags?: fs.OpenMode, mode?: fs.Mode) => {
        if (String(p) === dir) throw errno(code);
        return realOpen(p, flags as fs.OpenMode, mode);
      }) as typeof fs.openSync);
      expect(openPrefsStore(dir).set({ theme: 'light' }).theme).toBe('light');
    }
    expect(console.warn).not.toHaveBeenCalled();
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

  it('fills defaults for keys missing from an older file; unknown keys are not exposed', () => {
    fs.writeFileSync(file(), JSON.stringify({ theme: 'dark', future: 1 }));
    expect(openPrefsStore(dir).get()).toEqual({ ...DEFAULTS, theme: 'dark' });
  });

  it('an invalid field falls back to its default on its own: the other fields and libraryRoot survive, nothing is moved', () => {
    const body = JSON.stringify({ theme: 'blue', density: 'compact', fontSize: 99, libraryRoot: ABS });
    fs.writeFileSync(file(), body);
    const store = openPrefsStore(dir);
    expect(store.get()).toEqual({ theme: 'system', density: 'compact', fontSize: 13, libraryRoot: ABS });
    expect(store.readOnly).toBe(false);
    expect(vi.mocked(console.warn).mock.calls).toEqual([['PREFS_FIELD_INVALID theme'], ['PREFS_FIELD_INVALID fontSize']]);
    expect(fs.readdirSync(dir)).toEqual([PREFS_FILE]); // not quarantined
    expect(fs.readFileSync(file(), 'utf8')).toBe(body);
    expect(resolveLibraryRoot({ envDir: undefined, prefs: store.get(), userData: dir })).toBe(ABS);
  });

  it('saving keeps keys (and values) this build does not know, so a newer build\'s prefs survive', () => {
    fs.writeFileSync(file(), JSON.stringify({ theme: 'sepia', libraryRoot: ABS, future: { shortcuts: { 'library.import': 'Cmd+I' } } }));
    const store = openPrefsStore(dir);
    expect(store.set({ density: 'compact' })).toEqual({ ...DEFAULTS, density: 'compact', libraryRoot: ABS });
    expect(JSON.parse(fs.readFileSync(file(), 'utf8'))).toEqual({
      theme: 'sepia', density: 'compact', fontSize: 13, libraryRoot: ABS, future: { shortcuts: { 'library.import': 'Cmd+I' } },
    });
    expect(store.set({ theme: 'dark' }).theme).toBe('dark');
    expect(JSON.parse(fs.readFileSync(file(), 'utf8'))).toMatchObject({ theme: 'dark', future: { shortcuts: { 'library.import': 'Cmd+I' } } });
    expect(openPrefsStore(dir).get()).toEqual({ ...DEFAULTS, theme: 'dark', density: 'compact', libraryRoot: ABS });
  });

  it('rejects an invalid or unknown patch key with VALIDATION_FAILED and writes nothing', () => {
    const store = openPrefsStore(dir);
    for (const patch of [{ theme: 'neon' }, { fontSize: 16 }, { nope: 1 }]) {
      let err: unknown;
      try {
        store.set(patch as never);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(LearnError);
      expect((err as LearnError).code).toBe('VALIDATION_FAILED');
    }
    expect(fs.existsSync(file())).toBe(false);
    expect(store.get()).toEqual(DEFAULTS);
  });

  it.each([
    ['unparseable JSON', '{ theme: dark'],
    ['not an object', '[]'],
    ['null', 'null'],
    ['a bare string', '"dark"'],
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

  it('moves an unreadable file (read error other than ENOENT) aside and starts from defaults', () => {
    const body = JSON.stringify({ theme: 'dark' });
    fs.writeFileSync(file(), body);
    failReadOf(file(), 'EIO');
    const store = openPrefsStore(dir, { now: () => new Date('2026-10-21T01:02:03.456Z') });
    expect(store.get()).toEqual(DEFAULTS);
    expect(store.readOnly).toBe(false);
    expect(console.warn).toHaveBeenCalledWith('PREFS_READ_FAILED EIO');
    vi.mocked(fs.readFileSync).mockRestore();
    expect(fs.readFileSync(path.join(dir, 'preferences.invalid-2026-10-21T01-02-03-456Z.json'), 'utf8')).toBe(body);
    expect(store.set({ theme: 'light' }).theme).toBe('light');
  });

  it.each([
    ['unreadable', 'EACCES'],
    ['corrupt', null],
  ] as const)('stays read-only for the session when a %s file cannot be moved aside', (_kind, readError) => {
    const body = readError ? JSON.stringify({ theme: 'dark' }) : '{ broken';
    fs.writeFileSync(file(), body);
    if (readError) failReadOf(file(), readError);
    vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw errno('EACCES');
    });
    const store = openPrefsStore(dir);
    expect(store.get()).toEqual(DEFAULTS);
    expect(store.readOnly).toBe(true);
    expect(console.warn).toHaveBeenCalledWith('PREFS_QUARANTINE_FAILED EACCES');

    const open = vi.spyOn(fs, 'openSync');
    let err: unknown;
    try {
      store.set({ theme: 'light' });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(LearnError);
    expect((err as LearnError).code).toBe('PREFS_UNAVAILABLE');
    expect(open).not.toHaveBeenCalled(); // nothing was written, not even a tmp file
    expect(store.get()).toEqual(DEFAULTS);
    vi.restoreAllMocks();
    expect(fs.readFileSync(file(), 'utf8')).toBe(body);
    expect(fs.readdirSync(dir)).toEqual([PREFS_FILE]);
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
  const prefs = (libraryRoot: string | null) => ({ theme: 'system', density: 'regular', fontSize: 13, libraryRoot }) as const;

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
