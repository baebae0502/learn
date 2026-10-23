import fs from 'node:fs';
import path from 'node:path';
import { toLearnError } from '@learn/domain';
import { libraryLayout } from '@learn/library';

/**
 * The newest pre-update backup of the library database (`library.sqlite.pre-v<N>.bak`, written by the migration
 * runner before version N), as a file name in the library folder, or null. The fatal screen names this real file
 * instead of a pattern (n5) and points at no backup when there is none. Only the error code is logged.
 */
export function findUpdateBackup(libraryRoot: string): string | null {
  const db = path.basename(libraryLayout(libraryRoot).dbFile);
  const pattern = new RegExp(`^${db.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.pre-v(\\d+)\\.bak$`);
  let best: { name: string; version: number } | null = null;
  try {
    for (const e of fs.readdirSync(libraryRoot, { withFileTypes: true })) {
      const m = e.isFile() ? pattern.exec(e.name) : null;
      if (!m) continue;
      const version = Number(m[1]);
      if (!best || version > best.version) best = { name: e.name, version };
    }
  } catch (e) {
    console.warn(`[library] listing backups failed: ${toLearnError(e).code}`);
    return null;
  }
  return best?.name ?? null;
}
