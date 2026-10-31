// Every string main shows itself (spec §8: none inline elsewhere in main, strings.test.ts checks): window titles, native
// dialogs and menus, the messages its checks and requests send back to a page. strings.test.ts lints it with the
// renderer's copy (design-spec 9: 합니다체, verb buttons, U+00A0 groups; cause + next step). No Electron import.
export const mainStrings = {
  settingsWindow: { title: '설정' },
  /** The sheets ui:confirm shows: the confirming button's text comes from the page, the cancel button is main's. */
  confirmSheet: { cancel: '취소' },
  libraryFolder: {
    pickTitle: '라이브러리 폴더 선택',
    pickButton: '선택',
    confirmMessage: '다른 라이브러리를 열려면 Learn을 다시 시작해야 합니다',
    /** The chosen folder on its own line, then what happens to the two libraries. */
    confirmDetail: (folder: string) => `${folder}\n이 폴더에 라이브러리가 없으면 새로 만듭니다. 지금 라이브러리는 그대로 남아 있습니다.`,
    confirmButtons: ['다시 시작', '취소'],
    missing: '폴더를 찾을 수 없습니다. 다른 폴더를 고르세요.',
    notFolder: '폴더가 아닙니다. 다른 폴더를 고르세요.',
    notWritable: '이 폴더에는 쓸 수 없습니다. 쓰기 권한이 있는 폴더를 고르세요.',
    revealMissing: '라이브러리 폴더를 찾을 수 없습니다. 폴더가 있는 디스크가 연결되어 있는지 확인하세요.',
  },
  /** The open panels of 파일 가져오기… and 다시 연결… (the filter names; middots bound as VIDEO_FORMATS, T14-n1). */
  importFilters: { media: 'PDF\u00a0·\u00a0동영상', all: '모든\u00a0파일' },
  /**
   * The open panels' titles: 파일 가져오기… and 다시 연결… (ipc/library.ts). macOS shows no title on a sheet, so each
   * panel also has a one-line message (shown on top) and its own button name: ⌘O, ⌥⌘O and 다시 연결 do not look alike.
   */
  openPanels: {
    import: '파일 가져오기',
    relink: '원본\u00a0파일 다시 연결',
    importMessage: '라이브러리에 사본으로 가져올 파일을 고르세요.',
    importButton: '가져오기',
    linkMessage: '원본\u00a0파일은 제자리에 두고 연결할 파일을 고르세요.',
    linkButton: '연결',
    relinkMessage: '옮겨진 원본\u00a0파일을 고르세요.',
    relinkButton: '다시 연결',
  },
  /** An item's file: Finder에서 보기 / 기본 앱으로 열기 / 사본 내보내기 (ipc/library.ts availableAsset); noItem for any item lookup (item-availability.ts too). */
  itemFile: {
    /** A linked file that is gone: it can be relinked. */
    linkedMissing: '원본\u00a0파일을 찾을 수 없습니다. 파일을 옮겼다면 다시 연결하세요.',
    /** A managed copy that is gone: it cannot be relinked, only imported again (final review m6). */
    managedMissing: '라이브러리 안의 사본을 찾을 수 없습니다. 원본\u00a0파일이 있으면 다시 가져오세요.',
    noItem: '자료를 찾을 수 없습니다.',
    noApp: '기본 앱으로 열지 못했습니다. 이\u00a0형식을 여는 앱이 설치되어 있는지 확인하세요.',
  },
  /** 사본 내보내기… (ipc/library.ts exportCopy): the save panel's type filter and what the copy can fail with. */
  exportCopy: {
    filterName: { pdf: 'PDF', video: '동영상' },
    notWritable: '이\u00a0폴더에는 쓸 수 없습니다. 다른\u00a0폴더를 고르세요.',
    diskFull: '디스크\u00a0공간이 부족합니다. 공간을 확보하거나 다른\u00a0폴더를 고르세요.',
    inLibrary: '라이브러리 폴더 안에는 저장할 수 없습니다. 다른\u00a0폴더를 고르세요.',
    onSource: '원본\u00a0파일 자리에는 저장할 수 없습니다. 다른\u00a0폴더나 이름을 고르세요.',
    folderGone: '저장할 폴더를 찾을 수 없습니다. 폴더가 있는지 확인하고 다시 내보내세요.',
    nameTooLong: '파일\u00a0이름이 너무 깁니다. 더 짧은 이름으로 다시 내보내세요.',
    isFolder: '같은 이름의 폴더가 있습니다. 다른\u00a0이름으로 다시 내보내세요.',
    failed: '사본을 쓰지 못했습니다. 잠시 뒤에 다시 내보내거나 다른\u00a0폴더를 고르세요.',
    gone: '내보낸 사본을 찾을 수 없습니다. 옮기거나 지웠다면 다시 내보내세요.',
  },
  /** The table header's native column menu (menu/column-menu.ts); the column names come from the catalogue. */
  columnMenu: { reset: '열 구성 되돌리기' },
  /** A request that fails its schema (ipc/register.ts), or a sheet's answer of the wrong kind (sheets.ts). */
  badRequest: '잘못된 요청입니다.',
  /** ui.windowState from a page whose window is gone. */
  windowGone: '창을 찾을 수 없습니다.',
  /** Opening the library at startup (index.ts): a failure with no message of its own, and requests while there is none. */
  library: { openFailed: '라이브러리를 여는 중 오류가 발생했습니다.', unavailable: '라이브러리를 열 수 없습니다.' },
  /** The preferences file (prefs.ts). */
  prefs: {
    saveFailed: '환경설정을 저장하지 못했습니다.',
    readOnly: '환경설정 파일을 읽거나 옮길 수 없어 이번 실행에서는 변경 내용을 저장하지 않습니다. 파일 권한을 확인한 뒤 앱을 다시 시작하세요.',
    invalid: '환경설정 값이 올바르지 않습니다.',
    libraryRootRelative: '라이브러리 위치는 절대 경로여야 합니다.',
  },
  /**
   * The application menu's own items (registry commands carry their labels in COMMANDS) and the edit context menu.
   * Apple Korean: "<앱>에 관하여" in the app menu ("정보" is the Windows Help › About wording), "윈도우 닫기" after the
   * 윈도우 menu; Linux/Windows say 창 and end 도움말 with "Learn 정보".
   */
  menu: {
    top: { app: 'Learn', file: '파일', edit: '편집', view: '보기', go: '이동', window: '윈도우', help: '도움말' },
    app: { about: 'Learn에 관하여', services: '서비스', hide: 'Learn 가리기', hideOthers: '기타 가리기', unhide: '모두 보기', quit: 'Learn 종료' },
    close: { mac: '윈도우 닫기', other: '창 닫기' },
    edit: { undo: '실행 취소', redo: '실행 복귀', cut: '오려두기', copy: '복사하기', paste: '붙여넣기', selectAll: '모두 선택' },
    /** macOS names the item by what it will do; the neutral name is spec 7.4's (Linux/Windows's role item). */
    fullScreen: { label: '전체 화면', windowed: '전체 화면 시작', fullscreen: '전체 화면 종료' },
    devTools: '개발자 도구',
    window: { minimize: '최소화', zoom: '확대/축소', front: '모두 앞으로 가져오기' },
    aboutOther: 'Learn 정보',
    /** 보기 › 정렬 기준 ▸ (menu/submenus.ts): the two directions; the columns are named by the catalogue. */
    sort: { asc: '오름차순', desc: '내림차순' },
    /** The first row of 컬렉션에 추가 ▸: a collection made for the selection (no dialog, spec 3.4). */
    newCollection: '새\u00a0컬렉션',
  },
  /** The About panel's credits, one line each (README "런타임 의존성 라이선스"). */
  about: {
    credits: [
      '글꼴: Pretendard Variable — SIL Open Font License 1.1 (OFL)',
      '아이콘: Lucide — ISC License',
      '컴포넌트: React Aria Components — Apache License 2.0',
      'PDF: PDF.js — Apache License 2.0',
      'React, react-resizable-panels, TanStack Query, TanStack Virtual, zustand, Zod, Electron, better-sqlite3 — MIT License',
    ],
  },
  /** The work line (jobs/lane.ts): a job dropped before it ran, as the app quits. A stopped job reports nothing, so it is never shown. */
  jobs: { cancelled: '작업을 멈췄습니다.' },
  /** The duplicate question when no main window is left to hang the sheet on (jobs/duplicate-asker.ts, spec 3.4). */
  duplicateQuestion: {
    message: '이미 라이브러리에 있는 파일입니다',
    detail: (file: string, title: string) => `${file}의 내용이 ‘${title}’ 자료와 완전히 같습니다. 어느\u00a0쪽을 골라도 원본\u00a0파일은 지우지 않습니다.`,
    add: '새\u00a0자료로 추가',
    skip: '건너뛰기',
    applyToRest: (n: number) => `남은 중복 파일 ${n}개에도 같은 선택 적용`,
  },
  /** An IPC call from a window that may not make it (the settings window's channels, main-window-only channels). */
  callerRefused: '허용되지 않은 호출자입니다.',
} as const;
