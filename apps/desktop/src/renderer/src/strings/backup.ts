// 백업 (spec 8): the result sheet (dialogs.html?scene=backup, ?scene=backup-missing) and 마지막 백업 in the settings window
// (settings.html, ?state=nobackup).
export const backup = {
  doneTitle: '백업을 만들었습니다',
  /** Under the title: when it was made, and how long it took ("2026. 10. 30. 오후 9:41 · 38초 걸림"). */
  when: (at: string, took: string) => `${at} · ${took} 걸림`,
  labels: { items: '자료', files: '파일', location: '위치' },
  /** Items outside the trash, the trash's when it holds any, and what comes with them (spec 8.2: no notes yet). */
  items: (items: number, trashed: number) => (trashed > 0 ? `${items}개 · 휴지통 ${trashed}개 · 컬렉션⁠·태그 포함` : `${items}개 · 컬렉션⁠·태그 포함`),
  /** Copies written and read back: how many, how big, and that every one read back the same. */
  files: (files: number, size: string) => `${files}개 · ${size} · 손상 없음`,
  noFiles: '없음',
  linkedNote: (n: number) => `외부 연결 자료 ${n}개는 파일 없이 위치만 기록했습니다. 다른 Mac에서 복원하면 다시 연결해야 합니다.`,
  missingNote: (n: number) => `사본이 사라진 자료 ${n}개는 파일 없이 기록했습니다.`,
  /** 마지막 백업 (settings.html): the row's name; 아직 없음 and where one is made when there is none. */
  last: '마지막 백업',
  none: '아직 없음',
  noneHint: '파일 › 백업 만들기에서 만들 수 있습니다.',
} as const;
