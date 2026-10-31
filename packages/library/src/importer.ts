import fs from 'node:fs/promises';
import path from 'node:path';
import { LearnError, VIDEO_FORMATS, newId, nowIso, toLearnError, type ImportOutcome, type StorageMode } from '@learn/domain';
import type { AssetRow, LibraryRepository } from '@learn/db';
import { fsyncDir, fsyncFile } from './fsync';
import { sha256File } from './hash';
import { managedRelativePath, type LibraryLayout } from './layout';
import { sniffFile } from './sniff';

export const EXTRACTOR_VERSION = 'text-v0';

/** Fault-injection points for tests. Production passes none. */
export interface ImportHooks {
  afterStage?(stagingFile: string): void | Promise<void>;
  afterPlace?(assetFile: string): void | Promise<void>;
  beforeCommit?(): void | Promise<void>;
}

export interface ImportOptions {
  mode: StorageMode;
  allowDuplicate?: boolean;
  /** File each imported item into this collection in the item's own transaction; a collection gone by then is skipped. */
  collectionId?: string | null;
}

export class Importer {
  constructor(private readonly deps: { layout: LibraryLayout; repo: LibraryRepository; hooks?: ImportHooks | undefined }) {}

  /** Sequential on purpose: one writer, predictable disk usage. */
  async importMany(paths: readonly string[], opts: ImportOptions): Promise<ImportOutcome[]> {
    const outcomes: ImportOutcome[] = [];
    for (const p of paths) outcomes.push(await this.importOne(p, opts));
    return outcomes;
  }

  async importOne(inputPath: string, opts: ImportOptions): Promise<ImportOutcome> {
    const src = path.resolve(inputPath);
    try {
      return await this.run(src, opts);
    } catch (e) {
      const le = toLearnError(e, '가져오기에 실패했습니다.');
      return { status: 'failed', path: src, code: le.code, message: le.message };
    }
  }

  private async run(src: string, opts: ImportOptions): Promise<ImportOutcome> {
    const { repo, hooks } = this.deps;
    const st = await fs.stat(src);
    if (!st.isFile()) throw new LearnError('UNSUPPORTED_TYPE', '일반 파일만 가져올\u00a0수 있습니다.');
    const kind = await sniffFile(src);
    if (!kind) throw new LearnError('UNSUPPORTED_TYPE', `지원하지 않는 형식입니다. 지금은 PDF와\u00a0동영상(${VIDEO_FORMATS})을 가져올\u00a0수 있습니다.`);
    const sha256 = await sha256File(src);

    const existing = repo.findAssetsBySha(sha256);
    const existingItemId = existing.map((a) => repo.itemIdsForAsset(a.id)[0]).find((id) => id !== undefined);
    if (existingItemId && !opts.allowDuplicate) return { status: 'duplicate', path: src, existingItemId };

    const now = nowIso();
    const reusable =
      opts.mode === 'managed'
        ? existing.find((a) => a.storageMode === 'managed')
        : existing.find((a) => a.storageMode === 'linked' && a.externalPath === src);
    let asset: AssetRow;
    if (reusable) {
      asset = reusable;
      // Verify reused managed asset is intact; restore file if missing.
      if (opts.mode === 'managed') {
        await this.ensurePlaced(src, sha256);
        if (reusable.availability === 'missing') {
          repo.setAvailability(reusable.id, 'available', now);
        }
      }
    } else {
      asset = {
        id: newId(), sha256, storageMode: opts.mode, relativePath: null, externalPath: null,
        originalName: displayFileName(src), mime: kind.mime, size: st.size, availability: 'available', createdAt: now, checkedAt: now,
      };
      if (opts.mode === 'managed') asset.relativePath = await this.place(src, sha256);
      else asset.externalPath = src;
    }

    await hooks?.beforeCommit?.();
    const item = { id: newId(), type: kind.type, title: fileTitle(src), createdAt: now };
    const collectionId = opts.collectionId ?? null;
    const filed = repo.insertImported({
      item,
      asset,
      assetIsNew: !reusable,
      revision: reusable ? null : { id: newId(), createdAt: now },
      job: { id: newId(), kind: 'extract', dedupeKey: `extract:${sha256}:${EXTRACTOR_VERSION}`, payload: { sha256, type: kind.type } },
      collectionId,
    });
    const saved = repo.getItem(item.id);
    if (!saved) throw new LearnError('INTERNAL', '가져온 항목을 다시 읽지 못했습니다.');
    // The outcome names the collection only when the membership really exists: the renderer counts from it.
    return filed && collectionId !== null ? { status: 'imported', path: src, item: saved, collectionId } : { status: 'imported', path: src, item: saved };
  }

  /** Reused managed asset: make sure a verified file sits at the hash-addressed target. */
  private async ensurePlaced(src: string, sha256: string): Promise<void> {
    await this.place(src, sha256);
  }

  /**
   * staging copy → verify hash → flush → atomic rename into assets/ → flush the folder. Returns the library-relative
   * path. A target already present with the right hash is reused. A target with the wrong hash is quarantined into
   * staging/ (never deleted) and replaced by the verified copy.
   */
  private async place(src: string, sha256: string): Promise<string> {
    const { layout, hooks } = this.deps;
    const rel = managedRelativePath(sha256);
    const target = path.join(layout.root, ...rel.split('/'));
    const shard = path.dirname(target);
    const staging = path.join(layout.stagingDir, `${newId()}.part`);
    try {
      await fs.copyFile(src, staging);
      if ((await sha256File(staging)) !== sha256) {
        throw new LearnError('HASH_MISMATCH', '복사하는 동안 원본\u00a0파일이 바뀌었습니다. 다시 시도하세요.', { retryable: true });
      }
      await hooks?.afterStage?.(staging);
      // A shard folder made just now is a new entry of its parent, which has to reach the disk as well.
      const made = await fs.mkdir(shard, { recursive: true });
      if (made !== undefined) await fsyncDir(path.dirname(made));
      if (await exists(target)) {
        if ((await sha256File(target)) === sha256) {
          // intact: reuse
        } else {
          // The bytes reach the disk before the name does: after a power cut the name holds the old file or the whole new one.
          await fsyncFile(staging);
          await fs.rename(target, path.join(layout.stagingDir, `corrupt-${sha256}-${newId()}`));
          await fs.rename(staging, target);
          await fsyncDir(layout.stagingDir);
          await fsyncDir(shard);
        }
      } else {
        await fsyncFile(staging);
        await fs.rename(staging, target);
        await fsyncDir(shard);
      }
      await hooks?.afterPlace?.(target);
      return rel;
    } finally {
      await fs.rm(staging, { force: true });
    }
  }
}

/** A file's name as the library stores and shows it: macOS hands over decomposed Hangul (NFD), the library keeps NFC. The path itself stays as the disk has it. */
export const displayFileName = (filePath: string): string => path.basename(filePath).normalize('NFC');

/** The title a file gets on import: its NFC name without the extension (the whole name when that leaves nothing). */
export function fileTitle(filePath: string): string {
  const name = displayFileName(filePath);
  return path.basename(name, path.extname(name)) || name;
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
