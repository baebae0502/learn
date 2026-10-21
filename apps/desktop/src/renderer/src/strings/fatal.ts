// The fatal screen: nothing else can be shown. Only our own copy; main's messages (which can carry paths) never
// reach it — the error code goes to the file line's tooltip (C-8).
export const fatal = {
  title: '라이브러리를 열 수 없습니다',
  // C-8: the file name is a technical value — it goes on the notice's monospace file line (backupFile), not in prose.
  // "업데이트 전" stays on one line (U+00A0): a line that opens with "전 백업" misreads.
  hint: '데이터는 삭제되지 않았습니다. 아래 위치에 업데이트\u00a0전 백업 파일이 있으면 그\u00a0파일로 복구할 수 있습니다.',
  backupFile: 'library.sqlite.pre-v*.bak',
  /** A render-time failure in the main window (RenderBoundary): the library itself is fine. */
  renderTitle: '화면을 표시하지 못했습니다',
  renderBody: '데이터는 삭제되지 않았습니다. 앱을 다시 시작하세요.',
} as const;
