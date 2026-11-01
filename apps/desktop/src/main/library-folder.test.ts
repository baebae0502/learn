import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { LearnError } from '@learn/domain';
import { checkLibraryFolder, insideFolder, switchLibrary } from './library-folder';
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

describe('switchLibrary (app.chooseLibraryFolder and the restore\'s 전환)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-switch-'));
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
  it('checks the folder, saves it as the library folder, tells every window, then restarts — in that order', () => {
    const order: string[] = [];
    switchLibrary(tmp, {
      prefs: {
        set: (patch) => {
          order.push(`set ${patch.libraryRoot}`);
          return { theme: 'system', density: 'regular', fontSize: 13, libraryRoot: patch.libraryRoot ?? null, backupDir: null };
        },
      },
      announce: (prefs) => void order.push(`announce ${prefs.libraryRoot}`),
      relaunch: () => void order.push('relaunch'),
    });
    expect(order).toEqual([`set ${tmp}`, `announce ${tmp}`, 'relaunch']);
  });
  it('a folder that is gone is refused with the cause and the next step; prefs that cannot be saved stop it before the restart', () => {
    const relaunch = vi.fn();
    const set = vi.fn();
    expect(() => switchLibrary(path.join(tmp, 'gone'), { prefs: { set }, announce: () => {}, relaunch })).toThrow(mainStrings.libraryFolder.missing);
    expect(set).not.toHaveBeenCalled();
    const readOnly = () => {
      throw new LearnError('PREFS_UNAVAILABLE', mainStrings.prefs.readOnly);
    };
    expect(() => switchLibrary(tmp, { prefs: { set: readOnly }, announce: () => {}, relaunch })).toThrow(mainStrings.prefs.readOnly);
    expect(relaunch).not.toHaveBeenCalled();
  });
});
