import { LibraryRepository, migrate, openDatabase, type Db } from '@learn/db';
import type { RecoveryReport } from '@learn/domain';
import { Importer, ensureLayout, libraryLayout, refreshLinkedAvailability, scanRecovery, type LibraryLayout } from '@learn/library';

export interface LibraryContext {
  layout: LibraryLayout;
  db: Db;
  repo: LibraryRepository;
  importer: Importer;
  schemaVersion: number;
  recovery: RecoveryReport;
}

export async function openLibraryContext(root: string): Promise<LibraryContext> {
  const layout = libraryLayout(root);
  ensureLayout(layout);
  const db = openDatabase(layout.dbFile);
  try {
    const { to } = migrate(db, { dbFile: layout.dbFile });
    const repo = new LibraryRepository(db);
    const recovery = await scanRecovery(layout, repo);
    await refreshLinkedAvailability(layout, repo);
    return { layout, db, repo, importer: new Importer({ layout, repo }), schemaVersion: to, recovery };
  } catch (e) {
    db.close();
    throw e;
  }
}
