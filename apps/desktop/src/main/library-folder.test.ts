import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { checkLibraryFolder } from './library-folder';

describe('checkLibraryFolder (R4)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-folder-'));
  afterAll(() => {
    if (fs.existsSync(path.join(tmp, 'ro'))) fs.chmodSync(path.join(tmp, 'ro'), 0o755);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  it('accepts an existing writable folder', () => {
    expect(checkLibraryFolder(tmp)).toEqual({ ok: true });
  });
  it('rejects a missing path and a file, with the cause and the next step', () => {
    expect(checkLibraryFolder(path.join(tmp, 'nope'))).toEqual({ ok: false, message: '폴더를 찾을 수 없습니다. 다른\u00a0폴더를 고르세요.' });
    const file = path.join(tmp, 'f.txt');
    fs.writeFileSync(file, 'x');
    expect(checkLibraryFolder(file)).toEqual({ ok: false, message: '폴더가 아닙니다. 다른\u00a0폴더를 고르세요.' });
  });
  it.skipIf(process.getuid?.() === 0)('rejects a folder this user cannot write to', () => {
    const ro = path.join(tmp, 'ro');
    fs.mkdirSync(ro, { mode: 0o555 });
    expect(checkLibraryFolder(ro)).toMatchObject({ ok: false, message: expect.stringContaining('쓸 수 없습니다') });
  });
});
