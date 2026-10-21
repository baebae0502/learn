/** ⌘K command palette (design-spec 10.5, palette.html). */
export const palette = {
  dialogLabel: '명령 팔레트',
  inputLabel: '명령 검색',
  placeholder: '명령 검색',
  group: '명령',
  emptyTitle: (query: string) => `‘${query}’에 맞는 명령이 없습니다`,
  // The 초성 example finds one command, in every view: ㅅㅈ → 설정… (critic T10-m2; ㄱㅈ also finds 글자 크게 / 작게).
  emptyBody: '초성으로도 찾을 수 있습니다. 예: ㅅㅈ → 설정',
  /** While an import or a sheet holds the window (critic T9-n5): what is unavailable, then why and what next. */
  busyTitle: '지금은 명령을 실행할 수 없습니다',
  busyBody: '진행 중인 작업이 있습니다. 작업이 끝나면 다시 쓸 수 있습니다.',
  /**
   * The same hold while a command that still runs (설정…) is listed under it: the header says why the rest is missing
   * and when it comes back, not that nothing runs.
   */
  busyHeaderTitle: '진행 중인 작업이 있습니다',
  busyHeaderBody: '작업이 끝나면 다른\u00a0명령도 쓸 수 있습니다.',
  /** Read out (polite) with that header: the hold, then how many commands are listed. */
  busyStatus: (n: number) => `진행 중인 작업이 있습니다. 실행할 수 있는 명령 ${n}개`,
  /** Read out (polite) when the number of results changes. */
  resultCount: (n: number) => `명령 ${n}개`,
  footMove: '이동',
  footRun: '실행',
  footClose: '닫기',
  footHint: '초성 검색 지원 · ㅅㅈ → 설정',
} as const;
