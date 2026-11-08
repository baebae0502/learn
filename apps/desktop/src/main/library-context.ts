import {
  AnchorsRepository, CollectionsRepository, LibraryRepository, ReadingRepository, SettingsRepository, TagsRepository, TextRepository, TranslationCacheRepository, migrate, openDatabase, type Db,
} from '@learn/db';
import type { LibraryCheck } from '@learn/domain';
import { Importer, ensureLayout, libraryLayout, type LibraryLayout } from '@learn/library';

export interface LibraryContext {
  layout: LibraryLayout;
  db: Db;
  repo: LibraryRepository;
  collections: CollectionsRepository;
  tags: TagsRepository;
  settings: SettingsRepository;
  reading: ReadingRepository;
  anchors: AnchorsRepository;
  translations: TranslationCacheRepository;
  /** Body text: the extract jobs and the page texts (main's scheduler writes them). */
  text: TextRepository;
  importer: Importer;
  schemaVersion: number;
  /** The newest library check (library-check.ts), null until the first one — it runs once the window exists (P-18). */
  check: LibraryCheck | null;
}

/** Opens and migrates only: the library check and the linked originals' stat run after the window is made (P-18). */
export async function openLibraryContext(root: string): Promise<LibraryContext> {
  const layout = libraryLayout(root);
  ensureLayout(layout);
  const db = openDatabase(layout.dbFile);
  try {
    const { to } = migrate(db, { dbFile: layout.dbFile });
    const repo = new LibraryRepository(db);
    return {
      layout,
      db,
      repo,
      collections: new CollectionsRepository(db),
      tags: new TagsRepository(db),
      settings: new SettingsRepository(db),
      reading: new ReadingRepository(db),
      anchors: new AnchorsRepository(db),
      translations: new TranslationCacheRepository(db),
      text: new TextRepository(db),
      importer: new Importer({ layout, repo }),
      schemaVersion: to,
      check: null,
    };
  } catch (e) {
    db.close();
    throw e;
  }
}
