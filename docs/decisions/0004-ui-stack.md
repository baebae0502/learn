# ADR-0004: UI 스택 — react-aria-components, lucide, CSS `@layer`

- 상태: **채택**(2026-10-21, M3) · 제안 2026-10-21, M1 목업 승인과 함께 채택, M3에서 적용 · M4: 표 구현의 측정과 결정은 아래 "M4 표" · M5: 끌어 놓기의 측정과 결정은 아래 "M5 끌어 놓기" · 관련: `docs/design/design-spec.md`, AC18(접근성), ADR-0005

## 맥락
M1 목업은 가상화된 정렬 표, 중첩 트리, 탭, 메뉴·팝오버·시트, 명령 팔레트, Finder 드래그 앤 드롭, 키보드 우선 조작을 요구한다(Zotero 7 수준). 현재 렌더러는 손으로 짠 React 560줄이고 접근성 시맨틱·포커스 관리·가상화가 없다. 런타임 의존성은 MIT/ISC/Apache/OFL만 쓰고, 버전은 정확히 고정한다.

## 결정
| 영역 | 선택(고정 버전, M3) | 라이선스 |
|---|---|---|
| 대화형 컴포넌트 | **react-aria-components** 1.22.1: `Table`·`Tree`·`GridList` + `Virtualizer`, 네이티브 DnD(`useDragAndDrop`, 파일 드롭), `Menu`·`Popover`·`Dialog`·`Modal`·`Sheet`·`Toast`, `DropZone`, `Tabs`, `SearchField`, `ToggleButton`, `Autocomplete`(팔레트), `I18nProvider locale="ko-KR"` | Apache-2.0 |
| 가상 표(M4) | **@tanstack/react-virtual** 3.14.22(RAC `Table`은 스파이크의 "M4 표" 절 기준을 넘지 못해 표만 자체 `role="grid"`로 만들었다. 선택·열 크기·롤링 포커스는 우리 코드, RAC는 표 밖 전부) | MIT |
| 사이드바 트리와 끌어 놓기(M5) | **react-aria-components** 1.22.1의 `Tree`를 `Virtualizer`(`ListLayout`) 안에 두고, 행·칩의 끌기는 `useDrag`·`useDrop`(`hasDragButton: true`)을 쓴다. 새 의존성 없음. 키 처리·이름 칸은 트리 위의 우리 캡처 처리기가 맡는다 | Apache-2.0 |
| 아이콘 | **lucide-react** 1.60.0(목업과 같은 세트, 16px / stroke 1.5) | ISC |
| 패널 | **react-resizable-panels** 4.14.8(크기 조절, 접힘, 지속 저장 콜백) | MIT |
| 데이터 | **@tanstack/react-query** 5.104.5(IPC 조회 캐시, main 푸시 이벤트로 무효화) | MIT |
| UI 상태 | **zustand** 5.0.15(탭, 패널, 선택, 팔레트) | MIT |
| 스타일 | 일반 CSS + `@layer reset, tokens, base, components, screens, utilities`. 토큰은 생성된 `tokens.css`. 한국어 줄바꿈 규칙은 `base`. | — |
| 글꼴 | macOS는 시스템 글꼴(SF Pro + Apple SD Gothic Neo, 소유자 확정 2026-10-21), Linux/Windows는 번들 Pretendard Variable | OFL-1.1 |
| 한글 초성 검색 | 자체 함수 `palette/hangul.ts`(`matchKorean`) — 팔레트(M3)와 라이브러리 빠른 검색(M4)이 같이 쓴다. es-hangul은 들이지 않았다 | — |
| 접근성 검사(개발 전용) | @axe-core/playwright 4.14.0 | MPL-2.0(개발 도구, 배포물에 포함 안 됨) |

