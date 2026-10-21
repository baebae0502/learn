import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { findUpdateBackup } from './update-backup';

const dirs: string[] = [];
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-backup-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('findUpdateBackup (the fatal screen names a real file, never a pattern)', () => {
  it('returns the newest pre-update backup of the library database by version', () => {
    const root = tmp();
    for (const f of ['library.sqlite', 'library.sqlite.pre-v2.bak', 'library.sqlite.pre-v10.bak', 'library.sqlite.pre-v3.bak']) fs.writeFileSync(path.join(root, f), '');
    expect(findUpdateBackup(root)).toBe('library.sqlite.pre-v10.bak');
  });
  it('ignores look-alikes: other databases, other suffixes, folders', () => {
    const root = tmp();
    for (const f of ['other.sqlite.pre-v4.bak', 'library.sqlite.pre-v4.bak.tmp', 'library.sqlite.pre-vX.bak', 'library.sqlite.bak']) fs.writeFileSync(path.join(root, f), '');
    fs.mkdirSync(path.join(root, 'library.sqlite.pre-v5.bak'));
    expect(findUpdateBackup(root)).toBeNull();
  });
  it('no backup, or a folder that cannot be read: null (the code is logged, never the path)', () => {
    expect(findUpdateBackup(tmp())).toBeNull();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const missing = path.join(tmp(), 'nope');
    expect(findUpdateBackup(missing)).toBeNull();
    expect(warn).toHaveBeenCalledWith('[library] listing backups failed: NOT_FOUND');
    expect(warn.mock.calls.flat().join(' ')).not.toContain(missing);
    warn.mockRestore();
  });
});
