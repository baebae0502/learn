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
 * sha256. Edits made there in another app stay in that copy (M4/M6: import the edited copy again; removing these files
 * belongs with trash).
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

/**
 * Makes `dst` a copy of `src` unless it already is one of `size` bytes: through a temporary name and a rename, so a
 * half-written file is never opened. Other names in the folder (an older title) are removed. Returns what it did.
 */
export async function ensureNamedCopy(src: string, dst: string, size: number): Promise<'reused' | 'created'> {
  const st = await fs.stat(dst).catch(() => null);
  if (st?.isFile() && st.size === size) return 'reused';
  const dir = path.dirname(dst);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${randomUUID()}.part`);
  try {
    await fs.copyFile(src, tmp, fsConstants.COPYFILE_FICLONE);
    await fs.rename(tmp, dst);
  } catch (e) {
    await fs.rm(tmp, { force: true });
    throw e;
  }
  for (const name of await fs.readdir(dir)) {
    if (name !== path.basename(dst) && !name.endsWith('.part')) await fs.rm(path.join(dir, name), { force: true });
  }
  return 'created';
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
  await ensureNamedCopy(src, dst, asset.size);
  return dst;
}
