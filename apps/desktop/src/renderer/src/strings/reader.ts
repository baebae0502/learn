// Reader chrome and the reader's final states (design-spec 6 끝난 상태, 9 원인 + 다음 행동). U+00A0 binds
// determiner + noun and "원본 파일" (strings.test.ts).
export const reader = {
  /** The notices' second button: a verb of its own (the command's name, 라이브러리, is the menu's and the ⌘1 tab's). */
  backToLibrary: '라이브러리로 돌아가기',
  prevPage: '이전 쪽',
  nextPage: '다음 쪽',
  /** After the page field: the field holds the current page. */
  pageOf: (total: number) => `/ ${total}`,
  pageField: '쪽\u00a0번호',
  /** Disabled-button tooltips (M-2). */
  firstPage: '첫 쪽입니다',
  lastPage: '마지막 쪽입니다',
  /** The toolbar's 뒤로 / 앞으로 while the tab's history has nothing in that direction (M-2). */
  noHistoryBack: '뒤로 갈 곳이 없습니다',
  noHistoryForward: '앞으로 갈 곳이 없습니다',
  opening: 'PDF를 여는 중입니다',
  needsFile: '원본\u00a0파일이 있어야 쓸 수 있습니다',
  pdfTools: 'PDF 도구',
  /** The zoom field holds the scale in percent; its ▾ opens the zoom menu (design-spec 7.3). */
  zoomField: '확대 비율',
  zoomMenu: '확대 메뉴',
  /** The toolbar's 보기 menu: the page colour, the scroll and spread submenus and the rotation. */
  viewMenu: '보기',
  pageColor: '쪽 색',
  /** The picture's 보기 menu head for its three grounds (the menu bar's group carries the same name). */
  imageBackground: '배경',
  /** The two submenus of 보기 ▾ (the menu bar's groups carry the same names). */
  scrollMode: '스크롤',
  spreadMode: '펼침',
  pdfStage: 'PDF 쪽',
  lockedTitle: '암호로 보호된 PDF입니다',
  lockedBody: '암호를 입력하면 엽니다. 암호는 저장하지 않으므로 다음에 열 때 다시 묻습니다.',
  password: '암호',
  passwordOpen: '열기',
  passwordWrong: '암호가 맞지 않습니다.',
  pdfErrorTitle: '이\u00a0PDF를 열 수 없습니다',
  // One cause, one next action (design-spec 6), as in reader-pdf.html?state=error.
  pdfErrorBody: '파일 내용이 손상되어 쪽을 읽을 수 없습니다. 원본\u00a0파일은 그대로 보관됩니다. 다른\u00a0사본이 있으면 다시 가져오세요.',
  /** One page of a PDF that opened could not be drawn (final review m2): cause, then the way on. */
  pageErrorTitle: '이\u00a0쪽을 표시할 수 없습니다',
  pageErrorBody: '이\u00a0쪽의 내용을 그리지 못했습니다. 다른\u00a0쪽으로 이동해 계속 읽을 수 있습니다.',
  videoUnsupportedTitle: '이\u00a0동영상은 재생할 수 없습니다',
  // U+2060 (word joiner) keeps the particle on the format's line: a break between ")" and "로" is allowed even
  // with word-break: keep-all, and a line that opens with "로" reads badly.
  videoUnsupportedBody:
    'Learn의 재생 엔진이 이\u00a0파일의 형식을 지원하지 않습니다. MP4(H.264/AAC)\u2060로 변환한 파일을 가져오면 재생할 수 있습니다. 원본\u00a0파일은 그대로 보관됩니다.',
  videoErrorTitle: '이\u00a0동영상을 재생하지 못했습니다',
  videoErrorBody: '파일이 손상되었거나 읽는 중에 문제가 생겼습니다. 원본\u00a0파일은 그대로 보관됩니다.',
  missingTitle: '원본\u00a0파일을 찾을 수 없습니다',
  missingLinkedBody: '외부 연결 자료입니다. 파일을 옮겼거나 이름을 바꿨다면 새\u00a0위치를 지정하세요.',
  missingManagedBody:
    '라이브러리 안의 사본을 찾을 수 없습니다. 원본\u00a0파일이 있으면 다시 가져오세요. 이미 있는 자료로 표시되면 ‘새\u00a0자료로 추가’\u2060를 고르세요.',
  openFailedTitle: '자료를 열 수 없습니다',
  /** The find bar (spec 4.5): the count reads "3 / 17"; a miss and a wrap say so in the same place. */
  find: '찾기',
  findField: 'PDF에서 찾기',
  findCount: (current: number, total: number) => `${current} / ${total}`,
  findNone: '찾을 수 없음',
  findWrapped: (current: number, total: number) => `처음부터\u00a0· ${current} / ${total}`,
  findWrappedSpoken: '처음부터 다시 찾았습니다',
  findPrev: '이전 찾기',
  findNext: '다음 찾기',
  findClose: '찾기 닫기',
  /** The sidebar while a PDF is read (spec 4.7). */
  navLabel: '썸네일과 목차',
  thumbnails: '썸네일',
  outline: '목차',
  thumbnailList: '쪽 썸네일',
  thumbnailFailed: (page: number) => `${page}쪽, 썸네일을 만들 수 없습니다`,
  thumbnailOf: (page: number) => `${page}쪽`,
  outlineSearch: '목차에서 찾기',
  outlineSearchLabel: '목차 검색',
  outlineRowName: (title: string, page: number) => `${title}, ${page}쪽`,
  outlineTree: 'PDF 목차',
  noOutlineTitle: '이\u00a0PDF에는 목차가 없습니다',
  /** The body names the page shortcut between its two halves (a keycap, not text: the keys differ by platform). */
  noOutlineLead: '썸네일에서 쪽을 고르거나',
  noOutlineTail: '로 쪽\u00a0번호를 입력하세요.',
  outlineNoMatch: '일치하는 목차가 없습니다',
  noPagesTrashed: '복원하면 쪽이 보입니다',
  noPagesLocked: '암호를 입력하면 쪽이 보입니다',
  noPages: '표시할 쪽이 없습니다',
  /** The sidebar beside an image tab, in every state of it: a picture has no pages to list. */
  noPagesImage: '이미지에는 쪽이 없습니다',
  /**
   * The image reader (M7c spec 11). Its zoom menu names come from the commands (창에 맞춤 · 너비에 맞춤 · 실제 크기 · 확대 · 축소);
   * the field and the ▾ keep the PDF's names (확대 비율, 확대 메뉴).
   */
  imageTools: '이미지 도구',
  imageStage: '이미지',
  imageOpening: '이미지를 여는 중입니다',
  imageErrorTitle: '이\u00a0이미지를 표시할 수 없습니다',
  imageErrorBody: '파일 내용이 손상되었거나 그릴 수 없는 형식입니다. 원본\u00a0파일은 그대로 보관됩니다. 다른\u00a0사본이 있으면 다시 가져오세요.',
} as const;
