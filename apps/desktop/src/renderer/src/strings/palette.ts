/** ⌘K command palette (design-spec 10.5, palette.html). */
export const palette = {
  dialogLabel: '명령 팔레트',
  inputLabel: '명령 검색',
  placeholder: '명령 검색',
  group: '명령',
  emptyTitle: (query: string) => `‘${query}’에 맞는 명령이 없습니다`,
  emptyBody: '초성으로도 찾을 수 있습니다. 예: ㄱㅈ → 가져오기',
  footMove: '이동',
  footRun: '실행',
  footClose: '닫기',
  footHint: '초성 검색 지원 · ㄱㅈ → 가져오기',
} as const;
