export const sheets = {
  duplicateTitle: '이미 라이브러리에 있는 파일입니다',
  /** Follows the bold file name: "molbio.pdf의 내용이 …" (의 needs no batchim choice). "어느 쪽", "원본 파일" bound (U+00A0). */
  duplicateBody: '의 내용이 아래 자료와 완전히 같습니다. 어느 쪽을 골라도 원본 파일은 지우지 않습니다.',
  cardMeta: (type: string, size: string, when: string) => `${type} · ${size} · ${when} 추가`,
  openExisting: '기존 자료 열기',
  addAnyway: '새 자료로 추가',
  skip: '건너뛰기',
  /** The check box under the card while more duplicates wait (spec 3.4, dialogs.html?scene=duplicate). */
  applyToRest: (n: number) => `남은 중복 파일 ${n}개에도 같은 선택 적용`,
  shortcutsTitle: '단축키',
  groups: { app: '앱', library: '라이브러리', viewer: '리더', item: '자료', organize: '정리', dialogs: '팔레트·대화상자' },
  /** The one line for the eight colour keys (spec 4.2), under 정리: "1–8 · 색 태그 붙이기/떼기". */
  colorKeys: { label: '색 태그 붙이기/떼기', spoken: (first: string, last: string) => `${first}부터 ${last}` },
  /** The keys the ⌘K palette and every sheet understand (design-spec 7.4); sheets/shortcuts.ts spells them per platform. */
  dialogKeys: { move: '이동', run: '실행', close: '닫기' },
  /** 보기's 전체 화면, built by main outside the registry (main/menu/app-menu.ts FULL_SCREEN): the menu's neutral name. */
  fullScreen: '전체 화면',
} as const;
