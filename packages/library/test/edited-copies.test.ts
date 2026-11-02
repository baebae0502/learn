import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AssetRow } from '@learn/db';
import { editedCopyFile, listEditedCopies, openFolder, orphanEditedCopies, removeImportedEditedCopy } from '../src/edited-copies';
import { sha256File } from '../src/hash';
import { libraryLayout, managedRelativePath, type LibraryLayout } from '../src/layout';
import { cleanupTemp, tempDir } from './helpers';

afterEach(cleanupTemp);

const A = '5a0b8c1d-3e4f-4a5b-8c6d-7e8f9a0b1c2d';
const B = '0f1e2d3c-4b5a-4968-8776-a5b4c3d2e1f0';
const ASIDE = '강의 3 (수정본 2026-10-30 1412).pdf';

function setup() {
  const layout = libraryLayout(tempDir('edited'));
  const folder = (assetId: string) => {
    const dir = openFolder(layout, assetId);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  };
  const write = (file: string, body: string | Buffer, at?: Date) => {
    fs.writeFileSync(file, body);
    if (at) fs.utimesSync(file, at, at);
    return file;
  };
  return { layout, folder, write };
}

describe('listEditedCopies (M6 spec 6)', () => {
  it('lists the copies kept aside in the asset folder, newest first, with when they were saved and their size', async () => {
    const { layout, folder, write } = setup();
    const dir = folder(A);
    write(path.join(dir, '강의 3.pdf'), 'named copy');
    write(path.join(dir, ASIDE), 'edited once', new Date('2026-10-30T05:12:00Z'));
    write(path.join(dir, '강의 3 (수정본 2026-10-31 0905).pdf'), 'edited again!', new Date('2026-10-31T00:05:00Z'));
    write(path.join(dir, '.0d1c2b3a-0000-4000-8000-000000000000.part'), 'a copy in flight');
    write(path.join(dir, '.DS_Store'), 'finder');
    fs.mkdirSync(path.join(dir, '폴더 (수정본 2026-10-30 1412)'));
    fs.symlinkSync(path.join(dir, ASIDE), path.join(dir, '링크 (수정본 2026-10-30 1412).pdf'));
    expect(await listEditedCopies(layout, A)).toEqual([
      { name: '강의 3 (수정본 2026-10-31 0905).pdf', modifiedAt: '2026-10-31T00:05:00.000Z', size: 13 },
      { name: ASIDE, modifiedAt: '2026-10-30T05:12:00.000Z', size: 11 },
    ]);
  });

  it('names a copy in NFC whatever the disk spells, and has none for an asset without a folder or an id that is not one', async () => {
    const { layout, folder, write } = setup();
    write(path.join(folder(A), ASIDE.normalize('NFD')), 'x');
    expect((await listEditedCopies(layout, A)).map((c) => c.name)).toEqual([ASIDE]);
    expect(await listEditedCopies(layout, B)).toEqual([]);
    expect(await listEditedCopies(layout, '../open')).toEqual([]);
  });
});

describe('editedCopyFile (the panel names a copy, main finds it)', () => {
  it('finds the copy by the name the panel was given, as the disk spells it', async () => {
    const { layout, folder, write } = setup();
    const onDisk = write(path.join(folder(A), ASIDE.normalize('NFD')), 'x');
    expect(await editedCopyFile(layout, A, ASIDE)).toBe(onDisk);
  });

  it('answers nothing for the named copy, a dot name, a path, another asset copy, one that is gone, or a bad asset id', async () => {
    const { layout, folder, write } = setup();
    write(path.join(folder(A), '강의 3.pdf'), 'named');
    write(path.join(folder(B), ASIDE), 'another asset');
    for (const name of ['강의 3.pdf', `../${B}/${ASIDE}`, '..', '.', `.${ASIDE}`, ASIDE]) expect(await editedCopyFile(layout, A, name), name).toBeNull();
    expect(await editedCopyFile(layout, '../derived', ASIDE)).toBeNull();
  });
});