- 모든 패키지는 `package.json`에 정확한 버전으로 고정하고(`^`·`~` 금지) 이 표와 README에 라이선스를 기록한다.
- 화면 코드는 RAC의 렌더 프롭(`isSelected`, `isFocusVisible`, `isPressed`, `isDropTarget` …)을 데이터 속성으로 받아 CSS가 상태를 그린다. 목업의 `.is-*` 클래스가 그대로 `[data-selected]`, `[data-focus-visible]`로 옮겨진다.
- **M4 표**: 2026-10-24 스파이크로 정했다 — 아래 "M4 표" 절. 트리·메뉴·대화상자·팔레트의 RAC 사용은 그대로다.
- **M5 끌어 놓기**: 2026-10-26 스파이크로 정했다 — 아래 "M5 끌어 놓기". 표는 그대로 자체 `role="grid"`이고 행 끌기만 RAC `useDrag`를 얹는다.

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
- 번들 크기가 늘어난다(RAC는 트리 셰이킹 가능, 쓰는 컴포넌트만 포함). **M3 측정**(Linux 빌드, `tests/evidence/perf.evidence.ts` → `perf.json` `bundleBytes`, 2026-10-22): 렌더러 JS 2,596,153 B(메인 창 코드는 별도 청크라 시트·설정 창은 읽지 않는다), PDF.js 워커 1,264,342 B, CSS 82,838 B, 글꼴 2,057,688 B(Pretendard Variable woff2, Linux·Windows용). 냉시작 예산(1.5초)은 기준 장비에서 판정하고, Linux CI 한도는 3초다. **M4 측정**(Linux 로컬 증거 실행, `perf.json` `bundleBytes`): 렌더러 JS 2,858,393 B(M3 대비 +262,240 B), CSS 104,083 B, PDF.js 워커 1,264,342 B, 글꼴 그대로. Linux CI run id는 푸시 뒤에 채운다(미정). **M5 측정**(macOS run 40708161452의 패키지 빌드, `perf.json` `bundleBytes` — 이 문서의 입력에 Linux CI의 `perf.json`이 없어 Mac 빌드의 값이다): 렌더러 JS 3,501,127 B(M4 대비 +642,734 B), CSS 133,722 B, PDF.js 워커 1,264,342 B, 글꼴 그대로(2,057,688 B).
- **RAC Toast는 `UNSTABLE_` API다**(1.22.1: `UNSTABLE_Toast`·`UNSTABLE_ToastContent`·`UNSTABLE_ToastQueue`·`UNSTABLE_ToastRegion`). 버전을 정확히 고정하고 `ui/toasts.tsx` 한 곳에서만 쓴다. RAC를 올릴 때는 그 파일과 토스트 E2E만 다시 보면 된다. 1.22.1은 `ToastRegion`을 랜드마크로 등록하지 않아 그 F6 처리가 돌지 않는다. F6은 창 캡처 단계의 렌더러 키맵이 맡고, 업그레이드 때 토스트가 떠 있는 상태의 F6(처리기 하나, 이동 한 번)을 다시 확인한다.
- **axe는 두 규칙만 끈다**(`tests/e2e/a11y.ts`). `color-contrast`: 대비는 `tokens.test.ts`가 두 테마와 고대비에서 맡고, 3차 글자는 명세 3.1·8.3에 따라 3:1이 의도이며, axe는 비브런시 재질 위 글자의 대비를 계산할 수 없다. `video-caption`: 자막은 M8에 온다. 나머지 규칙은 `<video>`를 포함해 모두 돈다.
- RAC `Virtualizer`의 열 크기 조절·고정 머리 조합은 M4 스파이크에서 쟀다("M4 표"의 `resize`·`scroll`).
- **M4 측정**(1만 항목, `tests/evidence/perf.evidence.ts` → `library-perf.json`, 5회 이상의 중앙값·p95): 목록 IPC 269/90 ms(예산 150), 첫 표 그리기 98/39 ms(500), 검색 입력 → 그리기 p95 54/30 ms(50), 메타데이터 검색 p95 5.9/2.7 ms(300, AC16), 스크롤 프레임 간격 p95 16.7/18.7 ms(16.7), 정렬 열 바꾸기 48/21 ms(100), 인스펙터 선택 → 정보 26/18 ms(100) — 앞이 Linux(xvfb, Task 10의 `@perf`), 뒤가 Mac VM(run 40134381407, 참고값). Linux는 예산의 2배에서 실패하는데 목록 IPC는 269로 한도 300에 얇게 걸쳐 있다. Mac 러너의 스크롤 p95 18.7은 예산 16.7을 넘지만 그 러너는 가만히 있어도 p95가 약 33ms라 60Hz를 못 지킨다(참고값). 표 구현의 결정은 "M4 표" 절. **Linux CI run id는 푸시 뒤 컨트롤러가 채운다(미정).**
- IME: RAC 입력 컴포넌트의 조합 중 키 처리(Enter·화살표)를 M3 `ime` E2E(CDP `Input.imeSetComposition`)로 검증한다. 팔레트는 자체 콤보박스라(위 M3 편차) 조합 중 키(`isComposing`, keyCode 229)를 캡처 단계에서 직접 막고, 같은 E2E가 가드 없이는 실패함을 확인했다.
- **M5 측정**(1만 항목 + 컬렉션 200·태그 50·소속 3만·붙임 2만·중복 50묶음, `tests/evidence/organize-perf.evidence.ts` → `organize-perf.json`, 5회 이상의 중앙값·p95): `library:organize` 88/38 ms(예산 50), 보기 전환 → 첫 행 115/76(100), 태그 필터 → 그리기 87/54(100), `1` 키 → 점 하나 109/68(100) · 1만 개 349/241(300), 100행 드롭 → 개수 157/121(200), 컨텍스트 메뉴(1만 선택, `popup`까지) 192/190(150); `library-perf.json`: 목록 IPC 288/165(M4 기록 269, 실패선 300), 검색 입력 → 그리기 p95 77–96/55(50), 팔레트 입력 p95 22/12(50) — 앞이 Linux(xvfb, Task 11의 로컬 `@perf`, 부하 9–11), 뒤가 Mac VM(run 40708161452, `all`, 참고값). Linux CI는 예산의 2배에서 실패하고, run 40705189430(9872d2f)이 그 선 안에서 녹색이다 — CI 실행의 값은 이 문서의 입력에 없어 적지 않는다. 같은 코드의 조용한 Mac `perf` 실행(run 40653779499, d649d9e)은 모든 줄이 예산 안이다: `library:organize` 38, 보기 전환 46, 태그 필터 43, `1` 키 69 · 1만 개 135, 드롭 59, 컨텍스트 메뉴 97. **예산을 넘은 줄**: Linux 로컬은 `library:organize`·보기 전환·`1` 키(하나)·`1` 키(1만)·컨텍스트 메뉴·검색 입력 p95(모두 2배 선 아래이나 `library:organize`와 검색 입력은 100 가까이), Mac `all`은 컨텍스트 메뉴 190(150)과 검색 입력 p95 55(50). 고치지 않은 구조: `1` 키가 정리 모델을 다시 만들고, 태그가 바뀌면 1만 항목 검색 색인을 유휴 콜백에서 다시 만든다(61ms), `library:organize` 페이로드는 2,001,990 B다(M6 입력).
- 재검토 조건: 스파이크 실패가 표 밖(트리·DnD)까지 번지거나, RAC 주요 버전이 비호환 변경을 낼 때. RAC를 올릴 때는 "M5 끌어 놓기"의 우회(아래 "RAC를 올릴 때")를 가진 E2E를 다시 본다.

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

