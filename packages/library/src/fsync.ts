import fs, { type FileHandle } from 'node:fs/promises';

/**
 * Flushes a file's bytes to the disk. On macOS Node's fsync is fcntl(F_FULLFSYNC), then F_BARRIERFSYNC, then fsync()
 * (libuv uv__fs_fsync; libuv 1.25 and 1.30), so the drive's own cache is flushed too and a power cut cannot leave a renamed
 * file empty. Opened read-only: a copy keeps its source's mode, and a read-only descriptor flushes the same.
 */
export async function fsyncFile(file: string): Promise<void> {
  const fh = await fs.open(file, 'r');
  try {
    await fh.sync();
  } finally {
    await fh.close();
  }
}

/** What a file system that cannot flush a folder answers (some network and FUSE ones); nothing is lost by going on. */
const NO_FOLDER_SYNC: ReadonlySet<string> = new Set(['EISDIR', 'EINVAL', 'EPERM', 'ENOTSUP', 'EOPNOTSUPP']);

/** Flushes a folder's entries, so a rename into it, or a folder made in it, survives a power cut. */
export async function fsyncDir(dir: string): Promise<void> {
  let fh: FileHandle;
  try {
    fh = await fs.open(dir, 'r');
  } catch (e) {
    if (NO_FOLDER_SYNC.has((e as NodeJS.ErrnoException).code ?? '')) return;
    throw e;
  }
  try {
    await fh.sync();
  } catch (e) {
    if (!NO_FOLDER_SYNC.has((e as NodeJS.ErrnoException).code ?? '')) throw e;
  } finally {
    await fh.close();
  }
}
