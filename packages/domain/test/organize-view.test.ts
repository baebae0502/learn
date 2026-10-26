import { describe, expect, it } from 'vitest';
import { LearnError } from '../src/errors';
import { newId } from '../src/ids';
import { showColumnMenuInput } from '../src/ipc';
import { LIBRARY_COLUMN_IDS, LIBRARY_SORT_COLUMNS, columnSpec } from '../src/library-columns';
import { libraryScopeSchema } from '../src/organize';
import { SETTINGS, SIDEBAR_EXPANDED_MAX, parseSetting } from '../src/settings';

const code = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (e) {
    return e instanceof LearnError ? e.code : 'other';
  }
  return undefined;
};

describe('the library view (spec 3.1)', () => {
  it('reads the five scopes, a collection by its uuid', () => {
    const id = newId();
    for (const kind of ['all', 'recent', 'unfiled', 'duplicates'] as const) expect(libraryScopeSchema.parse({ kind })).toEqual({ kind });
    expect(libraryScopeSchema.parse({ kind: 'collection', id })).toEqual({ kind: 'collection', id });
  });
  it('refuses what is not a scope: another kind, a collection without a uuid, extra keys', () => {
    for (const bad of [null, 'all', {}, { kind: 'trash' }, { kind: 'collection' }, { kind: 'collection', id: 'x' }, { kind: 'all', id: newId() }, { kind: 'recent', extra: 1 }]) {
      expect(libraryScopeSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('M5 settings keys (spec 10.4)', () => {
  it('library.view is a scope; library.sort.recent is a sort and takes openedAt', () => {
    const id = newId();
    expect(parseSetting('library.view', { kind: 'collection', id })).toEqual({ kind: 'collection', id });
    expect(code(() => parseSetting('library.view', { kind: 'collection', id: 'x' }))).toBe('VALIDATION_FAILED');
    expect(parseSetting('library.sort.recent', { column: 'openedAt', direction: 'desc' })).toEqual({ column: 'openedAt', direction: 'desc' });
    expect(code(() => parseSetting('library.sort.recent', { column: 'tags', direction: 'asc' }))).toBe('VALIDATION_FAILED');
  });
  it('sidebar.expanded is up to 2,000 uuids', () => {
    expect(SIDEBAR_EXPANDED_MAX).toBe(2000);
    const ids = Array.from({ length: SIDEBAR_EXPANDED_MAX }, () => newId());
    expect(parseSetting('sidebar.expanded', ids)).toHaveLength(2000);
    expect(code(() => parseSetting('sidebar.expanded', [...ids, newId()]))).toBe('VALIDATION_FAILED');
    expect(code(() => parseSetting('sidebar.expanded', ['not-a-uuid']))).toBe('VALIDATION_FAILED');
    expect(parseSetting('sidebar.expanded', [])).toEqual([]);
  });
  it('tags.selector is show view|all and sort name|count', () => {
    expect(parseSetting('tags.selector', { show: 'all', sort: 'count' })).toEqual({ show: 'all', sort: 'count' });
    expect(code(() => parseSetting('tags.selector', { show: 'some', sort: 'name' }))).toBe('VALIDATION_FAILED');
    expect(code(() => parseSetting('tags.selector', { show: 'view' }))).toBe('VALIDATION_FAILED');
  });
  it('the keys are registered once each', () => {
    for (const key of ['library.view', 'library.sort.recent', 'sidebar.expanded', 'tags.selector']) expect(Object.hasOwn(SETTINGS, key), key).toBe(true);
  });
});

describe('the openedAt column (spec 5.1)', () => {
  it('sits after 수정일, is hidden by default, 132 wide with a 112 minimum, and is also a sort column', () => {
    expect(LIBRARY_COLUMN_IDS.indexOf('openedAt')).toBe(LIBRARY_COLUMN_IDS.indexOf('updatedAt') + 1);
    expect(columnSpec('openedAt')).toEqual({ id: 'openedAt', label: '마지막으로 연 날', defaultVisible: false, defaultWidth: 132, minWidth: 112, align: 'start' });
    expect(LIBRARY_SORT_COLUMNS).toContain('openedAt');
  });
});

describe('the column menu input', () => {
  it('may name locked columns: the ones a view forces on', () => {
    expect(showColumnMenuInput.parse({ visible: ['title'], locked: ['openedAt'], x: 1, y: 2 })).toEqual({ visible: ['title'], locked: ['openedAt'], x: 1, y: 2 });
    expect(showColumnMenuInput.parse({ visible: ['title'], x: 1, y: 2 })).not.toHaveProperty('locked');
    expect(showColumnMenuInput.safeParse({ visible: [], locked: ['tags'], x: 0, y: 0 }).success).toBe(false);
    expect(showColumnMenuInput.safeParse({ visible: [], locked: [], x: 0, y: 0, extra: 1 }).success).toBe(false);
  });
});
