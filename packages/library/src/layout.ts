import fs from 'node:fs';
import path from 'node:path';

export interface LibraryLayout {
  root: string;
  dbFile: string;
  assetsDir: string;
  stagingDir: string;
  derivedDir: string;
  exportsDir: string;
}

export function libraryLayout(root: string): LibraryLayout {
  const r = path.resolve(root);
  return {
    root: r,
    dbFile: path.join(r, 'library.sqlite'),
    assetsDir: path.join(r, 'assets'),
    stagingDir: path.join(r, 'staging'),
    derivedDir: path.join(r, 'derived'),
    exportsDir: path.join(r, 'exports'),
  };
}

export function ensureLayout(layout: LibraryLayout): void {
  for (const d of [layout.root, layout.assetsDir, layout.stagingDir, layout.derivedDir, layout.exportsDir]) {
    fs.mkdirSync(d, { recursive: true });
  }
}

/** Library-relative POSIX path stored in assets.relative_path. File names are hashes only. */
export const managedRelativePath = (sha256: string): string => `assets/${sha256.slice(0, 2)}/${sha256}`;

/** A sha256 as the library writes it: the only form a managed path may be derived from. */
export const SHA256_HEX = /^[0-9a-f]{64}$/;
