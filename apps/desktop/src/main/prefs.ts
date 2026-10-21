import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LearnError, prefsFields, prefsSchema, prefsSetInput, toLearnError, type Prefs, type PrefsSetInput } from '@learn/domain';

/** Per-device preferences, outside the library (userData/preferences.json). No Electron import: unit-tested. */
export const PREFS_FILE = 'preferences.json';

export interface PrefsStore {
  /** A copy of the current prefs. */
  get(): Prefs;
  /**
   * Validates the patch, merges it over the stored file object (unknown keys survive), persists atomically, and
   * returns the result.
   */
  set(patch: PrefsSetInput): Prefs;
  /**
   * True when an existing file could neither be read nor moved aside: this session runs on defaults and
   * `set` refuses (PREFS_UNAVAILABLE) rather than overwrite a file we never saw.
   */
  readonly readOnly: boolean;
}

const stamp = (d: Date): string => d.toISOString().replace(/[:.]/g, '-');
/** Logs carry the errno-style code only (never the path or message). */
const errCode = (e: unknown): string => {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]*$/.test(code) ? code : toLearnError(e).code;
};

/** Moves an unreadable or corrupt file aside (never deletes it). Returns false when the move failed. */
function quarantine(dir: string, file: string, now: Date): boolean {
  const base = `preferences.invalid-${stamp(now)}`;
  let target = path.join(dir, `${base}.json`);
  for (let n = 1; fs.existsSync(target); n++) target = path.join(dir, `${base}-${n}.json`);
  try {
    fs.renameSync(file, target);
    return true;
  } catch (e) {
    console.warn(`PREFS_QUARANTINE_FAILED ${errCode(e)}`);
    return false;
  }
}

type StoredObject = Record<string, unknown>;
const DEFAULTS: Prefs = prefsSchema.parse({});
const FIELDS = Object.keys(prefsFields) as Array<keyof Prefs>;
const isObject = (v: unknown): v is StoredObject => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The known fields of the stored object, each validated on its own: a missing field takes its default, an invalid
 * one falls back to its default alone (logged as PREFS_FIELD_INVALID <field>; the name is ours, never the value).
 */
function readFields(stored: StoredObject): Prefs {
  const prefs: Record<string, unknown> = { ...DEFAULTS };
  for (const key of FIELDS) {
    if (!Object.hasOwn(stored, key) || stored[key] === undefined) continue;
    const parsed = prefsFields[key].safeParse(stored[key]);
    if (parsed.success) prefs[key] = parsed.data;
    else console.warn(`PREFS_FIELD_INVALID ${key}`);
  }
  return prefs as Prefs;
}

interface Loaded {
  prefs: Prefs;
  /** The parsed file as stored (unknown keys included); `{}` when there was none. */
  stored: StoredObject;
  readOnly: boolean;
}

function load(dir: string, now: () => Date): Loaded {
  const file = path.join(dir, PREFS_FILE);
  const defaults = (readOnly: boolean): Loaded => ({ prefs: { ...DEFAULTS }, stored: {}, readOnly });
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if ((e as { code?: unknown }).code === 'ENOENT') return defaults(false);
    // EACCES, EIO, ESTALE…: the file exists but we can't see it. Treat it like a corrupt file.
    console.warn(`PREFS_READ_FAILED ${errCode(e)}`);
    return defaults(!quarantine(dir, file, now()));
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    raw = undefined;
  }
  // Only a file that is not a JSON object at all is moved aside; bad fields are handled one by one.
  if (isObject(raw)) return { prefs: readFields(raw), stored: raw, readOnly: false };
  console.warn('PREFS_INVALID');
  return defaults(!quarantine(dir, file, now()));
}

/** Best effort: makes the rename itself durable. Platforms that can't open/fsync a directory are skipped. */
function fsyncDir(dir: string): void {
  let fd: number | null = null;
  try {
    fd = fs.openSync(dir, 'r');
    fs.fsyncSync(fd);
  } catch (e) {
    const code = (e as { code?: unknown }).code;
    if (code !== 'EISDIR' && code !== 'EPERM' && code !== 'EINVAL') console.warn(`PREFS_DIR_FSYNC_FAILED ${errCode(e)}`);
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

/**
 * tmp (unique per process, host and write — userData can sit on a shared/NFS home) + fsync + rename in the
 * same directory, then fsync the directory: a crash leaves the old or the new file, never a torn one.
 */
function writeAtomic(file: string, body: string): void {
  const host = os.hostname().replace(/[^A-Za-z0-9.-]/g, '_');
  const tmp = `${file}.tmp-${process.pid}-${host}-${randomBytes(6).toString('hex')}`;
  try {
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeFileSync(fd, body); // loops over partial writes
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, file);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw toLearnError(e, '환경설정을 저장하지 못했습니다.');
  }
  fsyncDir(path.dirname(file));
}

export function openPrefsStore(dir: string, opts: { now?: () => Date } = {}): PrefsStore {
  const file = path.join(dir, PREFS_FILE);
  const loaded = load(dir, opts.now ?? (() => new Date()));
  let current = loaded.prefs;
  let stored = loaded.stored;
  return {
    readOnly: loaded.readOnly,
    get: () => ({ ...current }),
    set(patch) {
      if (loaded.readOnly) {
        throw new LearnError(
          'PREFS_UNAVAILABLE',
          '환경설정 파일을 읽거나 옮길 수 없어 이번 실행에서는 변경 내용을 저장하지 않습니다. 파일 권한을 확인한 뒤 앱을 다시 시작하세요.',
        );
      }
      const parsed = prefsSetInput.safeParse(patch);
      if (!parsed.success) throw new LearnError('VALIDATION_FAILED', '환경설정 값이 올바르지 않습니다.');
      // A key sent as `undefined` means "unchanged", not "reset to the default".
      const defined = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined)) as Partial<Prefs>;
      if (typeof defined.libraryRoot === 'string' && !path.isAbsolute(defined.libraryRoot)) {
        throw new LearnError('VALIDATION_FAILED', '라이브러리 위치는 절대 경로여야 합니다.');
      }
      // The patch goes over the stored object, so keys (and values) this build does not know — a newer build's —
      // survive. Known fields missing from the file are written with their current value.
      const nextStored: StoredObject = { ...current, ...stored, ...defined };
      writeAtomic(file, `${JSON.stringify(nextStored, null, 2)}\n`);
      stored = nextStored;
      current = { ...current, ...defined };
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
