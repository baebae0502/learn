# ADR-0004: UI 스택 — react-aria-components, lucide, CSS `@layer`

- 상태: **채택**(2026-10-21, M3) · 제안 2026-10-21, M1 목업 승인과 함께 채택, M3에서 적용 · 관련: `docs/design/design-spec.md`, AC18(접근성), ADR-0005

## 맥락
M1 목업은 가상화된 정렬 표, 중첩 트리, 탭, 메뉴·팝오버·시트, 명령 팔레트, Finder 드래그 앤 드롭, 키보드 우선 조작을 요구한다(Zotero 7 수준). 현재 렌더러는 손으로 짠 React 560줄이고 접근성 시맨틱·포커스 관리·가상화가 없다. 런타임 의존성은 MIT/ISC/Apache/OFL만 쓰고, 버전은 정확히 고정한다.

## 결정
| 영역 | 선택(고정 버전, M3) | 라이선스 |
|---|---|---|
| 대화형 컴포넌트 | **react-aria-components** 1.22.1: `Table`·`Tree`·`GridList` + `Virtualizer`, 네이티브 DnD(`useDragAndDrop`, 파일 드롭), `Menu`·`Popover`·`Dialog`·`Modal`·`Sheet`·`Toast`, `DropZone`, `Tabs`, `SearchField`, `ToggleButton`, `Autocomplete`(팔레트), `I18nProvider locale="ko-KR"` | Apache-2.0 |
| 아이콘 | **lucide-react** 1.60.0(목업과 같은 세트, 16px / stroke 1.5) | ISC |
| 패널 | **react-resizable-panels** 4.14.8(크기 조절, 접힘, 지속 저장 콜백) | MIT |
| 데이터 | **@tanstack/react-query** 5.104.5(IPC 조회 캐시, main 푸시 이벤트로 무효화) | MIT |
| UI 상태 | **zustand** 5.0.15(탭, 패널, 선택, 팔레트) | MIT |
| 스타일 | 일반 CSS + `@layer reset, tokens, base, components, screens, utilities`. 토큰은 생성된 `tokens.css`. 한국어 줄바꿈 규칙은 `base`. | — |
| 글꼴 | macOS는 시스템 글꼴(SF Pro + Apple SD Gothic Neo, 소유자 확정 2026-10-21), Linux/Windows는 번들 Pretendard Variable | OFL-1.1 |
| 한글 초성 검색 | 작은 자체 함수(NFD 분해) 우선, 부족하면 es-hangul 2.x | (MIT) |
| 접근성 검사(개발 전용) | @axe-core/playwright 4.14.0 | MPL-2.0(개발 도구, 배포물에 포함 안 됨) |

- 모든 패키지는 `package.json`에 정확한 버전으로 고정하고(`^`·`~` 금지) 이 표와 README에 라이선스를 기록한다.
- 화면 코드는 RAC의 렌더 프롭(`isSelected`, `isFocusVisible`, `isPressed`, `isDropTarget` …)을 데이터 속성으로 받아 CSS가 상태를 그린다. 목업의 `.is-*` 클래스가 그대로 `[data-selected]`, `[data-focus-visible]`로 옮겨진다.
- **M4 표**: 2026-10-24 스파이크로 정했다 — 아래 "M4 표" 절. 트리·메뉴·대화상자·팔레트의 RAC 사용은 그대로다.

## 미채택과 이유
- **Base UI**(MIT, 1.x): 원시 컴포넌트 품질은 좋지만 가상화된 표·트리, 표의 키보드 탐색·다중 선택·DnD가 없다. 그리드 시맨틱을 직접 만들어야 해 Zotero 수준까지 비용이 크다.
- **Radix UI**: 표·트리가 없고, 메뉴·대화상자만으로는 핵심 화면(표·트리)이 해결되지 않는다. 여러 라이브러리를 섞으면 포커스 관리가 이중이 된다.
- **cmdk**: 팔레트 전용. RAC `Autocomplete` + `ListBox`가 같은 일을 하고 포커스·IME 처리를 RAC 한 곳에 모은다.
  - **M3 편차(Task 9)**: 팔레트의 목록은 RAC `Autocomplete`·`Menu`가 아니라 자체 WAI-ARIA 콤보박스(`input role="combobox"`, `aria-activedescendant`) + 리스트박스(`role="listbox"`/`option`)다. RAC는 `Modal`·`Dialog`(포커스 가두기, esc, 스크림 닫기)만 맡는다. 이유: react-aria 3.53.1의 `useAutocomplete`가 지우기·붙여넣기·실행 취소 입력에서 가상 포커스를 지우고(`clearVirtualFocus`) 열 때도 커서를 두지 않아, "목록에 행이 있으면 언제나 커서 행이 있고 ↩가 그것을 실행한다"(디자인 비평 T9-M1)를 지킬 수 없었다. 커서·↑↓·↩·IME 가드는 `palette/Palette.tsx`가 직접 처리하고 E2E(`palette.spec.ts`, `ime.spec.ts`)가 검사한다. VoiceOver로 읽히는지는 Mac 실기 수동 확인으로 남는다.
