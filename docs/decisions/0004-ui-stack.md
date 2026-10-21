# ADR-0004: UI 스택 — react-aria-components, lucide, CSS `@layer`

- 상태: 제안 (2026-10-21) · M1 목업 승인과 함께 채택, M3에서 적용 · 관련: `docs/design/design-spec.md`, AC18(접근성), ADR-0005

## 맥락
M1 목업은 가상화된 정렬 표, 중첩 트리, 탭, 메뉴·팝오버·시트, 명령 팔레트, Finder 드래그 앤 드롭, 키보드 우선 조작을 요구한다(Zotero 7 수준). 현재 렌더러는 손으로 짠 React 560줄이고 접근성 시맨틱·포커스 관리·가상화가 없다. 런타임 의존성은 MIT/ISC/Apache/OFL만 쓰고, 버전은 정확히 고정한다.

## 결정
| 영역 | 선택(조사 시점 버전) | 라이선스 |
|---|---|---|
| 대화형 컴포넌트 | **react-aria-components** 1.22.x: `Table`·`Tree`·`GridList` + `Virtualizer`, 네이티브 DnD(`useDragAndDrop`, 파일 드롭), `Menu`·`Popover`·`Dialog`·`Modal`·`Sheet`·`Toast`, `DropZone`, `Tabs`, `SearchField`, `ToggleButton`, `Autocomplete`(팔레트), `I18nProvider locale="ko-KR"` | Apache-2.0 |
| 아이콘 | **lucide-react** 1.60.x(목업과 같은 세트, 16px / stroke 1.5) | ISC |
| 패널 | **react-resizable-panels** 4.x(크기 조절, 접힘, 지속 저장 콜백) | MIT |
| 데이터 | **@tanstack/react-query** 5.x(IPC 조회 캐시, main 푸시 이벤트로 무효화) | MIT |
| UI 상태 | **zustand** 5.x(탭, 패널, 선택, 팔레트) | MIT |
| 스타일 | 일반 CSS + `@layer reset, tokens, base, components, screens, utilities`. 토큰은 생성된 `tokens.css`. 한국어 줄바꿈 규칙은 `base`. | — |
| 글꼴 | macOS는 시스템 글꼴(SF Pro + Apple SD Gothic Neo, 소유자 확정 2026-10-21), Linux/Windows는 번들 Pretendard Variable | OFL-1.1 |
| 한글 초성 검색 | 작은 자체 함수(NFD 분해) 우선, 부족하면 es-hangul 2.x | (MIT) |
| 접근성 검사(개발 전용) | @axe-core/playwright 4.x | MPL-2.0(개발 도구, 배포물에 포함 안 됨) |

- 모든 패키지는 `package.json`에 정확한 버전으로 고정하고(`^`·`~` 금지) 이 표와 README에 라이선스를 기록한다.
- 화면 코드는 RAC의 렌더 프롭(`isSelected`, `isFocusVisible`, `isPressed`, `isDropTarget` …)을 데이터 속성으로 받아 CSS가 상태를 그린다. 목업의 `.is-*` 클래스가 그대로 `[data-selected]`, `[data-focus-visible]`로 옮겨진다.
- **M4 첫 60–90분 스파이크**: RAC `Table` + `Virtualizer`로 1만 행, 열 크기 조절, 정렬, 다중 선택, Finder 파일 드롭, 스크롤 프레임 p95 ≤ 16.7ms를 확인한다. 실패하면 표만 **@tanstack/react-virtual** 3.x(MIT) + RAC의 `useGridList`/선택 훅 조합으로 대체한다(트리·메뉴는 RAC 유지).

## 미채택과 이유
- **Base UI**(MIT, 1.x): 원시 컴포넌트 품질은 좋지만 가상화된 표·트리, 표의 키보드 탐색·다중 선택·DnD가 없다. 그리드 시맨틱을 직접 만들어야 해 Zotero 수준까지 비용이 크다.
- **Radix UI**: 표·트리가 없고, 메뉴·대화상자만으로는 핵심 화면(표·트리)이 해결되지 않는다. 여러 라이브러리를 섞으면 포커스 관리가 이중이 된다.
- **cmdk**: 팔레트 전용. RAC `Autocomplete` + `ListBox`가 같은 일을 하고 포커스·IME 처리를 RAC 한 곳에 모은다.
- **dnd-kit**: 포인터 이벤트 기반이라 Finder ↔ 창 파일 드래그(OS 네이티브 DnD)를 처리하지 못한다. RAC는 HTML5 네이티브 DnD 위에서 키보드 DnD까지 제공한다.
- **Tailwind**: 토큰이 이미 CSS 변수다. 유틸리티 클래스는 상태 스타일(선택·포커스·다크)을 마크업에 흩어 놓고, 한국어 타이포 규칙과 컴포넌트 단위 시각 비평을 어렵게 한다.
- **MUI·Chakra 등 디자인 시스템 포함 라이브러리**: 웹 대시보드 외형이 기본값이라 Mac 네이티브 목표와 맞지 않고 덮어쓰기 비용이 크다.

## 근거
- RAC는 표·트리·메뉴·대화상자·DnD·국제화를 한 접근성 모델(ARIA 그리드/트리, 포커스 링 `focus-visible`, 화면 낭독기 알림)로 제공한다. AC18(키보드 전용 여정, VoiceOver)을 직접 구현하지 않고 얻는다.
- 스타일이 없는(headless) 라이브러리라 목업의 토큰·CSS를 그대로 쓸 수 있다.
- 가상화를 표·트리·목록에 같은 방식으로 적용해 1만 항목 성능 예산(첫 그리기 ≤ 500ms, 검색 입력→그리기 p95 ≤ 50ms)을 맞춘다.

## 결과와 위험
- 번들 크기가 늘어난다(RAC는 트리 셰이킹 가능, 쓰는 컴포넌트만 포함). M3에서 렌더러 번들 크기를 기록한다.
- RAC `Virtualizer`의 열 크기 조절·고정 머리 조합은 M4 스파이크 전까지 확인되지 않았다(위의 대체안).
- IME: RAC 입력 컴포넌트의 조합 중 키 처리(Enter·화살표)를 M3 `ime` E2E(CDP `Input.imeSetComposition`)로 검증한다.
- 재검토 조건: 스파이크 실패가 표 밖(트리·DnD)까지 번지거나, RAC 주요 버전이 비호환 변경을 낼 때.
