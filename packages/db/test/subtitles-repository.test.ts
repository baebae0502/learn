import { newId, nowIso, type Cue } from '@learn/domain';
import { describe, expect, it } from 'vitest';
import { LibraryRepository, SubtitlesRepository, purgeTrash, type AssetRow, type Db } from '../src/index';
import { expectLearnError, freshDb, seedItem } from './fixtures';

const cues = (n = 3): Cue[] => Array.from({ length: n }, (_, i) => ({ startMs: i * 1000, endMs: i * 1000 + 900, text: `문장 ${i}` }));
let seq = 0;
const sha = () => (0x1000 + ++seq).toString(16).padStart(64, 'a');

function subtitleAsset(over: Partial<AssetRow> = {}): AssetRow {
  const s = over.sha256 ?? sha();
  return {
    id: newId(), sha256: s, storageMode: 'managed', relativePath: `assets/${s.slice(0, 2)}/${s}`, externalPath: null,
    originalName: 'lecture.ko.srt', mime: 'application/x-subrip', size: 99, availability: 'available',
    createdAt: nowIso(), checkedAt: nowIso(), ...over,
  };
}

function setup() {
  const db = freshDb();
  return { db, subs: new SubtitlesRepository(db), repo: new LibraryRepository(db) };
}

function attachNew(subs: SubtitlesRepository, itemId: string, over: { asset?: AssetRow; language?: string | null; cues?: Cue[] } = {}) {
  const asset = over.asset ?? subtitleAsset();
  const assetIsNew = over.asset === undefined;
  const track = subs.attach({
    itemId, asset, assetIsNew, revision: assetIsNew ? { id: newId(), createdAt: nowIso() } : null,
    language: over.language ?? null, cues: over.cues ?? cues(), createdAt: nowIso(),
  });
  return { asset, track };
}
const count = (db: Db, table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

describe('attach and list', () => {
  it('a new asset gives one track at position 0, the second file position 1', () => {
    const { db, subs } = setup();
    const { itemId } = seedItem(db, { type: 'video' });
    const a = attachNew(subs, itemId, { language: 'ko' });
    expect(a.track).toEqual({ assetId: a.asset.id, language: 'ko', position: 0, originalName: 'lecture.ko.srt', cueCount: 3 });
    const b = attachNew(subs, itemId, { language: 'en', cues: cues(2) });
    expect(subs.list(itemId).map((t) => [t.assetId, t.position, t.cueCount])).toEqual([[a.asset.id, 0, 3], [b.asset.id, 1, 2]]);
    expect(db.prepare(`SELECT role FROM item_assets WHERE asset_id = ?`).pluck().get(a.asset.id)).toBe('subtitle');
  });

  it('shares one asset row and one set of cues when another video uses the same file', () => {
    const { db, subs } = setup();
    const v1 = seedItem(db, { type: 'video' });
    const v2 = seedItem(db, { type: 'video' });
    const first = attachNew(subs, v1.itemId);
    const second = attachNew(subs, v2.itemId, { asset: first.asset });
    expect(second.track).toMatchObject({ assetId: first.asset.id, position: 0, cueCount: 3 });
    expect(count(db, 'assets WHERE mime = \'application/x-subrip\'')).toBe(1);
    expect(count(db, 'cue_texts')).toBe(3);
    expect(count(db, 'subtitle_tracks')).toBe(2);
  });

  it('does not insert cues again when the sha already has them', () => {
    const { db, subs } = setup();
    const v1 = seedItem(db, { type: 'video' });
    const v2 = seedItem(db, { type: 'video' });
    const first = attachNew(subs, v1.itemId);
    subs.attach({ itemId: v2.itemId, asset: first.asset, assetIsNew: false, revision: null, language: null, cues: cues(5), createdAt: nowIso() });
    expect(count(db, 'cue_texts')).toBe(3);
  });

  it('answers already for the same sha on the same video and writes nothing', () => {
    const { db, subs } = setup();
    const { itemId } = seedItem(db, { type: 'video' });
    const first = attachNew(subs, itemId);
    const before = [count(db, 'assets'), count(db, 'item_assets'), count(db, 'subtitle_tracks'), count(db, 'cue_texts')];
    const dup = attachNew(subs, itemId, { asset: first.asset });
    expect(dup.track).toBe('already');
    const again = subs.attach({ itemId, asset: subtitleAsset({ sha256: first.asset.sha256 }), assetIsNew: true, revision: { id: newId(), createdAt: nowIso() }, language: null, cues: cues(), createdAt: nowIso() });
    expect(again).toBe('already');
    expect([count(db, 'assets'), count(db, 'item_assets'), count(db, 'subtitle_tracks'), count(db, 'cue_texts')]).toEqual(before);
    expect(subs.isLinked(itemId, first.asset.sha256)).toBe(true);
    expect(subs.isLinked(itemId, sha())).toBe(false);
  });
});

describe('attach refusals', () => {
  it('refuses a trashed video, a PDF, and a missing item with NOT_FOUND, writing nothing', () => {
    const { db, subs, repo } = setup();
    const video = seedItem(db, { type: 'video' });
    const pdf = seedItem(db);
    const trashed = seedItem(db, { type: 'video' });
    repo.trash([trashed.itemId]);
    for (const id of [trashed.itemId, pdf.itemId, newId()]) expectLearnError(() => attachNew(subs, id), 'NOT_FOUND');
    expect(attachNew(subs, video.itemId).track).not.toBe('already'); // the same call shape succeeds on a live video
    expect(count(db, 'subtitle_tracks')).toBe(1);
  });

  it('refuses a MIME that is not a subtitle with VALIDATION_FAILED', () => {
    const { db, subs } = setup();
    const { itemId } = seedItem(db, { type: 'video' });
    expectLearnError(() => subs.attach({
      itemId, asset: subtitleAsset({ mime: 'application/pdf' }), assetIsNew: true, revision: { id: newId(), createdAt: nowIso() }, language: null, cues: cues(), createdAt: nowIso(),
    }), 'VALIDATION_FAILED');
    expect(count(db, 'assets WHERE mime = \'application/pdf\'')).toBe(0);
  });
});

describe('cues', () => {
  it('reads the cues in order, and refuses an asset the item does not link', () => {
    const { db, subs } = setup();
    const v1 = seedItem(db, { type: 'video' });
    const v2 = seedItem(db, { type: 'video' });
    const a = attachNew(subs, v1.itemId, { cues: cues(4) });
    expect(subs.cues(v1.itemId, a.asset.id)).toEqual(cues(4));
    expectLearnError(() => subs.cues(v2.itemId, a.asset.id), 'NOT_FOUND');
    expectLearnError(() => subs.cues(v1.itemId, newId()), 'NOT_FOUND');
    expect(subs.hasCues(a.asset.sha256)).toBe(true);
    expect(subs.hasCues(sha())).toBe(false);
  });
});

describe('remove and restore', () => {
  it('remove leaves the asset and cues; restore puts the language and position back, once', () => {
    const { db, subs } = setup();
    const { itemId } = seedItem(db, { type: 'video' });
    attachNew(subs, itemId, { language: 'en' });
    const b = attachNew(subs, itemId, { language: 'ko' });
    const removed = subs.remove(itemId, b.asset.id);
    expect(removed).toEqual({ position: 1, language: 'ko' });
    expect(subs.list(itemId).map((t) => t.language)).toEqual(['en']);
    expect(count(db, `subtitle_tracks WHERE asset_id = '${b.asset.id}'`)).toBe(0);
    expect(count(db, `item_assets WHERE asset_id = '${b.asset.id}'`)).toBe(0);
    expect(count(db, `assets WHERE id = '${b.asset.id}'`)).toBe(1);
    expect(count(db, 'cue_texts')).toBe(6);

    const back = subs.restore(itemId, b.asset.id, removed, nowIso());
    expect(back).toMatchObject({ assetId: b.asset.id, language: 'ko', position: 1, cueCount: 3 });
    expect(subs.restore(itemId, b.asset.id, removed, nowIso())).toEqual(back);
    expect(subs.list(itemId)).toHaveLength(2);
    expect(count(db, 'subtitle_tracks')).toBe(2);
  });

  it('refuses to remove a track that is not there and to restore what is gone', () => {
    const { db, subs } = setup();
    const { itemId } = seedItem(db, { type: 'video' });
    expectLearnError(() => subs.remove(itemId, newId()), 'NOT_FOUND');
    expectLearnError(() => subs.restore(itemId, newId(), { position: 0, language: null }, nowIso()), 'NOT_FOUND');
  });
});

describe('orphans and purge', () => {
  it('sweeps an unlinked subtitle asset with its cues, once', () => {
    const { db, subs } = setup();
    const { itemId } = seedItem(db, { type: 'video' });
    const a = attachNew(subs, itemId);
    subs.remove(itemId, a.asset.id);
    const swept = subs.sweepOrphans();
    expect(swept).toEqual([{ id: a.asset.id, storageMode: 'managed', relativePath: a.asset.relativePath, size: 99 }]);
    expect(count(db, 'assets WHERE mime = \'application/x-subrip\'')).toBe(0);
    expect(count(db, 'cue_texts')).toBe(0);
    expect(count(db, 'cue_texts_fts')).toBe(0);
    expect(subs.sweepOrphans()).toEqual([]);
  });

  it('keeps the asset while another video links it, and never touches a linked PDF original', () => {
    const { db, subs } = setup();
    const v1 = seedItem(db, { type: 'video' });
    const v2 = seedItem(db, { type: 'video' });
    const pdf = seedItem(db);
    const a = attachNew(subs, v1.itemId);
    attachNew(subs, v2.itemId, { asset: a.asset });
    subs.remove(v1.itemId, a.asset.id);
    expect(subs.sweepOrphans()).toEqual([]);
    expect(count(db, 'cue_texts')).toBe(3);
    expect(count(db, `assets WHERE id = '${pdf.asset.id}'`)).toBe(1);
  });

  it('purging the video removes the subtitle asset, cues and tracks, unless another video shares the sha', () => {
    const { db, subs, repo } = setup();
    const v1 = seedItem(db, { type: 'video' });
    const v2 = seedItem(db, { type: 'video' });
    const v3 = seedItem(db, { type: 'video' });
    const shared = attachNew(subs, v1.itemId);
    attachNew(subs, v2.itemId, { asset: shared.asset });
    const own = attachNew(subs, v3.itemId);

    repo.trash([v1.itemId, v3.itemId]);
    const purged = purgeTrash(db, { itemIds: [v1.itemId, v3.itemId], collectionIds: [] });
    expect(purged.assets.map((a) => a.id)).toContain(own.asset.id);
    expect(purged.assets.map((a) => a.id)).not.toContain(shared.asset.id);
    expect(count(db, 'cue_texts')).toBe(3);
    expect(subs.hasCues(shared.asset.sha256)).toBe(true);
    expect(subs.hasCues(own.asset.sha256)).toBe(false);
    expect(count(db, 'subtitle_tracks')).toBe(1);

    repo.trash([v2.itemId]);
    purgeTrash(db, { itemIds: [v2.itemId], collectionIds: [] });
    expect(count(db, 'cue_texts')).toBe(0);
    expect(count(db, 'subtitle_tracks')).toBe(0);
  });
});

describe('counts', () => {
  it('counts tracks and cue texts by item or sha', () => {
    const { db, subs, repo } = setup();
    const v1 = seedItem(db, { type: 'video' });
    const v2 = seedItem(db, { type: 'video' });
    const a = attachNew(subs, v1.itemId, { cues: cues(4) });
    attachNew(subs, v1.itemId, { cues: cues(2) });
    expect(subs.count()).toBe(2);
    expect(repo.counts().subtitleTracks).toBe(2);
    expect(subs.cueTextCount({ itemId: v1.itemId })).toBe(6);
    expect(subs.cueTextCount({ itemId: v2.itemId })).toBe(0);
    expect(subs.cueTextCount({ sha256: a.asset.sha256 })).toBe(4);
  });
});

describe('itemIdsForAsset by role', () => {
  it('filters by role when asked', () => {
    const { db, subs, repo } = setup();
    const v = seedItem(db, { type: 'video' });
    const a = attachNew(subs, v.itemId);
    expect(repo.itemIdsForAsset(a.asset.id)).toEqual([v.itemId]);
    expect(repo.itemIdsForAsset(a.asset.id, 'subtitle')).toEqual([v.itemId]);
    expect(repo.itemIdsForAsset(a.asset.id, 'original')).toEqual([]);
    expect(repo.itemIdsForAsset(v.asset.id, 'original')).toEqual([v.itemId]);
  });
});
