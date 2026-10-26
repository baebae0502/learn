import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SaveDialogOptions } from 'electron';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { LearnError, type Availability, type Result } from '@learn/domain';
import { libraryLayout } from '@learn/library';
import { mainStrings } from '../strings';
import { fakeSender, stubDeps } from './test-deps';

type Listener = (event: unknown, raw: unknown) => Promise<Result<unknown>>;
const handlers = new Map<string, Listener>();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-export-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
const DOWNLOADS = path.join(tmp, 'Downloads');
const MAIN = { id: 1, name: 'main window' };
/** What the save panel answers next (null: cancelled) and every call it got. */
const panel: { answer: string | null; calls: Array<{ parent: unknown; options: SaveDialogOptions }> } = { answer: null, calls: [] };
const reveals: string[] = [];

vi.mock('electron', () => ({
  app: { getPath: (name: string) => (name === 'downloads' ? DOWNLOADS : path.join(tmp, name)) },
  ipcMain: { handle: (channel: string, fn: Listener) => handlers.set(channel, fn) },
  BrowserWindow: { fromWebContents: () => MAIN, getAllWindows: () => [] },
  dialog: {
    showSaveDialog: async (parent: unknown, options: SaveDialogOptions) => {
      panel.calls.push({ parent, options });
      return panel.answer === null ? { canceled: true, filePath: '' } : { canceled: false, filePath: panel.answer };
    },
  },
  shell: { showItemInFolder: (p: string) => void reveals.push(p) },
}));

const { createHandle } = await import('./register');
const { registerLibraryIpc, exportError } = await import('./library');

const layout = libraryLayout(path.join(tmp, 'library'));
const ITEM = '7d3f3c3e-8a51-4f7e-9d7c-2b1f0f6f8f10';
const ASSET = '1b6f5a52-2c1e-4d55-9a3e-0d2c6f7e8a90';
const SHA = 'ab'.repeat(32);
const assetFile = path.join(layout.assetsDir, 'ab', SHA);
const BYTES = '%PDF-1.7\nexport\n';
const stored: { availability: Availability } = { availability: 'available' };
const repo = {
  getItem: (id: string) => (id === ITEM ? { id: ITEM, assetId: ASSET, title: '세포 신호: 개요', type: 'pdf', storageMode: 'managed', availability: stored.availability } : undefined),
  getAsset: (id: string) =>
    id === ASSET
      ? { id: ASSET, sha256: SHA, storageMode: 'managed', relativePath: `assets/ab/${SHA}`, externalPath: null, originalName: 'Lecture 3.pdf', mime: 'application/pdf', size: BYTES.length, availability: stored.availability, createdAt: '', checkedAt: null }
      : undefined,
  setAvailability: (_id: string, a: Availability) => void (stored.availability = a),
  itemIdsForAsset: () => [ITEM],
};
/** The panel runs inside windows.asSheet(owner, …), like every dialog with a parent window. */
const sheets: string[] = [];
registerLibraryIpc(
  createHandle(null),
  stubDeps({
    getContext: () => ({ layout, repo }) as never,
    windows: {
      openSettings: () => {},
      asSheet: async (_owner, show) => {
        sheets.push('shown');
        try {
          return await show();
        } finally {
          sheets.push('closed');
        }
      },
    },
  }),
);
const MAIN_PAGE = fakeSender(10, 'main');
const invoke = (channel: string, raw?: unknown) => handlers.get(channel)!({ sender: MAIN_PAGE, senderFrame: { url: 'learn://app/index.html?window=main' } }, raw);
const chosen = path.join(tmp, 'chosen');

beforeEach(() => {
  fs.mkdirSync(path.dirname(assetFile), { recursive: true });
  fs.writeFileSync(assetFile, BYTES);
  stored.availability = 'available';
  panel.answer = null;
  panel.calls.length = 0;
  reveals.length = 0;
  sheets.length = 0;
});

