import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LearnError, newId, nowIso } from '@learn/domain';
import type { AssetRow } from '@learn/db';
import { ensureLayout, libraryLayout, managedRelativePath, resolveAssetPath, sha256File, sniffFile } from '../src/index';
import { cleanupTemp, tempDir, writeMp4, writePdf } from './helpers';

afterEach(cleanupTemp);

describe('layout', () => {
  it('creates the library directory structure', () => {
    const layout = libraryLayout(path.join(tempDir(), 'Library'));
    ensureLayout(layout);
    for (const d of [layout.assetsDir, layout.stagingDir, layout.derivedDir, layout.exportsDir]) expect(fs.statSync(d).isDirectory()).toBe(true);
    expect(layout.dbFile.endsWith('library.sqlite')).toBe(true);
  });
  it('shards managed assets by hash prefix', () => {
    expect(managedRelativePath('ab'.padEnd(64, 'c'))).toBe(`assets/ab/${'ab'.padEnd(64, 'c')}`);
  });
});

describe('resolveAssetPath', () => {
  const base = (over: Partial<AssetRow>): AssetRow => ({
    id: newId(), sha256: 'a'.repeat(64), storageMode: 'managed', relativePath: null, externalPath: null,
    originalName: 'x', mime: 'application/pdf', size: 1, availability: 'available', createdAt: nowIso(), checkedAt: null, ...over,
  });
  it('resolves managed paths inside assets/ and refuses escapes', () => {
    const layout = libraryLayout(tempDir());
    expect(resolveAssetPath(layout, base({ relativePath: managedRelativePath('a'.repeat(64)) }))).toBe(path.join(layout.assetsDir, 'aa', 'a'.repeat(64)));
    expect(() => resolveAssetPath(layout, base({ relativePath: '../../etc/passwd' }))).toThrow(LearnError);
  });
  it('returns external paths for linked assets', () => {
    const layout = libraryLayout(tempDir());
    expect(resolveAssetPath(layout, base({ storageMode: 'linked', externalPath: '/Users/me/a.pdf' }))).toBe('/Users/me/a.pdf');
  });
});

describe('sniffFile', () => {
  it('detects pdf and mp4 by magic bytes, not by extension', async () => {
    const d = tempDir();
    expect(await sniffFile(writePdf(d, 'renamed.bin', 'x'))).toEqual({ type: 'pdf', mime: 'application/pdf' });
    expect(await sniffFile(writeMp4(d, 'clip.mp4', 'x'))).toEqual({ type: 'video', mime: 'video/mp4' });
    expect(await sniffFile(writeMp4(d, 'clip.mov', 'x'))).toEqual({ type: 'video', mime: 'video/quicktime' });
    const txt = path.join(d, 'notes.pdf');
    fs.writeFileSync(txt, 'just text');
    expect(await sniffFile(txt)).toBeNull();
  });
});

