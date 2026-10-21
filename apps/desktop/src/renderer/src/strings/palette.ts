/** ⌘K command palette (design-spec 10.5, palette.html). */
export const palette = {
  dialogLabel: '명령 팔레트',
  inputLabel: '명령 검색',
  placeholder: '명령 검색',
  group: '명령',
  emptyTitle: (query: string) => `‘${query}’에 맞는 명령이 없습니다`,
  emptyBody: '초성으로도 찾을 수 있습니다. 예: ㄱㅈ → 가져오기',
  /** While an import or a sheet holds the window (critic T9-n5): what is unavailable, then why and what next. */
  busyTitle: '지금은 명령을 실행할 수 없습니다',
  busyBody: '진행 중인 작업이 있습니다. 작업이 끝나면 다시 쓸 수 있습니다.',
  /** Read out (polite) when the number of results changes. */
  resultCount: (n: number) => `명령 ${n}개`,
  footMove: '이동',
  footRun: '실행',
  footClose: '닫기',
  footHint: '초성 검색 지원 · ㄱㅈ → 가져오기',
} as const;