describe('사본 내보내기 (spec §7) — in order: the run remembers the last folder', () => {
  it('revealExport before anything was exported: NOT_FOUND with the next step, nothing revealed', async () => {
    expect(await invoke('library:revealExport')).toMatchObject({ ok: false, code: 'NOT_FOUND', message: mainStrings.exportCopy.gone });
    expect(reveals).toEqual([]);
  });

  it('asks in a save panel on the asking window: the title-named default in Downloads, the type filter, overwrite asked', async () => {
    expect(await invoke('library:exportCopy', { itemId: ITEM })).toEqual({ ok: true, data: { saved: false } });
    expect(sheets).toEqual(['shown', 'closed']);
    expect(panel.calls).toHaveLength(1);
    const { parent, options } = panel.calls[0]!;
    expect(parent).toBe(MAIN);
    expect(options).toMatchObject({
      title: '사본 내보내기',
      defaultPath: path.join(DOWNLOADS, '세포 신호 개요.pdf'),
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    expect(options.properties).toEqual(expect.arrayContaining(['createDirectory', 'showOverwriteConfirmation']));
    expect(fs.existsSync(DOWNLOADS)).toBe(false); // cancelled: nothing written anywhere
  });

  it('saves the bytes at the chosen path with no temporary file left; the next panel opens there; revealExport shows it', async () => {
    fs.mkdirSync(chosen, { recursive: true });
    panel.answer = path.join(chosen, '내 사본.pdf');
    expect(await invoke('library:exportCopy', { itemId: ITEM })).toEqual({ ok: true, data: { saved: true } });
    expect(fs.readFileSync(panel.answer, 'utf8')).toBe(BYTES);
    expect(fs.readdirSync(chosen)).toEqual(['내 사본.pdf']);
    expect(await invoke('library:revealExport')).toEqual({ ok: true, data: undefined });
    expect(reveals).toEqual([path.join(chosen, '내 사본.pdf')]);
    panel.answer = null;
    await invoke('library:exportCopy', { itemId: ITEM });
    expect(panel.calls.at(-1)!.options.defaultPath).toBe(path.join(chosen, '세포 신호 개요.pdf'));
  });

  it('a copy the user has moved or deleted since is not revealed', async () => {
    fs.rmSync(path.join(chosen, '내 사본.pdf'));
    expect(await invoke('library:revealExport')).toMatchObject({ ok: false, code: 'NOT_FOUND', message: mainStrings.exportCopy.gone });
    expect(reveals).toEqual([]);
  });

  it('a file that is gone is reported before any panel opens, in the words Finder에서 보기 uses', async () => {
    fs.rmSync(assetFile);
    expect(await invoke('library:exportCopy', { itemId: ITEM })).toMatchObject({ ok: false, code: 'NOT_FOUND', message: mainStrings.itemFile.managedMissing });
    expect(panel.calls).toEqual([]);
  });

  it.skipIf(process.getuid?.() === 0)('a folder that refuses the copy: PERMISSION_DENIED with the cause and the next step, nothing left in it', async () => {
    const ro = path.join(tmp, 'read-only');
    fs.mkdirSync(ro, { recursive: true });
    fs.chmodSync(ro, 0o555);
    try {
      panel.answer = path.join(ro, 'x.pdf');
      expect(await invoke('library:exportCopy', { itemId: ITEM })).toMatchObject({ ok: false, code: 'PERMISSION_DENIED', message: mainStrings.exportCopy.notWritable });
    } finally {
      fs.chmodSync(ro, 0o755);
    }
    expect(fs.readdirSync(ro)).toEqual([]);
  });

  it('names a full disk and a refused folder in the user\'s words; every other errno gets a Korean cause and next step, keeping the error as cause', () => {
    const errno = (code: string) => Object.assign(new Error(code), { code });
    expect(exportError(errno('ENOSPC'))).toMatchObject({ code: 'DISK_FULL', message: mainStrings.exportCopy.diskFull });
    expect(exportError(errno('EDQUOT'))).toMatchObject({ code: 'DISK_FULL', message: mainStrings.exportCopy.diskFull });
    for (const c of ['EACCES', 'EPERM', 'EROFS']) expect(exportError(errno(c))).toMatchObject({ code: 'PERMISSION_DENIED', message: mainStrings.exportCopy.notWritable });
    expect(exportError(errno('ENOENT'))).toMatchObject({ code: 'NOT_FOUND', message: mainStrings.exportCopy.folderGone });
    expect(exportError(errno('ENAMETOOLONG'))).toMatchObject({ code: 'VALIDATION_FAILED', message: mainStrings.exportCopy.nameTooLong });
    expect(exportError(errno('EISDIR'))).toMatchObject({ code: 'VALIDATION_FAILED', message: mainStrings.exportCopy.isFolder });
    for (const c of ['EBUSY', 'EIO', 'EMFILE', 'EXDEV']) {
      const e = errno(c);
      const mapped = exportError(e);
      expect(mapped).toBeInstanceOf(LearnError);
      expect(mapped).toMatchObject({ code: 'INTERNAL', message: mainStrings.exportCopy.failed, cause: e });
    }
    expect(exportError(errno('ENOSPC'))).toBeInstanceOf(LearnError);
    const refusal = new LearnError('VALIDATION_FAILED', 'mine');
    expect(exportError(refusal)).toBe(refusal);
  });

  describe('a destination that would replace a library file is refused before anything is written', () => {
    const snapshot = (dir: string): string[] => fs.readdirSync(dir, { recursive: true, encoding: 'utf8' }).sort();
    const refused = { ok: false, code: 'VALIDATION_FAILED', message: mainStrings.exportCopy.inLibrary };

    it('the source file itself, by its path or through a symlink to it: said as the original\'s own place, not as the library', async () => {
      const link = path.join(tmp, 'link-to-asset.pdf');
      fs.rmSync(link, { force: true });
      fs.symlinkSync(assetFile, link);
      for (const target of [assetFile, link]) {
        panel.answer = target;
        expect(await invoke('library:exportCopy', { itemId: ITEM })).toMatchObject({ ...refused, message: mainStrings.exportCopy.onSource });
      }
      expect(fs.readFileSync(assetFile, 'utf8')).toBe(BYTES);
      expect(fs.readdirSync(path.dirname(assetFile))).toEqual([SHA]);
      expect(await invoke('library:revealExport')).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    });

    it('any path under the library root: the managed copies, the named copies, a new name beside them', async () => {
      const named = path.join(layout.derivedDir, 'open', ASSET);
      fs.mkdirSync(named, { recursive: true });
      const before = snapshot(layout.root);
      for (const target of [path.join(layout.assetsDir, 'ab', 'new.pdf'), path.join(named, '세포 신호 개요.pdf'), path.join(layout.root, 'x.pdf')]) {
        panel.answer = target;
        expect(await invoke('library:exportCopy', { itemId: ITEM })).toMatchObject(refused);
      }
      expect(snapshot(layout.root)).toEqual(before);
    });

    it('a folder named like "..notes" inside the library is inside it, not a way out', async () => {
      const dotted = path.join(layout.root, '..notes');
      fs.mkdirSync(dotted, { recursive: true });
      const before = snapshot(layout.root);
      panel.answer = path.join(dotted, 'x.pdf');
      expect(await invoke('library:exportCopy', { itemId: ITEM })).toMatchObject(refused);
      expect(snapshot(layout.root)).toEqual(before);
    });

    it('a library root reached through a symlinked folder is the same folder', async () => {
      const alias = path.join(tmp, 'library-alias');
      fs.rmSync(alias, { force: true });
      fs.symlinkSync(layout.root, alias);
      panel.answer = path.join(alias, 'assets', 'ab', 'x.pdf');
      expect(await invoke('library:exportCopy', { itemId: ITEM })).toMatchObject(refused);
    });

    it('a folder whose name only starts like the library root\'s is a normal folder', async () => {
      const beside = `${layout.root}-exports`;
      fs.mkdirSync(beside, { recursive: true });
      panel.answer = path.join(beside, 'x.pdf');
      expect(await invoke('library:exportCopy', { itemId: ITEM })).toEqual({ ok: true, data: { saved: true } });
      expect(fs.readFileSync(panel.answer, 'utf8')).toBe(BYTES);
    });

    it('a folder that vanished while the panel was open: the folder-gone words, nothing written', async () => {
      panel.answer = path.join(tmp, 'vanished', 'x.pdf');
      expect(await invoke('library:exportCopy', { itemId: ITEM })).toMatchObject({ ok: false, code: 'NOT_FOUND', message: mainStrings.exportCopy.folderGone });
    });
  });
});