- **dnd-kit**: 포인터 이벤트 기반이라 Finder ↔ 창 파일 드래그(OS 네이티브 DnD)를 처리하지 못한다. RAC는 HTML5 네이티브 DnD 위에서 키보드 DnD까지 제공한다.
- **Tailwind**: 토큰이 이미 CSS 변수다. 유틸리티 클래스는 상태 스타일(선택·포커스·다크)을 마크업에 흩어 놓고, 한국어 타이포 규칙과 컴포넌트 단위 시각 비평을 어렵게 한다.
- **MUI·Chakra 등 디자인 시스템 포함 라이브러리**: 웹 대시보드 외형이 기본값이라 Mac 네이티브 목표와 맞지 않고 덮어쓰기 비용이 크다.

## 근거
- RAC는 표·트리·메뉴·대화상자·DnD·국제화를 한 접근성 모델(ARIA 그리드/트리, 포커스 링 `focus-visible`, 화면 낭독기 알림)로 제공한다. AC18(키보드 전용 여정, VoiceOver)을 직접 구현하지 않고 얻는다.
- 스타일이 없는(headless) 라이브러리라 목업의 토큰·CSS를 그대로 쓸 수 있다.
- 가상화를 표·트리·목록에 같은 방식으로 적용해 1만 항목 성능 예산(첫 그리기 ≤ 500ms, 검색 입력→그리기 p95 ≤ 50ms)을 맞춘다.

## 결과와 위험
- 번들 크기가 늘어난다(RAC는 트리 셰이킹 가능, 쓰는 컴포넌트만 포함). **M3 측정**(Linux 빌드, `tests/evidence/perf.evidence.ts` → `perf.json` `bundleBytes`, 2026-10-22): 렌더러 JS 2,596,153 B(메인 창 코드는 별도 청크라 시트·설정 창은 읽지 않는다), PDF.js 워커 1,264,342 B, CSS 82,838 B, 글꼴 2,057,688 B(Pretendard Variable woff2, Linux·Windows용). 냉시작 예산(1.5초)은 기준 장비에서 판정하고, Linux CI 한도는 3초다.
- **RAC Toast는 `UNSTABLE_` API다**(1.22.1: `UNSTABLE_Toast`·`UNSTABLE_ToastContent`·`UNSTABLE_ToastQueue`·`UNSTABLE_ToastRegion`). 버전을 정확히 고정하고 `ui/toasts.tsx` 한 곳에서만 쓴다. RAC를 올릴 때는 그 파일과 토스트 E2E만 다시 보면 된다. 1.22.1은 `ToastRegion`을 랜드마크로 등록하지 않아 그 F6 처리가 돌지 않는다. F6은 창 캡처 단계의 렌더러 키맵이 맡고, 업그레이드 때 토스트가 떠 있는 상태의 F6(처리기 하나, 이동 한 번)을 다시 확인한다.
- **axe는 두 규칙만 끈다**(`tests/e2e/a11y.ts`). `color-contrast`: 대비는 `tokens.test.ts`가 두 테마와 고대비에서 맡고, 3차 글자는 명세 3.1·8.3에 따라 3:1이 의도이며, axe는 비브런시 재질 위 글자의 대비를 계산할 수 없다. `video-caption`: 자막은 M8에 온다. 나머지 규칙은 `<video>`를 포함해 모두 돈다.
- RAC `Virtualizer`의 열 크기 조절·고정 머리 조합은 M4 스파이크에서 쟀다("M4 표"의 `resize`·`scroll`).
- IME: RAC 입력 컴포넌트의 조합 중 키 처리(Enter·화살표)를 M3 `ime` E2E(CDP `Input.imeSetComposition`)로 검증한다. 팔레트는 자체 콤보박스라(위 M3 편차) 조합 중 키(`isComposing`, keyCode 229)를 캡처 단계에서 직접 막고, 같은 E2E가 가드 없이는 실패함을 확인했다.
- 재검토 조건: 스파이크 실패가 표 밖(트리·DnD)까지 번지거나, RAC 주요 버전이 비호환 변경을 낼 때.

## M4 표 (2026-10-24, M4 Task 1 스파이크)

