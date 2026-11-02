import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { IDLE_BACKUP_PROGRESS, IDLE_RESTORE_PROGRESS, LearnError, type Result } from '@learn/domain';
import { SettingsRepository, migrate, openDatabase } from '@learn/db';
import { mainStrings } from '../strings';
import { fakeSender, stubDeps } from './test-deps';

type Listener = (event: unknown, raw: unknown) => Promise<Result<unknown>>;
const handlers = new Map<string, Listener>();
const revealed: string[] = [];
const MAIN_WINDOW = { id: 1, name: 'main window' };
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: Listener) => handlers.set(channel, fn) },
  BrowserWindow: { fromWebContents: () => MAIN_WINDOW, getAllWindows: () => [] },
  shell: { showItemInFolder: (p: string) => void revealed.push(p) },
}));

const { createHandle } = await import('./register');
const { registerBackupIpc, revealRestoredFolder } = await import('./backup');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-backup-ipc-'));
const db = openDatabase(':memory:');
migrate(db, { dbFile: null });
afterAll(() => {
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});
const settings = new SettingsRepository(db);
let libraryOpen = true;
const start = vi.fn(async () => ({ started: true }));
const cancel = vi.fn();
const restoreStart = vi.fn(async () => ({ started: true }));
const restoreCancel = vi.fn();
const SETTINGS_PAGE = fakeSender(20, 'settings');
const MAIN_PAGE = fakeSender(10, 'main');
registerBackupIpc(
  createHandle(null),
  stubDeps({
    getContext: () => {
      if (!libraryOpen) throw new LearnError('LIBRARY_UNAVAILABLE', mainStrings.library.unavailable);
      return { settings } as never;
    },
    backup: { start, cancel, state: () => ({ ...IDLE_BACKUP_PROGRESS }), setHooks: () => {} },
    restore: { start: restoreStart, cancel: restoreCancel, state: () => ({ ...IDLE_RESTORE_PROGRESS }), setHooks: () => {} },
    isSettingsWindow: (sender) => sender === (SETTINGS_PAGE as never),
  }),
);
const invokeFrom = (sender: unknown, channel: string, raw?: unknown) =>
  handlers.get(channel)!({ sender, senderFrame: { url: 'learn://app/index.html?window=main' } }, raw);

describe('the backup channels (P-20)', () => {
  it('backup:create asks main\'s job with the calling window, taking no path; backup:cancel stops it; the main window\'s only', async () => {
    expect(await invokeFrom(MAIN_PAGE, 'backup:create')).toEqual({ ok: true, data: { started: true } });
    expect(start).toHaveBeenCalledWith(MAIN_WINDOW);
    expect(await invokeFrom(MAIN_PAGE, 'backup:create', { folder: '/tmp' })).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(await invokeFrom(MAIN_PAGE, 'backup:cancel')).toMatchObject({ ok: true });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(await invokeFrom(SETTINGS_PAGE, 'backup:create')).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('app:backupInfo: null before any backup or with no library open; then when, and the folder\'s name only', async () => {
    expect(await invokeFrom(SETTINGS_PAGE, 'app:backupInfo')).toEqual({ ok: true, data: null });
    const folder = path.join(tmp, 'Learn 백업 2026-10-30 2141');
    settings.set('backup.last', { at: '2026-10-30T12:41:00.000Z', folder });
    expect(await invokeFrom(SETTINGS_PAGE, 'app:backupInfo')).toEqual({ ok: true, data: { at: '2026-10-30T12:41:00.000Z', folderName: 'Learn 백업 2026-10-30 2141' } });
    libraryOpen = false;
    expect(await invokeFrom(SETTINGS_PAGE, 'app:backupInfo')).toEqual({ ok: true, data: null });
    libraryOpen = true;
    expect(await invokeFrom(MAIN_PAGE, 'app:backupInfo')).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
  });

  it('app:revealBackup shows the folder selected in its parent; a folder that is gone says so and shows nothing', async () => {
    const folder = path.join(tmp, 'Learn 백업 2026-10-31 0905');
    fs.mkdirSync(folder);
    settings.set('backup.last', { at: '2026-10-31T00:05:00.000Z', folder });
    expect(await invokeFrom(SETTINGS_PAGE, 'app:revealBackup')).toMatchObject({ ok: true });
    expect(revealed).toEqual([folder]);
    fs.rmSync(folder, { recursive: true });
    expect(await invokeFrom(SETTINGS_PAGE, 'app:revealBackup')).toMatchObject({ ok: false, code: 'NOT_FOUND', message: mainStrings.backup.revealMissing });
    expect(revealed).toHaveLength(1);
  });
});

describe('backup:restore and the toast\'s 취소 for it (P-20)', () => {
  it('backup:restore asks main\'s restore with the calling window, taking no path; the main window\'s only', async () => {
    expect(await invokeFrom(MAIN_PAGE, 'backup:restore')).toEqual({ ok: true, data: { started: true } });
    expect(restoreStart).toHaveBeenCalledWith(MAIN_WINDOW);
    expect(await invokeFrom(MAIN_PAGE, 'backup:restore', { folder: '/tmp' })).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(await invokeFrom(SETTINGS_PAGE, 'backup:restore')).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
    expect(restoreStart).toHaveBeenCalledTimes(1);
  });

  it('backup:cancel stops the job it names — the backup when it names none', async () => {
    cancel.mockClear();
    restoreCancel.mockClear();
    expect(await invokeFrom(MAIN_PAGE, 'backup:cancel', { job: 'restore' })).toMatchObject({ ok: true });
    expect([cancel.mock.calls.length, restoreCancel.mock.calls.length]).toEqual([0, 1]);
    expect(await invokeFrom(MAIN_PAGE, 'backup:cancel', { job: 'backup' })).toMatchObject({ ok: true });
    expect(await invokeFrom(MAIN_PAGE, 'backup:cancel')).toMatchObject({ ok: true });
    expect([cancel.mock.calls.length, restoreCancel.mock.calls.length]).toEqual([2, 1]);
    expect(await invokeFrom(MAIN_PAGE, 'backup:cancel', { job: 'import' })).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
  });

  it('revealRestoredFolder shows the restored folder selected in its parent; one that is gone says so', () => {
    const folder = path.join(tmp, 'Learn 복원 2026-10-31 2141');
    fs.mkdirSync(folder);
    revealRestoredFolder(folder);
    expect(revealed.at(-1)).toBe(folder);
    fs.rmSync(folder, { recursive: true });
    expect(() => revealRestoredFolder(folder)).toThrow(mainStrings.restore.revealMissing);
  });
});