- F6 착지점(P-31): 격자(`role="grid"`)는 스크롤 요소이며 `tabindex="-1"`이고, 커서가 있는 행만 `tabindex="0"`이다(roving tabindex). F6은 그 행에 내리므로 `R/shell/panes.ts`의 포커스 대상은 커서 행이다. 스파이크 페이지(`TanstackSpike.tsx`)의 격자 `tabIndex={0}`은 측정용 지름길이었고 Task 3은 따르지 않는다.
- 정렬 계산: 1만 행 콜레이터 정렬 12.7ms(Linux) / 3.3ms(Mac) — `R/library/sort.ts`는 정렬 열마다 다시 계산해도 예산 안이다.
- 대안 페이지(`TanstackSpike.tsx`)가 Task 3의 출발점이다: `useVirtualizer({ count, getScrollElement, estimateSize: () => rowHeight, overscan: 8, getItemKey })`, 머리는 붙인 줄, 행은 `translateY`, `aria-rowindex`는 머리 줄을 1로 센다. 명세 3.3의 선택(⇧·⌘·⌘A·오른쪽 클릭·화살표·Home/End·↩)과 열 크기 조절은 직접 만든다.

### 위험 갱신

- 선택·키보드·접근성을 직접 만드는 비용(0절 "버린 안"의 이유)이 생긴다: Task 3의 E2E가 3.3 전부를 덮고, Task 13의 axe·키보드 여정이 확인한다.

