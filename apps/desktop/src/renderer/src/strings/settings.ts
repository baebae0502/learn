// The ⌘, settings window (settings.html, design-spec 6 설정 창, 10.6). Every change applies at once: no 완료 or ×.
export const settings = {
  title: '설정',
  appearance: '외관',
  theme: '테마',
  themes: { system: '시스템 설정', light: '라이트', dark: '다크' },
  density: '밀도',
  densityHint: '목록과 표의 행 높이 · 24 / 28 / 32',
  densities: { compact: '촘촘하게', regular: '보통', comfortable: '여유 있게' },
  fontSize: '글자 크기',
  // Only what M3 does: the native menus keep the system size (the mockup said "목록·메뉴·패널"), and reader zoom is M7.
  // The same form as densityHint, one group up: what it sets, then its values (critic T14-n7; spec 9 "7 / 12").
  fontSizeHint: '목록과 패널의 글자 크기 · 12 / 13 / 14 / 15pt',
  fontSizes: { 12: '작게', 13: '기본', 14: '크게', 15: '아주 크게' },
  /** Each size's value, in its segment's tooltip (settings.html, design-spec 10.6 "12·13·14·15pt"). */
  fontSizePt: (size: number) => `${size}pt`,
  library: '라이브러리',
  location: '위치',
  locationHint: '자료 사본과 데이터베이스가 있는 폴더입니다. 다른\u00a0폴더를 고르면 Learn을 다시 시작하고 그\u00a0폴더의 라이브러리를 엽니다.',
  reveal: { darwin: 'Finder에서 보기', other: '폴더에서 보기' },
  choose: '다른\u00a0폴더 선택…',
} as const;
