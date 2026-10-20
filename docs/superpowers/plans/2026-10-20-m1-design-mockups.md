# M1 — 디자인 명세 + 토큰 + 고해상도 목업 구현 계획

> **For agentic workers:** 디자인 작업이다. 일관성이 생명이므로 한 명의 디자이너 에이전트가 명세·토큰·목업을 함께 만들고, 이후 디자인 비평(별도 에이전트)과 수정 라운드를 거친다. 이 마일스톤은 **실제 앱 화면을 바꾸지 않는다**(M3에서 적용). 목업은 소유자 승인을 위한 설계 목표다.

**Goal:** Learn을 Zotero 7 / Codex 데스크톱 앱 수준의 완성도로 끌어올릴 디자인 체계를 정의하고, 주요 화면의 고해상도 목업(라이트/다크, 레이아웃 A/B)을 만들어 소유자가 승인할 수 있게 한다.

**Spec:** `docs/superpowers/specs/2026-10-20-quality-phase-design.md`(M1 절과 "M3–M9 요약"), 제품 명세 `docs/spec.html`(02 화면, 06 필기, 10 튜터).

## 제품 맥락 (디자이너가 알아야 할 것)

- Learn: 로컬 우선 개인 학습 라이브러리. 자료(PDF·동영상, 이후 EPUB·PPTX·웹)를 소유하고, 자료 위에 필기하고, 근거를 인용하는 튜터와 공부한다. 기본 UI 언어는 **한국어**, 자료는 한국어·영어.
- 주 사용 환경: **macOS Apple Silicon**. Electron 44(Chromium 152)이므로 `oklch()`, `light-dark()`, `color-mix()`, 컨테이너 쿼리, `:has()` 모두 사용 가능.
- 현재 앱의 문제(사용자가 "품질이 많이 부족하다"고 판단): 웹페이지 같은 네이비 헤더, 회색 여백 속 흰 카드, 아이콘 없음, 다크 모드 없음, 단조로운 표, 고정 레이아웃, 항상 열린 빈 튜터 패널, 텍스트 줄바꿈 어색함("지/금은").
- 품질 기준(조사 결과 요약):
  - **Zotero 7**: 3단(컬렉션 트리+태그 선택기 / 가상화된 항목 표 / 접히는 섹션의 항목 패널), 열 선택·정렬·크기 조절, 색 태그 8색(`#ffd400 #ff6666 #5fb236 #2ea8e5 #a28ae5 #e56eee #f19837 #aaaaaa`), 리더는 탭 + 왼쪽 사이드바(썸네일/필기/목차, 각각 검색) + 찾기 팝업 + 보기 메뉴(확대 모드, 스크롤 모드, 펼침), 읽기 위치 기억, 다크/세피아 리더 테마, 네이티브 메뉴·컨텍스트 메뉴, 키보드 우선, 밀도(Compact/Comfortable) 설정.
  - **Codex 데스크톱 / Linear 계열**: 절제된 크롬("관심을 얻지 않은 것은 경쟁하지 않는다"), 반투명 사이드바, ⌘K 명령 팔레트(명령·자료·컬렉션), 단일 명령 레지스트리, base/accent/contrast로 생성하는 테마, 픽셀 정렬된 아이콘·레이블, 즉각 반응.
  - **macOS 관례**: 숨긴 타이틀바 + 신호등(왼쪽 위 약 18,18), 52px 툴바, 사이드바 비브런시, 본문 13px, 시스템 글꼴, `⌘` 기호 단축키 표기, 네이티브 메뉴.
- 라이선스: Zotero 코드·자산(AGPL) 복사 금지. **글로 정리한 특성만** 참고. SF Symbols 사용 금지(라이선스). 아이콘은 lucide(ISC).
- **가짜 금지 원칙**: 목업은 목표 화면이지만, 각 요소가 어느 마일스톤(M3–M9)에서 실제로 동작하게 되는지 디자인 명세의 화면 카탈로그에 표시한다. 튜터(P3) 패널은 이번 목업에 넣지 않는다.

## 산출물

