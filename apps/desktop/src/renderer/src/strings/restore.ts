// 복원 (spec 9.3): the result sheet (dialogs.html?scene=restore, ?scene=restore-issues; Task 1 rulings — "손상 없음" and
// "내용이 손상된 파일" instead of the hash words, the closing paragraph from critique 1-16, names under each problem 1-17).
// Determiner + noun and 다시 연결 are bound (U+00A0); a word joiner keeps a particle on its closing quote (U+2060).
export const restore = {
  doneTitle: '백업을 복원했습니다',
  /** Under the title: which backup ("2026. 10. 30. 오후 9:41에 만든 백업"). */
  madeAt: (at: string) => `${at}에 만든 백업`,
  labels: { items: '자료', files: '파일', location: '위치' },
  /** Items outside the trash, the trash's when it holds any, live collections, tags. */
  items: (items: number, trashed: number, collections: number, tags: number) =>
    trashed > 0 ? `${items}개 · 휴지통 ${trashed}개 · 컬렉션 ${collections}개 · 태그 ${tags}개` : `${items}개 · 컬렉션 ${collections}개 · 태그 ${tags}개`,
  /** Copies read back as the backup recorded them: all of them, or how many of all. */
  filesOk: (files: number) => `${files}개 확인 · 손상 없음`,
  filesSome: (files: number, verified: number) => `${files}개 중 ${verified}개 확인`,
  noFiles: '없음',
  issues: {
    missing: (n: number) => `백업에 없는 파일 ${n}개`,
    damaged: (n: number) => `내용이 손상된 파일 ${n}개`,
    records: (n: number) => `일치하지 않는 기록 ${n}개`,
    counts: '개수가 백업에 적힌 것과 다릅니다',
  },
  more: (n: number) => `외 ${n}개`,
  missingNote: '이 라이브러리로 전환해도 그 자료는 ‘파일 없음’⁠으로 보입니다. 원래 파일이 있으면 전환한 뒤 다시 연결할 수 있습니다.',
  keep: '지금 라이브러리는 그대로 남습니다. 나중에 전환하려면 설정의 ‘다른 폴더 선택’⁠에서 이 폴더를 고르세요.',
  switch: '이 라이브러리로 전환하고 다시 시작',
  later: '나중에',
} as const;
