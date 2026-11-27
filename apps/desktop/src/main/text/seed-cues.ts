import { createHash } from 'node:crypto';
import { newId, nowIso } from '@learn/domain';
import { bodyTextPage } from './seed-body-text';
import type { SeedAssetsDeps } from '../test-hooks';

export interface SeedCuesInput {
  videos: number;
  cuesEach: number;
  /** The first this many videos get a second track ('en') of `cuesEach` cues, written after every video's first: a subtitle attached later. */
  lateTracks?: number;
}

const TITLE = 'lecture';
const CUE_CHARS = 60;
const COMMIT_EVERY = 5000;

/**
 * `videos` video items (newest first), each with one subtitle track of `cuesEach` cues, written straight to the tables with no
 * files: the library of subtitles that search runs over. Cue texts are the synthetic words of seedBodyText. E2E only.
 */
export function seedCues(deps: SeedAssetsDeps, input: SeedCuesInput): { itemIds: string[] } {
  const { videos, cuesEach, lateTracks = 0 } = input;
  for (const [name, v] of Object.entries({ videos, cuesEach, lateTracks })) if (!Number.isInteger(v) || v < 0) throw new Error(`seedCues: ${name} must be a whole number`);
  if (lateTracks > videos) throw new Error('seedCues: lateTracks must not exceed videos');
  const batch = newId();
  const base = Date.now();
  const now = nowIso();
  const insertAsset = deps.db.prepare(
    `INSERT INTO assets (id, sha256, storage_mode, relative_path, external_path, original_name, mime, size, availability, created_at, checked_at)
     VALUES (?, ?, 'managed', ?, NULL, ?, ?, 1, 'available', ?, ?)`,
  );
  const insertRevision = deps.db.prepare('INSERT INTO source_revisions (id, asset_id, hash, created_at) VALUES (?, ?, ?, ?)');
  const link = deps.db.prepare(`INSERT INTO item_assets (item_id, asset_id, role) VALUES (?, ?, 'subtitle')`);
  const insertTrack = deps.db.prepare(`INSERT INTO subtitle_tracks (item_id, asset_id, role, language, position, created_at) VALUES (?, ?, 'subtitle', ?, ?, ?)`);
  const insertCue = deps.db.prepare('INSERT INTO cue_texts (sha256, cue_index, start_ms, end_ms, text) VALUES (?, ?, ?, ?, ?)');
  const itemIds: string[] = [];
  let inBatch = 0;
  const cues = (sha: string, v: number, page: number): void => {
    for (let c = 0; c < cuesEach; c++) {
      insertCue.run(sha, c, c * 3000, c * 3000 + 2500, bodyTextPage(page, v, c, CUE_CHARS));
      if (++inBatch >= COMMIT_EVERY) {
        deps.db.exec('COMMIT');
        deps.db.exec('BEGIN');
        inBatch = 0;
      }
    }
  };
  /** A subtitle file of its own on video `v`: its asset, revision, link and track. */
  const subtitle = (videoId: string, v: number, tag: string, language: string, position: number, createdAt: string): string => {
    const sub = { asset: newId(), revision: newId(), sha: createHash('sha256').update(`seed-cues:${batch}:${tag}:${v}`).digest('hex') };
    insertAsset.run(sub.asset, sub.sha, `assets/${sub.sha.slice(0, 2)}/${sub.sha}`, position === 0 ? `seed-${v + 1}.srt` : `seed-${v + 1}.${language}.srt`, 'application/x-subrip', createdAt, now);
    insertRevision.run(sub.revision, sub.asset, sub.sha, createdAt);
    link.run(videoId, sub.asset);
    insertTrack.run(videoId, sub.asset, language, position, createdAt);
    return sub.sha;
  };
  deps.db.exec('BEGIN');
  let open = true;
  try {
    for (let v = 0; v < videos; v++) {
      const createdAt = new Date(base - v * 1000).toISOString();
      const sha = createHash('sha256').update(`seed-cues:${batch}:video:${v}`).digest('hex');
      const video = { id: newId(), asset: newId(), revision: newId(), sha };
      insertAsset.run(video.asset, video.sha, `assets/${video.sha.slice(0, 2)}/${video.sha}`, `seed-${v + 1}.mp4`, 'video/mp4', createdAt, now);
      insertRevision.run(video.revision, video.asset, video.sha, createdAt);
      deps.repo.insertItemsForAsset([{ id: video.id, type: 'video', title: `${TITLE} ${v + 1}`, createdAt, metadataJson: '{"creators":[]}', assetId: video.asset, revisionId: video.revision }]);
      cues(subtitle(video.id, v, 'subtitle', 'ko', 0, createdAt), v, 7);
      itemIds.push(video.id);
    }
    // After every first track: the ids of a late track's cues are past the whole library's.
    for (let v = 0; v < lateTracks; v++) cues(subtitle(itemIds[v]!, v, 'late', 'en', 1, now), v, 8);
    deps.db.exec('COMMIT');
    open = false;
  } finally {
    if (open) deps.db.exec('ROLLBACK');
  }
  return { itemIds };
}
