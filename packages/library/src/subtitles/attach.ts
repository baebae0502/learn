import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { LearnError, SUBTITLE_LIMITS, SUBTITLE_MIMES, newId, nowIso, subtitleFormatOf, type AttachFailureReason, type AttachResult } from '@learn/domain';
import type { AssetRow, LibraryRepository, SubtitlesRepository } from '@learn/db';
import { displayFileName, type Importer } from '../importer';
import { managedRelativePath } from '../layout';
import { readSubtitle } from './index';

export interface AttachDeps {
  repo: LibraryRepository;
  subtitles: SubtitlesRepository;
  importer: Pick<Importer, 'placeManaged'>;
  now?: () => string;
}

const SUBTITLE_MIME_VALUES: readonly string[] = Object.values(SUBTITLE_MIMES);

/** A file the disk would not give (or that changed while it was copied) is io; anything else is a bug and keeps its own error. */
function isFileError(e: unknown): boolean {
  if (e instanceof LearnError) return e.code === 'HASH_MISMATCH';
  return typeof (e as NodeJS.ErrnoException | null)?.code === 'string';
}

/**
 * The files one by one, each one its own outcome: a failure never stops the next (spec 5.4). A file that is not a
 * subtitle by name or size is refused before it is opened. The call as a whole is refused (NOT_FOUND) when the item is
 * not a live video, before the first file.
 */
export async function attachSubtitleFiles(deps: AttachDeps, itemId: string, paths: readonly string[]): Promise<AttachResult> {
  const item = deps.repo.getItem(itemId);
  if (!item || item.type !== 'video') throw new LearnError('NOT_FOUND', '동영상을 찾지 못했습니다.');
  const result: AttachResult = { added: [], already: [], failed: [] };
  for (const p of paths) {
    const name = displayFileName(p);
    const fail = (reason: AttachFailureReason): void => void result.failed.push({ name, reason });
    if (subtitleFormatOf(name) === null) {
      fail('not-subtitle');
      continue;
    }
    let size: number;
    let bytes: Buffer;
    try {
      size = (await fs.stat(p)).size;
      if (size > SUBTITLE_LIMITS.bytes) {
        fail('too-large');
        continue;
      }
      bytes = await fs.readFile(p);
    } catch (e) {
      if (!isFileError(e)) throw e;
      fail('io');
      continue;
    }
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const read = readSubtitle(bytes, name);
    if (!read.ok) {
      fail(read.reason);
      continue;
    }
    if (deps.subtitles.isLinked(itemId, sha256)) {
      result.already.push(name);
      continue;
    }
    const now = (deps.now ?? nowIso)();
    const existing = deps.repo.findAssetsBySha(sha256).find((a) => a.storageMode === 'managed' && SUBTITLE_MIME_VALUES.includes(a.mime));
    const asset: AssetRow = existing ?? {
      id: newId(), sha256, storageMode: 'managed', relativePath: managedRelativePath(sha256), externalPath: null, originalName: name,
      mime: SUBTITLE_MIMES[read.format], size, availability: 'available', createdAt: now, checkedAt: now,
    };
    try {
      // A reused asset's copy is checked (and put back) too: the file may be gone.
      await deps.importer.placeManaged(p, sha256);
    } catch (e) {
      if (!isFileError(e)) throw e;
      fail('io');
      continue;
    }
    if (existing && existing.availability === 'missing') deps.repo.setAvailability(existing.id, 'available', now);
    const track = deps.subtitles.attach({
      itemId, asset, assetIsNew: !existing, revision: existing ? null : { id: newId(), createdAt: now }, language: read.language, cues: read.cues, createdAt: now,
    });
    if (track === 'already') result.already.push(name);
    else result.added.push(track);
  }
  return result;
}
