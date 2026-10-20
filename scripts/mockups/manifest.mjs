// Which mockup renders exist. Shared by scripts/render-mockups.mjs (Linux, xvfb) and
// tests/evidence/mockups.evidence.ts (macOS runner, real SF fonts).

/** @typedef {{ name: string, page: string, query: Record<string, string>, group: 'base' | 'variant', label: string }} Render */

export const SCREENS = [
  ['library', '라이브러리'],
  ['library-empty', '첫 실행'],
  ['reader-pdf', 'PDF 리더'],
  ['reader-video', '동영상 리더'],
  ['palette', '명령 팔레트'],
  ['settings', '설정'],
  ['dialogs', '대화상자'],
];
export const THEMES = ['light', 'dark'];
export const LAYOUTS = ['A', 'B'];

/** @type {Render[]} 7 screens × 2 themes × 2 layouts = 28 */
export const BASE = SCREENS.flatMap(([screen, label]) =>
  THEMES.flatMap((theme) =>
    LAYOUTS.map((layout) => ({
      name: `${screen}-${theme}-${layout}`,
      page: `${screen}.html`,
      query: { theme, layout },
      group: /** @type {const} */ ('base'),
      label: `${label} · ${theme === 'light' ? '라이트' : '다크'} · ${layout}`,
    })),
  ),
);

/** States that do not fit in one base render. */
const variant = (screen, theme, layout, extra, suffix, label) => ({
  name: `${screen}--${suffix}-${theme}-${layout}`,
  page: `${screen}.html`,
  query: { theme, layout, ...extra },
  group: /** @type {const} */ ('variant'),
  label: `${label} · ${theme === 'light' ? '라이트' : '다크'} · ${layout}`,
});

/** @type {Render[]} */
export const VARIANTS = [
  ...THEMES.flatMap((t) => LAYOUTS.map((l) => variant('library-empty', t, l, { state: 'drop' }, 'drop', '드롭 오버레이'))),
  variant('library', 'light', 'A', { density: 'compact' }, 'compact', '라이브러리 촘촘하게(24)'),
  variant('library', 'dark', 'B', { density: 'comfortable' }, 'comfortable', '라이브러리 여유 있게(32)'),
  variant('reader-pdf', 'light', 'A', { page: 'sepia', menu: 'view' }, 'sepia-view-menu', 'PDF 세피아 + 보기 메뉴'),
  variant('reader-pdf', 'dark', 'B', { menu: 'zoom' }, 'zoom-menu', 'PDF 확대 메뉴'),
  variant('reader-pdf', 'light', 'B', { nav: 'outline' }, 'outline', 'PDF 목차'),
  variant('reader-pdf', 'dark', 'A', { page: 'original', nav: 'outline' }, 'outline-original', 'PDF 목차 · 원본 쪽 색'),
  variant('library', 'light', 'A', { ms: '1' }, 'milestones', '라이브러리 마일스톤 표시'),
  variant('reader-pdf', 'light', 'A', { ms: '1' }, 'milestones', 'PDF 마일스톤 표시'),
  variant('reader-video', 'light', 'A', { ms: '1' }, 'milestones', '동영상 마일스톤 표시'),
  ...THEMES.flatMap((t) =>
    [1, 2, 3].map((part) =>
      variant('components', t, 'A', { part: String(part) }, `part${part}`, ['', '컴포넌트 상태 1', '토큰', '컴포넌트 상태 2'][part]),
    ),
  ),
  // Screen states (critique M3): selection, results, loading and failure states.
  variant('library', 'light', 'A', { state: 'none' }, 'none', '라이브러리 선택 없음'),
  variant('library', 'dark', 'B', { state: 'multi' }, 'multi', '라이브러리 다중 선택 + 키보드 커서'),
  variant('library', 'light', 'B', { state: 'noresults' }, 'noresults', '라이브러리 검색 결과 없음'),
  variant('library', 'dark', 'A', { state: 'loading' }, 'loading', '라이브러리 불러오는 중'),
  variant('library', 'light', 'A', { state: 'empty-collection' }, 'empty-collection', '빈 컬렉션'),
  variant('reader-pdf', 'light', 'A', { state: 'loading' }, 'loading', 'PDF 여는 중'),
  variant('reader-pdf', 'dark', 'B', { state: 'error' }, 'error', 'PDF 열기 실패'),
  variant('reader-pdf', 'light', 'B', { state: 'missing' }, 'missing', '원본 파일 없음(다시 연결)'),
  variant('reader-pdf', 'light', 'A', { state: 'nooutline', nav: 'outline' }, 'nooutline', 'PDF 목차 없음'),
  variant('reader-video', 'light', 'B', { state: 'nosubs' }, 'nosubs', '동영상 자막 없음'),
  variant('reader-video', 'dark', 'A', { state: 'nomatch' }, 'nomatch', '대본 검색 결과 없음'),
  variant('palette', 'dark', 'A', { state: 'none' }, 'none', '팔레트 결과 없음'),
  ...['recovery', 'backup', 'codec'].flatMap((scene) => [
    variant('dialogs', 'light', 'A', { scene }, scene, `대화상자 ${scene}`),
    variant('dialogs', 'dark', 'B', { scene }, scene, `대화상자 ${scene}`),
  ]),
];

export const ALL = [...BASE, ...VARIANTS];