### 1. `docs/design/design-spec.md` (한국어)
1. 원칙: 절제, 내용 우선, 키보드 우선, Mac 네이티브, 가짜 금지, 상태 기억.
2. 창·패널 격자: 레이아웃 A(Zotero식: 상단 52px 툴바에 신호등 + 탭 줄, 아래에 사이드바/표/항목 패널)와 B(Codex식: 전체 높이 반투명 사이드바 안에 신호등, 내용 영역 머리에 탭) — 두 안의 치수, 최소/기본/최대 폭(사이드바 240(180–360), 항목 패널 320(260–480)).
3. 토큰(아래 2절)과 사용 규칙.
4. 타이포그래피: 역할별 스케일(caption 11/14, footnote 12/16, **body 13/18**, callout 14/22, title3 15/20 600, title2 17/22 600, title1 22/28 600), 한국어 규칙(`word-break: keep-all; overflow-wrap: anywhere; line-break: strict`, 한글 UI에 700 지양), `tabular-nums`, 모노 12px.
5. 아이콘: lucide 16px, stroke 1.5, 28px 히트 영역, `currentColor`. 자료 종류 아이콘 규칙.
6. 컴포넌트 목록과 상태(hover/active/focus/disabled/empty/loading/error): 버튼(기본/보조/아이콘/툴바), 세그먼트, 검색 필드, 메뉴/컨텍스트 메뉴(네이티브 표기 규칙), 팝오버, 시트/대화상자, 토스트, 진행 표시, 표(행 선택: 포커스 시 강조색 채움+흰 글자, 비포커스 시 중립), 트리, 태그 칩/색 점, 배지, 빈 상태, 스크롤바.
7. 상호작용: 선택 모델(클릭/⇧/⌘/⌘A, 오른쪽 클릭이 먼저 선택), 드래그&드롭(Finder→창 전체 오버레이, ⌥=외부 연결; 행→컬렉션 추가, ⌘=이동), 컨텍스트 메뉴 내용, **전체 키 맵**(⌘K 팔레트, ⌘F 찾기/검색, ⌘O 가져오기, ⇧⌘N 새 컬렉션, ⌘W 탭 닫기, ⌃⇥ 탭 전환, ⌘[ ⌘] 뒤/앞, ⌘± ⌘0 확대, ⌘/ 단축키 도움말, ⌘, 설정, 1–8 색 태그, J/K/L 영상 등) — IME 조합 중 무시 규칙.
8. 모션(100/160/240ms, `cubic-bezier(.2,0,0,1)`, 목록 갱신엔 모션 없음, reduced-motion이면 불투명도만), 다크 모드 원칙(그림자보다 경계선·내부 하이라이트), 접근성 목표(대비, 포커스 링, 200% 확대, 키보드 전용 여정).
9. 문체: 합니다체 유지(소유자 결정 대기), 버튼은 동사형 짧게, 오류는 원인+다음 행동.
10. **화면 카탈로그**: 각 목업 화면과 각 요소가 동작하게 되는 마일스톤(M3–M9).

### 2. 토큰 (실제 코드, M3에서 그대로 사용)
- 원본 `apps/desktop/src/renderer/src/design/tokens.ts`: 중립(hue≈250, chroma≤0.01) 단계, 강조(기본 틸 hue≈190), 의미색(danger/warning/success), 필기·태그 8색, 간격(4px 격자: 2,4,6,8,12,16,20,24,32), 행 높이(밀도 24/28/32), 반경(4/6/8/12), 그림자(e1 팝오버, e2 대화상자), 모션, 포커스 링. 라이트/다크 값과 `prefers-contrast: more` 변형.
  - 시작값(조정 가능): 라이트 window `oklch(.985 .002 250)`, content `oklch(1 0 0)`, hover `.95`, 비포커스 선택 `.92`, 경계 `.88`, 글자 `.23/.45/.60`; 다크 window `oklch(.20 .005 250)`, content `.23`, hover `.28`, 선택 `.32`, 경계 `.33`, 글자 `.94/.72/.58`; 강조 라이트 `oklch(.55 .11 190)`, 다크 `oklch(.68 .11 190)`.
- 생성기 `apps/desktop/scripts/build-tokens.mjs` → `design/tokens.css`(CSS 변수, `light-dark()`, `@media (prefers-contrast: more)`) + `design/tokens.generated.ts`(main용 테마별 hex: 창 배경, titleBarOverlay 색). 생성물은 커밋하고, 생성기를 다시 돌렸을 때 차이가 없음을 테스트로 확인.
- `design/tokens.test.ts`(vitest): 두 테마에서 본문 글자/배경 대비 ≥ 4.5:1, UI 글리프·경계(필요한 곳) ≥ 3:1, 선택 행 글자 ≥ 4.5:1. oklch→sRGB 변환은 의존성(정확히 고정, MIT) 또는 작은 자체 구현.
- 글꼴: npm `pretendard`(정확히 고정)에서 `PretendardVariable.woff2`와 `LICENSE`(OFL-1.1)를 `design/fonts/`로 복사하는 스크립트 또는 커밋. 글꼴 스택 `-apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Pretendard Variable", system-ui, sans-serif`(Mac은 시스템, Linux는 Pretendard). 목업에는 "Mac 시스템 글꼴 / Pretendard 통일" 두 안을 전환하는 `?font=system|pretendard`도 둔다.

