# Learn — 품질 도약 단계 설계 (승인됨 2026-10-20)

## Context

- 첫 세션(P0 + 가져오기/열기 수직선, `main` 0878bcb)은 기능은 동작하지만, 시연 영상을 본 사용자가 **품질이 많이 부족하다**고 판단했다. 장기 목표는 **Zotero 7 / Codex 데스크톱 앱 수준의 완성도**다.
- 현재 상태(조사 결과): 렌더러 약 560줄, CSS 프레임워크·아이콘·다크 모드 없음, Electron 기본 메뉴(⌘R·DevTools 노출), 네이티브 타이틀바 통합 없음, 단축키 없음, 탭 없음, 위치 기억 없음, PDF는 캔버스 1장 단일 페이지, 영상은 기본 컨트롤뿐, 튜터 자리표시(340px)가 항상 열림. DB에는 collections·tags·anchors·annotations·settings 테이블이 이미 있지만 저장소/IPC/UI가 없다.
- 사용자는 Max 5x 구독자로, 토큰을 아끼지 말고 충분히 조사·검토·반복하라고 했다(낭비는 금지).
- macOS 검증은 Computer use 없이 내가 스스로 해야 한다. 이 서버(Intel Xeon)에서 macOS를 가상화하는 것은 Apple SLA §2J 위반이고 Apple Silicon 빌드도 시험할 수 없으므로 **제외**한다.

## 결정 사항

**사용자가 정한 것**
- GitHub **비공개** 저장소를 만들어 macOS 러너를 쓴다.
- **품질 기반 먼저**(창·디자인 체계·메뉴/단축키 → 라이브러리 → 리더 v2), 필기는 그다음이다.
- **목업을 먼저 승인**받고 화면을 구현한다.

**계획 승인 시 함께 확정되는 기본값**(바꾸려면 말씀해 주세요)
- macOS 증거 레인은 GitHub-hosted `macos-15` arm64(M1, 3 vCPU / 7 GB)에서 **수동 실행만**(`workflow_dispatch`) 한다. 비공개 저장소라 macOS 분이 10배로 차감되므로(무료 한도 월 약 200–300분), 지출 한도는 $0으로 둔다.
- 튜터 자리표시 패널은 P3 전까지 **제거**한다. 동작하지 않는 컨트롤은 아예 렌더링하지 않는다.
- AGPL인 Zotero 코드(reader, note-editor)는 **UX 참고만** 하고 가져오지 않는다. 런타임 의존성은 MIT/ISC/Apache/OFL만 쓴다.
- 서명하지 않은 `electron-builder --dir` 패키지를 증거 수집용으로 추가한다. 메뉴바의 앱 이름이 "Electron"이 아니라 "Learn"으로 나오는지 확인하기 위해서다.
- 휴지통 규칙: 영구 삭제 시 관리형 사본은 참조가 없을 때만 지우고, 외부 원본은 절대 지우지 않는다. 자동 비우기는 없다.
- 실기 대화형 점검(VoiceOver, 트랙패드, Finder 드래그, HEVC 확정)은 나중에 Scaleway Mac mini M1(24시간 약 €2.6, 사용자 계정 필요)이나 사용자 Mac에서 따로 한다.
- 목업에서 결정할 것: 레이아웃 A(Zotero식 탭 줄) / B(Codex식 전체 높이 반투명 사이드바), Mac 글꼴(시스템 SF + Apple SD Gothic Neo / Pretendard), 강조색(틸 유지 / 시스템 강조색), 문체(합니다체).

## 로드맵

