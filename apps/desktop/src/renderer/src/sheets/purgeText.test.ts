import { describe, expect, it } from 'vitest';
import { purgeText } from './purgeText';

describe('the purge sheet\'s words (P-25; dialogs.html?scene=purge, ?scene=empty-trash)', () => {
  it('names what goes and what stays, by variant', () => {
    const keep = '외부 연결 원본은 지우지 않습니다.';
    expect(purgeText({ kind: 'purge', variant: 'items', items: 3, collections: 0 })).toEqual({ title: '자료 3개를 영구히 삭제하겠습니까?', body: `되돌릴 수 없습니다. 라이브러리 안의 사본도 지웁니다. ${keep}`, verb: '영구 삭제' });
    expect(purgeText({ kind: 'purge', variant: 'collections', items: 0, collections: 2 })).toEqual({ title: '컬렉션 2개를 영구히 삭제하겠습니까?', body: '그 안의 자료는 라이브러리에 남습니다. 되돌릴 수 없습니다.', verb: '영구 삭제' });
    expect(purgeText({ kind: 'purge', variant: 'items', items: 1, collections: 0 }).title).toBe('자료 1개를 영구히 삭제하겠습니까?');
    expect(purgeText({ kind: 'purge', variant: 'mixed', items: 1, collections: 1 }).title).toBe('자료 1개와 컬렉션 1개를 영구히 삭제하겠습니까?');
    expect(purgeText({ kind: 'purge', variant: 'mixed', items: 1, collections: 1 }).body).toBe(`되돌릴 수 없습니다. 라이브러리 안의 사본도 지웁니다. 컬렉션 안의 다른 자료는 라이브러리에 남습니다. ${keep}`);
    expect(purgeText({ kind: 'purge', variant: 'empty', items: 7, collections: 2 })).toEqual({ title: '휴지통을 비우겠습니까?', body: `자료 7개와 컬렉션 2개를 영구히 지웁니다. 되돌릴 수 없습니다. ${keep}`, verb: '휴지통 비우기' });
    expect(purgeText({ kind: 'purge', variant: 'empty', items: 0, collections: 1 }).body).toMatch(/^컬렉션 1개를 영구히 지웁니다/);
    expect(purgeText({ kind: 'purge', variant: 'empty', items: 4, collections: 0 }).body).toMatch(/^자료 4개를 영구히 지웁니다/);
  });
  it('one row is named: ‘제목’을 for a final consonant, ‘제목’를 for a vowel, ‘이름’ 컬렉션을', () => {
    expect(purgeText({ kind: 'purge', variant: 'items', items: 1, collections: 0, name: '분자생물학 6장' }).title).toBe('‘분자생물학 6장’\u2060을 영구히 삭제하겠습니까?');
    expect(purgeText({ kind: 'purge', variant: 'items', items: 1, collections: 0, name: '통계' }).title).toBe('‘통계’\u2060를 영구히 삭제하겠습니까?');
    expect(purgeText({ kind: 'purge', variant: 'collections', items: 0, collections: 1, name: '학회 준비' }).title).toBe('‘학회 준비’ 컬렉션을 영구히 삭제하겠습니까?');
    expect(purgeText({ kind: 'purge', variant: 'items', items: 3, collections: 0, name: '통계' }).title).toBe('자료 3개를 영구히 삭제하겠습니까?');
  });
});
