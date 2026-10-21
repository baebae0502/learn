export const toast = {
  imported: (n: number) => `자료 ${n}개를 가져왔습니다`,
  linked: (n: number) => `자료 ${n}개를 연결했습니다`,
  failedTitle: (n: number) => `파일 ${n}개를 가져오지 못했습니다`,
  more: (n: number) => `외 ${n}개`,
  importFailed: '가져오지 못했습니다',
  dropNoPathTitle: (n: number) => `놓은 파일 ${n}개를 가져오지 못했습니다`,
  dropNoPathBody: '파일 위치를 확인할 수 없습니다. 파일 › 파일 가져오기…로 다시 시도하세요.',
  actionFailed: '작업을 마치지 못했습니다',
} as const;
