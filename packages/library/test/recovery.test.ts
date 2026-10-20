import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LibraryRepository, migrate, openDatabase, type Db } from '@learn/db';
import {
  Importer, ensureLayout, libraryLayout, refreshAvailability, refreshLinkedAvailability, relinkAsset, resolveAssetPath, scanRecovery,
} from '../src/index';
import { cleanupTemp, tempDir, writePdf } from './helpers';

const dbs: Db[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
  cleanupTemp();
});

function setup() {
  const layout = libraryLayout(path.join(tempDir(), 'Library'));
  ensureLayout(layout);
  const db = openDatabase(layout.dbFile);
  dbs.push(db);
  migrate(db, { dbFile: layout.dbFile });
  const repo = new LibraryRepository(db);
  return { layout, db, repo, importer: new Importer({ layout, repo }) };
}

describe('scanRecovery', () => {
  it('reports a clean library as clean', async () => {
    const { layout, repo, importer } = setup();
    await importer.importOne(writePdf(tempDir('src'), 'a.pdf', 'a'), { mode: 'managed' });
    expect(await scanRecovery(layout, repo)).toEqual({ stagingLeftovers: [], unreferencedAssets: [], missingManagedAssets: [], interruptedJobs: 0 });
  });

  it('reports staging leftovers and unreferenced assets without deleting them', async () => {
    const { layout, repo } = setup();
    fs.writeFileSync(path.join(layout.stagingDir, 'dead.part'), 'partial');
    const orphanRel = `assets/ff/${'f'.repeat(64)}`;
    fs.mkdirSync(path.join(layout.assetsDir, 'ff'));
    fs.writeFileSync(path.join(layout.root, orphanRel), 'orphan');
    const report = await scanRecovery(layout, repo);
    expect(report.stagingLeftovers).toEqual(['dead.part']);
    expect(report.unreferencedAssets).toEqual([orphanRel]);
    expect(fs.existsSync(path.join(layout.stagingDir, 'dead.part'))).toBe(true);
    expect(fs.existsSync(path.join(layout.root, orphanRel))).toBe(true);
  });

  it('flags managed assets whose file vanished and interrupts running jobs', async () => {
    const { layout, db, repo, importer } = setup();
    const out = await importer.importOne(writePdf(tempDir('src'), 'a.pdf', 'a'), { mode: 'managed' });
    if (out.status !== 'imported') throw new Error(out.status);
    fs.rmSync(resolveAssetPath(layout, repo.getAsset(out.item.assetId)!));
    db.prepare(`UPDATE jobs SET state = 'running'`).run();
    const report = await scanRecovery(layout, repo);
    expect(report.missingManagedAssets).toEqual([out.item.assetId]);
    expect(report.interruptedJobs).toBe(1);
    expect(repo.getItem(out.item.id)!.availability).toBe('missing');
  });
});

describe('linked availability and relink', () => {
  it('marks a moved linked file missing, then relinks only to identical content', async () => {
    const { layout, repo, importer } = setup();
    const dir = tempDir('src');
    const src = writePdf(dir, 'paper.pdf', 'paper');
    const out = await importer.importOne(src, { mode: 'linked' });
    if (out.status !== 'imported') throw new Error(out.status);
    const moved = path.join(dir, 'paper (moved).pdf');
    fs.renameSync(src, moved);

    await refreshLinkedAvailability(layout, repo);
    expect(repo.getItem(out.item.id)!.availability).toBe('missing');

    const other = writePdf(dir, 'other.pdf', 'different');
    await expect(relinkAsset(repo, out.item.assetId, other)).rejects.toMatchObject({ code: 'HASH_MISMATCH' });

    await relinkAsset(repo, out.item.assetId, moved);
    expect(repo.getAsset(out.item.assetId)).toMatchObject({ externalPath: moved, availability: 'available' });
    expect(await refreshAvailability(layout, repo, repo.getAsset(out.item.assetId)!)).toBe('available');
  });

  it('refuses to relink managed assets', async () => {
    const { layout, repo, importer } = setup();
    const src = writePdf(tempDir('src'), 'a.pdf', 'a');
    const out = await importer.importOne(src, { mode: 'managed' });
    if (out.status !== 'imported') throw new Error(out.status);
    await expect(relinkAsset(repo, out.item.assetId, src)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});
