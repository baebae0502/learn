import Database from 'better-sqlite3';

export type Db = Database.Database;

/** One connection per library, owned by the main process: it is the single write queue. */
export function openDatabase(file: string): Db {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  return db;
}
