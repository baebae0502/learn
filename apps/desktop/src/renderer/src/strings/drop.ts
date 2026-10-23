/** The window-wide drop overlay (design-spec 6 드롭 오버레이, 7.2). */
export const drop = {
  label: '파일 놓기',
  title: '놓으면 라이브러리로 가져옵니다',
  files: (n: number) => `파일 ${n}개`,
  pdf: 'PDF',
  video: '동영상',
  other: '기타',
  copyTitle: '사본으로 가져오기',
  // A line per sentence (.dm-text is pre-line); the link card's one sentence wraps where it must.
  copyBody: '라이브러리 폴더에 복사합니다.\n원본은 그대로 둡니다.',
  linkTitle: '외부 파일로 연결',
  linkBody: '복사하지 않고 원래 위치의 파일을 그대로 씁니다.',
} as const;
