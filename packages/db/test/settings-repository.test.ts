import { beforeEach, describe, expect, it, vi } from 'vitest';
import { newId } from '@learn/domain';
import { SettingsRepository, type Db } from '../src/index';
import { expectLearnError, freshDb } from './fixtures';

let db: Db;
let repo: SettingsRepository;
beforeEach(() => {
  db = freshDb();
  repo = new SettingsRepository(db);
});

describe('SettingsRepository', () => {
  it('round-trips every registered key as JSON and lists stored keys', () => {
    expect(repo.get('library.sort')).toBeUndefined();
    expect(repo.keys()).toEqual([]);

    repo.set('library.sort', { column: 'year', direction: 'desc' });
    repo.set('layout.panes', { sidebar: 240, detail: 320 });
    const id = newId();
    repo.set('ui.lastOpenItemId', id);

    expect(repo.get('library.sort')).toEqual({ column: 'year', direction: 'desc' });
    expect(repo.get('layout.panes')).toEqual({ sidebar: 240, detail: 320 });
    expect(repo.get('ui.lastOpenItemId')).toBe(id);
    expect(repo.keys()).toEqual(['layout.panes', 'library.sort', 'ui.lastOpenItemId']);
    expect((db.prepare(`SELECT value FROM settings WHERE key = 'library.sort'`).get() as { value: string }).value)
      .toBe('{"column":"year","direction":"desc"}');
  });

  it('overwrites a value and keeps an explicit null distinct from missing', () => {
    repo.set('ui.lastOpenItemId', newId());
    repo.set('ui.lastOpenItemId', null);
    expect(repo.get('ui.lastOpenItemId')).toBeNull();
    expect(repo.keys()).toEqual(['ui.lastOpenItemId']);
  });

  it('rejects unregistered keys on set and get', () => {
    expectLearnError(() => repo.set('nope', 1), 'VALIDATION_FAILED', '알 수 없는 설정 항목입니다.');
    expectLearnError(() => repo.get('nope'), 'VALIDATION_FAILED', '알 수 없는 설정 항목입니다.');
    expect(repo.keys()).toEqual([]);
  });

  it('rejects invalid values and keeps the previous value', () => {
    repo.set('library.sort', { column: 'title', direction: 'asc' });
    expectLearnError(() => repo.set('library.sort', { column: 'nope', direction: 'asc' }), 'VALIDATION_FAILED', '설정 값이 올바르지 않습니다.');
    expectLearnError(() => repo.set('layout.panes', { sidebar: -1 }), 'VALIDATION_FAILED');
    expectLearnError(() => repo.set('ui.lastOpenItemId', 'not-a-uuid'), 'VALIDATION_FAILED');
    expect(repo.get('library.sort')).toEqual({ column: 'title', direction: 'asc' });
    expect(repo.keys()).toEqual(['library.sort']);
  });

  it('treats a corrupt or out-of-schema stored value as missing without logging it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    db.prepare(`INSERT INTO settings (key, value) VALUES ('library.sort', '{broken')`).run();
    db.prepare(`INSERT INTO settings (key, value) VALUES ('layout.panes', '{"a":"secret-text"}')`).run();
    expect(repo.get('library.sort')).toBeUndefined();
    expect(repo.get('layout.panes')).toBeUndefined();
    expect(warn.mock.calls.flat().join(' ')).not.toContain('secret-text');
    warn.mockRestore();
  });
});
