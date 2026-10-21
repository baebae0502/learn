import fs from 'node:fs';

export type FolderCheck = { ok: true } | { ok: false; message: string };

/** A library folder must exist, be a directory and be writable by this user (R4). The message says what to do next. */
export function checkLibraryFolder(dir: string): FolderCheck {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(dir);
  } catch {
    return { ok: false, message: '폴더를 찾을 수 없습니다. 다른\u00a0폴더를 고르세요.' };
  }
  if (!stat.isDirectory()) return { ok: false, message: '폴더가 아닙니다. 다른\u00a0폴더를 고르세요.' };
  try {
    fs.accessSync(dir, fs.constants.W_OK);
  } catch {
    return { ok: false, message: '이\u00a0폴더에는 쓸 수 없습니다. 쓰기 권한이 있는 폴더를 고르세요.' };
  }
  return { ok: true };
}
