export const sheets = {
  duplicateTitle: '이미 라이브러리에 있는 파일입니다',
  /** Follows the bold file name: "molbio.pdf의 내용이 …" (의 needs no batchim choice). "어느 쪽", "원본 파일" bound (U+00A0). */
  duplicateBody: '의 내용이 아래 자료와 완전히 같습니다. 어느 쪽을 골라도 원본 파일은 지우지 않습니다.',
  cardMeta: (type: string, size: string, when: string) => `${type} · ${size} · ${when} 추가`,
  openExisting: '기존 자료 열기',
  addAnyway: '새 자료로 추가',
  skip: '건너뛰기',
  shortcutsTitle: '단축키',
  groups: { app: '앱', library: '라이브러리', viewer: '리더', item: '자료', dialogs: '대화상자' },
  /** The keys every sheet understands; sheets/shortcuts.ts spells them per platform. */
  dialogKeys: { confirm: '기본 버튼 누르기', close: '닫기' },
} as const;
