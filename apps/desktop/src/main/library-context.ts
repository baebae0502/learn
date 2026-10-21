import {
  CollectionsRepository, LibraryRepository, ReadingRepository, SettingsRepository, TagsRepository, migrate, openDatabase, type Db,
} from '@learn/db';
import type { RecoveryReport } from '@learn/domain';
import { Importer, ensureLayout, libraryLayout, refreshLinkedAvailability, scanRecovery, type LibraryLayout } from '@learn/library';

export interface LibraryContext {
  layout: LibraryLayout;
  db: Db;
  repo: LibraryRepository;
  collections: CollectionsRepository;
  tags: TagsRepository;
  settings: SettingsRepository;
  reading: ReadingRepository;
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
    return {
      layout,
      db,
      repo,
      collections: new CollectionsRepository(db),
      tags: new TagsRepository(db),
      settings: new SettingsRepository(db),
      reading: new ReadingRepository(db),
      importer: new Importer({ layout, repo }),
      schemaVersion: to,
      recovery,
    };
  } catch (e) {
    db.close();
    throw e;
  }
}
