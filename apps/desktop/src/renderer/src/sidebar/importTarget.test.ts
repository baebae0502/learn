import { describe, expect, it } from 'vitest';
import { buildOrganizeModel } from '../organize/model';
import { importTarget } from './importTarget';

const model = buildOrganizeModel(
  { collections: [{ id: 'c1', name: '학회 준비', parentId: null, createdAt: '2026-10-01T00:00:00.000Z' }], tags: [], members: {}, tagged: {}, duplicates: [] },
  [],
);

describe('where an import goes (spec 3.7)', () => {
  it('into the collection being viewed; nowhere from the library and the special views', () => {
    expect(importTarget(model, { kind: 'collection', id: 'c1' }, undefined)).toEqual({ id: 'c1', name: '학회 준비' });
    for (const kind of ['all', 'recent', 'unfiled', 'duplicates'] as const) expect(importTarget(model, { kind }, undefined), kind).toBeNull();
  });
  it('a collection named by a menu row wins over the view; null means none', () => {
    expect(importTarget(model, { kind: 'all' }, 'c1')).toEqual({ id: 'c1', name: '학회 준비' });
    expect(importTarget(model, { kind: 'collection', id: 'c1' }, null)).toBeNull();
  });
  it('a collection that is not there (deleted meanwhile, no snapshot yet) is none', () => {
    expect(importTarget(model, { kind: 'collection', id: 'gone' }, undefined)).toBeNull();
    expect(importTarget(undefined, { kind: 'collection', id: 'c1' }, undefined)).toBeNull();
  });
});
