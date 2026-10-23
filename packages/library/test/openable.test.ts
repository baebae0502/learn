import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { libraryLayout } from '../src/layout';
import { ensureNamedCopy, extensionAgrees, namedCopyPath, openExtension, openableFile, safeBaseName, type OpenableAsset } from '../src/openable';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-openable-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
const layout = libraryLayout(path.join(tmp, 'lib'));
const pdf: OpenableAsset = { id: 'a1', mime: 'application/pdf', originalName: 'Lecture 3.pdf', size: 9, storageMode: 'managed' };

describe('a file the OS can open by name (final review I1)', () => {
  it('takes the extension from the sniffed type, or the original name when it agrees', () => {
    expect(openExtension('application/pdf', 'notes.PDF')).toBe('pdf');
    expect(openExtension('application/pdf', 'x.command')).toBe('pdf');
    expect(openExtension('video/mp4', 'clip.m4v')).toBe('m4v');
    expect(openExtension('video/mp4', 'clip')).toBe('mp4');
    expect(openExtension('video/quicktime', 'a.mp4')).toBe('mov');
    expect(openExtension('video/webm', 'a.webm')).toBe('webm');
    expect(openExtension('video/x-matroska', 'a.bin')).toBe('mkv');
    expect(openExtension('text/plain', 'a.txt')).toBeNull();
    expect(extensionAgrees('/Users/me/a.pdf', 'application/pdf')).toBe(true);
    expect(extensionAgrees('/Users/me/a.command', 'application/pdf')).toBe(false);
    expect(extensionAgrees('/Users/me/noext', 'video/mp4')).toBe(false);
  });

  it('sanitises a name for every platform: no reserved characters, no leading dot, NFC, a byte cap', () => {
    expect(safeBaseName('a/b\\c:d*e?f"g<h>i|j')).toBe('a b c d e f g h i j');
    expect(safeBaseName('.hidden')).toBe('hidden');
    expect(safeBaseName('trailing. ')).toBe('trailing');
    expect(safeBaseName('CON')).toBe('_CON');
    expect(safeBaseName('...', 'fallback')).toBe('fallback');
    expect(safeBaseName('한글'.normalize('NFD'))).toBe('한글'.normalize('NFC'));
    const long = safeBaseName('가'.repeat(200));
    expect(Buffer.byteLength(long, 'utf8')).toBeLessThanOrEqual(180);
    expect(long).toBe('가'.repeat(60)); // 3 bytes each, cut at a character
  });

  it('names the copy after the title under derived/open/<assetId>/, the original name when the title is empty', () => {
    expect(namedCopyPath(layout, pdf, '세포 신호: 개요')).toBe(path.join(layout.derivedDir, 'open', 'a1', '세포 신호 개요.pdf'));
    expect(namedCopyPath(layout, pdf, '  ')).toBe(path.join(layout.derivedDir, 'open', 'a1', 'Lecture 3.pdf'));
    expect(namedCopyPath(layout, { ...pdf, mime: 'text/plain' }, 'x')).toBeNull();
  });

  it('copies through a temporary name, reuses a copy of the right size, recreates a wrong one, drops an older name', async () => {
    const src = path.join(tmp, 'src.bin');
    fs.writeFileSync(src, '%PDF-1.7\n');
    const dst = path.join(tmp, 'open', 'a1', 'Title.pdf');
    expect(await ensureNamedCopy(src, dst, 9)).toBe('created');
    expect(fs.readFileSync(dst, 'utf8')).toBe('%PDF-1.7\n');
    expect(fs.statSync(dst).ino).not.toBe(fs.statSync(src).ino); // never a hard link
    expect(await ensureNamedCopy(src, dst, 9)).toBe('reused');
    fs.writeFileSync(dst, 'edited in another app, longer');
    expect(await ensureNamedCopy(src, dst, 9)).toBe('created');
    expect(fs.readFileSync(dst, 'utf8')).toBe('%PDF-1.7\n');
    const renamed = path.join(tmp, 'open', 'a1', 'New title.pdf');
    expect(await ensureNamedCopy(src, renamed, 9)).toBe('created');
    expect(fs.readdirSync(path.dirname(dst))).toEqual(['New title.pdf']);
  });

  it('a managed copy and a misnamed linked file open as the named copy; a well-named linked file as itself', async () => {
    const store = path.join(layout.assetsDir, 'ab', 'ab'.padEnd(64, '0'));
    fs.mkdirSync(path.dirname(store), { recursive: true });
    fs.writeFileSync(store, '%PDF-1.7\n');
    const managed = await openableFile(layout, pdf, '세포', store);
    expect(managed).toBe(path.join(layout.derivedDir, 'open', 'a1', '세포.pdf'));
    expect(fs.readFileSync(managed, 'utf8')).toBe('%PDF-1.7\n');

    const own = path.join(tmp, 'mine.pdf');
    fs.copyFileSync(store, own);
    expect(await openableFile(layout, { ...pdf, id: 'a2', storageMode: 'linked' }, '내 파일', own)).toBe(own);
    const misnamed = path.join(tmp, 'x.command');
    fs.copyFileSync(store, misnamed);
    expect(await openableFile(layout, { ...pdf, id: 'a3', storageMode: 'linked', originalName: 'x.command' }, 'x', misnamed)).toBe(path.join(layout.derivedDir, 'open', 'a3', 'x.pdf'));
    // A type with nothing to name: the file itself.
    expect(await openableFile(layout, { ...pdf, id: 'a4', mime: 'text/plain' }, 't', store)).toBe(store);
  });
});