| # | 마일스톤 | 명세 단계 | 선행 | macOS 실행 |
|---|---|---|---|---|
| **M0** | macOS 증거 레인 + 현재 앱 macOS 기준선 | P0/P6 위험 제거 | — | 2–3회 |
| **M1** | 디자인 명세 + 고해상도 목업 (**사용자 승인 게이트**) | — | M0 | 1회 |
| **M2** | 플랫폼 기반(비시각): 스키마 v2, 명령 레지스트리, 메뉴, 푸시 채널, 설정 | P1 | M0, M1 검토와 병행 | 1회 |
| M3 | 셸 + 디자인 체계(Mac 네이티브 창, 패널, 팔레트, 설정, 테마) | P1 | M1 승인, M2 | 2회 |
| M4 | 라이브러리 표(가상화·정렬·열 선택) + 빠른 검색 + 항목 패널 | P1 | M3 | 1–2회 |
| M5 | 컬렉션 트리 + 색 태그 + 드래그&드롭 + 네이티브 컨텍스트 메뉴 | P1 | M4 | 1회 |
| M6 | 휴지통, 가져오기 큐/진행률, 복구·백업 UI, 하드닝 (**P1 게이트**) | P1 | M5 | 1회 |
| M7 | 리더 v2: pdf.js PDFViewer, 탭, 위치 기억, 찾기, 썸네일/목차 | P2 | M3 | 2회 |
| M8 | 영상 리더 v2 + 자막(SRT/VTT) + 위치 기억 | P2 | M7 | 1회 |
| M9 | 필기(하이라이트·밑줄·노트·펜, 8색, 사이드바, undo/redo) (**P2 게이트**) | P2 | M7, M8 | 2회 |

**이번 실행 범위는 M0 → M1(목업 전달·승인 대기) → M2(승인 대기 중 병행)까지다.** M3 이후는 목업 승인 뒤에 마일스톤마다 같은 절차로 진행한다. 실행 방식은 지난 세션과 같다: writing-plans로 구현 계획 문서를 만들고, 서브에이전트가 구현하고, 작업마다 검토(명세 + 품질 + **UI 작업은 디자인 비평**)한 뒤, 마일스톤마다 브랜치를 만들어 PR로 병합한다.

---

## M0 — macOS 증거 레인 + 기준선

1. **GitHub 비공개 저장소** `baebae0502/learn`을 만들고 기존 기록을 push한다. `workflow_dispatch`는 기본 브랜치에 워크플로 파일이 있어야 나타나므로, 워크플로 파일을 먼저 `main`에 병합한다.
2. **`.github/workflows/ci.yml`**(Linux, push/PR마다): pnpm·Node 22 캐시, typecheck, vitest, fixture 캐시(미스 시 `apt-get install ffmpeg`), build, xvfb E2E, 실패 시 `test-results` 업로드.
3. **`.github/workflows/macos-evidence.yml`**(수동만):
   - 입력: `suite`(baseline / e2e / evidence / perf / demo / mockups / all), `runner`(macos-15 / macos-26), `packaged`, `label`. 설정: `concurrency` + `cancel-in-progress`, `timeout-minutes: 30`.
   - fixture는 Linux 잡에서 만들어 artifact로 넘긴다. macOS 분은 Linux의 10배로 차감되고, ffmpeg가 러너 이미지에 있다고 가정하지 않기 위해서다.
   - mac 잡 순서:
     1. `defaults write com.github.Electron ApplePersistenceIgnoreState YES`
     2. Electron/pnpm 캐시
     3. `pnpm install --frozen-lockfile`
     4. build (필요하면 `electron-builder --dir --mac`)
     5. 환경 보고(`sw_vers`, CPU, 디스플레이, Electron·Chromium 버전, GPU 상태)
     6. `playwright test -c playwright.evidence.config.ts --grep @suite`
     7. `upload-artifact@v7` (증거와 데모는 별도 artifact, 보관 14일)
