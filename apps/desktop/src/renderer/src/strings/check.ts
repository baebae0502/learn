/**
 * 라이브러리 점검 (M6 spec 7.2; the approved mockups dialogs.html?scene=recovery, recovery-full, recovery-ok, Task 1 rulings:
 * a cause the app did not record is not named, 쓰이지 않는 사본, the 자료 기록 row). Determiner + noun and the listed
 * compounds are bound (U+00A0); a middot after a word keeps to it (U+2060).
 */
export const check = {
  title: '라이브러리 점검',
  intro: {
    auto: '라이브러리를 열 때 정리할 것을 찾았습니다. 자동으로 지운 것은 없습니다.',
    manual: '라이브러리에서 정리할 것을 찾았습니다. 자동으로 지운 것은 없습니다.',
    fine: '문제가 없습니다.',
  },
  hint: '언제든 메뉴 막대의 파일 › 라이브러리 점검에서 다시 할 수 있습니다.',
  records: { title: '자료 기록', text: (n: number) => `자료 ${n}개의 정보⁠·컬렉션⁠·태그가 그대로입니다.` },
  rows: {
    staging: { title: (n: number) => `가져오다 멈춘 임시 파일 ${n}개`, name: '가져오다 멈춘 임시 파일', text: '라이브러리에는 추가되지 않았습니다. 정리하면 디스크 공간을 돌려받습니다.' },
    unreferenced: { title: (n: number) => `쓰이지 않는 사본 ${n}개`, name: '쓰이지 않는 사본', text: '어느 자료도 쓰지 않는 라이브러리 폴더의 파일입니다.' },
    missingManaged: { title: (n: number) => `사본이 사라진 자료 ${n}개`, name: '사본이 사라진 자료', text: '라이브러리 폴더에서 사본 파일이 없어졌습니다.' },
    missingLinked: { title: (n: number) => `원본을 찾을 수 없는 외부 연결 ${n}개`, name: '원본을 찾을 수 없는 외부 연결', text: '파일을 옮겼다면 새 위치를 지정하세요.' },
    corrupt: {
      title: (n: number) => `따로 보관한 손상된 사본 ${n}개`, name: '따로 보관한 손상된 사본',
      text: '내용이 손상되어 라이브러리에서 뺀 사본입니다. 확인한 뒤 직접 지울 수 있습니다.',
    },
    orphanEdits: { title: (n: number) => `주인 없는 수정본 ${n}개`, name: '주인 없는 수정본', text: '다른 앱에서 고쳤지만 원래 자료가 없는 파일입니다.' },
  },
  /** A fixed row's sentence (it keeps its place, its name without a count). */
  fixed: { cleaned: '정리했습니다.', revived: '자료로 되살렸습니다.', relinked: '다시 연결했습니다.', imported: '새 자료로 가져왔습니다.', none: '남은 것이 없습니다.' },
  actions: {
    cleanStaging: '임시 파일 정리',
    revive: '자료로 되살리기',
    clean: '지우기…',
    relink: '다시 연결…',
    /** The name a screen reader hears for one name's 다시 연결… (the visible label comes last). */
    relinkFor: (title: string) => `${title} 다시 연결…`,
    reveal: { darwin: 'Finder에서 보기', other: '폴더에서 보기' },
    importNew: '새 자료로 가져오기',
  },
  /** 정리… asks in its row first (no sheet over the sheet); ↩ and esc keep the copies. */
  confirm: {
    title: (n: number) => `쓰이지 않는 사본 ${n}개를 지우겠습니까?`,
    text: '되돌릴 수 없습니다. 라이브러리 폴더에서 지웁니다.',
    remove: '지우기',
    cancel: '취소',
  },
  more: (n: number) => `외 ${n}개`,
  withMore: (label: string, n: number) => `${label} 외 ${n}개`,
  /** The status icon's name for a screen reader. */
  status: { warning: '주의', info: '참고', success: '이상 없음', working: '처리하는 중' },
} as const;
