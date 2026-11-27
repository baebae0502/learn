import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import fs, { type FileHandle } from 'node:fs/promises';
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
/** One read's most: a file within the limit is read in a few. */
const READ_CHUNK = 1024 * 1024;

/** Up to `max` bytes of the open file from its start: a file that grows while it is read is read no further. */
async function readAtMost(fh: FileHandle, max: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  while (total < max) {
    const chunk = Buffer.allocUnsafe(Math.min(READ_CHUNK, max - total));
    const { bytesRead } = await fh.read(chunk, 0, chunk.length, total);
    if (bytesRead === 0) break;
    chunks.push(chunk.subarray(0, bytesRead));
    total += bytesRead;
  }
  return Buffer.concat(chunks, total);
}

/**
 * The file's bytes, or why there are none. One open, and the handle answers what it is: a path swapped between a check and the
 * read cannot be read in its place. Non-blocking, so a FIFO's open does not wait for a writer (its stat refuses it).
 */
async function readSubtitleFile(p: string): Promise<Buffer | 'io' | 'too-large'> {
  const fh = await fs.open(p, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
  try {
    const st = await fh.stat();
    if (!st.isFile()) return 'io';
    if (st.size > SUBTITLE_LIMITS.bytes) return 'too-large';
    return await readAtMost(fh, SUBTITLE_LIMITS.bytes + 1);
  } finally {
    await fh.close();
  }
}

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
    try {
      const reason = await attachOne(deps, itemId, p, name, result);
      if (reason) result.failed.push({ name, reason });
    } catch (e) {
      // What an earlier path committed is the answer (and gets announced); only a call that added nothing throws.
      if (result.added.length === 0) throw e;
      result.failed.push({ name, reason: 'io' });
      break;
    }
  }
  return result;
}

/** One file, its own commit. Returns the failure's reason, or null when the file was added or was already there. */
async function attachOne(deps: AttachDeps, itemId: string, p: string, name: string, result: AttachResult): Promise<AttachFailureReason | null> {
  if (subtitleFormatOf(name) === null) return 'not-subtitle';
  let bytes: Buffer;
  try {
    const read = await readSubtitleFile(p);
    if (read === 'io' || read === 'too-large') return read;
    bytes = read;
  } catch (e) {
    if (!isFileError(e)) throw e;
    return 'io';
  }
  // A file that grew since its size was asked is as large as the bytes in hand say.
  if (bytes.length > SUBTITLE_LIMITS.bytes) return 'too-large';
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const read = readSubtitle(bytes, name);
  if (!read.ok) return read.reason;
  if (deps.subtitles.isLinked(itemId, sha256)) {
    result.already.push(name);
    return null;
  }
  const found = deps.repo.findAssetsBySha(sha256).find((a) => a.storageMode === 'managed' && SUBTITLE_MIME_VALUES.includes(a.mime));
  try {
    // A reused asset's copy is checked (and put back) too: the file may be gone.
    await deps.importer.placeManaged(p, sha256);
  } catch (e) {
    if (!isFileError(e)) throw e;
    return 'io';
  }
  // No await from here to the commit: the path's lock is let go only after this continuation, and the commit must land
  // before a purge's queued file removal looks at whether the copy is in use.
  const now = (deps.now ?? nowIso)();
  // A purge commits without the path's lock: the asset found before the copy was placed may be gone by now (its video was
  // purged meanwhile), and then its copy is in place for a new row.
  const existing = found ? deps.repo.getAsset(found.id) : undefined;
  if (existing && existing.availability === 'missing') deps.repo.setAvailability(existing.id, 'available', now);
  const asset: AssetRow = existing ?? {
    id: newId(), sha256, storageMode: 'managed', relativePath: managedRelativePath(sha256), externalPath: null, originalName: name,
    mime: SUBTITLE_MIMES[read.format], size: bytes.length, availability: 'available', createdAt: now, checkedAt: now,
  };
  const track = deps.subtitles.attach({
    itemId, asset, assetIsNew: !existing, revision: existing ? null : { id: newId(), createdAt: now }, language: read.language, cues: read.cues, createdAt: now,
  });
  if (track === 'already') result.already.push(name);
  else result.added.push(track);
  return null;
}
