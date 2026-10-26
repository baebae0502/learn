// Which mockup renders exist. Shared by scripts/render-mockups.mjs (Linux, xvfb) and
// tests/evidence/mockups.evidence.ts (macOS runner, real SF fonts).

/** @typedef {{ name: string, page: string, query: Record<string, string>, group: 'base' | 'variant' | 'tutor', label: string }} Render */

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
  ...['recovery', 'backup', 'codec'].flatMap((scene) => [
    variant('dialogs', 'light', 'A', { scene }, scene, `대화상자 ${scene}`),
    variant('dialogs', 'dark', 'B', { scene }, scene, `대화상자 ${scene}`),
  ]),
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
  tutor('light', { state: '5', width: '340' }, '5-width-340', '결정 · 폭 340'),
  tutor('light', { state: '5', width: '440' }, '5-width-440', '결정 · 폭 440'),
  tutor('light', { state: '5', msg: 'bubble' }, '5-msg-bubble', '결정 · 메시지 말풍선'),
  tutor('light', { state: '5', scroll: 'top' }, '5-msg-doc-top', '결정 · 문서식(처음부터)'),
  tutor('light', { state: '5', msg: 'bubble', scroll: 'top' }, '5-msg-bubble-top', '결정 · 말풍선(처음부터)'),
  tutor('light', { state: '6', cite: 'p' }, '6-cite-p', '결정 · 인용 p. 42'),
  tutor('light', { state: '6', cite: 'icon' }, '6-cite-icon', '결정 · 인용 아이콘 + 숫자'),
  tutor('light', { state: '2', consent: 'sheet' }, '2-consent-sheet', '결정 · 동의 시트'),
  tutor('light', { state: '9', sessions: 'panel' }, '9-sessions-panel', '결정 · 세션 목록 패널'),
  tutor('light', { view: 'library' }, 'library', '라이브러리 보기의 튜터'),
  tutor('light', { state: '5', ms: '1' }, '5-milestones', '마일스톤 표시 · 대화'),
  tutor('light', { state: '7', ms: '1' }, '7-milestones', '마일스톤 표시 · 제안 카드'),
  ...THEMES.flatMap((t) => [
    inTutor(variant('components', t, 'A', { part: '4' }, 'part4', '컴포넌트 상태 3 — 튜터')),
    inTutor(variant('components', t, 'A', { part: '5' }, 'part5', '컴포넌트 상태 4 — 튜터 목록 · 선택')),
  ]),
];

export const ALL = [...BASE, ...VARIANTS, ...TUTOR];