### 3. 목업 `docs/design/mockups/`
- 실제 `tokens.css`를 상대 경로로 사용. 공통 `mockup.css`/`mockup.js`(쿼리 파라미터 `theme=light|dark`, `layout=A|B`, `font=system|pretendard`, `density=compact|comfortable` 처리, 아이콘 인라인).
- 아이콘: lucide SVG를 인라인(npm `lucide-static` 정확히 고정 또는 필요한 아이콘만 복사 + ISC 고지).
- 콘텐츠: 사실적인 한국어 학습 자료(예: 컬렉션 "분자생물학", "통계", "연구 방법"; 자료 "분자생물학 6장 · 신호 전달.pdf", "강의 04 · 세포 신호.mp4", 영어 논문 제목, 저자·연도, 진행률, 색 태그). 실존 인물·기관 사칭 금지(가상 이름 사용).
- 화면(각각 라이트/다크 × 레이아웃 A/B):
  1. `library.html` — 채워진 라이브러리: 컬렉션 트리(내 라이브러리, 최근 연 자료, 미분류, 중복 항목, 휴지통, 중첩 컬렉션) + 하단 태그 선택기, 항목 표(제목+종류 아이콘+색 점, 저자, 연도, 진행, 추가일 등, 정렬 표시, 선택 행), 항목 패널(정보/파일/태그/컬렉션 섹션), 툴바(검색, 추가 메뉴).
  2. `library-empty.html` — 첫 실행 빈 상태 + Finder 드래그 시 창 전체 드롭 오버레이(복사/⌥ 외부 연결 안내).
  3. `reader-pdf.html` — 탭 줄, PDF 연속 스크롤(실제 페이지처럼 보이는 내용), 왼쪽 사이드바(썸네일/목차 전환, 검색), 찾기 바(3/12), 확대 메뉴, 쪽 입력, 하이라이트 예시(M9 표시), 세피아/다크 페이지 변형.
  4. `reader-video.html` — 커스텀 컨트롤(재생, 스크러버+버퍼, 시간, 배속, 자막 토글, 전체화면), 자막 오버레이, 대본 패널(현재 큐 강조, 검색), 시간 메모(M9 표시).
  5. `palette.html` — ⌘K 팔레트(명령/자료/컬렉션 섹션, 단축키 표기, 한국어 검색어 강조).
  6. `settings.html` — 설정 시트(외관: 시스템/라이트/다크, 밀도, 글자 크기, 라이브러리 위치) — 실제로 구현될 옵션만.
  7. `dialogs.html` — 중복 확인, 가져오기 진행 토스트(진행률·취소), 백업 결과, 라이브러리 점검(복구) 시트, 미지원 코덱 안내.
- Mac 크롬(신호등, 비브런시)은 CSS로 그리고 작은 "simulated" 표시를 넣는다.
- 1440×900 기준, 레이아웃은 실제 앱처럼 반응형(창 축소 시 항목 패널 접힘 등)은 필요 없음.

### 4. 렌더링
- `scripts/render-mockups.mjs`: 이 저장소의 Electron + Playwright `_electron`으로 작은 렌더 전용 main(별도 파일, 앱 코드와 분리)을 띄워 각 목업 × 테마 × 레이아웃을 1440×900 @2x(`--force-device-scale-factor=2`)로 `docs/design/renders/<name>-<theme>-<layout>.png`에 저장(이 서버에서는 `xvfb-run`). 렌더 PNG는 **커밋하지 않고**(`.gitignore`), 대조표(contact sheet) JPEG 1–2장만 `docs/design/` 아래에 커밋.
- `tests/evidence/mockups.evidence.ts`(`@mockups`): macOS 러너에서 같은 렌더를 수행(실제 SF 글꼴 확인용). M0의 증거 하네스가 병합된 뒤에 연결해도 된다(파일만 준비).

### 5. 기준 문서
- `docs/design/references.md`: Zotero 7/8, Codex, Linear, macOS 관례에서 채택한 특성(글로만, 출처 URL).
- `docs/design/review-rubric.md`: 디자인 비평 기준 — 격자·간격 토큰 준수, 타입 스케일·위계·밀도, 한국어 타이포(keep-all, 행간), 상태 완비, 라이트/다크 대등, Mac 관례(52px 바, 신호등 간격, 비브런시, ⌘ 표기, 네이티브 메뉴), 대비, **동작 없는 컨트롤 금지**, 심각도 정의(blocker/major/minor/nit)와 보고 형식(스크린샷 파일·영역·구체적 수정안).
- `docs/decisions/0004-ui-stack.md`: react-aria-components(Table/Tree/GridList+Virtualizer, 네이티브 DnD, Menu/Dialog/Popover, I18nProvider ko-KR) 채택 근거와 Base UI·Radix·cmdk·dnd-kit 미채택 근거, lucide, react-resizable-panels 4.x, TanStack Query, zustand, CSS `@layer`(Tailwind 미채택), M4 스파이크 대체안(TanStack Virtual).
- `docs/decisions/0005-commands-menus-shortcuts.md`: 단일 명령 레지스트리(`packages/domain/src/commands.ts`), 메뉴 소유 단축키 vs 렌더러 키맵(단일 키, IME 무시), 네이티브 컨텍스트 메뉴 경로, 팔레트, 재지정은 P6.

## 완료 조건
- 위 산출물이 모두 있고 자리표시가 없다.
- `pnpm typecheck`, `pnpm test`(토큰 테스트 포함) 통과. 기존 E2E 영향 없음(앱 화면 미변경).
- `scripts/render-mockups.mjs`가 이 서버에서 7개 화면 × 2테마 × 2레이아웃 = 28장 렌더를 성공하고 대조표를 만든다.
- 디자인 비평 라운드에서 blocker/major 0건(컨트롤러가 비평 에이전트를 따로 돌린다).

## 커밋
작업 단위로 커밋하고 메시지 끝에:
```
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LH2FDh4QwsGUFR3V2KewHi
```
