// Which mockup renders exist. Shared by scripts/render-mockups.mjs (Linux, xvfb) and
// tests/evidence/mockups.evidence.ts (macOS runner, real SF fonts).

/** @typedef {{ name: string, page: string, query: Record<string, string>, group: 'base' | 'variant' | 'tutor' | 'm6' | 'm7a' | 'm7b', label: string }} Render */

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
  variant('reader-pdf', 'light', 'A', { state: 'locked' }, 'locked', '암호로 보호된 PDF'),
  variant('reader-pdf', 'light', 'A', { state: 'nooutline', nav: 'outline' }, 'nooutline', 'PDF 목차 없음'),
  variant('reader-video', 'light', 'B', { state: 'nosubs' }, 'nosubs', '동영상 자막 없음'),
  variant('reader-video', 'dark', 'A', { state: 'nomatch' }, 'nomatch', '대본 검색 결과 없음'),
  variant('palette', 'dark', 'A', { state: 'none' }, 'none', '팔레트 결과 없음'),
  // Layout A is retired: the sheets M6 changed (recovery, backup) render in B in both themes.
  ...['recovery', 'backup'].flatMap((scene) => THEMES.map((t) => variant('dialogs', t, 'B', { scene }, scene, `대화상자 ${scene}`))),
  variant('dialogs', 'light', 'A', { scene: 'codec' }, 'codec', '대화상자 codec'),
  variant('dialogs', 'dark', 'B', { scene: 'codec' }, 'codec', '대화상자 codec'),
  // M6 (docs/superpowers/specs/2026-10-31-m6-p1-gate-design.md §13): layout B, both themes. `--only m6` renders these.
  ...[
    ['library', { state: 'trash' }, 'trash', '휴지통 보기'],
    ['library', { state: 'duplicates' }, 'duplicates', '중복 항목 보기 · 모두 정리'],
    ['library', { state: 'edited' }, 'edited', '항목 패널 · 다른 앱에서 고친 수정본'],
    ['reader-pdf', { state: 'trashed' }, 'trashed', 'PDF 리더 · 휴지통에 있는 자료'],
    ['settings', { state: 'nobackup' }, 'nobackup', '설정 · 마지막 백업 없음'],
    ['dialogs', { scene: 'purge' }, 'purge', '영구 삭제 확인 시트'],
    ['dialogs', { scene: 'empty-trash' }, 'empty-trash', '휴지통 비우기 확인 시트'],
    ['dialogs', { scene: 'restore' }, 'restore', '복원 결과 시트'],
    ['dialogs', { scene: 'restore-issues' }, 'restore-issues', '복원 결과 시트 · 문제 있음'],
    ['dialogs', { scene: 'recovery-full' }, 'recovery-full', '라이브러리 점검 · 모든 줄'],
    ['dialogs', { scene: 'recovery-ok' }, 'recovery-ok', '라이브러리 점검 · 문제 없음'],
    ['dialogs', { scene: 'backup-missing' }, 'backup-missing', '백업 결과 시트 · 사라진 사본'],
    ['dialogs', { scene: 'jobs' }, 'jobs', '진행 토스트 · 백업과 기다리는 가져오기'],
    ['dialogs', { scene: 'fatal' }, 'fatal', '치명 화면 · Finder에서 보기'],
  ].flatMap(([screen, query, suffix, label]) => THEMES.map((t) => ({ ...variant(screen, t, 'B', query, suffix, label), group: /** @type {const} */ ('m6') }))),
  // M7a (docs/superpowers/specs/2026-11-03-m7a-reader-design.md §10): layout B, both themes. `--only m7a` renders these.
  // The reader without a tab strip (`m=7a`): the find bar, the selection pop-up, the inspector's 번역 section, the
  // sidebar and the failure states; the settings 번역 group; the library's 진행 column.
  ...[
    ['reader-pdf', { m: '7a' }, 'm7a', 'M7a 리더 · 썸네일 · 번역 절(빈 상태)'],
    ['reader-pdf', { m: '7a', nav: 'outline' }, 'm7a-outline', 'M7a 리더 · 목차(검색 입력란)'],
    ['reader-pdf', { m: '7a', find: 'open' }, 'm7a-find', 'M7a 찾기 막대 · 3 / 17'],
    ['reader-pdf', { m: '7a', find: 'none' }, 'm7a-find-none', 'M7a 찾기 막대 · 찾을 수 없음'],
    ['reader-pdf', { m: '7a', find: 'wrap' }, 'm7a-find-wrap', 'M7a 찾기 막대 · 처음부터'],
    ['reader-pdf', { m: '7a', select: 'consent' }, 'm7a-select-consent', 'M7a 선택 팝업 · 동의'],
    ['reader-pdf', { m: '7a', select: 'translating' }, 'm7a-select-translating', 'M7a 선택 팝업 · 번역 중'],
    ['reader-pdf', { m: '7a', select: 'translated' }, 'm7a-select-translated', 'M7a 선택 팝업 · 결과 + 번역 절'],
    ['reader-pdf', { m: '7a', select: 'error' }, 'm7a-select-error', 'M7a 선택 팝업 · 오류'],
    ['reader-pdf', { m: '7a', select: 'offline' }, 'm7a-select-offline', 'M7a 선택 팝업 · 오프라인'],
    ['reader-pdf', { m: '7a', select: 'long' }, 'm7a-select-long', 'M7a 선택 팝업 · 너무 긴 글'],
    ['reader-pdf', { m: '7a', select: 'same' }, 'm7a-select-same', 'M7a 선택 팝업 · 이미 한국어'],
    ['reader-pdf', { m: '7a', inspector: 'translated' }, 'm7a-inspector-translated', 'M7a 번역 절 · 결과'],
    ['reader-pdf', { m: '7a', inspector: 'concat' }, 'm7a-inspector-concat', 'M7a 번역 절 · 이어 붙이기'],
    ['reader-pdf', { m: '7a', inspector: 'consent' }, 'm7a-inspector-consent', 'M7a 번역 절 · 동의'],
    ['reader-pdf', { m: '7a', inspector: 'off' }, 'm7a-inspector-off', 'M7a 번역 절 · 사용 안 함'],
    ['reader-pdf', { m: '7a', inspector: 'translated', menu: 'direction' }, 'm7a-menu-direction', 'M7a 번역 방향 메뉴'],
    ['reader-pdf', { m: '7a', inspector: 'translated', menu: 'copy' }, 'm7a-menu-copy', 'M7a 복사 메뉴'],
    ['reader-pdf', { m: '7a', menu: 'zoom' }, 'm7a-menu-zoom', 'M7a 확대 메뉴'],
    ['reader-pdf', { m: '7a', menu: 'view' }, 'm7a-menu-view', 'M7a 보기 메뉴(쪽 색 · 회전)'],
    ['reader-pdf', { m: '7a', state: 'loading' }, 'm7a-loading', 'M7a 여는 중 · 썸네일 자리 상자'],
    ['reader-pdf', { m: '7a', state: 'nooutline', nav: 'outline' }, 'm7a-nooutline', 'M7a 목차 없음'],
    ['reader-pdf', { m: '7a', state: 'error' }, 'm7a-error', 'M7a 열기 실패'],
    ['reader-pdf', { m: '7a', state: 'missing' }, 'm7a-missing', 'M7a 원본 없음'],
    ['reader-pdf', { m: '7a', state: 'locked' }, 'm7a-locked', 'M7a 암호로 보호된 PDF'],
    ['reader-pdf', { m: '7a', state: 'locked', pw: 'wrong' }, 'm7a-locked-wrong', 'M7a 암호 틀림'],
    ['reader-pdf', { m: '7a', state: 'trashed' }, 'm7a-trashed', 'M7a 휴지통 자료 · 쪽 사이드바 줄'],
    ['reader-pdf', { m: '7a', inspector: 'translated', w: '1024' }, 'm7a-w1024', 'M7a 창 1024×768 · 항목 패널 펼침'],
    ['reader-pdf', { m: '7a', inspector: 'translated', w: '960' }, 'm7a-w960', 'M7a 창 960 · 항목 패널 접힘'],
    ['settings', { section: 'translation' }, 'm7a-translation', 'M7a 설정 · 번역 그룹'],
    ['settings', { section: 'translation', tr: 'unset' }, 'm7a-translation-unset', 'M7a 설정 · 번역 아직 묻지 않음'],
    ['settings', { section: 'translation', tr: 'off' }, 'm7a-translation-off', 'M7a 설정 · 번역 끔'],
    ['library', { columns: 'progress' }, 'm7a-progress', 'M7a 라이브러리 · 진행 열'],
  ].flatMap(([screen, query, suffix, label]) => THEMES.map((t) => ({ ...variant(screen, t, 'B', query, suffix, label), group: /** @type {const} */ ('m7a') }))),
  // M7b (docs/superpowers/specs/2026-11-05-m7b-reader-tabs-design.md §11): layout B, both themes. `--only m7b` renders these.
  // The tab strip (one reader tab, twelve that overflow, one being dragged), ‹ › in the reader toolbar, scroll and spread in
  // the view menu, the horizontal / one-page / spread scenes, the tab menu, a collapsed sidebar, a 1024 window, and the
  // library: its tab active with a reader tab open, and the item panel's 읽기 section.
  ...[
    ['reader-pdf', { m: '7b', tabs: '2' }, 'm7b', 'M7b 리더 · 탭 줄(라이브러리 + 리더 탭 하나) · 뒤로만'],
    ['reader-pdf', { m: '7b', tabs: 'many' }, 'm7b-tabs-many', 'M7b 탭 12개 · 최소 폭 120에 닿아 넘침, 활성 탭이 보이게 스크롤'],
    ['reader-pdf', { m: '7b', tabs: 'drag' }, 'm7b-tabs-drag', 'M7b 탭 끌기 중 · 이웃이 자리를 비킴'],
    ['reader-pdf', { m: '7b', tabs: '2', history: 'none' }, 'm7b-history-none', 'M7b ‹ › 둘 다 꺼짐'],
    ['reader-pdf', { m: '7b', tabs: '2', history: 'both' }, 'm7b-history-both', 'M7b ‹ › 둘 다 켜짐'],
    ['reader-pdf', { m: '7b', tabs: '2', view: 'menu' }, 'm7b-view-menu', 'M7b 보기 ▾ · 스크롤 ▸ · 펼침 ▸'],
    ['reader-pdf', { m: '7b', tabs: '2', view: 'menu-scroll' }, 'm7b-view-menu-scroll', 'M7b 보기 ▾ · 스크롤 하위 메뉴'],
    ['reader-pdf', { m: '7b', tabs: '2', view: 'menu-spread' }, 'm7b-view-menu-spread', 'M7b 보기 ▾ · 펼침 하위 메뉴'],
    ['reader-pdf', { m: '7b', tabs: '2', scroll: 'horizontal' }, 'm7b-scroll-horizontal', 'M7b 가로 스크롤 장면'],
    ['reader-pdf', { m: '7b', tabs: '2', scroll: 'horizontal', view: 'menu' }, 'm7b-scroll-horizontal-menu', 'M7b 가로 스크롤 · 펼침 ▸ 꺼짐'],
    ['reader-pdf', { m: '7b', tabs: '2', scroll: 'page' }, 'm7b-scroll-page', 'M7b 한 쪽씩 장면'],
    ['reader-pdf', { m: '7b', tabs: '2', spread: 'odd' }, 'm7b-spread-odd', 'M7b 펼침 보기 · 홀수 쪽부터'],
    ['reader-pdf', { m: '7b', menu: 'tab' }, 'm7b-menu-tab', 'M7b 탭 컨텍스트 메뉴'],
    ['reader-pdf', { m: '7b', tabs: '2', sidebar: 'hidden' }, 'm7b-sidebar-hidden', 'M7b 사이드바 접힘 · 탭 줄에 신호등 인셋·토글·실행기'],
    ['reader-pdf', { m: '7b', tabs: '2', w: '1000' }, 'm7b-w1000', 'M7b 창 1000×768 · 항목 패널이 펼쳐지는 가장 좁은 창'],
    ['reader-pdf', { m: '7b', tabs: 'many', w: '1024' }, 'm7b-w1024', 'M7b 창 1024×768 · 탭 줄과 리더 도구 막대'],
    ['library', { m: '7b', tabs: '2' }, 'm7b-library-tabs', 'M7b 라이브러리 탭 활성 · 리더 탭 하나'],
    ['library', { m: '7b', tabs: '2', reading: 'pdf' }, 'm7b-reading-pdf', 'M7b 항목 패널 읽기 절 · PDF'],
    ['library', { m: '7b', tabs: '2', reading: 'video' }, 'm7b-reading-video', 'M7b 항목 패널 읽기 절 · 동영상'],
    ['library', { m: '7b', tabs: '2', reading: 'legacy' }, 'm7b-reading-legacy', 'M7b 항목 패널 읽기 절 · 쪽 수 없는 옛 값'],
  ].flatMap(([screen, query, suffix, label]) => THEMES.map((t) => ({ ...variant(screen, t, 'B', query, suffix, label), group: /** @type {const} */ ('m7b') }))),
  // M7c (docs/superpowers/specs/2026-11-08-m7c-images-search-perf-design.md §12): layout B, both themes. `--only m7c` renders these.
  // reader-image (not one of SCREENS): ① the three backgrounds and a transparent PNG, ② fit / small / width / 400 % and the
  // zoom and view menus, ③ rotation, the states and a 1024 window, ⑦ the sidebar question. The library: ④ the search scope
  // button and menu and the full-text table, ⑤ the 본문 일치 section, ⑥ the image panel, the 본문 검색 line and the no-results
  // additions. library-empty: ⑧ the formats line and the drop summary.
  ...[
    ['reader-image', { m: '7c' }, 'm7c', '① 이미지 리더 · 창에 맞춤(큰 사진) · 배경은 앱 테마를 따름'],
    ['reader-image', { m: '7c', bg: 'light' }, 'm7c-bg-light', '① 배경 밝게'],
    ['reader-image', { m: '7c', bg: 'dark' }, 'm7c-bg-dark', '① 배경 어둡게'],
    ['reader-image', { m: '7c', bg: 'checker' }, 'm7c-bg-checker', '① 배경 체크무늬'],
    ['reader-image', { m: '7c', img: 'transparent', bg: 'checker' }, 'm7c-transparent', '① 투명 PNG · 체크무늬 8px'],
    ['reader-image', { m: '7c', img: 'diagram' }, 'm7c-diagram', '① 흰 바탕 그림 · 테두리와 그림자 없음'],
    ['reader-image', { m: '7c', img: 'small' }, 'm7c-small', '② 작은 이미지 · 창에 맞춤 100%(키우지 않음)'],
    ['reader-image', { m: '7c', zoom: 'width' }, 'm7c-width', '② 너비에 맞춤 · 세로 스크롤'],
    ['reader-image', { m: '7c', zoom: '400' }, 'm7c-400', '② 400% · 끌기 커서 grab'],
    ['reader-image', { m: '7c', menu: 'zoom' }, 'm7c-menu-zoom', '② 확대 ▾'],
    ['reader-image', { m: '7c', menu: 'view' }, 'm7c-menu-view', '② 보기 ▾ · 배경 묶음(밝게 · 어둡게 · 체크무늬) · 회전'],
    ['reader-image', { m: '7c', rotate: '90' }, 'm7c-rotate', '③ 90° 회전'],
    ['reader-image', { m: '7c', state: 'loading' }, 'm7c-loading', '③ 여는 중'],
    ['reader-image', { m: '7c', state: 'error' }, 'm7c-error', '③ 그릴 수 없음'],
    ['reader-image', { m: '7c', state: 'missing' }, 'm7c-missing', '③ 원본 없음'],
    ['reader-image', { m: '7c', state: 'trashed' }, 'm7c-trashed', '③ 휴지통'],
    ['reader-image', { m: '7c', w: '1024' }, 'm7c-w1024', '③ 창 1024×768'],
    ['reader-image', { m: '7c', sidebar: 'nopages' }, 'm7c-sidebar-nopages', '⑦ 사이드바 · 쪽 없음 안내'],
    ['library', { m: '7c' }, 'm7c-library', '라이브러리 · 이미지 행 · 검색 범위 단추'],
    ['library', { m: '7c', search: 'scope-states' }, 'm7c-scope-states', '④ 검색 범위 단추 · 기본 호버 눌림 포커스'],
    ['library', { m: '7c', search: 'scope-menu' }, 'm7c-scope-menu', '④ 검색 범위 메뉴'],
    ['library', { m: '7c', search: 'scope-menu', indexing: '1' }, 'm7c-scope-menu-indexing', '④ 검색 범위 메뉴 · 본문 색인 37 / 120'],
    ['library', { m: '7c', scope: 'fulltext', q: '형광' }, 'm7c-fulltext', '④ 정보와 본문 · 표(본문만 일치한 행 표시 없음)'],
    ['library', { m: '7c', matches: '3' }, 'm7c-matches-3', '⑤ 본문 일치 · 3쪽'],
    ['library', { m: '7c', matches: 'many' }, 'm7c-matches-many', '⑤ 본문 일치 · 34쪽 중 20행'],
    ['library', { m: '7c', matches: 'many', scroll: 'end' }, 'm7c-matches-many-end', '⑤ 본문 일치 · 외 14쪽(끝까지 스크롤)'],
    ['library', { m: '7c', matches: 'loading' }, 'm7c-matches-loading', '⑤ 본문 일치 · 찾는 중'],
    ['library', { m: '7c', matches: 'indexing' }, 'm7c-matches-indexing', '⑤ 본문 일치 · 색인 중'],
    ['library', { m: '7c', matches: 'empty' }, 'm7c-matches-empty', '⑤ 본문 일치 · 글자 없음'],
    ['library', { m: '7c', matches: 'locked' }, 'm7c-matches-locked', '⑤ 본문 일치 · 암호'],
    ['library', { m: '7c', matches: 'truncated' }, 'm7c-matches-truncated', '⑤ 본문 일치 · 잘린 색인(행 아래 줄)'],
    ['library', { m: '7c', matches: 'truncated-none' }, 'm7c-matches-truncated-none', '⑤ 본문 일치 · 잘린 색인(그 줄만)'],
    ['library', { m: '7c', panel: 'image' }, 'm7c-panel-image', '⑥ 이미지 항목 패널 · 미리보기'],
    ['library', { m: '7c', panel: 'image-large' }, 'm7c-panel-image-large', '⑥ 이미지 항목 패널 · 5,000만 화소 넘음(아이콘 칸)'],
    ['library', { m: '7c', panel: 'pdf-indexing' }, 'm7c-panel-pdf-indexing', '⑥ PDF 항목 패널 · 파일 절의 본문 검색 줄'],
    ['library', { m: '7c', panel: 'pdf-failed' }, 'm7c-panel-pdf-failed', '⑥ PDF 항목 패널 · 본문 검색 줄 · 실패(가장 긴 문구)'],
    ['library', { m: '7c', state: 'noresults', scope: 'fulltext' }, 'm7c-noresults-fulltext', '⑥ 결과 없음 · …·PDF 본문(본문을 찾음)'],
    ['library', { m: '7c', state: 'noresults', scope: 'fulltext', onechar: '1' }, 'm7c-noresults-onechar', '⑥ 결과 없음 · 한 글자(본문은 찾지 않음)'],
    ['library', { m: '7c', state: 'noresults', scope: 'fulltext', indexing: '1' }, 'm7c-noresults-indexing', '⑥ 결과 없음 · PDF 본문 · 색인 중'],
    ['library-empty', { m: '7c' }, 'm7c-formats', '⑧ 첫 실행 · 지원 형식 줄(이미지)'],
    ['library-empty', { m: '7c', w: '1024' }, 'm7c-formats-w1024', '⑧ 첫 실행 · 창 1024에서도 지원 형식 한 줄'],
    ['library-empty', { m: '7c', state: 'drop' }, 'm7c-drop', '⑧ 드롭 오버레이 · 파일 3개(PDF 1 · 이미지 2)'],
  ].flatMap(([screen, query, suffix, label]) => THEMES.map((t) => ({ ...variant(screen, t, 'B', query, suffix, label), group: /** @type {const} */ ('m7c') }))),
];