4. **증거 하네스** `tests/evidence/capture.ts`:
   - `pageShot`: Playwright 페이지 스크린샷
   - `nativeWindowShot`: `getMediaSourceId()`로 얻은 CGWindowID로 `screencapture -l<id>` 실행. 신호등·비브런시까지 찍힌다.
   - `fullScreenShot`: `screencapture -x`. 메뉴바까지 찍힌다.
   - 녹화: `screencapture -v -V <초>`, 대체 수단은 Playwright `recordVideo`
   - 글꼴 확인: CDP `CSS.getPlatformFontsForNode`
   - 데모용 커서·키 입력 오버레이(`LEARN_DEMO_OVERLAY=1`일 때, 개발 빌드에서만)
5. **기준선 suite**(현재 앱): Apple Silicon E2E, seek 오차, 첫 PDF·MP4 표시 시간(각 5회), HEVC 재생 여부, 기본 라이브러리 경로, 라이브러리·PDF·영상·미지원 코덱 화면의 page/window/full-screen 스크린샷.
6. **스파이크**(통과 여부를 기록): Node 자식 프로세스에서 `screencapture` 권한, `screencapture -v` 녹화, 열린 네이티브 컨텍스트 메뉴 캡처, 메뉴바 열기(실패하면 메뉴 JSON 덤프로 대체), 패키지 빌드의 Playwright 실행(Playwright #43247 주시), 서버로의 artifact 다운로드 속도.
7. **서버 구동 스크립트** `scripts/evidence.sh`: `gh workflow run` → `gh run watch --exit-status` → `gh run download`. `evidence/` 폴더는 gitignore한다.
8. 함께 고칠 것: `fixtures/generate.mjs`가 ffmpeg를 매번 조사하는 문제(필요할 때만 조사), `tests/e2e/helpers.ts`의 `launch` 옵션 확장(env, recordVideo, 스위치).

**산출물**: `docs/mac-verification.md`(실측값), `acceptance.md`에 Mac 증거 열 추가, 사용한 macOS 분 기록.

## M1 — 디자인 명세 + 고해상도 목업 (게이트)

1. **`docs/design/design-spec.md`**(한국어)
   - 원칙: 절제, 내용 우선, 키보드 우선, Mac 네이티브, 가짜 금지
   - 창·패널 격자
   - 토큰
   - 타입 스케일: 본문 13/18, 한국어 문단 14/22, `word-break: keep-all`, 숫자 열은 `tabular-nums`
   - 아이콘 규칙: lucide 16px, stroke 1.5
   - 컴포넌트 목록과 상태: hover / active / focus / disabled / empty / loading / error
   - 선택 모델, 드래그&드롭, 컨텍스트 메뉴, 전체 키 맵
   - 모션: 100 / 160 / 240ms, reduced-motion 지원
   - 다크 모드, 접근성 목표, 화면 카탈로그
2. **토큰**
   - 원본: `renderer/src/design/tokens.ts`
   - 생성기 `scripts/build-tokens.mjs`가 두 가지를 만든다: oklch + `light-dark()` CSS, 그리고 main용 hex(테마별 창 배경으로 흰 화면 깜빡임 방지).
   - 강조색은 Linear식 base / accent / contrast 방식으로 생성한다.
   - 대비 테스트 `tokens.test.ts`: 본문 4.5:1 이상, UI 3:1 이상.
3. **글꼴**: Pretendard Variable(OFL)을 번들하고 OFL 고지를 넣는다. Mac은 시스템 글꼴을 우선 쓰고, Linux CI에서는 Pretendard로 Mac과 비슷하게 보이게 한다.
4. **목업** `docs/design/mockups/*.html`
   - 실제 `tokens.css`를 쓰고 `?theme=dark`, `?layout=A|B`를 지원한다.
   - 화면: 라이브러리(채워진 상태 + 항목 패널 + 태그 선택기), 첫 실행/드롭 오버레이, PDF 리더(썸네일, 찾기, 세피아/다크), 영상 리더(커스텀 컨트롤, 자막, 대본), 명령 팔레트, 설정, 대화상자(중복, 가져오기 진행, 백업 결과, 복구 시트)
   - Mac 크롬(신호등, 비브런시)은 그려서 넣고 "simulated"라고 표시한다.
5. **렌더링**: `scripts/render-mockups.mjs`로 Linux에서 1440×900 @2x 스크린샷을 찍고, 실제 SF 글꼴 확인용으로 macOS 러너 `mockups` suite도 돌린다.
6. **사용자 검토**
   - 목업을 claude.ai 비공개 Artifact(디자인)로 게시하고, 대조표 PNG와 결정 목록(레이아웃 A/B, 글꼴, 강조색, 문체)을 보낸다.
   - 그 전에 내부 **디자인 비평 에이전트**(opus)가 먼저 검토한다.
   - 수정은 최대 2회 반복한다.
7. **기준 문서**: `docs/design/review-rubric.md`, `docs/design/references.md`(Zotero/Codex 특성을 글로만 정리하고 자산은 복사하지 않음), ADR-0004(UI 스택), ADR-0005(명령·메뉴·단축키).

## M2 — 플랫폼 기반 (비시각, 목업 검토와 병행)

1. **스키마 v2** `packages/db/src/migrations/002-organize.ts`
   - 컬렉션: `collections.updated_at/deleted_at`, `collection_items.added_at`
   - 태그: `tags.color/position(1–8)/created_at`과 그 유일 인덱스, 이름 대소문자 무시 유일
   - 외래 키 자식 인덱스와 `jobs_state`
   - **`reading_positions`** 테이블(item, revision, locator_json, progress, opened_at)
   - 메타데이터는 `items.metadata_json`에 두고 zod `ItemMetadata`로 검증한다.
   - `LATEST_SCHEMA_VERSION`을 `MIGRATIONS`에서 유도하고, 다단계 실패 문구를 정정한다.
2. **저장소**
   - collections: CRUD, 재귀 CTE 조상 검사로 순환 금지, 하위 트리 soft delete와 복원
   - tags: 이름 바꾸면 기존 태그와 병합, 색·위치, 위치별 토글
   - settings: KV + zod 키 레지스트리
   - reading
   - `LibraryRepository` 확장: creators / year / tagIds / progress / openedAt, 상세 조회, 메타데이터 수정, 휴지통, 중복 그룹
3. **도메인**
   - `commands.ts`: 메뉴·팔레트·컨텍스트 메뉴·단축키가 모두 쓰는 단일 레지스트리. 한국어 레이블과 accelerator를 갖고 zod를 쓰지 않는다.
   - `events.ts` / `event-channels.ts`, `settings.ts`, `metadata.ts`, `tag-colors.ts`(Zotero 8색)
   - **이름공간 `LearnApi`**(`learn.library.*`, `collections.*`, `tags.*`, `settings.*`, `prefs.*`, `reader.*`, `ui.*`, `learn.on`), 채널은 `ns:verb` 형식
4. **main**
   - `index.ts`에서 `window.ts`를 분리
   - `events.ts`: main→renderer 푸시. 허용 목록을 두고 `IpcRendererEvent`는 렌더러에 넘기지 않는다.
   - `prefs.ts`: `userData/preferences.json`에 테마·밀도·라이브러리 위치를 원자적으로 기록
   - `theme.ts`: `nativeTheme.themeSource`
   - `menu/app-menu.ts`: 레지스트리 기반 한국어 메뉴. Reload는 없애고 DevTools는 개발 빌드에서만 연다.
   - `menu/context-menu.ts`: 네이티브 `Menu.popup` 결과를 레지스트리로 실행
   - `menu/edit-context-menu.ts`: 입력란 잘라내기 / 복사 / 붙여넣기
   - `ipc.ts`를 `ipc/register.ts`(기존 `handle()` 래퍼 그대로)와 영역별 모듈로 분리
5. **preload / renderer**
   - preload는 이름공간 API와 허용 목록 기반 `on`만 노출한다.
   - 렌더러에는 레지스트리 골격과 `menu-command` 디스패치만 넣는다(화면 변화 없음).
   - 키 라우팅: 메뉴에 있는 단축키는 메뉴가 처리한다. J/K/L, 1–8 같은 단일 키는 렌더러 키맵이 처리하되 편집 중이거나 IME 조합 중이면 무시한다.
6. **테스트**
   - 단위: 컬렉션 순환 사례, 하위 트리 삭제·복원, 태그 병합·유일성, 설정 거부, 위치 upsert, **v1→v2 실데이터 마이그레이션 + `.pre-v2.bak`**, 레지스트리 불변식(id 유일, 같은 맥락 안 accelerator 중복 금지)
   - E2E `platform.spec.ts`: 메뉴 JSON(한국어, Reload 없음), 메뉴 명령 전달, ⌘K 정확히 1회 처리, 컨텍스트 메뉴 stub, 설정 재시작 유지, `window.learn`에 범용 send/invoke 없음
   - 기존 테스트 갱신: `smoke`(schemaVersion 2), `protocol`(이름공간 API), `migrate`/`domain`/`backup` 테스트
7. ADR-0007(설정·환경설정 저장)을 추가하고 ADR-0003을 v2에 맞춰 갱신한다.

---

## M3–M9 요약 (목업 승인 뒤, 같은 절차로 별도 계획 문서 작성)

- **M3 셸 + 디자인 체계**
  - 의존성 정확히 고정: react-aria-components, lucide-react, react-resizable-panels 4.x, @tanstack/react-query, zustand. CSS는 `@layer`로 나누고 `styles.css`는 폐기한다.
  - Mac 창: `titleBarStyle:'hidden'`, `trafficLightPosition`, `vibrancy:'sidebar'`, `windowStatePersistence`. Linux/Windows는 `titleBarOverlay`.
  - 크기 조절 가능한 패널을 쓰고, 네이비 TopBar와 튜터 패널은 제거한다.
  - 설정 시트(⌘,), 팔레트(⌘K, 한국어 초성 지원), 단축키 도움말(⌘/), 창 전체 드롭 오버레이(⌥를 누르면 외부 연결), 토스트를 넣는다.
  - 폰트 MIME과 About 패널을 추가하고, 결정적 렌더링 스위치를 둔다.
  - E2E: `shell`, `ime`(CDP 조합 입력), `visual/tour`(라이트/다크 기준 스크린샷)
- **M4 라이브러리 표**
  - 첫 60–90분은 RAC Table+Virtualizer 스파이크로 1만 행, 크기 조절, 정렬, 다중 선택, Finder 드롭을 확인한다. 실패하면 TanStack Virtual로 대체한다.
  - 열: 제목, 저자, 연도, 종류, 진행, 보관, 크기, 상태, 추가일, 수정일. 열 선택기와 지속 저장을 넣는다.
  - 빠른 검색은 클라이언트 쪽 NFC 부분 일치로 한다. 한국어 2글자와 초성을 지원하고, 이후 계획(FTS5 trigram + 바이그램)은 ADR-0008에 둔다.
  - 항목 패널: 메타데이터 편집, 파일 정보, Finder에서 보기, 사본 내보내기, sha 복사(클립보드 권한 허용)
  - 1만 항목 성능 측정
- **M5 정리 도구**
  - 컬렉션 트리(RAC Tree, 중첩, 미분류, 중복 항목), 항목을 컬렉션으로 드래그, 컬렉션에 Finder 드롭 → `collectionId`로 바로 가져오기
  - 태그 선택기(AND 필터, 8색, 1–8 키)
  - 네이티브 컨텍스트 메뉴(항목, 컬렉션, 태그, 열 머리)
- **M6 P1 게이트**
  - 휴지통(ADR-0006), main 가져오기 큐(진행률과 취소), 복구 시트(staging 정리), 백업/복원 UI(빈 프로필로 복원 후 재시작)
  - next-session.md의 하드닝 목록: fsync, SQLite 오류 매핑, NFC, ftyp brand, 절대 경로, 재연결을 itemId 기준으로, 시작 지연 제거, DB 핸들 누수, 백업 경로
  - E2E `p1-gate`: 가져오기 중 SIGKILL → 복구 → 백업·복원 일치
- **M7 리더 v2**
  - `pdfjs-dist/web/pdf_viewer` 기반: 연속 스크롤, 텍스트 선택, 링크, 찾기(⌘F), 확대 모드(자동 / 폭 / 페이지 / 실제 크기, ⌘± / ⌘0, 핀치), 스크롤·펼침 모드, 회전, 쪽 입력, 키보드
  - 썸네일(가상화, LRU), 목차(RAC Tree), 세피아/다크 페이지
  - **위치 기억**(300ms 디바운스, SIGKILL 후 복원), 탭(세션 복원, 최근 4개만 마운트), 자체 뒤로 / 앞으로, ViewerAdapter, 한국어·목차 PDF fixture
- **M8 영상 리더 v2**
  - 커스텀 컨트롤(J/K/L, 배속, ±5/10초, 프레임 단위 이동, 컨테이너 전체화면)
  - 자막 SRT/VTT(BOM·CP949 감지, 신뢰하지 않는 입력으로 처리), 대본 패널에서 클릭하면 seek
  - 위치 기억
- **M9 필기**
  - PDF user space 기준 자체 레이어(ADR-0002), 하이라이트 / 밑줄 / 노트 / 펜 / 지우개, 8색, 필기 사이드바
  - undo/redo, 명세 06의 저장 규칙(메모리 즉시 반영, 펜 up 시 트랜잭션, 500ms 자동 저장), 저장 상태 표시
  - 영상 정지 프레임 카드
  - AC03 / AC04 / AC06 / AC17 검증

## 품질 프로세스 (토큰을 쓰는 곳)

- **작업마다**: 구현 → 명세 검토 → 품질 검토. UI 작업은 **디자인 비평 에이전트**(opus)가 Linux 투어 스크린샷과 목업을 나란히 비교해 blocker / major / minor로 판정하고, 문제가 없을 때까지 수정을 반복한다.
- **마일스톤마다**:
  - Linux 전체 suite
  - `macos-evidence suite=all`과 Mac PNG에 대한 디자인 비평
  - 성능 보고서
  - `acceptance.md` 갱신
  - **macOS에서 직접 녹화한 2–4분 데모 영상**(장 목록 포함)
  - PR에서 사용자 검토
- **가짜 컨트롤 금지**: 메뉴·팔레트·툴바·도움말을 모두 레지스트리에서 렌더링하므로 핸들러 없이는 화면에 나타날 수 없다. `commands.coverage.spec`은 모든 활성 명령을 실행해 예외가 없는지 확인하고, CI는 "P[0-9] 단계" 같은 문구가 남아 있으면 실패한다.
- **접근성(AC18)**: RAC 시맨틱, `@axe-core/playwright`(개발 전용)에서 심각 이상 0건, 키보드만 쓰는 여정 E2E, 200% 확대, IME 테스트를 한다. VoiceOver는 실기에서 확인한다.
- **성능 예산**: macOS 러너 값을 보고값으로 쓰고, 최종 판정은 기준 장비에서 한다.
  - 냉시작 → app-ready ≤ 1.5초
  - 1만 항목: 목록 IPC ≤ 150ms, 첫 표 그리기 ≤ 500ms, 검색 입력 → 그리기 p95 ≤ 50ms, 스크롤 프레임 p95 ≤ 16.7ms
  - 첫 PDF 쪽 ≤ 2초, 첫 MP4 프레임 ≤ 3초, seek 오차 ≤ 500ms
  - CI는 예산의 2배를 넘을 때만 실패시킨다.

## 재사용 (새로 만들지 않을 것)

- `packages/library/src/importer.ts`: staging / 해시 / 원자적 rename / 격리를 유지하고 `onProgress`, 취소, `collectionId`만 추가한다.
- `packages/db/src/library-repository.ts`: `ITEM_SELECT`와 단일 트랜잭션 패턴을 유지하고, 새 저장소도 같은 방식(prepared statement + 매퍼 + 변경 없으면 오류)으로 만든다.
- `migrate.ts`와 `.pre-vN.bak` 스냅샷은 그대로 쓴다.
- `backup.ts`: 전부 아니면 전무 방식과 zod manifest를 유지하고, 카운트만 선택 항목으로 확장한다.
- `recovery.ts`, `availability.ts`는 새 UI 뒤에서 그대로 쓴다.
- `app-protocol.ts`: MIME 표만 추가한다.
- `security.ts`, `url-policy.ts`: 클립보드 권한만 추가한다.
- `ipc.ts`의 `handle()` 래퍼(발신자 검사 + zod + Result)는 모든 새 채널에 그대로 쓴다.
- `strings.ts`: `t` 패턴을 유지하고 영역별로 나눈다.
- E2E `helpers.ts`(`launch` / `stubOpenDialog` / `openItem`)는 확장한다. UI 의존 단계는 helper로 모아서 testid는 계획적으로 옮긴다(예: `pdf-zoom` select는 M7에서 `setPdfZoom`으로).

## 위험과 대응

- **macOS 분 소진**: 수동 실행, suite 선택, fixture는 Linux에서 생성, 캐시, 30분 제한, 지출 한도 $0
- **Playwright 1.64 + 패키지 앱 `firstWindow` 문제(#43247)**: 기능 E2E는 비패키지 앱으로 하고, 패키지는 증거용으로만 쓰며 재시도로 감싼다.
- **러너에서 화면 캡처나 메뉴 열기가 안 됨**: M0 스파이크로 확인하고, 안 되면 `recordVideo`와 메뉴 JSON으로 대체한다.
- **비브런시에 투명 창 배경이 필요할 수 있음**: M3에서 러너로 확인한다.
- **`windowStatePersistence`가 실험적 기능**: 안 되면 환경설정 파일에 창 크기·위치를 직접 저장한다.
- **RAC 가상 표의 한계**: M4 스파이크 후 TanStack으로 대체할 수 있다.
- **러너 HEVC·성능 결과가 결정적이지 않음**: 결정적이지 않다고 표시하고 실기에서 확정한다.
- **서버의 artifact 다운로드 제한 가능성**: M0에서 측정하고, 증거와 영상 artifact를 나눈다.

## Verification

- **각 마일스톤 종료 조건**: `pnpm typecheck` / `pnpm test` / `pnpm e2e:xvfb` 통과, `scripts/evidence.sh <branch> all <label>` 실행 후 macOS artifact 확보, 디자인 비평 blocker / major 0건, 성능 보고서, macOS 데모 영상 전달, PR 병합
- **M0 완료**:
  - Linux CI 녹색
  - macOS 증거 실행 1회 녹색이고, artifact에 메뉴바가 찍힌 전체 화면을 포함한 PNG 8장 이상, `env.json`, 실측값이 있다.
  - `docs/mac-verification.md`에 값이 채워져 있다.
  - 사용한 macOS 분을 기록했다.
- **M1 완료**: 목업(라이트 / 다크, 레이아웃 A / B)을 Linux와 macOS에서 렌더링한 PNG와 Artifact로 전달했고, 사용자가 승인했다(또는 수정 사항을 반영했다).
- **M2 완료**:
  - v1→v2 마이그레이션 테스트와 `platform.spec` 통과
  - macOS 증거에서 메뉴바 스크린샷이 한국어 메뉴로 나오고 Reload가 없다.
  - ⌘K가 정확히 1번 처리된다.