## M5 끌어 놓기 (2026-10-26, M5 Task 1 스파이크)

- 결정: **행·칩은 RAC `useDrag`·`useDrop`, 트리는 RAC `Virtualizer` 안의 RAC `Tree`**. 우회는 모두 공개 API와 DOM 이벤트다(`hasDragButton`, 미리보기 ref, 행 `useDrop`의 `isDisabled`, 트리를 감싸는 요소의 캡처 처리기). 내부 파일 import도 RAC 패치도 없다. HTML5 직접 구현과 자체 트리는 쓰지 않았다.
- 규칙(측정 전에 정함, 명세 8.1): 행·칩은 R1·R2·T7이 Linux와 Mac 모두 통과하면 RAC, 트리는 T1–T6·T8이 모두 통과하면 RAC `Tree`. 우회는 공개 API로 되면 통과로 셌다. 시간은 Mac이 예산, Linux가 2배(CI 실패선).
- 근거: 스파이크 브랜치 `m5-spike` e3925b4(병합하지 않음), 실제 `LibraryTable`(합성 1만 행) 옆에 RAC `Tree`(컬렉션 200개, 깊이 4)·태그 칩·Finder 파일 오버레이를 한 화면에 놓았고, 끌기는 Playwright의 실제 마우스(Chromium의 진짜 `dragstart`·RAC 처리기·`dragend`)와 CDP `Input.dispatchDragEvent`(Finder 파일), `Input.imeSetComposition`(한글 조합)이다. Linux = Xvfb 1440×900, Mac = run [40269632733](https://github.com/baebae0502/learn/actions/runs/40269632733)(macos-15 arm64 가상 머신, `suite=perf`).

### 측정

| 확인 | Linux | Mac | 방식 |
|---|---|---|---|
| R1 행 끌기 원본(1만 행, 선택 1·1,000) | 통과 | 통과 | 우회: `hasDragButton`, 미리보기 ref, 선택 안의 행을 누르면 놓을 때까지 선택 유지. 끌기 시작 중앙값 7.3/5.9ms(Linux), 13.1/12.2ms(Mac) |
| R2 원본 행이 언마운트돼도 | 통과 | 통과 | 기본: 눌린 행이 커서 행이라 이미 붙잡혀 있다. 목록에서 항목이 사라지면 RAC가 `onDragEnd(cancel)`을 즉시 부르고 드롭은 id를 그대로 받는다 |
| T1 트리 선택·키보드 | 통과 | 통과 | 우회: 한 글자 키 차단(type-ahead를 끄는 타입 있는 prop이 없다), → 첫 하위, ← 상위 선택 따라가기 |
| T2 행 안 입력 | 통과 | 통과 | 우회: 입력의 키를 트리 위 캡처 처리기가 맡는다(그대로 두면 End가 행을 옮겨 입력이 사라진다) |
| T3 표 행 → 트리 행, ⌘ = 이동 | 통과 | 통과 | 기본: "위에"만, 행 높이 전체가 대상, 지금 컬렉션은 표시 없음, 복사 기본, 이동 변조키는 플랫폼의 것(Mac ⌘, 그 밖 Shift) |
| T4 컬렉션 → 컬렉션 | 통과 | 통과 | 기본: 순환 대상·지금 부모에 표시 없음, "컬렉션" 머리에 놓으면 최상위 |
| T5 Finder 파일 → 트리 행 | 통과 | 통과 | 우회: 창 오버레이 리스너가 사이드바 안의 이벤트를 무시, 행 `useDrop`은 태그 끌기 중에만 |
| T6 스프링 로딩·자동 스크롤 | 통과 | 통과 | 스프링 RAC 고정 800ms(835/752ms), 자동 스크롤 띠 RAC 20px |
| T7 태그 칩 → 표 행 | 통과 | 통과 | 우회: 칩 `hasDragButton: true`, 행 `useDrop`은 끄는 동안만 |
| T8 esc·키맵·키보드 끌기 | 통과 | 통과 | esc 기본(Playwright 취소는 `dragleave`를 안 보내 표시가 남는다 — `dragend`에서 정리, 실제 esc는 실기), 끄는 중 `keydown`이 페이지에 안 온다, 키보드 끌기는 `slot="drag"` 단추 |
| P1 트리 시간 | 전부 펼침만 탈락 | 전부 펼침만 탈락 | 200행 전부 펼침 마운트 379/257ms(p95 410), `Virtualizer`로 94/44ms. 접힌 시작·한 노드 펼침은 통과 |

판정: P1 외 전부 통과. P1은 `Virtualizer`로 풀었다(결정에 포함) — 제품의 트리가 같은 행에서 T1–T8을 다시 통과했다(Task 5·8의 E2E).

### 제품 구현이 확인한 것

- 사이드바 구조: 한 RAC `Tree`에 `TreeSection` 둘(특수 보기, 컬렉션)이 `Virtualizer` 아래에서 키보드·기하 게이트를 통과했다(Task 5, 폴백의 별도 `ListBox`는 쓰지 않았다).
- RAC 1.22.1의 `ListLayout`은 펼친 행마다 내용 노드를 구역 높이에 한 번 더 세어 긴 트리의 스크롤 높이가 한 화면만큼 컸다(끝까지 스크롤하면 아무것도 그리지 않는다). 구역을 아는 자체 레이아웃 `TreeSectionsLayout`으로 고쳤다(Task 8).
- `useDragAndDrop`에 `onDropActivate`를 넘기면 Tree의 펼침 처리기를 덮어쓴다 — 넘기지 않는다(스프링은 RAC 고정).
- 끌기 중 원본이 목록에서 사라진 경우를 위해 쓰기·토스트는 `onDragEnd`가 아니라 드롭 처리기에 둔다.
- 놓은 뒤 보기를 지키기: RAC는 드롭 뒤 커서를 놓인 행으로 옮긴다(행이 바뀐 뒤의 렌더마다, 그리고 50ms 타이머로 — 키보드 모달리티로). 트리에서 선택은 포커스를 따르므로 그대로 두면 보기가 놓인 컬렉션으로 넘어간다. 그래서 행에 놓는 마우스·Finder 드롭은 RAC가 드롭을 기록하기 직전(`onDropCapture`)에 그 기록의 `focusedKey`를 비우고, 커서를 보던 행으로 되돌린다(`parkCursor`). 키보드 드롭은 ↩ 다음 RAC가 `getDropOperation`을 묻는 때에 같은 일을 한다. Finder 파일 드롭은 미분류 행이 새로 생길 수 있어 선택도 잠시 비웠다가 되돌린다(Task 8, 수정 3·4회차).
- 취소한 Finder 끌기는 페이지에 이벤트를 주지 않고(CDP 취소도, 실제 끌기의 `dragend`도 없다) RAC는 `dragleave`에서만 표시를 지운다. 그래서 끌기 밖의 다음 포인터 이동·누름·키, 그리고 관련 대상이 없는 창 `dragleave` 뒤 150ms에 표시를 쓸어 낸다. 쓸어 낼 때 보내는 합성 `dragleave`는 `isTrusted`가 아니므로 그 타이머를 다시 걸지 않는다.

### RAC를 올릴 때

- T1·T2의 우회는 RAC 행이 키를 캡처 단계에서 처리하고 `TreeProps`에 type-ahead를 끄는 prop이 없다는 것에 기댄다. 버전을 올리면 트리 키보드 E2E와 이름 칸 E2E를 다시 본다.
- 스프링 로딩 800ms와 자동 스크롤 띠 20px는 RAC 고정값이다. 바뀌면 명세 8.2의 숫자를 따라 고친다.
- 놓은 뒤 보기를 지키는 처리는 react-aria 3.53.1의 순서에 기댄다: 드롭을 기록하는 `focusedKey`를 캡처 단계에서 비울 수 있고, `DragManager.drop()`이 `onDrop` 바로 앞에 `getDropOperation`을 묻는다. 올리면 `dnd.spec.ts`의 "마우스로 놓은 뒤 키보드 링 없음"·이동 키·키보드 드롭 시험을 여러 번 되풀이해 본다.
- `TreeSectionsLayout`은 `ListLayout`의 구역 높이 계산을 대신한다. RAC가 그 계산을 고치면 자체 레이아웃을 걷어 낼 수 있는지 본다.
