import { createHash } from 'node:crypto';
import { newId, nowIso } from '@learn/domain';
import { bodyTextPage } from './seed-body-text';
import type { SeedAssetsDeps } from '../test-hooks';

export interface SeedCuesInput {
  videos: number;
  cuesEach: number;
}

const TITLE = 'lecture';
const CUE_CHARS = 60;
const COMMIT_EVERY = 5000;

/**
 * `videos` video items (newest first), each with one subtitle track of `cuesEach` cues, written straight to the tables with no
 * files: the library of subtitles that search runs over. Cue texts are the synthetic words of seedBodyText. E2E only.
 */
export function seedCues(deps: SeedAssetsDeps, input: SeedCuesInput): { itemIds: string[] } {
  const { videos, cuesEach } = input;
  for (const [name, v] of Object.entries({ videos, cuesEach })) if (!Number.isInteger(v) || v < 0) throw new Error(`seedCues: ${name} must be a whole number`);
  const batch = newId();
  const base = Date.now();
  const now = nowIso();
  const insertAsset = deps.db.prepare(
    `INSERT INTO assets (id, sha256, storage_mode, relative_path, external_path, original_name, mime, size, availability, created_at, checked_at)
     VALUES (?, ?, 'managed', ?, NULL, ?, ?, 1, 'available', ?, ?)`,
  );
  const insertRevision = deps.db.prepare('INSERT INTO source_revisions (id, asset_id, hash, created_at) VALUES (?, ?, ?, ?)');
  const link = deps.db.prepare(`INSERT INTO item_assets (item_id, asset_id, role) VALUES (?, ?, 'subtitle')`);
  const insertTrack = deps.db.prepare(`INSERT INTO subtitle_tracks (item_id, asset_id, role, language, position, created_at) VALUES (?, ?, 'subtitle', 'ko', 0, ?)`);
  const insertCue = deps.db.prepare('INSERT INTO cue_texts (sha256, cue_index, start_ms, end_ms, text) VALUES (?, ?, ?, ?, ?)');
  const itemIds: string[] = [];
  let inBatch = 0;
  deps.db.exec('BEGIN');
  let open = true;
  try {
    for (let v = 0; v < videos; v++) {
      const createdAt = new Date(base - v * 1000).toISOString();
      const sha = (tag: string): string => createHash('sha256').update(`seed-cues:${batch}:${tag}:${v}`).digest('hex');
      const video = { id: newId(), asset: newId(), revision: newId(), sha: sha('video') };
      const sub = { asset: newId(), revision: newId(), sha: sha('subtitle') };
      insertAsset.run(video.asset, video.sha, `assets/${video.sha.slice(0, 2)}/${video.sha}`, `seed-${v + 1}.mp4`, 'video/mp4', createdAt, now);
      insertRevision.run(video.revision, video.asset, video.sha, createdAt);
      deps.repo.insertItemsForAsset([{ id: video.id, type: 'video', title: `${TITLE} ${v + 1}`, createdAt, metadataJson: '{"creators":[]}', assetId: video.asset, revisionId: video.revision }]);
      insertAsset.run(sub.asset, sub.sha, `assets/${sub.sha.slice(0, 2)}/${sub.sha}`, `seed-${v + 1}.srt`, 'application/x-subrip', createdAt, now);
      insertRevision.run(sub.revision, sub.asset, sub.sha, createdAt);
      link.run(video.id, sub.asset);
      insertTrack.run(video.id, sub.asset, createdAt);
      for (let c = 0; c < cuesEach; c++) {
        insertCue.run(sub.sha, c, c * 3000, c * 3000 + 2500, bodyTextPage(7, v, c, CUE_CHARS));
        if (++inBatch >= COMMIT_EVERY) {
          deps.db.exec('COMMIT');
          deps.db.exec('BEGIN');
          inBatch = 0;
        }
      }
      itemIds.push(video.id);
    }
    deps.db.exec('COMMIT');
    open = false;
  } finally {
    if (open) deps.db.exec('ROLLBACK');
  }
  return { itemIds };
}
