export const shell = {
  /** The window title when nothing more specific is known (index.html's <title>). */
  appName: 'Learn',
  sidebar: '사이드바',
  /** The ⌘K launcher's text and name (design-spec 6 실행기, 10.5): the palette finds items and commands, as its field says. */
  launcher: '검색 및 명령',
  libraryHeading: '라이브러리',
  myLibrary: '내 라이브러리',
  count: (n: number) => `${n}개`,
  /** The toolbar count while a quick search filters the table (design-spec 2.4: "0개 / 48개"). */
  countOf: (shown: number, total: number) => `${shown}개 / ${total}개`,
  /** The tab strip's name for assistive technology, and the library's own tab. */
  tabs: '탭',
  libraryTab: '라이브러리',
  closeTab: (title: string) => `‘${title}’ 탭 닫기`,
  listFailed: '목록을 새로 고치지 못했습니다',
} as const;
