import { describe, expect, it } from 'vitest';
import { duplicateMarks, groupRows, groupStarts, keptOf } from './duplicates';
import { item } from './testing';

const GROUP: Record<string, number> = { p1: 0, p2: 0, p3: 0, q1: 1, q2: 1 };
const groupOf = (id: string) => GROUP[id];
const rows = (...ids: string[]) => ids.map((id) => item(id));
const ids = (list: readonly { id: string }[]) => list.map((r) => r.id);

describe('the row that stays (M6 spec 5)', () => {
  it('is the earliest import, the smaller id between two of the same moment (the database rule)', () => {
    expect(keptOf([item('b', { createdAt: '2026-10-02T00:00:00.000Z' }), item('c', { createdAt: '2026-10-01T00:00:00.000Z' }), item('a', { createdAt: '2026-10-03T00:00:00.000Z' })])).toBe('c');
    expect(keptOf([item('y', { createdAt: '2026-10-01T00:00:00.000Z' }), item('x', { createdAt: '2026-10-01T00:00:00.000Z' })])).toBe('x');
    expect(keptOf([])).toBeUndefined();
  });
});

describe('rows grouped whatever the sort (the approved mockup)', () => {
  it('puts each group where its first row came, its rows in the order given', () => {
    expect(ids(groupRows(rows('p3', 'q2', 'p2', 'q1', 'p1'), groupOf))).toEqual(['p3', 'p2', 'p1', 'q2', 'q1']);
    expect(ids(groupRows(rows('q1', 'p1', 'q2', 'p2'), groupOf))).toEqual(['q1', 'q2', 'p1', 'p2']);
  });
  it('keeps a row of no group in its place, and hands back the same array when nothing moves', () => {
    expect(ids(groupRows(rows('x', 'p1', 'y', 'p2'), groupOf))).toEqual(['x', 'p1', 'p2', 'y']);
    const already = rows('p1', 'p2', 'q1');
    expect(groupRows(already, groupOf)).toBe(already);
  });
});

describe('the line between groups', () => {
  it('goes above the first row of every group but the table first', () => {
    expect([...groupStarts(rows('p3', 'p2', 'q2', 'q1'), groupOf)]).toEqual(['q2']);
    expect([...groupStarts(rows('q1', 'q2'), groupOf)]).toEqual([]);
    expect([...groupStarts([], groupOf)]).toEqual([]);
  });
  it('the marks of a view: the kept rows from the model, the lines from the rows shown', () => {
    const kept = new Set(['p1', 'q1']);
    const marks = duplicateMarks(rows('p2', 'p1', 'q1'), { duplicateKept: kept, duplicateGroupOf: groupOf });
    expect(marks.kept).toBe(kept);
    expect([...marks.starts]).toEqual(['q1']);
  });
});
