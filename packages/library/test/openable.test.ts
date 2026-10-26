import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { libraryLayout } from '../src/layout';
import {
  EXPORT_TEMP_BYTES, NAMED_COPY_MODE, asideName, ensureNamedCopy, exportFile, exportTempName, extensionAgrees, isAside, mayHoldEdits, namedCopyPath, openExtension,
  openableFile, openableName, safeBaseName, type OpenableAsset,
} from '../src/openable';

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

  it('an orphaned .part is removed once nothing has written it for 10 minutes; a fresh one and Finder files stay (re-review m-N3)', async () => {
    const src = path.join(tmp, 'src.bin');
    const dst = path.join(tmp, 'open', 'o1', 'Orphans.pdf');
    await ensureNamedCopy(src, dst, 9);
    const dir = path.dirname(dst);
    const orphan = path.join(dir, `.${'0'.repeat(8)}-0000-4000-8000-${'0'.repeat(12)}.part`);
    fs.writeFileSync(orphan, 'half a video');
    fs.writeFileSync(path.join(dir, '.DS_Store'), 'finder');
    fs.chmodSync(dst, 0o644); // force a fresh copy, so the cleanup runs
    // Now: the .part was just written, maybe by another open in flight: kept.
    await ensureNamedCopy(src, dst, 9);
    expect(fs.existsSync(orphan)).toBe(true);
    // An hour on, nothing has touched it: an orphan, removed. .DS_Store is not ours.
    fs.chmodSync(dst, 0o644);
    await ensureNamedCopy(src, dst, 9, () => new Date(Date.now() + 60 * 60_000));
    expect(fs.existsSync(orphan)).toBe(false);
    expect(fs.existsSync(path.join(dir, '.DS_Store'))).toBe(true);
  });

  it('a misnamed linked file changed since it was linked is compared at its current size: reused, not set aside (re-review m-N6)', async () => {
    const own = path.join(tmp, 'changed.command');
    fs.writeFileSync(own, '%PDF-1.7\n% grew after linking\n');
    const linked: OpenableAsset = { ...pdf, id: 'l6', storageMode: 'linked', originalName: 'changed.command', size: 9 };
    const first = await openableFile(layout, linked, 'changed', own);
    expect(await openableFile(layout, linked, 'changed', own)).toBe(first);
    expect(fs.readdirSync(path.dirname(first))).toEqual(['changed.pdf']);
  });

  it('a linked symlink is copied as the file it points to; the user\'s own file keeps its mode', async () => {
    const target = path.join(tmp, 'user-file');
    fs.writeFileSync(target, '%PDF-1.7\n');
    fs.chmodSync(target, 0o644);
    const link = path.join(tmp, 'pointer.command');
    fs.symlinkSync(target, link);
    const opened = await openableFile(layout, { ...pdf, id: 'sl', storageMode: 'linked', originalName: 'pointer.command' }, 'pointer', link);
    expect(fs.lstatSync(opened).isFile()).toBe(true);
    expect(fs.lstatSync(opened).isSymbolicLink()).toBe(false);
    expect(fs.statSync(opened).mode & 0o777).toBe(NAMED_COPY_MODE);
    expect(fs.statSync(target).mode & 0o777).toBe(0o644);
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
  });

  describe('a folder that does not keep modes (exFAT, FAT, some SMB)', () => {
    afterEach(() => vi.restoreAllMocks());
    it('chmod refused (EPERM): the open still succeeds, and the writable copy is reused, not set aside', async () => {
      vi.spyOn(fsp, 'chmod').mockRejectedValue(Object.assign(new Error('operation not permitted'), { code: 'EPERM' }));
      const src = path.join(tmp, 'src.bin');
      const dst = path.join(tmp, 'open', 'f1', 'Vfat.pdf');
      expect((await ensureNamedCopy(src, dst, 9)).action).toBe('created');
      expect(fs.statSync(dst).mode & 0o222).not.toBe(0);
      expect(await ensureNamedCopy(src, dst, 9)).toEqual({ action: 'reused', keptAside: null });
      // Only a size change counts there.
      fs.writeFileSync(dst, 'edited on the stick');
      expect((await ensureNamedCopy(src, dst, 9, () => new Date(2026, 9, 23, 18, 0))).keptAside).toBe(path.join(tmp, 'open', 'f1', 'Vfat (수정본 2026-10-23 1800).pdf'));
    });
    it('chmod ignored (the mode does not stick): the same size-only rule', async () => {
      vi.spyOn(fsp, 'chmod').mockResolvedValue(undefined);
      const src = path.join(tmp, 'src.bin');
      const dst = path.join(tmp, 'open', 'f2', 'Exfat.pdf');
      expect((await ensureNamedCopy(src, dst, 9)).action).toBe('created');
      expect(await ensureNamedCopy(src, dst, 9)).toEqual({ action: 'reused', keptAside: null });
      expect(fs.readdirSync(path.dirname(dst))).toEqual(['Exfat.pdf']);
    });
  });
});

