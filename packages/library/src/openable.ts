import { randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { LibraryLayout } from './layout';

/**
 * A file the OS can open or reveal by name (design-spec 7.3, 10.7: 기본 앱으로 열기, Finder에서 보기). A managed copy
 * is stored as `assets/<2>/<sha256>` with no extension (ADR-0003), and LaunchServices (macOS) and ShellExecute (Windows)
 * choose the app by the extension: they find none for it. So these actions use a named copy at
 * `derived/open/<assetId>/<name>.<ext>`, made with copy-on-write where the file system has it (APFS clone) and a full
 * copy elsewhere — never a hard link: an app that saves in place would change a content-addressed asset and break its
 * sha256. The copy is read-only (0o444): Preview and the like say the file is locked and offer a duplicate, rather than
 * let the user think the edits go into Learn. A copy that may hold edits all the same (unlocked, or a different size) is
 * never overwritten or removed: it is kept aside under `<name> (수정본 <YYYY-MM-DD HHmm>).<ext>` (final review I1,
 * addendum 2). Importing an edited copy again is M4/M6; removing these files belongs with trash (M6).
 */

/** The extensions each sniffed type may have (sniff.ts); the first is the one used when the original name has none of them. */
const EXTENSIONS: Readonly<Record<string, readonly string[]>> = {
  'application/pdf': ['pdf'],
  'video/mp4': ['mp4', 'm4v'],
  'video/quicktime': ['mov'],
  'video/webm': ['webm'],
  'video/x-matroska': ['mkv'],
};

/** The extension for a file of this sniffed type: the original name's own when it agrees with the type, else the type's. */
export function openExtension(mime: string, originalName: string): string | null {
  const allowed = EXTENSIONS[mime];
  if (!allowed) return null;
  const own = path.extname(originalName).slice(1).toLowerCase();
  return allowed.includes(own) ? own : allowed[0]!;
}

/** Whether a file's own name already gives the OS the right type (a linked file the user named well). */
export const extensionAgrees = (filePath: string, mime: string): boolean => {
  const own = path.extname(filePath).slice(1).toLowerCase();
  return (EXTENSIONS[mime] ?? []).includes(own);
};

/** At most this many UTF-8 bytes for the name before the extension (file systems allow 255 for the whole name). */
const NAME_BYTES = 180;

/**
 * A base name every platform accepts: NFC; no `/ \ : * ? " < > |` or control characters; no leading dot (hidden on
 * macOS and Linux) and no trailing dot or space (Windows); not a Windows device name; at most NAME_BYTES bytes, cut at a
 * character boundary. Empty after all that: `fallback`.
 */
export function safeBaseName(raw: string, fallback = 'file'): string {
  let s = raw
    .normalize('NFC')
    .replace(/[/\\:*?"<>|\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+/, '')
    .replace(/[.\s]+$/, '');
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(s)) s = `_${s}`;
  const chars = Array.from(s);
  while (Buffer.byteLength(chars.join(''), 'utf8') > NAME_BYTES) chars.pop();
  s = chars.join('').replace(/[.\s]+$/, '');
  return s || fallback;
}

export interface OpenableAsset {
  id: string;
  mime: string;
  originalName: string;
  /** The size recorded at import or link time. The copy is checked against the file's current size instead (m-N6). */
  size: number;
  storageMode: 'managed' | 'linked';
}

/** Where the named copy of an asset lives (null: a type with no known extension, nothing to name). */
export function namedCopyPath(layout: LibraryLayout, asset: OpenableAsset, title: string): string | null {
  const ext = openExtension(asset.mime, asset.originalName);
  if (!ext) return null;
  const base = safeBaseName(title, safeBaseName(path.parse(asset.originalName).name));
  return path.join(layout.derivedDir, 'open', asset.id, `${base}.${ext}`);
}

/** The mode of a named copy: read-only for everyone. */
export const NAMED_COPY_MODE = 0o444;
/** The word in the name of a copy kept aside because it may hold edits (a file name the user sees in Finder). */
const EDITED_LABEL = '수정본';

/**
 * A copy that may hold edits: no longer the source's size, or unlocked again (any write bit) where the folder keeps
 * modes. Where it does not (exFAT, FAT, some SMB mounts: chmod is ignored or refused), only the size counts, so a fresh
 * copy is not set aside as 수정본 on every open.
 */
export const mayHoldEdits = (st: { mode: number; size: number }, size: number, modesKept = true): boolean =>
  (modesKept && (st.mode & 0o222) !== 0) || st.size !== size;

/** A `.part` (or mode probe) that nothing has written for this long was left by a process that died mid-copy. */
export const ORPHAN_MS = 10 * 60_000;
const SCRATCH = /^\.[0-9a-f-]{36}\.(?:part|probe)$/;

/** Whether files in this folder keep a read-only mode: probed once per folder and process, and corrected on a copy. */
const modesKeptIn = new Map<string, boolean>();
async function keepsModes(dir: string): Promise<boolean> {
  const known = modesKeptIn.get(dir);
  if (known !== undefined) return known;
  const probe = path.join(dir, `.${randomUUID()}.probe`);
  let kept = false;
  try {
    await fs.writeFile(probe, '');
    await fs.chmod(probe, NAMED_COPY_MODE);
    kept = ((await fs.stat(probe)).mode & 0o222) === 0;
  } catch {
    kept = false;
  } finally {
    await fs.rm(probe, { force: true }).catch(() => {});
  }
  modesKeptIn.set(dir, kept);
  return kept;
}

/** `<name> (수정본 2026-10-23 1504).<ext>` in local time (no colon: not allowed on Windows, shown as / in Finder). */
export function asideName(fileName: string, when: Date): string {
  const { name, ext } = path.parse(fileName);
  const two = (n: number) => String(n).padStart(2, '0');
  const stamp = `${when.getFullYear()}-${two(when.getMonth() + 1)}-${two(when.getDate())} ${two(when.getHours())}${two(when.getMinutes())}`;
  return `${name} (${EDITED_LABEL} ${stamp})${ext}`;
}
/**
 * File names as read back from the folder are compared NFC (re-review N1): HFS+ stores and lists names decomposed
 * (NFD), so the copy written under its NFC name comes back from readdir as a different string.
 */
const nfc = (name: string) => name.normalize('NFC');
/** ` (수정본 YYYY-MM-DD HHmm)`, with an optional ` N`, at the end of the base name: exactly what asideName writes. */
const ASIDE_TAIL = new RegExp(` \\(${EDITED_LABEL} \\d{4}-\\d{2}-\\d{2} \\d{4}\\)(?: \\d+)?$`);
export const isAside = (fileName: string): boolean => ASIDE_TAIL.test(path.parse(nfc(fileName)).name);

export interface NamedCopyResult {
  action: 'reused' | 'created';
  /** Where a copy that may hold edits was kept, when one stood at the name. */
  keptAside: string | null;
}

/**
 * Makes `dst` a read-only copy of `src` (`size` bytes) unless it already is one, writing through a temporary name and
 * a rename, so a half-written file is never opened. A file at `dst` that may hold edits is first renamed aside, never
 * overwritten. Other names in the folder (an older title) are removed only while they are unedited copies; edited ones
 * and copies kept aside stay.
 *
 * POSIX lets a writable folder rename over or remove a read-only file. Windows does not (the read-only attribute
 * blocks both); it is not a target yet, and would need the attribute cleared first.
 */
export function ensureNamedCopy(src: string, dst: string, size: number, now: () => Date = () => new Date()): Promise<NamedCopyResult> {
  // One at a time per asset folder (re-review m-N2): two presses of 기본 앱으로 열기 over an edited copy both set it
  // aside, and the second could fail, or (POSIX rename replaces) put its aside over the first one's.
  const key = path.dirname(dst);
  const run = (inFlight.get(key) ?? Promise.resolve()).then(() => ensureNamedCopyNow(src, dst, size, now));
  const settled = run.then(
    () => undefined,
    () => undefined,
  );
  inFlight.set(key, settled);
  void settled.then(() => {
    if (inFlight.get(key) === settled) inFlight.delete(key);
  });
  return run;
}
const inFlight = new Map<string, Promise<void>>();

async function ensureNamedCopyNow(src: string, dst: string, size: number, now: () => Date): Promise<NamedCopyResult> {
  const dir = path.dirname(dst);
  const st = await fs.stat(dst).catch(() => null);
  if (st?.isFile() && !mayHoldEdits(st, size, await keepsModes(dir))) return { action: 'reused', keptAside: null };
  await fs.mkdir(dir, { recursive: true });
  const keptAside = st ? await moveAside(dst, now()) : null;
  const tmp = path.join(dir, `.${randomUUID()}.part`);
  try {
    await fs.copyFile(src, tmp, fsConstants.COPYFILE_FICLONE);
    if (await keepsModes(dir)) {
      // Re-checked on the copy itself: where the mode did not stick, or chmod is refused (EPERM on Linux vfat), the
      // copy stays writable and the folder counts sizes only; the open goes on.
      try {
        await fs.chmod(tmp, NAMED_COPY_MODE);
        if (((await fs.stat(tmp)).mode & 0o222) !== 0) modesKeptIn.set(dir, false);
      } catch (e) {
        if (code(e) !== 'EPERM' && code(e) !== 'ENOTSUP' && code(e) !== 'EACCES') throw e;
        modesKeptIn.set(dir, false);
      }
    }
    await fs.rename(tmp, dst);
  } catch (e) {
    await fs.rm(tmp, { force: true });
    throw e;
  }
  const modes = await keepsModes(dir);
  const own = nfc(path.basename(dst));
  for (const name of await fs.readdir(dir)) {
    if (nfc(name) === own || isAside(name)) continue;
    const other = path.join(dir, name);
    const ost = await fs.stat(other).catch(() => null);
    if (!ost?.isFile()) continue;
    if (name.startsWith('.')) {
      // Our own scratch files only (re-review m-N3), and only once nothing has written them for ORPHAN_MS: a copy in
      // flight keeps writing (and calls on this folder run one at a time). Finder's .DS_Store and the like stay.
      const touched = Math.max(ost.mtimeMs, ost.birthtimeMs || 0);
      if (SCRATCH.test(name) && now().getTime() - touched > ORPHAN_MS) await fs.rm(other, { force: true });
      continue;
    }
    if (!mayHoldEdits(ost, size, modes)) await fs.rm(other, { force: true });
  }
  return { action: 'created', keptAside };
}

const code = (e: unknown) => (e as NodeJS.ErrnoException)?.code;

/**
 * Moves `file` to its first free aside name, never over an existing one: a hard link (which fails with EEXIST) then
 * the unlink of the old name; where the volume has no hard links (FAT, exFAT, some SMB), an exclusive copy instead.
 */
async function moveAside(file: string, when: Date): Promise<string> {
  const { name, ext } = path.parse(asideName(path.basename(file), when));
  const dir = path.dirname(file);
  for (let n = 1; n <= 999; n++) {
    const target = path.join(dir, n === 1 ? `${name}${ext}` : `${name} ${n}${ext}`);
    try {
      await fs.link(file, target).catch(async (e: unknown) => {
        if (code(e) === 'EEXIST') throw e;
        await fs.copyFile(file, target, fsConstants.COPYFILE_EXCL);
      });
    } catch (e) {
      if (code(e) === 'EEXIST') continue;
      throw e;
    }
    await fs.unlink(file);
    return target;
  }
  throw new Error(`no free name to keep ${file} aside`);
}

/**
 * The path to hand the OS for an asset whose file is at `src`: a linked file whose extension already agrees with its
 * type is the user's own file; anything else (every managed copy, a linked file with a misleading or missing extension
 * — `%PDF-` named `x.command` would go to Terminal) is the named copy. A type with no known extension: `src` itself.
 */
export async function openableFile(layout: LibraryLayout, asset: OpenableAsset, title: string, src: string): Promise<string> {
  if (asset.storageMode === 'linked' && extensionAgrees(src, asset.mime)) return src;
  const dst = namedCopyPath(layout, asset, title);
  if (!dst) return src;
  // The file itself, never a link to it: on macOS a clone of a symlink is the symlink (copyfile's COPYFILE_CLONE does
  // not follow it), and the chmod after would then lock the user's own file. Its size now, not the one recorded when
  // it was linked (re-review m-N6): a linked file changed since then would otherwise look edited on every open.
  const real = await fs.realpath(src);
  const { size } = await fs.stat(real);
  await ensureNamedCopy(real, dst, size);
  return dst;
}
