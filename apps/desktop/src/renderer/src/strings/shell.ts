export const shell = {
  /** The window title when nothing more specific is known (index.html's <title>). */
  appName: 'Learn',
  sidebar: '사이드바',
  /**
   * The ⌘K launcher's placeholder and name (design-spec 6 실행기). M3's palette finds commands only, so the launcher says
   * so (the palette's own placeholder); "검색 및 명령" comes back with item search in M4 (critic T9-m1, no-fake rule).
   */
  launcher: '명령 검색',
  libraryHeading: '라이브러리',
  myLibrary: '내 라이브러리',
  count: (n: number) => `${n}개`,
  listFailed: '목록을 새로 고치지 못했습니다',
} as const;
