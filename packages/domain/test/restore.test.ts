import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  IDLE_RESTORE_PROGRESS, NO_LIBRARY_VIEW, RESTORE_COPY, commandById, commandContextInput, inPalette, isCommandAvailable, jobCancelInput, sheetActInput,
  sheetResultInput, type CommandContextState, type LearnApi, type RestoreDoneSheet, type Result, type SheetResult,
} from '../src/index';
import { Channels } from '../src/ipc-channels';

const CTX: CommandContextState = { view: 'library', blocked: false, textSize: 13, libraryCount: 0, selectionCount: 0, selectionAvailable: 0, selectionRelinkable: 0, ...NO_LIBRARY_VIEW, trashCount: 0 };

describe('복원 in the domain (spec 9, P-20)', () => {
  it('a restore at rest is idle with nothing counted', () => {
    expect(IDLE_RESTORE_PROGRESS).toEqual({ kind: 'restore', state: 'idle', bytesDone: 0, bytesTotal: 0, done: 0, total: 0, name: null });
    expect(Object.isFrozen(IDLE_RESTORE_PROGRESS)).toBe(true);
  });

  it('what a backup folder can be refused for: each says the cause, then what to do next', () => {
    expect(Object.keys(RESTORE_COPY).sort()).toEqual(['damagedDatabase', 'damagedList', 'newerVersion', 'notEmpty', 'unknownFormat']);
    for (const [key, text] of Object.entries(RESTORE_COPY)) expect(text, key).toMatch(/^[^.]+\. [^.]+\.$/);
  });

  it('names backup:restore and the fatal screen\'s app:revealUpdateBackup', () => {
    expect(Channels.backup.restore).toBe('backup:restore');
    expect(Channels.app.revealUpdateBackup).toBe('app:revealUpdateBackup');
  });

  it('the result sheet answers 전환 or 나중에; Finder에서 보기 is an act on it carrying no path', () => {
    expect(sheetResultInput.parse({ kind: 'restoreDone', switch: true })).toEqual({ kind: 'restoreDone', switch: true });
    expect(sheetResultInput.parse({ kind: 'restoreDone', switch: false })).toEqual({ kind: 'restoreDone', switch: false });
    expect(sheetResultInput.safeParse({ kind: 'restoreDone' }).success).toBe(false);
    expect(sheetResultInput.safeParse({ kind: 'restoreDone', switch: 'yes' }).success).toBe(false);
    expect(sheetActInput.parse({ action: { kind: 'restoreDone', act: 'reveal' } })).toEqual({ action: { kind: 'restoreDone', act: 'reveal' } });
    expect(sheetActInput.safeParse({ action: { kind: 'restoreDone', act: 'reveal', folder: '/tmp' } }).success).toBe(false);
    expect(sheetActInput.safeParse({ action: { kind: 'restoreDone', act: 'switch' } }).success).toBe(false);
  });

  it('취소 names its job — the backup\'s when it names none (Task 9\'s call stays as it is)', () => {
    expect(jobCancelInput.parse(undefined)).toBeUndefined();
    expect(jobCancelInput.parse({ job: 'restore' })).toEqual({ job: 'restore' });
    expect(jobCancelInput.parse({ job: 'backup' })).toEqual({ job: 'backup' });
    for (const bad of [{ job: 'import' }, { job: 'restore', folder: '/tmp' }, { job: null }, {}]) {
      expect(jobCancelInput.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('the reported context may say a restore is on the line', () => {
    expect(commandContextInput.parse({ ...CTX, restoreRunning: true })).toMatchObject({ restoreRunning: true });
    expect(commandContextInput.safeParse({ ...CTX, restoreRunning: 'yes' }).success).toBe(false);
  });

  it('백업에서 복원…: on in every view, with or without items, behind other work; off while a restore is on the line or the window is held', () => {
    expect(isCommandAvailable('file.restore', CTX)).toBe(true);
    expect(isCommandAvailable('file.restore', { ...CTX, libraryCount: 3, view: 'viewer' })).toBe(true);
    expect(isCommandAvailable('file.restore', { ...CTX, importRunning: true, backupRunning: true })).toBe(true); // it waits its turn (spec 3.1)
    expect(isCommandAvailable('file.restore', { ...CTX, restoreRunning: true })).toBe(false);
    expect(isCommandAvailable('file.restore', { ...CTX, blocked: true })).toBe(false); // the fatal screen reports blocked
  });

  it('sits in 파일 right after 백업 만들기… and in the palette, with no key', () => {
    const c = commandById('file.restore');
    expect(c).toMatchObject({ label: '백업에서 복원…', menu: { menu: 'file', group: 3, order: 3 }, contexts: ['app'] });
    expect(c.accelerator).toBeUndefined();
    expect(inPalette(c)).toBe(true);
    expect(commandById('file.backup').menu).toMatchObject({ menu: 'file', group: 3, order: 2 });
  });

  it('types: no path goes in; the sheet answers whether to switch; the payload names the folder main made', () => {
    expectTypeOf<Parameters<LearnApi['backup']['restore']>>().toEqualTypeOf<[]>();
    expectTypeOf<ReturnType<LearnApi['backup']['restore']>>().toEqualTypeOf<Promise<Result<{ started: boolean }>>>();
    expectTypeOf<ReturnType<LearnApi['backup']['cancel']>>().toEqualTypeOf<Promise<Result<void>>>();
    expectTypeOf<Parameters<LearnApi['app']['revealUpdateBackup']>>().toEqualTypeOf<[]>();
    expectTypeOf<Extract<SheetResult, { kind: 'restoreDone' }>>().toEqualTypeOf<{ kind: 'restoreDone'; switch: boolean }>();
    expectTypeOf<RestoreDoneSheet['missing']>().toEqualTypeOf<{ count: number; titles: string[]; more: number } | null>();
  });
});
