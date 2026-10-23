import fs from 'node:fs';
import { mainStrings } from './strings';

const copy = mainStrings.libraryFolder;

export type FolderCheck = { ok: true } | { ok: false; message: string };

/** A library folder must exist, be a directory and be writable by this user (R4). The message says what to do next. */
export function checkLibraryFolder(dir: string): FolderCheck {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(dir);
  } catch {
    return { ok: false, message: copy.missing };
  }
  if (!stat.isDirectory()) return { ok: false, message: copy.notFolder };
  try {
    fs.accessSync(dir, fs.constants.W_OK);
  } catch {
    return { ok: false, message: copy.notWritable };
  }
  return { ok: true };
}
