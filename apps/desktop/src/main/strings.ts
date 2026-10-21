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
} as const;
