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
  it('says how many tutor sessions go with the items when there are some (T1a spec 6.2, 13): one item, several, the emptied trash', () => {
    const keep = '외부\u00a0연결\u00a0원본은 지우지 않습니다.';
    expect(purgeText({ kind: 'purge', variant: 'items', items: 1, collections: 0, name: '통계', sessions: 3, sessionItems: 1 }).body).toBe(
      `되돌릴 수 없습니다. 라이브러리 안의 사본도 지웁니다. ${keep} 이\u00a0자료의 세션 3개도 함께 지웁니다.`,
    );
    expect(purgeText({ kind: 'purge', variant: 'items', items: 4, collections: 0, sessions: 5, sessionItems: 2 }).body).toBe(
      `되돌릴 수 없습니다. 라이브러리 안의 사본도 지웁니다. ${keep} 자료 2개의 세션 5개도 함께 지웁니다.`,
    );
    expect(purgeText({ kind: 'purge', variant: 'mixed', items: 2, collections: 1, sessions: 1, sessionItems: 1 }).body).toMatch(/ 자료 1개의 세션 1개도 함께 지웁니다\.$/);
    expect(purgeText({ kind: 'purge', variant: 'mixed', items: 1, collections: 1, sessions: 2, sessionItems: 1 }).body).toMatch(/ 이\u00a0자료의 세션 2개도 함께 지웁니다\.$/);
    expect(purgeText({ kind: 'purge', variant: 'empty', items: 7, collections: 2, sessions: 6, sessionItems: 3 }).body).toBe(
      `자료 7개와 컬렉션 2개를 영구히 지웁니다. 되돌릴 수 없습니다. ${keep} 휴지통에 있는 자료의 세션 6개도 함께 지웁니다.`,
    );
    // None to say: no sentence (a count of 0, or none counted).
    for (const p of [{ sessions: 0, sessionItems: 0 }, {}]) {
      expect(purgeText({ kind: 'purge', variant: 'items', items: 1, collections: 0, ...p }).body).toBe(`되돌릴 수 없습니다. 라이브러리 안의 사본도 지웁니다. ${keep}`);
      expect(purgeText({ kind: 'purge', variant: 'empty', items: 1, collections: 0, ...p }).body).toBe(`자료 1개를 영구히 지웁니다. 되돌릴 수 없습니다. ${keep}`);
    }
    // The title and the verb do not change.
    expect(purgeText({ kind: 'purge', variant: 'items', items: 1, collections: 0, name: '통계', sessions: 3, sessionItems: 1 })).toMatchObject({ title: '‘통계’\u2060를 영구히 삭제하겠습니까?', verb: '영구 삭제' });
  });
});