describe('sha256File', () => {
  it('hashes file contents', async () => {
    const d = tempDir();
    const p = path.join(d, 'a.txt');
    fs.writeFileSync(p, 'abc');
    expect(await sha256File(p)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  it('reports the bytes it reads chunk by chunk and stops when its signal is aborted (the queue\'s progress and cancel)', async () => {
    const d = tempDir();
    const p = path.join(d, 'big.bin');
    fs.writeFileSync(p, Buffer.alloc(1024 * 1024, 7));
    const reads: number[] = [];
    expect(await sha256File(p, { onBytes: (n) => reads.push(n) })).toBe(createHash('sha256').update(fs.readFileSync(p)).digest('hex'));
    expect(reads.length).toBeGreaterThan(1);
    expect(reads.reduce((a, b) => a + b, 0)).toBe(1024 * 1024);
    await expect(sha256File(p, { signal: AbortSignal.abort() })).rejects.toMatchObject({ name: 'AbortError' });
    const stop = new AbortController();
    let seen = 0;
    await expect(sha256File(p, { signal: stop.signal, onBytes: () => { seen += 1; stop.abort(); } })).rejects.toMatchObject({ name: 'AbortError' });
    expect(seen).toBe(1);
  });
});

/** An ISO BMFF file whose `ftyp` box carries these brands (four characters each), then an empty `mdat` box. */
function writeFtyp(dir: string, name: string, major: string, compatible: readonly string[]): string {
  for (const b of [major, ...compatible]) expect(b, `brand "${b}"`).toHaveLength(4);
  const box = Buffer.alloc(16 + 4 * compatible.length);
  box.writeUInt32BE(box.length, 0);
  box.write('ftyp', 4, 'latin1');
  box.write(major, 8, 'latin1');
  box.writeUInt32BE(0x200, 12); // minor version
  compatible.forEach((b, i) => box.write(b, 16 + 4 * i, 'latin1'));
  const p = path.join(dir, name);
  fs.writeFileSync(p, Buffer.concat([box, Buffer.from([0, 0, 0, 8]), Buffer.from('mdat', 'latin1')]));
  return p;
}

describe('sniffFile: an ISO BMFF file is a video only by its brands (spec 10: HEIC, m4a)', () => {
  it.each([
    ['an iPhone photo (HEIC)', 'IMG_0001.heic', 'heic', ['mif1', 'heic']],
    ['a HEIF image, mif1 first', 'photo.heif', 'mif1', ['heic', 'miaf']],
    ['a HEIF burst', 'burst.heics', 'msf1', ['msf1', 'hevc']],
    ['an AVIF image', 'image.avif', 'avif', ['avif', 'mif1', 'miaf', 'MA1B']],
    ['iTunes audio that also lists mp42 and isom (m4a)', 'song.m4a', 'M4A ', ['M4A ', 'mp42', 'isom']],
    ['an audiobook (m4b)', 'book.m4b', 'M4B ', ['M4B ', 'mp42', 'isom']],
    ['protected music (m4p)', 'song.m4p', 'M4P ', ['M4P ', 'mp42', 'isom']],
    ['Flash audio (f4a)', 'clip.f4a', 'F4A ', ['F4A ', 'mp42']],
    ['a file named .mp4 whose brands are all unknown', 'odd.mp4', 'abcd', ['efgh']],
  ] as const)('%s is not importable', async (_, name, major, compatible) => {
    expect(await sniffFile(writeFtyp(tempDir(), name, major, compatible))).toBeNull();
  });

  it.each([
    ['an ffmpeg MP4', 'lecture.mp4', 'isom', ['isom', 'iso2', 'avc1', 'mp41'], 'video/mp4'],
    ['an MP4 v2', 'clip.mp4', 'mp42', ['mp42', 'isom'], 'video/mp4'],
    ['a QuickTime movie', 'screen.mov', 'qt  ', ['qt  '], 'video/quicktime'],
    ['iTunes video: the major brand decides, a compatible M4A does not matter', 'episode.m4v', 'M4V ', ['M4V ', 'M4A ', 'mp42', 'isom'], 'video/mp4'],
    ['a 3GP phone video, through a compatible brand', 'phone.mp4', '3gp4', ['3gp4', 'isom'], 'video/mp4'],
    ['a DASH segment', 'segment.mp4', 'dash', ['iso6', 'avc1'], 'video/mp4'],
    ['a Flash video', 'old.mp4', 'f4v ', ['f4v ', 'isom'], 'video/mp4'],
    ['HEVC in an MP4: a video, not a still image', 'hevc.mp4', 'isom', ['isom', 'iso2', 'mp41'], 'video/mp4'],
  ] as const)('%s is a video', async (_, name, major, compatible, mime) => {
    expect(await sniffFile(writeFtyp(tempDir(), name, major, compatible))).toEqual({ type: 'video', mime });
  });

  it('reads compatible brands inside the box only, also when the file ends early', async () => {
    const d = tempDir();
    // The box says 32 bytes, the file stops at 20: the one compatible brand there counts.
    const cut = Buffer.alloc(20);
    cut.writeUInt32BE(32, 0);
    cut.write('ftyp', 4, 'latin1');
    cut.write('abcd', 8, 'latin1');
    cut.write('isom', 16, 'latin1');
    fs.writeFileSync(path.join(d, 'cut.mp4'), cut);
    expect(await sniffFile(path.join(d, 'cut.mp4'))).toEqual({ type: 'video', mime: 'video/mp4' });
    // The box ends at 16 bytes: what follows belongs to the next box, not to the brands.
    const short = Buffer.alloc(24);
    short.writeUInt32BE(16, 0);
    short.write('ftyp', 4, 'latin1');
    short.write('abcd', 8, 'latin1');
    short.write('isom', 16, 'latin1');
    short.write('mdat', 20, 'latin1');
    fs.writeFileSync(path.join(d, 'short.mp4'), short);
    expect(await sniffFile(path.join(d, 'short.mp4'))).toBeNull();
  });
});
