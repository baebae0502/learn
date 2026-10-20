import fs from 'node:fs';
import { LearnError, nowIso } from '@learn/domain';
import type { Db } from './connection';
import { MIGRATIONS, type Migration } from './migrations/index';

export interface MigrateResult {
  from: number;
  to: number;
  backupFile: string | null;
}

export function currentVersion(db: Db): number {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)');
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number | null };
  return row.v ?? 0;
}

/** Consistent single-file snapshot of a live (WAL) database. */
export function snapshotDatabase(db: Db, file: string): void {
  fs.rmSync(file, { force: true });
  db.prepare('VACUUM INTO ?').run(file);
}

export function migrate(db: Db, opts: { dbFile: string | null; migrations?: readonly Migration[] }): MigrateResult {
  const migrations = [...(opts.migrations ?? MIGRATIONS)].sort((a, b) => a.version - b.version);
  const latest = migrations.at(-1)?.version ?? 0;
  const from = currentVersion(db);
  if (from > latest) {
    throw new LearnError('MIGRATION_FAILED', `이 라이브러리는 더 새로운 버전(v${from})의 앱에서 만들어졌습니다. 앱을 업데이트하세요.`);
  }
  const pending = migrations.filter((m) => m.version > from);
  if (pending.length === 0) return { from, to: from, backupFile: null };

  let backupFile: string | null = null;
  if (from > 0 && opts.dbFile) {
    backupFile = `${opts.dbFile}.pre-v${pending[0]!.version}.bak`;
    snapshotDatabase(db, backupFile);
  }
  let lastApplied = from;
  for (const m of pending) {
    try {
      db.transaction(() => {
        db.exec(m.sql);
        db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(m.version, m.name, nowIso());
      })();
      lastApplied = m.version;
    } catch (e) {
      throw new LearnError(
        'MIGRATION_FAILED',
        `v${m.version} 업데이트에 실패했습니다. 데이터베이스는 v${lastApplied} 상태입니다.${backupFile ? ' 업데이트 전 백업이 있습니다.' : ''}`,
        { cause: e },
      );
    }
  }
  return { from, to: pending.at(-1)!.version, backupFile };
}
