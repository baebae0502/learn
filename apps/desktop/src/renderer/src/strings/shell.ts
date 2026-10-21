export const shell = {
  /** The window title when nothing more specific is known (index.html's <title>). */
  appName: 'Learn',
  sidebar: '사이드바',
  libraryHeading: '라이브러리',
  myLibrary: '내 라이브러리',
  count: (n: number) => `${n}개`,
  listFailed: '목록을 새로 고치지 못했습니다',
} as const;
