import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ERROR_COPY, toLearnError } from '@learn/domain';
import { openDatabase } from '../src/index';

const dirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
function tempDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-db-'));
  dirs.push(d);
  return d;
}
function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  throw new Error('expected a throw');
}
/** SQLite opens this without a word and fails at the first read. */
const notADatabase = (file: string) => fs.writeFileSync(file, 'not a database, '.repeat(64));

describe('openDatabase', () => {
  it('returns an open WAL connection with foreign keys and a busy timeout', () => {
    const db = openDatabase(path.join(tempDir(), 'ok.sqlite'));
    try {
      expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
      expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
      expect(db.pragma('busy_timeout', { simple: true })).toBe(5000);
    } finally {
      db.close();
    }
  });

  it('closes the handle it opened when a pragma fails (a file that is not a database), then rethrows SQLite\'s error', () => {
    const file = path.join(tempDir(), 'library.sqlite');
    notADatabase(file);
    const close = vi.spyOn(Database.prototype, 'close');
    const e = thrown(() => openDatabase(file));
    expect(e).toMatchObject({ name: 'SqliteError', code: 'SQLITE_NOTADB' });
    expect(toLearnError(e)).toMatchObject({ code: 'LIBRARY_UNAVAILABLE', message: ERROR_COPY.libraryCorrupt, retryable: false });
    expect(close).toHaveBeenCalledTimes(1);
    expect((close.mock.contexts[0] as Database.Database).open).toBe(false);
  });
});

describe('the codes SQLite really throws, as toLearnError reads them (spec 10)', () => {
  it('SQLITE_FULL when the file may not grow → DISK_FULL', () => {
    const db = openDatabase(path.join(tempDir(), 'full.sqlite'));
    try {
      db.exec('CREATE TABLE fill (b BLOB)');
      // Not one page more than the file has: a 64 KiB row needs new pages.
      db.pragma(`max_page_count = ${db.pragma('page_count', { simple: true }) as number}`);
      const e = thrown(() => db.prepare('INSERT INTO fill VALUES (?)').run(Buffer.alloc(64 * 1024)));
      expect(e).toMatchObject({ name: 'SqliteError', code: 'SQLITE_FULL' });
      expect(toLearnError(e)).toMatchObject({ code: 'DISK_FULL', message: ERROR_COPY.diskFull, retryable: true });
    } finally {
      db.close();
    }
  });

  it('SQLITE_READONLY for a write through a read-only connection → PERMISSION_DENIED', () => {
    const file = path.join(tempDir(), 'ro.sqlite');
    const rw = new Database(file);
    rw.exec('CREATE TABLE t (x)');
    rw.close();
    const ro = new Database(file, { readonly: true });
    try {
      const e = thrown(() => ro.prepare('INSERT INTO t VALUES (1)').run());
      expect(e).toMatchObject({ code: expect.stringMatching(/^SQLITE_READONLY/) });
      expect(toLearnError(e)).toMatchObject({ code: 'PERMISSION_DENIED', message: ERROR_COPY.libraryDenied });
    } finally {
      ro.close();
    }
  });

  it('SQLITE_CANTOPEN for a file that has to exist and does not → PERMISSION_DENIED', () => {
    const e = thrown(() => new Database(path.join(tempDir(), 'missing.sqlite'), { fileMustExist: true }));
    expect(e).toMatchObject({ code: expect.stringMatching(/^SQLITE_CANTOPEN/) });
    expect(toLearnError(e)).toMatchObject({ code: 'PERMISSION_DENIED', message: ERROR_COPY.libraryDenied });
  });

  it('SQLITE_CORRUPT for a table page that is nonsense → LIBRARY_UNAVAILABLE', () => {
    const file = path.join(tempDir(), 'corrupt.sqlite');
    const db = new Database(file); // rollback journal: every page sits in the one file once it is closed
    db.exec('CREATE TABLE t (x TEXT)');
    const insert = db.prepare('INSERT INTO t VALUES (?)');
    for (let i = 0; i < 50; i++) insert.run(`row ${i}`);
    const pageSize = db.pragma('page_size', { simple: true }) as number;
    db.close();
    const fd = fs.openSync(file, 'r+');
    fs.writeSync(fd, Buffer.alloc(16, 0xff), 0, 16, pageSize); // page 2 is t's root: its b-tree header becomes 0xff
    fs.closeSync(fd);
    const broken = new Database(file);
    try {
      const e = thrown(() => broken.prepare('SELECT count(*) AS n FROM t').get());
      expect(e).toMatchObject({ code: expect.stringMatching(/^SQLITE_CORRUPT/) });
      expect(toLearnError(e)).toMatchObject({ code: 'LIBRARY_UNAVAILABLE', message: ERROR_COPY.libraryCorrupt });
    } finally {
      broken.close();
    }
  });
});
