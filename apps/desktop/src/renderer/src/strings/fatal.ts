// The fatal screen: nothing else can be shown. Only our own copy; main's messages (which can carry paths) never
// reach it — the error code goes to the file line's tooltip (C-8).
export const fatal = {
  title: '라이브러리를 열 수 없습니다',
  // C-8: the file name is a technical value — it goes on the notice's monospace file line (the backup main found),
  // not in prose. The noun phrase "업데이트 전 백업 파일" never splits across lines (U+00A0, n4).
  backupBody: '데이터는 삭제되지 않았습니다. 아래 위치의 업데이트\u00a0전\u00a0백업\u00a0파일로 복구할 수 있습니다.',
  /** No pre-update backup in the library folder (or the folder is unknown): the sentence points at none (n5). */
  restartBody: '데이터는 삭제되지 않았습니다. 앱을 다시 시작하세요.',
  /** A render-time failure in the main window (RenderBoundary): the library itself is fine. */
  renderTitle: '화면을 표시하지 못했습니다',
  /** The library could not be opened: its location can still be changed in the settings window (main-owned ⌘,). */
  openSettings: '설정 열기',
} as const;