describe('orphanEditedCopies (the library check, Task 8)', () => {
  it('lists the copies in folders whose asset has no row, folder by folder; uuid folders only', async () => {
    const { layout, folder, write } = setup();
    write(path.join(folder(A), ASIDE), 'its asset is there');
    write(path.join(folder(B), ASIDE), 'its asset is gone');
    write(path.join(folder(B), '강의 3.pdf'), 'its named copy');
    const stray = path.join(layout.derivedDir, 'open', 'not-an-asset');
    fs.mkdirSync(stray, { recursive: true });
    write(path.join(stray, ASIDE), 'stray');
    expect(await orphanEditedCopies(layout, new Set([A]))).toEqual([{ assetId: B, name: ASIDE }]);
    expect(await orphanEditedCopies(layout, new Set([A, B]))).toEqual([]);
  });

  it('has none before any copy was made (no derived/open/)', async () => {
    expect(await orphanEditedCopies(setup().layout, new Set())).toEqual([]);
  });
});

/** The library's copy of `body` where the importer leaves it, and its asset row. */
async function stored(layout: LibraryLayout, body: Buffer): Promise<{ asset: AssetRow; file: string }> {
  fs.mkdirSync(layout.root, { recursive: true });
  const incoming = path.join(layout.root, 'incoming.pdf');
  fs.writeFileSync(incoming, body);
  const sha256 = await sha256File(incoming);
  const relativePath = managedRelativePath(sha256);
  const file = path.join(layout.root, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.renameSync(incoming, file);
  const asset: AssetRow = {
    id: B, sha256, storageMode: 'managed', relativePath, externalPath: null, originalName: ASIDE, mime: 'application/pdf',
    size: body.length, availability: 'available', createdAt: '2026-10-31T00:00:00.000Z', checkedAt: null,
  };
  return { asset, file };
}

describe('removeImportedEditedCopy (after 새 자료로 가져오기 committed)', () => {
  const EDITED = Buffer.from('%PDF-1.4\n% edited in another app\n%%EOF\n');

  it('removes the copy once the library holds exactly its bytes', async () => {
    const { layout, folder, write } = setup();
    const copy = write(path.join(folder(A), ASIDE), EDITED);
    const { asset } = await stored(layout, EDITED);
    expect(await removeImportedEditedCopy(layout, copy, asset)).toBe(true);
    expect(fs.existsSync(copy)).toBe(false);
  });

  it('keeps a copy saved over while it was imported', async () => {
    const { layout, folder, write } = setup();
    const copy = write(path.join(folder(A), ASIDE), Buffer.concat([EDITED, Buffer.from('% saved again\n')]));
    const { asset } = await stored(layout, EDITED);
    expect(await removeImportedEditedCopy(layout, copy, asset)).toBe(false);
    expect(fs.existsSync(copy)).toBe(true);
  });

  it('keeps it when the library copy is gone or not its size, the asset is linked, or there is no asset', async () => {
    const { layout, folder, write } = setup();
    const copy = write(path.join(folder(A), ASIDE), EDITED);
    const { asset, file } = await stored(layout, EDITED);
    expect(await removeImportedEditedCopy(layout, copy, { ...asset, size: asset.size + 1 })).toBe(false);
    expect(await removeImportedEditedCopy(layout, copy, { ...asset, storageMode: 'linked', relativePath: null, externalPath: copy })).toBe(false);
    expect(await removeImportedEditedCopy(layout, copy, undefined)).toBe(false);
    fs.rmSync(file);
    expect(await removeImportedEditedCopy(layout, copy, asset)).toBe(false);
    expect(fs.existsSync(copy)).toBe(true);
  });

  it('never removes a file outside an asset folder in derived/open/, or one that is not a copy kept aside', async () => {
    const { layout, folder, write } = setup();
    const { asset } = await stored(layout, EDITED);
    const named = write(path.join(folder(A), '강의 3.pdf'), EDITED);
    const outside = write(path.join(layout.root, ASIDE), EDITED);
    const deeper = path.join(folder(A), 'sub');
    fs.mkdirSync(deeper);
    const nested = write(path.join(deeper, ASIDE), EDITED);
    for (const file of [named, outside, nested]) {
      expect(await removeImportedEditedCopy(layout, file, asset), file).toBe(false);
      expect(fs.existsSync(file)).toBe(true);
    }
  });
});
