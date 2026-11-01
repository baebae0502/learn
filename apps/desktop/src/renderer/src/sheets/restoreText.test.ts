import { describe, expect, it } from 'vitest';
import type { RestoreDoneSheet } from '@learn/domain';
import { restoreSheetText } from './restoreText';

const payload = (over: Partial<RestoreDoneSheet> = {}): RestoreDoneSheet => ({
  kind: 'restoreDone', backupAt: new Date(2026, 9, 30, 21, 41).toISOString(), items: 128, trashed: 7, collections: 9, tags: 14, files: 128, verified: 128,
  missing: null, damaged: null, records: null, countsMatch: true,
  location: '/Users/seojin/Library/Application Support/Learn/Learn 복원 2026-10-31 2141', homeDir: '/Users/seojin', ...over,
});
const KEEP = '지금 라이브러리는 그대로 남습니다. 나중에 전환하려면 설정의 ‘다른 폴더 선택’⁠에서 이 폴더를 고르세요.';
const MISSING_NOTE = '이 라이브러리로 전환해도 그 자료는 ‘파일 없음’⁠으로 보입니다. 원래 파일이 있으면 전환한 뒤 다시 연결할 수 있습니다.';

describe('the restore result sheet in words (spec 9.3, dialogs.html?scene=restore, ?scene=restore-issues)', () => {
  it('a clean restore: which backup, what came back, every file checked, where; the success badge, no problem line, what happens to the library in use', () => {
    expect(restoreSheetText(payload(), 'darwin')).toEqual({
      tone: 'success',
      title: '백업을 복원했습니다',
      when: '2026. 10. 30. 오후 9:41에 만든 백업',
      items: '128개 · 휴지통 7개 · 컬렉션 9개 · 태그 14개',
      files: '128개 확인 · 손상 없음',
      location: '~/Library/Application Support/Learn/Learn 복원 2026-10-31 2141',
      reveal: 'Finder에서 보기',
      issues: [],
      missingNote: null,
      keep: KEEP,
      switch: '이 라이브러리로 전환하고 다시 시작',
      later: '나중에',
    });
  });

  it('with problems: the warning badge, a line per kind with its first items and 외 N개, the 파일 없음 sentence; the files read back of all', () => {
    const t = restoreSheetText(
      payload({
        verified: 125,
        missing: { count: 2, titles: ['분자생물학 5장 · 막 수송', '실험 2 · 단백질 정량'], more: 0 },
        damaged: { count: 1, titles: ['Second Messengers at a Glance'], more: 0 },
        records: { count: 3, titles: ['a', 'b'], more: 1 },
      }),
      'linux',
    );
    expect(t).toMatchObject({ tone: 'warning', files: '128개 중 125개 확인', reveal: '폴더에서 보기', missingNote: MISSING_NOTE, keep: KEEP });
    expect(t.issues).toEqual([
      { key: 'missing', text: '백업에 없는 파일 2개', titles: ['분자생물학 5장 · 막 수송', '실험 2 · 단백질 정량'], more: 0 },
      { key: 'damaged', text: '내용이 손상된 파일 1개', titles: ['Second Messengers at a Glance'], more: 0 },
      { key: 'records', text: '일치하지 않는 기록 3개', titles: ['a', 'b'], more: 1 },
    ]);
  });

  it('a count of 0 after the first is left out, like the trash\'s: an empty library is just the item count', () => {
    expect(restoreSheetText(payload({ trashed: 0, collections: 0, tags: 14 }), 'darwin').items).toBe('128개 · 태그 14개');
    expect(restoreSheetText(payload({ trashed: 7, collections: 0, tags: 0 }), 'darwin').items).toBe('128개 · 휴지통 7개');
    expect(restoreSheetText(payload({ items: 0, trashed: 0, collections: 0, tags: 0 }), 'darwin').items).toBe('0개');
  });

  it('counts that differ are a line of their own, without the 파일 없음 sentence; an empty trash is left out; no copies at all is 없음', () => {
    const t = restoreSheetText(payload({ countsMatch: false, trashed: 0, files: 0, verified: 0 }), 'darwin');
    expect(t).toMatchObject({ tone: 'warning', items: '128개 · 컬렉션 9개 · 태그 14개', files: '없음', missingNote: null });
    expect(t.issues).toEqual([{ key: 'counts', text: '개수가 백업에 적힌 것과 다릅니다', titles: [], more: 0 }]);
  });
});
