import { describe, expect, it } from 'vitest';
import type { OrganizeSnapshot } from '@learn/domain';
import { buildOrganizeModel } from '../organize/model';
import { item } from '../organize/testing';
import { COLLECTION_RESULTS_MAX, collectionMeta, rankCollections } from './collections';

const at = '2026-10-01T00:00:00.000Z';
const c = (id: string, name: string, parentId: string | null = null) => ({ id, name, parentId, createdAt: at });
const SNAPSHOT: OrganizeSnapshot = {
  collections: [
    c('bio', '분자생물학'),
    c('c6', '6장 · 신호 전달', 'bio'),
    c('c7', '7장 · 세포 주기', 'bio'),
    c('note1', '노트 모음'),
    c('note2', '노트 모음', 'bio'),
    c('lec', '강의 노트'),
    c('nong', '농토'),
    c('ga', '노트 가'),
    c('na', '노트 나'),
    c('stat', '통계'),
    c('deep', '회귀분석 신호 노트', 'c7'),
  ],
  tags: [],
  members: { c6: ['i1'], stat: ['i2'] },
  tagged: {},
  duplicates: [],
};
const model = buildOrganizeModel(SNAPSHOT, [item('i1'), item('i2')]);
const ids = (query: string, max?: number) => rankCollections(model, query, max).map((r) => r.node.id);

describe('palette 컬렉션 results (spec 7.2)', () => {
  it('finds a name by its letters, marked where it matched', () => {
    const [hit] = rankCollections(model, '신호');
    expect(hit!.node.id).toBe('c6');
    expect(hit!.match).toEqual({ start: 5, end: 7, kind: 'word' });
    expect(ids('신호')).toEqual(['c6', 'deep']); // both read 신호 at 5; the shorter path first
  });

  it('ranks by where the name matched, the earlier the higher, 초성 included; then by the shorter path; then by name', () => {
    // ㄴㅌ: 노트 모음 (root), 노트 가, 노트 나 and 농토 read at 0; the same name one level down (note2) after the roots; 강의 노트 at 3.
    expect(ids('ㄴㅌ', 10)).toEqual(['ga', 'na', 'note1', 'nong', 'note2', 'lec', 'deep']);
  });

  it('cuts the group at five, the best five', () => {
    expect(COLLECTION_RESULTS_MAX).toBe(5);
    expect(ids('ㄴㅌ')).toEqual(['ga', 'na', 'note1', 'nong', 'note2']);
    expect(ids('ㄴㅌ', 2)).toEqual(['ga', 'na']);
  });

  it('wants every word of the query in the name (as the item search does), and marks the first word', () => {
    expect(ids('신호 노트')).toEqual(['deep']);
    expect(rankCollections(model, '노트 신호')[0]!.match).toEqual({ start: 8, end: 10, kind: 'word' }); // the first word, 노트
    expect(ids('분자 생물')).toEqual(['bio']); // two words, both in 분자생물학
    expect(ids('분자 통계')).toEqual([]);
    expect(ids('효소 억제제')).toEqual([]);
  });

  it('gives the parent and the count the row shows: "<parent> 안 · N개" under a parent, "N개" at the top (mockup)', () => {
    const meta = (query: string) => new Map(rankCollections(model, query, 20).map((r) => [r.node.id, r]));
    const byId = meta('노트');
    expect(byId.get('note1')).toMatchObject({ parent: null, count: 0 });
    expect(byId.get('note2')).toMatchObject({ parent: '분자생물학', count: 0 });
    expect(byId.get('deep')).toMatchObject({ parent: '7장 · 세포 주기', count: 0 }); // the parent only, not the whole path
    expect(rankCollections(model, '신호')[0]).toMatchObject({ parent: '분자생물학', count: 1 }); // 6장 holds i1
    expect(rankCollections(model, '통계')[0]).toMatchObject({ parent: null, count: 1 });
    expect(collectionMeta(byId.get('deep')!)).toBe('7장 · 세포 주기 안 · 0개');
    expect(collectionMeta(rankCollections(model, '통계')[0]!)).toBe('1개');
  });

  it('lists nothing for an empty query or a model with no collection', () => {
    expect(ids('')).toEqual([]);
    expect(ids('   ')).toEqual([]);
    expect(rankCollections(buildOrganizeModel({ ...SNAPSHOT, collections: [], members: {} }, []), '노트')).toEqual([]);
  });
});
