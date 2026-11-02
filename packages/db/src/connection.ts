import Database from 'better-sqlite3';

export type Db = Database.Database;
/** better-sqlite3's error class (`code` is SQLite's extended result code), for code that has to throw what SQLite throws. */
export const SqliteError = Database.SqliteError;

/** One connection per library, owned by the main process: it is the single write queue. */
export function openDatabase(file: string): Db {
  const db = new Database(file);
  try {
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    return db;
  } catch (e) {
    // SQLite first reads the file here (a file that is not a database fails now, not in `new Database`); the handle exists
    // by then, so it is closed before the error goes up.
    db.close();
    throw e;
  }
}
