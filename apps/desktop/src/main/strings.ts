// Copy main shows itself: the settings window's title, its native folder dialog and restart confirmation, and the
// messages its checks send back to the settings window. strings.test.ts lints it with the renderer's copy (design-spec 9:
// 합니다체, verb buttons, U+00A0 groups; cause + next step). No Electron import.
export const mainStrings = {
  settingsWindow: { title: '설정' },
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
  /** Finder에서 보기 / 기본 앱으로 열기 on an item (ipc/library.ts existingFile). */
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
    folderGone: '저장할 폴더를 찾을 수 없습니다. 폴더가 있는지 확인하고 다시 내보내세요.',
    nameTooLong: '파일\u00a0이름이 너무 깁니다. 더 짧은 이름으로 다시 내보내세요.',
    isFolder: '같은 이름의 폴더가 있습니다. 다른\u00a0이름으로 다시 내보내세요.',
    failed: '사본을 쓰지 못했습니다. 잠시 뒤에 다시 내보내거나 다른\u00a0폴더를 고르세요.',
    gone: '내보낸 사본을 찾을 수 없습니다. 옮기거나 지웠다면 다시 내보내세요.',
  },
  /** The table header's native column menu (menu/column-menu.ts); the column names come from the catalogue. */
  columnMenu: { reset: '열 구성 되돌리기' },
  /** An IPC call from a window that may not make it (the settings window's channels, main-window-only channels). */
  callerRefused: '허용되지 않은 호출자입니다.',
} as const;
