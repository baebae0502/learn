import fs from 'node:fs/promises';
import path from 'node:path';
import { nowIso, type RecoveryReport } from '@learn/domain';
import type { LibraryRepository } from '@learn/db';
import type { LibraryLayout } from './layout';

/**
 * Startup scan. Reports leftovers from interrupted imports and inconsistencies; it never deletes.
 * Side effects: running jobs → interrupted, vanished managed assets → availability 'missing'.
 */
export async function scanRecovery(layout: LibraryLayout, repo: LibraryRepository): Promise<RecoveryReport> {
  const now = nowIso();
  const interruptedJobs = repo.markRunningJobsInterrupted(now);
  const stagingLeftovers = (await readdirSafe(layout.stagingDir)).sort();

  const onDisk: string[] = [];
  for (const prefix of await readdirSafe(layout.assetsDir)) {
    for (const name of await readdirSafe(path.join(layout.assetsDir, prefix))) onDisk.push(`assets/${prefix}/${name}`);
  }
  const managed = repo.assetsByMode('managed');
  const referenced = new Set(managed.map((a) => a.relativePath));
  const present = new Set(onDisk);
  const unreferencedAssets = onDisk.filter((rel) => !referenced.has(rel)).sort();
  const missing = managed.filter((a) => a.relativePath !== null && !present.has(a.relativePath));
  for (const a of missing) if (a.availability !== 'missing') repo.setAvailability(a.id, 'missing', now);

  return { stagingLeftovers, unreferencedAssets, missingManagedAssets: missing.map((a) => a.id).sort(), interruptedJobs };
}

async function readdirSafe(dir: string): Promise<string[]> {
  try {
    return await fs.readdir(dir);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT' || (e as NodeJS.ErrnoException).code === 'ENOTDIR') return [];
    throw e;
  }
}