describe('사본 내보내기: the default name, the temporary file beside the target, the copy (spec §7)', () => {
  const source = () => {
    const p = path.join(tmp, 'export-src.pdf');
    fs.writeFileSync(p, '%PDF-1.7\nexport\n');
    return p;
  };

  it('names the export as the named copy is named: the safe title and the type extension, the original name for an empty title', () => {
    expect(openableName(pdf, '세포 신호: 개요')).toBe('세포 신호 개요.pdf');
    expect(openableName(pdf, '  ')).toBe('Lecture 3.pdf');
    expect(openableName({ mime: 'video/quicktime', originalName: 'clip.MOV' }, '강의 04')).toBe('강의 04.mov');
    expect(openableName({ mime: 'text/plain', originalName: 'a.txt' }, 'x')).toBeNull();
    expect(path.basename(namedCopyPath(layout, pdf, '세포 신호: 개요')!)).toBe(openableName(pdf, '세포 신호: 개요'));
  });

  it('writes through a hidden temporary name beside the target, never longer than a file system allows', () => {
    const id = '0f0e0d0c-0b0a-4908-8706-050403020100';
    expect(exportTempName('세포 신호 개요.pdf', id)).toBe(`.세포 신호 개요.pdf.learn-export-${id}.part`);
    const long = exportTempName(`${'가'.repeat(100)}.pdf`, id);
    expect(Buffer.byteLength(long, 'utf8')).toBeLessThanOrEqual(EXPORT_TEMP_BYTES);
    expect(long.startsWith('.가')).toBe(true);
    expect(long.endsWith(`.learn-export-${id}.part`)).toBe(true);
    expect(exportTempName('a.pdf')).toMatch(/^\.a\.pdf\.learn-export-[0-9a-f-]{36}\.part$/);
  });

  it('copies the bytes, leaves no temporary file, and replaces a file the save panel agreed to replace', async () => {
    const dir = path.join(tmp, 'export-ok');
    fs.mkdirSync(dir, { recursive: true });
    const dst = path.join(dir, '세포 신호 개요.pdf');
    fs.writeFileSync(dst, 'an older file at the chosen name');
    await exportFile(source(), dst);
    expect(fs.readFileSync(dst, 'utf8')).toBe('%PDF-1.7\nexport\n');
    expect(fs.readdirSync(dir)).toEqual(['세포 신호 개요.pdf']);
  });

  it('a copy that fails leaves neither the target nor its temporary file', async () => {
    const dir = path.join(tmp, 'export-fail');
    fs.mkdirSync(dir, { recursive: true });
    await expect(exportFile(path.join(tmp, 'no-such-source.pdf'), path.join(dir, 'x.pdf'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it('a rename that fails after the copy takes the temporary file away and leaves the target as it was', async () => {
    const dir = path.join(tmp, 'export-rename');
    // A folder where the file should go: the rename is refused after the copy has been made.
    fs.mkdirSync(path.join(dir, 'taken.pdf'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'taken.pdf', 'inside'), 'x');
    await expect(exportFile(source(), path.join(dir, 'taken.pdf'))).rejects.toThrow();
    expect(fs.readdirSync(dir)).toEqual(['taken.pdf']);
    expect(fs.readdirSync(path.join(dir, 'taken.pdf'))).toEqual(['inside']);
  });
});
