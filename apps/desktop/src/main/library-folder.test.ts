import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { LearnError, type Prefs } from '@learn/domain';
import { createQuitGuard } from './jobs/quit-guard';
import { checkLibraryFolder, createLibrarySwitch, insideFolder, refuseLinkedInside, type LibrarySwitch } from './library-folder';
import { mainStrings } from './strings';

describe('checkLibraryFolder (R4)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-folder-'));
  afterAll(() => {
    if (fs.existsSync(path.join(tmp, 'ro'))) fs.chmodSync(path.join(tmp, 'ro'), 0o755);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  it('accepts an existing writable folder', () => {
    expect(checkLibraryFolder(tmp)).toEqual({ ok: true });
  });
  it('rejects a missing path and a file, with the cause and the next step', () => {
    expect(checkLibraryFolder(path.join(tmp, 'nope'))).toEqual({ ok: false, message: '폴더를 찾을 수 없습니다. 다른\u00a0폴더를 고르세요.' });
    const file = path.join(tmp, 'f.txt');
    fs.writeFileSync(file, 'x');
    expect(checkLibraryFolder(file)).toEqual({ ok: false, message: '폴더가 아닙니다. 다른\u00a0폴더를 고르세요.' });
  });
  it.skipIf(process.getuid?.() === 0)('rejects a folder this user cannot write to', () => {
    const ro = path.join(tmp, 'ro');
    fs.mkdirSync(ro, { mode: 0o555 });
    expect(checkLibraryFolder(ro)).toMatchObject({ ok: false, message: expect.stringContaining('쓸 수 없습니다') });
  });
});

describe('insideFolder: the folder itself or anything under it', () => {
  it('is true for the folder and its descendants, false for siblings and parents — also ones whose name starts with ..', () => {
    expect(insideFolder('/a/lib', '/a/lib')).toBe(true);
    expect(insideFolder('/a/lib/assets/aa', '/a/lib')).toBe(true);
    expect(insideFolder('/a/lib/', '/a/lib')).toBe(true);
    expect(insideFolder('/a/library', '/a/lib')).toBe(false);
    expect(insideFolder('/a', '/a/lib')).toBe(false);
    expect(insideFolder('/a/..lib', '/a')).toBe(true);
  });
});