- 결정: **`@tanstack/react-virtual` 3.14.22(MIT, `@tanstack/virtual-core` 3.19.7) + 자체 `role="grid"`**. 명세 3.3의 선택·키보드는 Task 3이 직접 만든다(명세 3.4). 트리·메뉴·대화상자·팔레트는 RAC 그대로다.
- 규칙(측정 전에 정함, 명세 3.4): 3.3의 동작 전부와 9절 예산 가운데 표가 정하는 몫을 Linux·Mac 모두에서 지키면 RAC, 하나라도 못 지키면 TanStack. 공개 API로 감싸서 되는 동작은 통과로 셌다(`how: workaround`). 시간 한도는 Mac이 예산, Linux가 2배(CI 실패선). 정렬은 렌더 몫(클릭 → 그려짐 − 콜레이터 정렬)으로 판정했다.
- 근거: 스파이크 브랜치 `m4-spike` 13e44c3(병합하지 않음) — `apps/desktop/src/renderer/src/spike/`, `tests/evidence/{spike-measure.ts,table-spike.evidence.ts,table-spike-tanstack.evidence.ts}`. 합성 1만 행(시드 고정: 한국어·영어 제목, 저자 0–4명, 연도 없는 행, 외부 연결 20 %, 파일 없음 3 %). Linux = 개발 서버 Xvfb(창 1439×899, 소프트웨어 합성), Mac = run [40034565009](https://github.com/baebae0502/learn/actions/runs/40034565009)(macos-15 arm64 가상 머신, 창 1024×684, 코어 3).

### 측정

| 확인 | 기준(Mac / Linux) | RAC Linux | RAC Mac | TanStack Linux | TanStack Mac |
|---|---|---|---|---|---|
| 첫 행 그리기, 중앙값 3회 | ≤ 500 / 1000 | 698.1 | 445.6 | 28.6 | 32.4 |
| 스크롤 3행/프레임 p95 (가만히 p95) | ≤ 16.7 / 33.4 (Mac은 가만히 p95 + 1) | 33.4 (16.7) | 19.3 (33.3) | 16.7 (16.7) | 18.7 (33.3) |
| 스크롤 중 빈 프레임 / 240 | ≤ 2 % | 0 | 0 | 0 | 0 |
| 정렬 렌더 몫 중앙값 (전체, 콜레이터) | ≤ 100 / 200 | 689.1 (694.8, 5.7) | 499 (502.1, 3.1) | 26 (36, 12.7) | 41.9 (43.4, 3.3) |
| 거르기 → 그려짐 p95 | ≤ 50 / 100 | 488.7 | 337.6 | 29.8 | 27.1 |
| 한 행만 바뀐 새로 고침: 셀 렌더 (ms) | 1–5 | 5 (168.6) | 5 (82.5) | 5 (22.7) | 5 (22.8) |
| 클릭 선택 → 그려짐 중앙값, ⌘A | ≤ 100 / 200 | 206, 162.7 | 106.8, 76.1 | — | — |
| End → 마지막 행 보임 | ≤ 100 / 200 | 449.6 | error | — | — |
| 열 크기 조절: 끄는 동안 프레임 p95 | ≤ 16.7 / 33.4 (Mac은 가만히 p95 + 1) | 50 | 33.8 | — | — |
| 동작(선택·오른쪽 클릭·키보드·열기·type-ahead·밀도·줄무늬) | 명세 3.3 | 선택 native(떨어짐), 오른쪽 클릭 workaround, 키보드 workaround(떨어짐), 열기 native, type-ahead workaround, 밀도 native, 줄무늬 workaround | 선택 native(떨어짐), 오른쪽 클릭 workaround, 키보드 error, 열기 native, type-ahead workaround, 밀도 native, 줄무늬 workaround | — | — |
| 실제 ⌘A(System Events) | 1만 행, 글자 선택 0 | skipped | native: 10000 선택, 글자 선택 0 | — | — |

판정: RAC Linux 떨어짐 resize·sort·select·keyboard·filter, RAC Mac 떨어짐 sort·select·keyboard·filter(keyboard는 `error` — Mac의 하네스·페이지 결함이며, 정렬·선택·거르기가 이미 떨어져 다시 재지 않았다), TanStack Linux 모두 통과, TanStack Mac 모두 통과. 재시도: 판정을 바꾼 재시도는 없었다 — 두 번째 스파이크 커밋 13e44c3은 시간 항목마다 우리 코드의 몫(우리 코드가 다시 만든 행 요소 수, 셀 렌더 수)만 기록하게 했고, 모든 시간 항목에서 우리 코드가 다시 만든 행 요소는 0이라 시간은 RAC·react-stately 안의 것이다.

### Task 3에 넘기는 것

- F6 착지점(P-31): 격자(`role="grid"`)가 스크롤 요소이고 `tabindex="0"`이며 행에는 없다(스파이크 페이지 `TanstackSpike.tsx`의 구조; RAC 쪽 측정 `focusTarget`도 같다) — `R/shell/panes.ts`의 포커스 대상은 이것이다.
- 정렬 계산: 1만 행 콜레이터 정렬 12.7ms(Linux) / 3.3ms(Mac) — `R/library/sort.ts`는 정렬 열마다 다시 계산해도 예산 안이다.
- 대안 페이지(`TanstackSpike.tsx`)가 Task 3의 출발점이다: `useVirtualizer({ count, getScrollElement, estimateSize: () => rowHeight, overscan: 8, getItemKey })`, 머리는 붙인 줄, 행은 `translateY`, `aria-rowindex`는 머리 줄을 1로 센다. 명세 3.3의 선택(⇧·⌘·⌘A·오른쪽 클릭·화살표·Home/End·↩)과 열 크기 조절은 직접 만든다.

### 위험 갱신

- 선택·키보드·접근성을 직접 만드는 비용(0절 "버린 안"의 이유)이 생긴다: Task 3의 E2E가 3.3 전부를 덮고, Task 13의 axe·키보드 여정이 확인한다.
