import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fsyncDir, fsyncFile } from '../src/index';
import { cleanupTemp, tempDir } from './helpers';

afterEach(() => {
  vi.restoreAllMocks();
  cleanupTemp();
});

/** FileHandle.prototype, so a test can make sync() answer what a file system would. */
async function fileHandlePrototype(dir: string): Promise<{ sync(): Promise<void> }> {
  const fh = await fsp.open(dir, 'r');
  await fh.close();
  return Object.getPrototypeOf(fh) as { sync(): Promise<void> };
}
const errno = (code: string) => Object.assign(new Error(code), { code });

describe('fsyncFile and fsyncDir', () => {
  it('flush a file, a read-only file and a folder; a missing one is an error', async () => {
    const d = tempDir();
    const f = path.join(d, 'a.part');
    fs.writeFileSync(f, 'bytes');
    await expect(fsyncFile(f)).resolves.toBeUndefined();
    fs.chmodSync(f, 0o444); // fs.copyFile keeps the source's mode: a read-only original gives a read-only staged copy
    await expect(fsyncFile(f)).resolves.toBeUndefined();
    await expect(fsyncDir(d)).resolves.toBeUndefined();
    await expect(fsyncFile(path.join(d, 'gone'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fsyncDir(path.join(d, 'gone'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each(['EINVAL', 'EPERM', 'EISDIR', 'ENOTSUP', 'EOPNOTSUPP'])('a folder the file system cannot flush (%s) is not an error', async (code) => {
    const d = tempDir();
    vi.spyOn(await fileHandlePrototype(d), 'sync').mockRejectedValueOnce(errno(code));
    await expect(fsyncDir(d)).resolves.toBeUndefined();
  });

  it('a folder that fails to flush otherwise (EIO) is an error; a file that fails to flush always is', async () => {
    const d = tempDir();
    const f = path.join(d, 'a.part');
    fs.writeFileSync(f, 'x');
    const proto = await fileHandlePrototype(d);
    vi.spyOn(proto, 'sync').mockRejectedValueOnce(errno('EIO'));
    await expect(fsyncDir(d)).rejects.toMatchObject({ code: 'EIO' });
    vi.spyOn(proto, 'sync').mockRejectedValueOnce(errno('EINVAL'));
    await expect(fsyncFile(f)).rejects.toMatchObject({ code: 'EINVAL' });
  });
});
