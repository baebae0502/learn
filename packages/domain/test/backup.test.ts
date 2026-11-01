import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  EventChannels, IDLE_BACKUP_PROGRESS, MAIN_WRITTEN_SETTINGS, NO_LIBRARY_VIEW, commandById, commandContextInput, inPalette, isCommandAvailable, parseSetting,
  prefsPatchInput, prefsSchema, prefsSetInput, sheetActInput, sheetResultInput,
  type BackupInfo, type CommandContextState, type JobProgress, type LearnApi, type Result,
} from '../src/index';

const CTX: CommandContextState = { view: 'library', blocked: false, textSize: 13, libraryCount: 0, selectionCount: 0, selectionAvailable: 0, selectionRelinkable: 0, ...NO_LIBRARY_VIEW, trashCount: 0 };

describe('백업 in the domain (spec 8, P-20, P-21)', () => {
  it('backup.last: when, and an absolute folder, nothing else; main alone writes it', () => {
    const last = { at: '2026-10-30T12:41:00.000Z', folder: '/Users/seojin/Documents/Learn 백업 2026-10-30 2141' };
    expect(parseSetting('backup.last', last)).toEqual(last);
    for (const bad of [{ ...last, folder: 'Documents/x' }, { at: '', folder: last.folder }, { ...last, extra: 1 }, { at: last.at }]) {
      expect(() => parseSetting('backup.last', bad), JSON.stringify(bad)).toThrow();
    }
    expect(MAIN_WRITTEN_SETTINGS.has('backup.last')).toBe(true);
    expect(MAIN_WRITTEN_SETTINGS.has('recovery.lastShown')).toBe(true); // Task 8's stays
  });

  it('prefs.backupDir: null by default, main\'s to set, never the renderer\'s (R4)', () => {
    expect(prefsSchema.parse({}).backupDir).toBeNull();
    expect(prefsPatchInput.parse({ backupDir: '/Users/seojin/Documents' })).toEqual({ backupDir: '/Users/seojin/Documents' });
    expect(prefsSetInput.safeParse({ backupDir: '/tmp' }).success).toBe(false);
  });

  it('job:progress is a push of its own; a backup at rest is idle with nothing counted', () => {
    expect(EventChannels['job:progress']).toBe('evt:job-progress');
    expect(IDLE_BACKUP_PROGRESS).toEqual({ kind: 'backup', state: 'idle', bytesDone: 0, bytesTotal: 0, done: 0, total: 0, name: null });
    expect(Object.isFrozen(IDLE_BACKUP_PROGRESS)).toBe(true);
  });

  it('the result sheet: 완료 answers it, Finder에서 보기 is an act on it carrying no path', () => {
    expect(sheetResultInput.parse({ kind: 'backupDone' })).toEqual({ kind: 'backupDone' });
    expect(sheetActInput.parse({ action: { kind: 'backupDone', act: 'reveal' } })).toEqual({ action: { kind: 'backupDone', act: 'reveal' } });
    expect(sheetActInput.safeParse({ action: { kind: 'backupDone', act: 'reveal', folder: '/tmp' } }).success).toBe(false);
    expect(sheetActInput.safeParse({ action: { kind: 'backupDone', act: 'delete' } }).success).toBe(false);
  });

  it('the reported context may say a backup is on the line', () => {
    expect(commandContextInput.parse({ ...CTX, backupRunning: true })).toMatchObject({ backupRunning: true });
    expect(commandContextInput.safeParse({ ...CTX, backupRunning: 'yes' }).success).toBe(false);
  });

  it('백업 만들기…: on with something to back up — items, or only a trash — off while a backup is on the line or the window is held', () => {
    expect(isCommandAvailable('file.backup', CTX)).toBe(false);
    expect(isCommandAvailable('file.backup', { ...CTX, libraryCount: 3 })).toBe(true);
    expect(isCommandAvailable('file.backup', { ...CTX, trashCount: 2 })).toBe(true);
    expect(isCommandAvailable('file.backup', { ...CTX, libraryCount: 3, view: 'viewer' })).toBe(true);
    expect(isCommandAvailable('file.backup', { ...CTX, libraryCount: 3, importRunning: true })).toBe(true); // it waits its turn (spec 3.1)
    expect(isCommandAvailable('file.backup', { ...CTX, libraryCount: 3, backupRunning: true })).toBe(false);
    expect(isCommandAvailable('file.backup', { ...CTX, libraryCount: 3, blocked: true })).toBe(false);
  });

  it('sits in 파일 right after 라이브러리 점검… and in the palette, with no key', () => {
    const c = commandById('file.backup');
    expect(c).toMatchObject({ label: '백업 만들기…', menu: { menu: 'file', group: 3, order: 2 }, contexts: ['app'] });
    expect(c.accelerator).toBeUndefined();
    expect(inPalette(c)).toBe(true);
    expect(commandById('file.checkLibrary').menu).toMatchObject({ menu: 'file', group: 3, order: 1 });
  });

  it('types: no path goes in; the settings window gets the folder\'s name, never its path', () => {
    expectTypeOf<Parameters<LearnApi['backup']['create']>>().toEqualTypeOf<[]>();
    expectTypeOf<ReturnType<LearnApi['backup']['create']>>().toEqualTypeOf<Promise<Result<{ started: boolean }>>>();
    expectTypeOf<ReturnType<LearnApi['backup']['cancel']>>().toEqualTypeOf<Promise<Result<void>>>();
    expectTypeOf<ReturnType<LearnApi['app']['backupInfo']>>().toEqualTypeOf<Promise<Result<BackupInfo | null>>>();
    expectTypeOf<BackupInfo>().toEqualTypeOf<{ at: string; folderName: string }>();
    expectTypeOf<JobProgress['kind']>().toEqualTypeOf<'backup' | 'restore'>();
  });
});
