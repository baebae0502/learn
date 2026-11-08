import { eulReul } from './josa';

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
  groups: { app: '앱', library: '라이브러리', viewer: '리더', item: '자료', organize: '정리', tabs: '탭', dialogs: '팔레트·대화상자' },
  /** The one line for the eight colour keys (spec 4.2), under 정리: "1–8 · 색 태그 붙이기/떼기". */
  colorKeys: { label: '색 태그 붙이기/떼기', spoken: (first: string, last: string) => `${first}부터 ${last}` },
  /** The lines of design-spec 7.4 that name two keys ("A / B"): one row each; `tabNumbersTo` is spoken between ⌘1 and ⌘8. */
  pairs: {
    import: '파일 가져오기… / 외부 파일 연결…',
    panes: '다음 / 이전 패널로 이동',
    text: '글자 크게 / 작게',
    zoom: '확대 / 축소',
    tabClose: '탭 닫기 / 닫은 탭 다시 열기',
    tabStep: '다음 / 이전 탭',
    tabNumbers: '라이브러리 · 2–8번째 탭 / 마지막 탭',
    find: '다음 / 이전 찾기',
    rotate: '시계 / 반시계 방향으로 회전',
    nav: '썸네일 / 목차 보기',
    history: '뒤로 / 앞으로',
  },
  tabNumbersTo: '부터 ',
  /** The keys the ⌘K palette and every sheet understand (design-spec 7.4); sheets/shortcuts.ts spells them per platform. */
  dialogKeys: { move: '이동', run: '실행', close: '닫기' },
  /** 보기's 전체 화면, built by main outside the registry (main/menu/app-menu.ts FULL_SCREEN): the menu's neutral name. */
  fullScreen: '전체 화면',
  /** 영구 삭제… / 휴지통 비우기… (P-25; dialogs.html?scene=purge, ?scene=empty-trash): "외부 연결 원본" kept on one line (U+00A0). */
  purge: {
    /** One row is named, as the move toasts name it (trash.movedOne, collectionMoved); several are counted. */
    titleItems: (n: number, name?: string) => (n === 1 && name !== undefined ? `‘${name}’\u2060${eulReul(name)} 영구히 삭제하겠습니까?` : `자료 ${n}개를 영구히 삭제하겠습니까?`),
    titleCollections: (n: number, name?: string) => (n === 1 && name !== undefined ? `‘${name}’ 컬렉션을 영구히 삭제하겠습니까?` : `컬렉션 ${n}개를 영구히 삭제하겠습니까?`),
    titleMixed: (items: number, collections: number) => `자료 ${items}개와 컬렉션 ${collections}개를 영구히 삭제하겠습니까?`,
    titleEmpty: '휴지통을 비우겠습니까?',
    bodyItems: '되돌릴 수 없습니다. 라이브러리 안의 사본도 지웁니다. 외부 연결 원본은 지우지 않습니다.',
    bodyCollections: '그 안의 자료는 라이브러리에 남습니다. 되돌릴 수 없습니다.',
    bodyMixed: '되돌릴 수 없습니다. 라이브러리 안의 사본도 지웁니다. 컬렉션 안의 다른 자료는 라이브러리에 남습니다. 외부 연결 원본은 지우지 않습니다.',
    /** `what`: "자료 7개와 컬렉션 2개" — it ends in 개, so 를. */
    bodyEmpty: (what: string) => `${what}를 영구히 지웁니다. 되돌릴 수 없습니다. 외부 연결 원본은 지우지 않습니다.`,
    what: (items: number, collections: number) => (items > 0 && collections > 0 ? `자료 ${items}개와 컬렉션 ${collections}개` : collections > 0 ? `컬렉션 ${collections}개` : `자료 ${items}개`),
    purge: '영구 삭제',
    empty: '휴지통 비우기',
    cancel: '취소',
  },
} as const;
