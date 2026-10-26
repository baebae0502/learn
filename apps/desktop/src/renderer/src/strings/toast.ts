export const toast = {
  imported: (n: number) => `자료 ${n}개를 가져왔습니다`,
  linked: (n: number) => `자료 ${n}개를 연결했습니다`,
  failedTitle: (n: number) => `파일 ${n}개를 가져오지 못했습니다`,
  more: (n: number) => `외 ${n}개`,
  importFailed: '가져오지 못했습니다',
  /** An import into the collection being viewed (spec 3.7): the collection named, and the existing items 가져오지 않음 filed. */
  importedInto: (name: string, n: number) => `‘${name}’에 자료 ${n}개를 가져왔습니다`,
  linkedInto: (name: string, n: number) => `‘${name}’에 자료 ${n}개를 연결했습니다`,
  filedExisting: (name: string, n: number) => `이미 있는 자료 ${n}개를 ‘${name}’에 넣었습니다`,
  /** The verb on a result toast that can be taken back (collection deleted, items moved or taken out). */
  undo: '실행 취소',
  undoFailed: '되돌리지 못했습니다',
  dropNoPathTitle: (n: number) => `놓은 파일 ${n}개를 가져오지 못했습니다`,
  /** `command`: 파일 가져오기 as prose names it (commandMention: no "…", critic T14-n2). */
  dropNoPathBody: (command: string) => `파일 위치를 확인할 수 없습니다. 파일 › ${command}로 다시 시도하세요.`,
  actionFailed: '작업을 마치지 못했습니다',
  /** A first copy in main past 300 ms: what is being made; the file's original name is the line under it. */
  busy: { open: '여는 중…', reveal: '여는 중…', export: '내보내는 중…' },
  /** 사본 내보내기…: saved, with the reveal action; or why not (main's cause and next step as the body). */
  exportSaved: '사본을 저장했습니다',
  exportFailed: '사본을 저장하지 못했습니다',
  /** When the call itself failed (the channel, not main's answer): no cause to name, so the next step only. */
  exportFailedBody: '내보내는 중에 문제가 생겼습니다. 잠시 뒤에 다시 내보내 보세요.',
} as const;
