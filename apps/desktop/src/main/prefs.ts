import fs from 'node:fs';
import path from 'node:path';
import { LearnError, prefsSchema, toLearnError, type Prefs, type PrefsSetInput } from '@learn/domain';

/** Per-device preferences, outside the library (userData/preferences.json). No Electron import: unit-tested. */
export const PREFS_FILE = 'preferences.json';

export interface PrefsStore {
  /** A copy of the current prefs. */
  get(): Prefs;
  /** Merges a validated patch over the stored prefs, persists atomically, and returns the result. */
  set(patch: PrefsSetInput): Prefs;
}

const stamp = (d: Date): string => d.toISOString().replace(/[:.]/g, '-');

/** Moves a corrupt file aside (never deletes it) so the user's data can still be recovered by hand. */
function quarantine(dir: string, file: string, now: Date): void {
  const base = `preferences.invalid-${stamp(now)}`;
  let target = path.join(dir, `${base}.json`);
  for (let n = 1; fs.existsSync(target); n++) target = path.join(dir, `${base}-${n}.json`);
  try {
    fs.renameSync(file, target);
  } catch (e) {
    console.warn(`PREFS_QUARANTINE_FAILED ${toLearnError(e).code}`);
  }
}

function load(dir: string, now: () => Date): Prefs {
  const file = path.join(dir, PREFS_FILE);
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if ((e as { code?: unknown }).code !== 'ENOENT') console.warn(`PREFS_READ_FAILED ${toLearnError(e).code}`);
    return prefsSchema.parse({});
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    raw = undefined;
  }
  const parsed = prefsSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  console.warn('PREFS_INVALID');
  quarantine(dir, file, now());
  return prefsSchema.parse({});
}

/** tmp + fsync + rename: a crash leaves either the old or the new file, never a torn one. */
function writeAtomic(file: string, body: string): void {
  const tmp = `${file}.tmp-${process.pid}`;
  try {
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeSync(fd, body);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, file);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw toLearnError(e, '환경설정을 저장하지 못했습니다.');
  }
}

export function openPrefsStore(dir: string, opts: { now?: () => Date } = {}): PrefsStore {
  const file = path.join(dir, PREFS_FILE);
  let current = load(dir, opts.now ?? (() => new Date()));
  return {
    get: () => ({ ...current }),
    set(patch) {
      // A key sent as `undefined` means "unchanged", not "reset to the default".
      const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
      if (typeof patch.libraryRoot === 'string' && !path.isAbsolute(patch.libraryRoot)) {
        throw new LearnError('VALIDATION_FAILED', '라이브러리 위치는 절대 경로여야 합니다.');
      }
      const next = prefsSchema.parse({ ...current, ...defined });
      writeAtomic(file, `${JSON.stringify(next, null, 2)}\n`);
      current = next;
      return { ...current };
    },
  };
}

/** `LEARN_LIBRARY_DIR` wins over `prefs.libraryRoot`; a non-absolute stored root is ignored. */
export function resolveLibraryRoot(opts: { envDir: string | undefined; prefs: Prefs; userData: string }): string {
  if (opts.envDir) return opts.envDir;
  const fromPrefs = opts.prefs.libraryRoot;
  if (fromPrefs !== null && path.isAbsolute(fromPrefs)) return fromPrefs;
  return path.join(opts.userData, 'Library');
}
