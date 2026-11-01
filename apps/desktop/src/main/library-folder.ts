import fs from 'node:fs';
import path from 'node:path';
import { LearnError, type Prefs } from '@learn/domain';
import type { PrefsStore } from './prefs';
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

/**
 * `dir` is `root` or a folder inside it, by real paths: a backup or a restore there would travel, and go, with the folder
 * it is in, and a link or a different spelling of the name must not get past the check. macOS volumes are mostly
 * case-insensitive, so there the names are compared in lower case (a conservative refusal). A path that cannot be resolved
 * (gone, no permission) is compared as written; the steps after say what is wrong with it.
 */
export function insideFolder(dir: string, root: string): boolean {
  const real = (p: string): string => {
    let r = path.resolve(p);
    try {
      r = fs.realpathSync.native(r);
    } catch {
      // compared as written
    }
    return process.platform === 'darwin' ? r.toLowerCase() : r;
  };
  const rel = path.relative(real(root), real(dir));
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

/**
 * Opens another library (설정's 다른 폴더 선택…, the restore's 전환 — spec 9.3): checked, saved as this device's library
 * folder, every window told, then the app restarts on it. The library in use stays as it is.
 */
export function switchLibrary(target: string, deps: { prefs: Pick<PrefsStore, 'set'>; announce(prefs: Prefs): void; relaunch(): void }): void {
  const check = checkLibraryFolder(target);
  if (!check.ok) throw new LearnError('VALIDATION_FAILED', check.message);
  deps.announce(deps.prefs.set({ libraryRoot: target }));
  deps.relaunch();
}
