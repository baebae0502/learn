import { describe, expect, it } from 'vitest';
import type { BackupDoneSheet } from '@learn/domain';
import { backupSheetText } from './backupText';

const payload = (over: Partial<BackupDoneSheet> = {}): BackupDoneSheet => ({
  kind: 'backupDone', at: new Date(2026, 9, 30, 21, 41).toISOString(), tookMs: 38_400, items: 128, trashed: 7, files: 128, bytes: 2_800_000_000,
  linked: 7, missing: 0, location: '/Users/seojin/Documents/Learn 백업 2026-10-30 2141', homeDir: '/Users/seojin', ...over,
});

describe('the backup result sheet in words (spec 8.2, dialogs.html?scene=backup)', () => {
  it('says when and how long, what it holds, where, and what was kept as a location only', () => {
    expect(backupSheetText(payload(), 'darwin')).toEqual({
      title: '백업을 만들었습니다',
      when: '2026. 10. 30. 오후 9:41 · 38초 걸림',
      items: '128개 · 휴지통 7개 · 컬렉션⁠·태그 포함',
      files: '128개 · 2.8 GB · 손상 없음',
      location: '~/Documents/Learn 백업 2026-10-30 2141',
      linkedNote: '외부 연결 자료 7개는 파일 없이 위치만 기록했습니다. 다른 Mac에서 복원하면 다시 연결해야 합니다.',
      missingNote: null,
      reveal: 'Finder에서 보기',
      done: '완료',
    });
  });
  it('leaves out the trash and the notes it has no cause for, says the copies already gone, names the file manager off macOS', () => {
    const t = backupSheetText(payload({ trashed: 0, linked: 0, missing: 2, files: 126, bytes: 2_700_000_000, tookMs: 125_000 }), 'linux');
    expect(t).toMatchObject({ items: '128개 · 컬렉션⁠·태그 포함', files: '126개 · 2.7 GB · 손상 없음', linkedNote: null, missingNote: '사본이 사라진 자료 2개는 파일 없이 기록했습니다.', reveal: '폴더에서 보기' });
    expect(t.when.endsWith(' · 2분 5초 걸림')).toBe(true);
    expect(backupSheetText(payload({ files: 0, bytes: 0 }), 'darwin').files).toBe('없음');
  });
});