/**
 * Tutor mockup (T1, docs/superpowers/specs/2026-10-26-tutor-mockup-design.md): the ten states of §2
 * in both themes (layout B only — the owner's layout), the sub-states, each §4 decision variant once,
 * the one library-view sheet, the fake-backend marker, milestone badges and the components board part 4.
 * @type {Render[]}
 */
const TUTOR_STATES = [
  [1, 'mode', '모드 전환'],
  [2, 'consent', '첫 사용 동의(패널 카드)'],
  [3, 'agents', '에이전트 고르기'],
  [4, 'empty', '빈 세션'],
  [5, 'conversation', '대화 · 스트리밍(폭 380)'],
  [6, 'citation', '인용 · 출처 없음'],
  [7, 'proposals', '제안 카드'],
  [8, 'failure', '실패 · 오프라인'],
  [9, 'sessions', '세션 목록(사이드바)'],
  [10, 'narrow', '좁은 창(1040) · 접힘'],
];
const inTutor = (r) => ({ ...r, group: /** @type {const} */ ('tutor') });
const tutor = (theme, query, suffix, label) => inTutor(variant('tutor', theme, 'B', query, suffix, `튜터 ${label}`));
export const TUTOR = [
  ...TUTOR_STATES.flatMap(([n, suffix, label]) => THEMES.map((t) => tutor(t, { state: String(n) }, `${n}-${suffix}`, `${n} ${label}`))),
  // Sub-states, both themes.
  ...[
    [{ state: '1', mode: 'info' }, '1-mode-info', '1 정보 모드(리더, 320)'],
    [{ state: '1', mode: 'info', view: 'library' }, '1-mode-info-library', '1 정보 모드(라이브러리)'],
    [{ state: '2', later: '1' }, '2-consent-later', '2 동의 카드 · 나중에 뒤'],
    [{ state: '3', agents: 'none' }, '3-agents-none', '3 에이전트 없음'],
    [{ state: '3', agents: 'searching' }, '3-agents-searching', '3 에이전트 찾는 중'],
    [{ state: '3', agents: 'blocked' }, '3-agents-blocked', '3 준비된 에이전트 없음'],
    [{ state: '5', menu: 'agent' }, 'menu-agent', '에이전트 메뉴'],
    [{ state: '8', fail: 'agent' }, '8-failure-agent', '8 실패 · 에이전트 중단'],
    [{ state: '8', fail: 'login' }, '8-failure-login', '8 실패 · 로그인 만료'],
    [{ state: '9', empty: '1' }, '9-sessions-empty', '9 세션 없음'],
    [{ state: '9', sheet: 'delete' }, '9-delete', '9 세션 삭제 시트'],
    [{ state: '10', fold: 'open' }, '10-narrow-open', '10 좁은 창(1040) · 펼침'],
    [{ state: '10', fold: '960' }, '10-narrow-960', '10 최소 창(960) · 펼침'],
    [{ state: '5', backend: 'fake' }, '5-backend-fake', '가짜 백엔드 표시'],
  ].flatMap(([q, suffix, label]) => THEMES.map((t) => tutor(t, q, suffix, label))),
  // §4 decisions: each alternative once (the defaults are the base state renders above).
  tutor('light', { state: '5', width: '320' }, '5-width-320', '결정 · 폭 320(최소)'),
  tutor('light', { state: '5', width: '340' }, '5-width-340', '결정 · 폭 340'),
  tutor('light', { state: '5', width: '440' }, '5-width-440', '결정 · 폭 440'),
  tutor('light', { state: '5', msg: 'doc' }, '5-msg-doc', '결정 · 문서식(대안)'),
  tutor('light', { state: '5', msg: 'doc', scroll: 'top' }, '5-msg-doc-top', '결정 · 문서식(처음부터)'),
  tutor('light', { state: '6', cite: 'p' }, '6-cite-p', '결정 · 인용 p. 42'),
  tutor('light', { state: '6', cite: 'icon' }, '6-cite-icon', '결정 · 인용 아이콘 + 숫자'),
  tutor('light', { state: '2', consent: 'sheet' }, '2-consent-sheet', '결정 · 동의 시트'),
  tutor('light', { state: '9', sessions: 'panel' }, '9-sessions-panel', '결정 · 세션 목록 패널'),
  tutor('light', { view: 'library' }, 'library', '라이브러리 보기의 튜터'),
  tutor('dark', { state: '4', page: 'original' }, '4-empty-original-page', '4 붙은 구간 · 다크 앱 + 원본 쪽'),
  tutor('light', { state: '5', ms: '1' }, '5-milestones', '마일스톤 표시 · 대화'),
  tutor('light', { state: '7', ms: '1' }, '7-milestones', '마일스톤 표시 · 제안 카드'),
  ...THEMES.flatMap((t) => [
    inTutor(variant('components', t, 'A', { part: '4' }, 'part4', '컴포넌트 상태 3 — 튜터')),
    inTutor(variant('components', t, 'A', { part: '5' }, 'part5', '컴포넌트 상태 4 — 튜터 목록 · 선택')),
  ]),
];

export const ALL = [...BASE, ...VARIANTS, ...TUTOR];
