import fs from 'node:fs';
import path from 'node:path';
import { LearnError, type ImportOutcome, type Prefs } from '@learn/domain';
import type { ImportOptions } from '@learn/library';
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

export interface ImportsFiles {
  importOne(inputPath: string, opts: ImportOptions): Promise<ImportOutcome>;
}

/**
 * The importer as the queue uses it, with one refusal added: a linked import of a file inside the library folder fails
 * (the file would be an "original" that a cleanup, a purge or the library check may delete). A managed import of it copies.
 */
export function refuseLinkedInside(importer: ImportsFiles, root: string): ImportsFiles {
  return {
    importOne: (inputPath, opts) =>
      opts.mode === 'linked' && insideFolder(path.resolve(inputPath), root)
        ? Promise.resolve<ImportOutcome>({ status: 'failed', path: path.resolve(inputPath), code: 'VALIDATION_FAILED', message: copy.linkedInside })
        : importer.importOne(inputPath, opts),
  };
}

export interface LibrarySwitch {
  /** Checks the folder and remembers the switch, then asks the app to quit. Nothing is saved or armed yet. */
  request(target: string): void;
  /** The quit really goes ahead (will-quit): saves the folder and arms the restart. Once per request. */
  apply(): void;
  /** The quit was called off (the user stayed): the switch is forgotten. */
  cancel(): void;
}

/**
 * Opens another library (설정's 다른 폴더 선택…, the restore's 전환 — spec 9.3): the folder is checked and the app asked
 * to quit, but the folder is saved as this device's library folder and the restart armed only when the quit goes ahead,
 * so a quit the user calls off leaves the open library and the saved one alike. The library in use stays as it is.
 */
export function createLibrarySwitch(deps: { prefs: Pick<PrefsStore, 'get' | 'set'>; arm(): void; quit(): void }): LibrarySwitch {
  let pending: string | null = null;
  return {
    request(target) {
      const check = checkLibraryFolder(target);
      if (!check.ok) throw new LearnError('VALIDATION_FAILED', check.message);
      // The write that cannot be made is said now, while the user can still read it: the same value is saved back.
      deps.prefs.set({ libraryRoot: deps.prefs.get().libraryRoot });
      pending = target;
      deps.quit();
    },
    apply() {
      const target = pending;
      pending = null;
      if (target === null) return;
      try {
        deps.prefs.set({ libraryRoot: target });
      } catch (e) {
        console.error(`[library] switch not saved: ${(e as { code?: string })?.code ?? 'unknown'}`);
        return;
      }
      deps.arm();
    },
    cancel() {
      pending = null;
    },
  };
}
