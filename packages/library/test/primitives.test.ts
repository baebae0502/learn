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
});
