import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDatabase } from '@learn/db';
import { ERROR_COPY, toLearnError } from '@learn/domain';
import { mainStrings } from './strings';
import { openLibraryContext } from './library-context';

const dirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
function tempRoot(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-ctx-'));
  dirs.push(d);
  return path.join(d, 'Library');
}
/** better-sqlite3's Database.prototype, reached through @learn/db (main has no better-sqlite3 types of its own). */
function databasePrototype(): { close(): unknown } {
  const probe = openDatabase(':memory:');
  probe.close();
  return Object.getPrototypeOf(probe) as { close(): unknown };
}

describe('openLibraryContext', () => {
  it('opens and migrates a new library folder', async () => {
    const root = tempRoot();
    const ctx = await openLibraryContext(root);
    try {
      expect(ctx.schemaVersion).toBeGreaterThan(0);
      expect(fs.existsSync(path.join(root, 'library.sqlite'))).toBe(true);
    } finally {
      ctx.db.close();
    }
  });

  it('leaves no handle open when library.sqlite is not a database, and the error reads as damage (spec 10)', async () => {
    const root = tempRoot();
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, 'library.sqlite'), 'not a database, '.repeat(64));
    const close = vi.spyOn(databasePrototype(), 'close');
    const e = await openLibraryContext(root).then(() => null, (x: unknown) => x);
    expect(e).toMatchObject({ code: 'SQLITE_NOTADB' });
    // index.ts turns it into the library error the fatal screen's file line names by code.
    expect(toLearnError(e, mainStrings.library.openFailed)).toMatchObject({ code: 'LIBRARY_UNAVAILABLE', message: ERROR_COPY.libraryCorrupt });
    expect(close).toHaveBeenCalledTimes(1);
    expect((close.mock.contexts[0] as { open: boolean }).open).toBe(false);
  });
});
