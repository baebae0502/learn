import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { libraryLayout } from '../src/layout';
import { NAMED_COPY_MODE, asideName, ensureNamedCopy, extensionAgrees, isAside, mayHoldEdits, namedCopyPath, openExtension, openableFile, safeBaseName, type OpenableAsset } from '../src/openable';

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

  it('copies through a temporary name, read-only; reuses an unedited copy; drops an unedited older name', async () => {
    const src = path.join(tmp, 'src.bin');
    fs.writeFileSync(src, '%PDF-1.7\n');
    const dst = path.join(tmp, 'open', 'a1', 'Title.pdf');
    expect(await ensureNamedCopy(src, dst, 9)).toEqual({ action: 'created', keptAside: null });
    expect(fs.readFileSync(dst, 'utf8')).toBe('%PDF-1.7\n');
    expect(fs.statSync(dst).mode & 0o777).toBe(NAMED_COPY_MODE); // locked: apps offer a duplicate
    expect(fs.statSync(dst).ino).not.toBe(fs.statSync(src).ino); // never a hard link
    expect(await ensureNamedCopy(src, dst, 9)).toEqual({ action: 'reused', keptAside: null });
    // A new title: the unedited copy under the old name goes.
    const renamed = path.join(tmp, 'open', 'a1', 'New title.pdf');
    expect((await ensureNamedCopy(src, renamed, 9)).action).toBe('created');
    expect(fs.readdirSync(path.dirname(dst))).toEqual(['New title.pdf']);
  });

  it('a copy edited after unlocking it is kept aside, never overwritten; a fresh read-only copy takes the name (addendum 2)', async () => {
    const src = path.join(tmp, 'src.bin');
    const dst = path.join(tmp, 'open', 'e1', 'Notes.pdf');
    await ensureNamedCopy(src, dst, 9);
    fs.chmodSync(dst, 0o644); // the user unlocked it …
    fs.writeFileSync(dst, 'annotated in Preview'); // … and saved annotations
    const when = new Date(2026, 9, 23, 15, 4);
    const result = await ensureNamedCopy(src, dst, 9, () => when);
    const aside = path.join(tmp, 'open', 'e1', 'Notes (수정본 2026-10-23 1504).pdf');
    expect(result).toEqual({ action: 'created', keptAside: aside });
    expect(fs.readFileSync(aside, 'utf8')).toBe('annotated in Preview');
    expect(fs.readFileSync(dst, 'utf8')).toBe('%PDF-1.7\n');
    expect(fs.statSync(dst).mode & 0o777).toBe(NAMED_COPY_MODE);
    // Unlocked but the same size (a same-length edit, or only unlocked): kept aside too; a second one that minute numbered.
    fs.chmodSync(dst, 0o644);
    expect((await ensureNamedCopy(src, dst, 9, () => when)).keptAside).toBe(path.join(tmp, 'open', 'e1', 'Notes (수정본 2026-10-23 1504) 2.pdf'));
    // A different size while still locked (an app that replaced the file): kept aside.
    fs.chmodSync(dst, 0o644);
    fs.writeFileSync(dst, 'x');
    fs.chmodSync(dst, 0o444);
    expect(await ensureNamedCopy(src, dst, 9, () => new Date(2026, 9, 23, 16, 30))).toEqual({ action: 'created', keptAside: path.join(tmp, 'open', 'e1', 'Notes (수정본 2026-10-23 1630).pdf') });
    expect(fs.readdirSync(path.dirname(dst)).sort()).toEqual(['Notes (수정본 2026-10-23 1504) 2.pdf', 'Notes (수정본 2026-10-23 1504).pdf', 'Notes (수정본 2026-10-23 1630).pdf', 'Notes.pdf'].sort());
  });

  it('an edited copy under an older title is not removed by the cleanup (addendum 2)', async () => {
    const src = path.join(tmp, 'src.bin');
    const old = path.join(tmp, 'open', 'e2', 'Old title.pdf');
    await ensureNamedCopy(src, old, 9);
    fs.chmodSync(old, 0o644);
    fs.appendFileSync(old, '% my notes');
    const next = path.join(tmp, 'open', 'e2', 'New title.pdf');
    expect(await ensureNamedCopy(src, next, 9)).toEqual({ action: 'created', keptAside: null });
    expect(fs.readdirSync(path.dirname(next)).sort()).toEqual(['New title.pdf', 'Old title.pdf']);
    expect(fs.readFileSync(old, 'utf8')).toBe('%PDF-1.7\n% my notes');
  });

  it('POSIX: a rename over a read-only unedited copy works (the folder is writable); so does removing one', () => {
    const dir = path.join(tmp, 'open', 'p1');
    fs.mkdirSync(dir, { recursive: true });
    const locked = path.join(dir, 'a.pdf');
    fs.writeFileSync(locked, 'old');
    fs.chmodSync(locked, NAMED_COPY_MODE);
    const part = path.join(dir, '.x.part');
    fs.writeFileSync(part, 'new');
    fs.renameSync(part, locked);
    expect(fs.readFileSync(locked, 'utf8')).toBe('new');
    fs.chmodSync(locked, NAMED_COPY_MODE);
    fs.rmSync(locked);
    expect(fs.existsSync(locked)).toBe(false);
  });

  it('names a copy kept aside by the local date and time, before the extension', () => {
    expect(asideName('세포 신호.pdf', new Date(2026, 0, 2, 3, 4))).toBe('세포 신호 (수정본 2026-01-02 0304).pdf');
    expect(mayHoldEdits({ mode: 0o100444, size: 9 }, 9)).toBe(false);
    expect(mayHoldEdits({ mode: 0o100644, size: 9 }, 9)).toBe(true);
    expect(mayHoldEdits({ mode: 0o100444, size: 8 }, 9)).toBe(true);
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

  describe('on HFS+, which lists names decomposed (re-review N1)', () => {
    afterEach(() => vi.restoreAllMocks());
    /** HFS+ as Node sees it: readdir answers NFD names, and a lookup by either form finds the same file. */
    function hfsPlus() {
      const { readdir, stat, rm } = fsp;
      vi.spyOn(fsp, 'readdir').mockImplementation((async (dir: string) => ((await readdir(dir)) as string[]).map((n) => n.normalize('NFD'))) as unknown as typeof fsp.readdir);
      vi.spyOn(fsp, 'stat').mockImplementation(((p: string, ...rest: unknown[]) => (stat as (...a: unknown[]) => unknown)(p.normalize('NFC'), ...rest)) as unknown as typeof fsp.stat);
      vi.spyOn(fsp, 'rm').mockImplementation(((p: string, ...rest: unknown[]) => (rm as (...a: unknown[]) => unknown)(p.normalize('NFC'), ...rest)) as unknown as typeof fsp.rm);
    }

    it('the fresh copy of a Hangul title is not mistaken for an older name: it survives, and the open hands it over', async () => {
      hfsPlus();
      const store = path.join(tmp, 'hfs-src.bin');
      fs.writeFileSync(store, '%PDF-1.7\n');
      const opened = await openableFile(layout, { ...pdf, id: 'h1' }, '세포 신호 전달', store);
      expect(opened).toBe(path.join(layout.derivedDir, 'open', 'h1', '세포 신호 전달.pdf'));
      expect(fs.existsSync(opened)).toBe(true);
      // Again: reused, still there; and an older Hangul title is still cleaned up.
      expect(await openableFile(layout, { ...pdf, id: 'h1' }, '세포 신호 전달', store)).toBe(opened);
      const renamed = await openableFile(layout, { ...pdf, id: 'h1' }, '세포 신호', store);
      expect(fs.existsSync(renamed)).toBe(true);
      expect(fs.readdirSync(path.dirname(renamed))).toEqual(['세포 신호.pdf']);
    });

    it('a copy kept aside is recognised in its decomposed form too', () => {
      expect(isAside('세포 (수정본 2026-10-23 1504).pdf'.normalize('NFD'))).toBe(true);
    });
  });

  it('a copy kept aside is the exact pattern at the end of the name; a title that only contains it is not', () => {
    expect(isAside('Notes (수정본 2026-10-23 1504).pdf')).toBe(true);
    expect(isAside('Notes (수정본 2026-10-23 1504) 2.pdf')).toBe(true);
    expect(isAside('Notes (수정본 초안).pdf')).toBe(false);
    expect(isAside('Notes (수정본 2026-10-23 1504) draft.pdf')).toBe(false);
    expect(isAside('Notes.pdf')).toBe(false);
  });

  it('two opens at once over an edited copy both succeed, and the edits are kept once (re-review m-N2)', async () => {
    const src = path.join(tmp, 'src.bin');
    const dst = path.join(tmp, 'open', 'c1', 'Both.pdf');
    await ensureNamedCopy(src, dst, 9);
    fs.chmodSync(dst, 0o644);
    fs.writeFileSync(dst, 'my annotations');
    const when = () => new Date(2026, 9, 23, 17, 0);
    const [a, b] = await Promise.all([ensureNamedCopy(src, dst, 9, when), ensureNamedCopy(src, dst, 9, when)]);
    expect([a.action, b.action]).toEqual(['created', 'reused']); // the second waited for the first and found its copy
    const aside = path.join(tmp, 'open', 'c1', 'Both (수정본 2026-10-23 1700).pdf');
    expect(a.keptAside).toBe(aside);
    expect(fs.readFileSync(aside, 'utf8')).toBe('my annotations');
    expect(fs.readFileSync(dst, 'utf8')).toBe('%PDF-1.7\n');
    expect(fs.readdirSync(path.dirname(dst)).sort()).toEqual(['Both (수정본 2026-10-23 1700).pdf', 'Both.pdf']);
  });

  it('an aside name already taken is never written over: the next free number is used (re-review m-N2)', async () => {
    const src = path.join(tmp, 'src.bin');
    const dst = path.join(tmp, 'open', 'c2', 'Taken.pdf');
    await ensureNamedCopy(src, dst, 9);
    const taken = path.join(tmp, 'open', 'c2', 'Taken (수정본 2026-10-23 1700).pdf');
    fs.writeFileSync(taken, 'kept earlier');
    fs.chmodSync(dst, 0o644);
    fs.writeFileSync(dst, 'edited again');
    const r = await ensureNamedCopy(src, dst, 9, () => new Date(2026, 9, 23, 17, 0));
    expect(r.keptAside).toBe(path.join(tmp, 'open', 'c2', 'Taken (수정본 2026-10-23 1700) 2.pdf'));
    expect(fs.readFileSync(taken, 'utf8')).toBe('kept earlier');
    expect(fs.readFileSync(r.keptAside!, 'utf8')).toBe('edited again');
  });

  it('a failed copy does not hold up the next open of that asset', async () => {
    const dst = path.join(tmp, 'open', 'c3', 'Next.pdf');
    await expect(ensureNamedCopy(path.join(tmp, 'missing.bin'), dst, 9)).rejects.toThrow();
    expect((await ensureNamedCopy(path.join(tmp, 'src.bin'), dst, 9)).action).toBe('created');
  });
});
