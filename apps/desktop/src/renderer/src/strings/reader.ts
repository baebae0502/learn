// Reader chrome and the reader's final states (design-spec 6 끝난 상태, 9 원인 + 다음 행동). U+00A0 binds
// determiner + noun and "원본 파일" (strings.test.ts).
export const reader = {
  prevPage: '이전 쪽',
  nextPage: '다음 쪽',
  page: (n: number, total: number) => `${n} / ${total}쪽`,
  /** Disabled-button tooltips (M-2). */
  firstPage: '첫 쪽입니다',
  lastPage: '마지막 쪽입니다',
  opening: 'PDF를 여는 중입니다',
  needsFile: '원본\u00a0파일이 있어야 쓸 수 있습니다',
  zoom: '배율',
  pdfTools: 'PDF 도구',
  pdfStage: 'PDF 쪽',
  linkedMeta: '외부 연결',
  pdfErrorTitle: '이\u00a0PDF를 열 수 없습니다',
  pdfErrorBody: '파일 내용이 손상되었거나 지원하지 않는 형식입니다. 원본\u00a0파일은 그대로 보관됩니다. 다른\u00a0사본이 있으면 다시 가져오세요.',
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
    '라이브러리 안의 사본을 찾을 수 없습니다. 원본\u00a0파일이 있으면 다시 가져오세요. 이미 있는 자료로 표시되면 ‘새\u00a0자료로 추가’를 고르세요.',
  showLibrary: '라이브러리에서 보기',
  openFailedTitle: '자료를 열 수 없습니다',
} as const;