describe('createLibrarySwitch (app.chooseLibraryFolder and the restore\'s 전환)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-switch-'));
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  /** A switch with fake prefs and a quit that goes through the real quit guard: `busy` is the lane's job, `stays` the user's answer. */
  function setup(opts: { busy?: 'import' | null; stays?: boolean } = {}) {
    const saved: Array<string | null> = [];
    let root: string | null = '/old/library';
    const arm = vi.fn();
    const prefs = {
      get: () => ({ theme: 'system', density: 'regular', fontSize: 13, libraryRoot: root, backupDir: null }) as Prefs,
      set: (patch: { libraryRoot?: string | null }) => {
        if (patch.libraryRoot !== undefined) {
          root = patch.libraryRoot;
          saved.push(root);
        }
        return prefs.get();
      },
    };
    const holder: { sw?: LibrarySwitch } = {};
    const quits: string[] = [];
    const guard = createQuitGuard<'main'>({
      lane: { busy: () => opts.busy ?? null, cancelAll: () => {}, idle: () => Promise.resolve() },
      remaining: () => 3,
      owner: () => 'main',
      ask: async () => !opts.stays,
      quit: () => {
        quits.push('quit');
        holder.sw!.apply(); // will-quit of the second, unasked quit
      },
      onStay: () => holder.sw!.cancel(),
    });
    holder.sw = createLibrarySwitch({
      prefs,
      arm,
      quit: () => {
        const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
        if (!guard.onBeforeQuit(event)) holder.sw!.apply(); // nothing held the quit: it goes ahead at once
      },
    });
    return { sw: holder.sw, saved, arm, root: () => root, quits };
  }
  const settle = () => new Promise((r) => setTimeout(r, 0));

  it('saves the folder and arms the restart once the quit goes ahead — not before, and only once', () => {
    const h = setup();
    h.sw.request(tmp);
    expect(h.root()).toBe(tmp);
    expect(h.arm).toHaveBeenCalledTimes(1);
    h.sw.apply();
    expect(h.arm).toHaveBeenCalledTimes(1);
  });
  it('a busy lane and a user who stays: prefs keep the open library, no restart is armed, and the next quit does not relaunch', async () => {
    const h = setup({ busy: 'import', stays: true });
    h.sw.request(tmp);
    await settle();
    expect(h.root()).toBe('/old/library');
    expect(h.arm).not.toHaveBeenCalled();
    h.sw.apply(); // the next normal quit
    expect(h.root()).toBe('/old/library');
    expect(h.arm).not.toHaveBeenCalled();
  });
  it('a busy lane and a user who quits: the folder is saved and the restart armed once, after the work stopped', async () => {
    const h = setup({ busy: 'import', stays: false });
    h.sw.request(tmp);
    expect(h.arm).not.toHaveBeenCalled();
    await settle();
    expect(h.root()).toBe(tmp);
    expect(h.arm).toHaveBeenCalledTimes(1);
  });
  it('a folder that is gone is refused with the cause and the next step; prefs that cannot be saved stop it before the quit', () => {
    const quit = vi.fn();
    const set = vi.fn();
    const prefs = { get: () => ({ libraryRoot: null }) as Prefs, set };
    expect(() => createLibrarySwitch({ prefs, arm: vi.fn(), quit }).request(path.join(tmp, 'gone'))).toThrow(mainStrings.libraryFolder.missing);
    expect(set).not.toHaveBeenCalled();
    const readOnly = () => {
      throw new LearnError('PREFS_UNAVAILABLE', mainStrings.prefs.readOnly);
    };
    expect(() => createLibrarySwitch({ prefs: { get: prefs.get, set: readOnly }, arm: vi.fn(), quit }).request(tmp)).toThrow(mainStrings.prefs.readOnly);
    expect(quit).not.toHaveBeenCalled();
  });
});

describe('refuseLinkedInside (a linked import of a file inside the library folder)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-linked-'));
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const root = path.join(tmp, 'Library');
  fs.mkdirSync(path.join(root, 'assets', 'ab'), { recursive: true });
  const inside = path.join(root, 'assets', 'ab', 'abcdef');
  fs.writeFileSync(inside, 'x');
  const outside = path.join(tmp, 'elsewhere.pdf');
  fs.writeFileSync(outside, 'x');
  const imported = (p: string) => ({ status: 'failed', path: p, code: 'INTERNAL', message: 'asked' }) as const;

  it('fails a linked file inside the library folder with the reason, and does not ask the importer', async () => {
    const importOne = vi.fn(async (p: string) => imported(p));
    const guarded = refuseLinkedInside({ importOne }, root);
    expect(await guarded.importOne(inside, { mode: 'linked' })).toEqual({
      status: 'failed', path: inside, code: 'VALIDATION_FAILED', message: mainStrings.libraryFolder.linkedInside,
    });
    expect(importOne).not.toHaveBeenCalled();
  });
  it('lets a managed import of the same file copy it, and a linked file outside go through', async () => {
    const importOne = vi.fn(async (p: string) => imported(p));
    const guarded = refuseLinkedInside({ importOne }, root);
    await guarded.importOne(inside, { mode: 'managed' });
    await guarded.importOne(outside, { mode: 'linked' });
    expect(importOne).toHaveBeenCalledTimes(2);
  });
  it('sees a link into the folder by the real path', async () => {
    const link = path.join(tmp, 'link');
    fs.symlinkSync(root, link);
    const importOne = vi.fn(async (p: string) => imported(p));
    const out = await refuseLinkedInside({ importOne }, root).importOne(path.join(link, 'assets', 'ab', 'abcdef'), { mode: 'linked' });
    expect(out).toMatchObject({ status: 'failed', code: 'VALIDATION_FAILED' });
  });
});
