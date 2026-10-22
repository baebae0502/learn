# 다음 세션 인계 (2026-10-20 첫 세션 종료 시점, M3 셸 결과 2026-10-22 추가)

첫 세션(P0 + 자료 기반 최소 수직선)의 리뷰에서 나왔지만 이번 범위 밖으로 미룬 항목과, Mac에서 확인할 목록이다. 진행 상태는 [`acceptance.md`](acceptance.md), 실측은 [`p0-verification.md`](p0-verification.md).

## 제품 방향 (2026-10-22 합의)

소유자가 2026-10-22에 승인했다. 제품 원칙은 [`design/design-spec.md`](design/design-spec.md) 1.1(비평 고정 항목은 [`review-rubric.md`](design/review-rubric.md) 0절), 명세 변경은 [`spec-amendments.md`](spec-amendments.md), 결정은 [ADR-0009](decisions/0009-anchor-hub-and-links.md)(앵커 허브, 제안)·[ADR-0010](decisions/0010-tutor-backend-acp.md)(튜터 백엔드 ACP, 제안)·[ADR-0011](decisions/0011-license-agpl.md)(AGPL, 채택). 이후 계획의 Global Constraints에는 "새 데이터 객체는 모두 앵커로 주소를 가질 수 있다"를 넣는다.

### 로드맵 M3 → M14 (T1 포함)
| 마일스톤 | 범위 |
|---|---|
| M3 | 셸 마무리. 인계 문서와 PR은 이 합의를 승인한 뒤 |
| M4 | 라이브러리 표 + 빠른 검색 + 모드가 있는 인스펙터 |
| M5 | 컬렉션·태그·DnD·컨텍스트 메뉴. 튜터 목업을 병행해 만들고 소유자가 승인 |
| M6 | 휴지통·가져오기 큐·복구/백업·강화. P1 게이트 |
| M7 | 리더 v2(PDF) + 이미지. 첫 작업은 앵커 ADR(ADR-0009) 스파이크 |
| T1 | 작은 튜터: ACP 클라이언트·에이전트 감지, 읽기 MCP 도구(PDF 쪽, 현재 선택), conversations·messages·message_sources·conversation_context 테이블, 인용 검증 → 칩 → 이동(AC10), 인스펙터 튜터 모드·세션 목록, 동의와 보낸 범위 표시, 가짜 백엔드·오프라인 초안 |
| M8 | 영상 v2 + 자막 + 오디오, 대본 도구 |
| M9 | 필기(P2 게이트) + 튜터 제안 카드(노트·확인 문제) |
| M10 | 기억·복습(명세 P4) |
| M11 | GitHub 저장소 + 코드 투어 + README용 Markdown 렌더러 |
| M12 | 재배치 계열: 웹 스냅샷·Markdown·EPUB, 샌드박스 viewer·웹 앵커 |
| M13 | Chrome 커넥터: 먼저 macOS Native Messaging 스파이크, 그다음 네 가지 캡처와 세션 시작 |
| M14 | 전사·OCR·PPTX, 제품화·공개: 서명, AGPL 고지·CLA, Anthropic 서면 확인, 출시 |

### M4 입력
- **항목 패널 = 모드가 있는 인스펙터.** 모드를 담는 그릇으로 만들고, 튜터가 생기기 전에는 모드 전환을 그리지 않는다(가짜 금지). 정보 모드 폭 320(260–480), 자동 접힘 순서(오른쪽 슬롯 → 사이드바)는 그대로다. [디자인 명세 2.5](design/design-spec.md).

### 튜터 목업
- M5와 병행해 만들고 소유자가 승인한다. M1처럼 실제 토큰 위의 HTML 목업, 라이트·다크, 내부 비평 뒤 소유자 승인.
- 다룰 것: 동의, 에이전트 선택(설치·로그인 상태), 스트리밍, 도구 칩·인용 칩, 제안 카드(노트·확인 문제·기억), 오프라인·에이전트 실패와 초안 유지, 요청마다 보낸 자료·발췌·기억을 알리는 줄, 세션 목록, 다크 모드. 튜터 모드 폭의 범위도 이때 정한다.

### 소유자 할 일
- **공개 전 Anthropic 서면 확인.** 사용자의 Claude 구독으로 Claude 에이전트를 ACP로 실행하는 방식에 대한 Anthropic의 입장이 문서상 모호하다([ADR-0010](decisions/0010-tutor-backend-acp.md) 5절). 넓은 공개(M14 출시) 전에 받는다.

## M3 셸 결과 (2026-10-22)

계획 [`superpowers/plans/2026-10-21-m3-shell.md`](superpowers/plans/2026-10-21-m3-shell.md), 브랜치 `m3-shell`. 검증 숫자는 [`acceptance.md`](acceptance.md) 머리말과 AC02·AC18. 결정은 [ADR-0004](decisions/0004-ui-stack.md)(채택)와 ADR-0005.

### M3에서 해결한 것
- **셸(레이아웃 B)**:
  - 전체 높이 사이드바: 240(180–360), 접기·기억, 좁은 창과 200% 확대에서 자동 접힘;
  - 사이드바 위 88px은 모든 화면에서 픽셀까지 같다(E2E);
  - 52px 통합 도구 막대;
  - TopBar와 튜터 자리표시는 없앴다.
- **키맵**:
  - 메뉴·팔레트·툴팁·⌘/ 시트의 가속기와 ⌘ 표기는 모두 명령 레지스트리 하나에서 나온다;
  - 렌더러 키맵은 F6 / ⇧F6 패널 이동이다. IME 조합 중과 편집 중에는 무시하고, 가져오는 중에도 막지 않는다;
  - 실행기는 `aria-keyshortcuts`를 단다.
- **명령 상태**:
  - 가용성 판정은 하나(`isCommandAvailable`)이고, main 메뉴·컨텍스트 메뉴·렌더러가 같이 쓴다;
  - 렌더러는 `ui:reportContext`로 상황을 알린다;
  - 비활성 명령은 이유를 툴팁으로 보인다;
  - ⌘/ 시트를 요청하면 명령은 그때부터 거절되지만, 창이 흐려지는 것은 시트가 화면에 뜬 뒤다.
- **설정 창(⌘,)**:
  - 따로 뜨는 600폭 창이다: 테마, 밀도, 글자 크기, 라이브러리 위치;
  - 라이브러리 위치(R4)는 main이 고르고 검사하고 확인한 뒤 재시작한다. 렌더러는 경로를 보내지 않는다;
  - 테마를 바꾸면 페이지가 먼저 바뀌고, 각 창의 크롬과 네이티브 테마가 따라온다. 보고가 없으면 250ms 뒤에 따라오고, 늦게 온 이전 변경의 보고는 무시한다.
- **시트**:
  - 중복 확인 시트와 ⌘/ 단축키 시트. macOS에서는 네이티브 시트다;
  - 시트가 닫힌 뒤 창이 다시 키가 될 때까지 크롬은 흐려지지 않는다.
- **그 밖**:
  - ⌘K 팔레트: 초성 검색, IME 안전, 자체 콤보박스(ADR-0004 M3 편차);
  - 드롭 오버레이(⌥는 외부 연결), 토스트;
  - 창 크롬: 신호등, 비브런시, 창 상태 기억, About. Linux·Windows는 `titleBarOverlay`;
  - CSS `@layer` 체계(`styles.css` 폐기), 의존성 정확 고정;
  - 데모 오버레이(`LEARN_DEMO_OVERLAY`)와 장 목록이 있는 macOS 데모 녹화;
  - `@perf`: 냉시작, 렌더러 번들, 시트·설정 창 열기 지연, 테마 전환 순서.

### M3에서 나온 M4 입력
- **항목 패널 자동 접힘 순서**: `shell/layout.ts`의 `CONTENT_MIN`(520)을 그대로 쓴다. 창이 좁아지면 오른쪽 슬롯(항목 패널)이 먼저 접히고, 그다음 사이드바가 접힌다. M4는 항목 패널 320(260–480)을 같은 `layout.ts`에 더한다.
- **표**: M3 임시 목록의 `.table-*` 치수(행·머리·열 간격)를 그대로 쓴다.
- **팔레트**:
  - 자료 검색 결과와 최근 실행 가중치를 더한다;
  - 항목 검색이 오면 실행기 문구를 "검색 및 명령"으로 되돌린다. M3는 가짜 금지 규칙 때문에 "명령 검색"이다;
  - 결과가 없을 때 "라이브러리에서 검색" 행과 ↩ 힌트를 더한다.
- **⇧⌘R**: 선택이 생기면 `item.showInFolder`에 붙인다.
- **컨텍스트 메뉴**: 종류 `collection|tag|column`이 레지스트리에 준비돼 있다(`CONTEXT_MENU_KINDS`).
- **열기**: 제목을 한 번 클릭하면 여는 M3 임시 동작을 명세 7.1 선택 모델로 바꾼다(C-5).

### M4–M7로 넘기는 항목 (M3 디자인 비평·리뷰에서)
- **M4**:
  - **표 행 선택과 정렬 머리**(비평 T3 minor 8). 명세 3.1, 6(표: 정렬 열은 primary 500 + 12px 화살표). 목업 `components--part1`의 표 행과 `mockup.css` `.table-row.is-selected`, `.is-selected.is-focused`, `.th.is-sorted`. 규칙:
    - `[data-selected]`는 `--fill-selected`;
    - 표에 포커스가 있으면 `--accent`, 그 안의 글자·아이콘·상태색은 `--text-on-accent`;
    - 커서 고리는 `--text-on-accent` 75%;
    - `:root[data-window-inactive]`이면 중립 선택으로 돌아간다;
    - 흰 75% 고리의 실제 CSS는 아직 없다.
  - 다중 선택에서 사라진 id가 남은 일부로 열기를 켜면 안 된다. 선택을 `CommandContextState`에 넣는다(Task 2 리뷰 M9).
- **M5**: **사이드바 행 드롭 대상**(비평 T3 minor 7). 명세 6(트리: 드롭 대상 = 2px 강조 안쪽 테두리 + `--accent-soft`), 루브릭 4, 목업 `.nav-row.is-drop-target`. `ForcedState`에 `'drop'`을 더하고 상태 보드에 행을 더한다.
- **M6**:
  - 치명 안내 안의 동작(예: 백업을 Finder에서 보기)을 복구·백업 UI와 함께 만든다(명세 6 "동작은 안내 안의 단추").
  - 리더에 열린 항목을 휴지통으로 보낼 때의 동작을 정한다. 일시적 다시 읽기 실패(NOT_FOUND가 아닌 실패)에서는 리더를 그대로 둔다.
  - 메인 창의 가져오기·다시 연결 열기 패널은 `asSheet`를 거치지 않는다. macOS에서 시트로 할지 자유 패널로 할지 정한다.
  - 창이 잡힌 채 팔레트가 열리는 경로(Dock `open-file`, 백그라운드 가져오기 큐)가 생기면 팔레트의 held 분기를 테스트하고 다시 캡처한다. axe 정거장도 지금의 합성 드롭 대신 그 실제 경로로 옮긴다.
- **M7**:
  - 패널 머리(44: 전체 제목, 저자, 종류)는 탭 줄과 함께 온다. M3는 통합 도구 막대가 제목을 맡는다.
  - 100% 확대 = scale × 96/72(A4 → 794px). `devicePixelRatio`가 바뀌면(창을 다른 디스플레이로 옮기면) PDF 캔버스를 다시 그린다.
  - 쪽 이전·다음 셰브런은 쪽 필드 옆에 한 쌍으로 붙인다(비평 T7 n7). 확대 필드는 목업대로 24/13이다.
  - `reader.open`과 위치 저장의 알림은 아래 "M2에서 나온 후속 입력"을 본다(M7로 넘김).
- **RAC 업그레이드 때**: 1.22.1은 `ToastRegion`을 랜드마크로 등록하지 않아, F6은 창 캡처 단계의 렌더러 키맵이 막는다. 올릴 때 토스트가 보이는 상태에서 F6을 다시 확인한다(처리기 하나, 이동 한 번).

### 실기에서만 확인할 것 (M3)
GitHub 러너로는 확인할 수 없다. Scaleway Mac mini나 사용자 Mac에서 확인한다.
- fn-F / Globe-F 전체 화면. 메뉴에는 우리 ⌃⌘F 항목만 보여야 한다.
- VoiceOver:
  - 팔레트 콤보박스와 리스트박스;
  - 실행기의 `aria-keyshortcuts`(⌘K). 이름에 더 이상 "(⌘K)"가 없다.
- 팔레트에서 실제 한국어 IME. E2E는 CDP 조합과 keyCode 229만 확인한다.
- 실제 Finder 드래그:
  - 오버레이, ⌥로 연결 전환, 커서 배지;
  - 가만히 들고 있을 때 오버레이가 깜박이지 않는다(AppKit `draggingUpdated`, 1초 유휴 해제);
  - `dragenter` 때 `DataTransferItem.type`이 채워진다. 비어 있으면 요약이 "파일 N개"만 읽힌다.
- macOS 14+의 협력적 활성화: 드롭 뒤 중복 시트 전에 `win.focus()`로 창이 앞으로 오는지.
- 라이브러리 위치를 고른 뒤의 실제 재시작. E2E는 재시작 요청만 기록한다.

## P1 첫 작업 후보 (명세 13절 P1 게이트: "가져오기 중 종료 복구와 빈 프로필 restore")

- 복구 리포트 UI: `library.recoveryReport`는 계산만 하고 화면이 없다. `staging/*.part`와 격리된 `staging/corrupt-<sha>-<uuid>` 파일을 보여 주고, 사용자가 확인한 뒤 정리한다(앱 staging 파일만 삭제 가능).
- staged 파일 fsync(macOS는 `F_FULLFSYNC`) 후 rename — 전원 차단 시 0바이트 대상 방지.
- main 쪽 가져오기 직렬 큐 + 가져오는 중 드롭 영역 비활성화(지금은 버튼만 비활성).
- SQLite 오류 코드 매핑(`SQLITE_FULL`→`DISK_FULL`, `READONLY`/`CANTOPEN`→`PERMISSION_DENIED`, `NOTADB`/`CORRUPT` 문구).
- 파일명 NFC 정규화(macOS NFD), `ftyp` brand 검사로 HEIC/m4a를 동영상에서 제외, `.DS_Store`를 복구 리포트에서 제외.
- `importPaths`에 절대 경로만 허용.
- `pickAndRelink`가 같은 자산을 공유하는 다른 item을 돌려줄 수 있음 → itemId를 받거나 renderer가 다시 조회.
- 시작 시 외부 연결 파일 stat을 창 생성 뒤 백그라운드로 이동(분리된 외부 디스크에서 시작 지연).
- `openDatabase`가 try 밖이라 pragma 실패 시 핸들 누수(`library-context.ts`, `backup.ts`).
- 백업: 대상 경로를 DB 문자열 대신 `managedRelativePath(sha)`로 유도, 복원 시 DB 행과 manifest의 sha/mode/path 교차 검증.
- 한국어 2글자 검색: FTS5 trigram은 3글자 미만 질의를 찾지 못한다(P0 #2). 검색 구현 시 별도 처리.
- 컬렉션·태그·검색·휴지통·백업/복원 UI(P1 본 범위).

## 테스트·문서 보강

- ~~마이그레이션 v2 추가 시: 다단계 실패 문구 정정, `LATEST_SCHEMA_VERSION`을 `MIGRATIONS`에서 유도, FK 자식 컬럼 인덱스.~~ → **M2에서 해결**: 실패 문구는 어디까지 적용됐는지를 알리고 백업이 있을 때만 백업을 언급한다(`migrate.test.ts` "migration failure reporting"), `LATEST_SCHEMA_VERSION = MIGRATIONS.at(-1)!.version`, FK·조회 인덱스는 `002-organize.ts`에 추가([ADR-0003](decisions/0003-storage-layout.md) 스키마 v2).
- E2E: rapid-render 단언을 버스트 전 값 대비 증가로 강화, 영상 재생 시 `currentTime` 증가 확인, 드래그&드롭 경로.
- `p0-verification.md` #2(WAL·FTS5·`VACUUM INTO`는 Node에서 확인 — 같은 N-API 바이너리), #4(`<video>` Range 근거는 커밋되지 않은 탐색 기록) 표현 정밀화.

## Mac에서 확인할 것

M0에서 GitHub macOS 러너(M1 VM)로 확인한 항목은 [`mac-verification.md`](mac-verification.md)에 run id와 함께 기록했다(macOS 5회, 16분).

- ~~Apple Silicon에서 `pnpm install && pnpm e2e`~~ → 러너에서 설치·빌드·기능 E2E 실행(fixture는 Linux 잡에서 생성). 처음엔 `first-session.spec.ts`가 전체 화면 진입 직후 해제에서 멈춰 5/6이었고, 테스트를 전환 완료 후 해제하도록 고친 뒤 6/6 통과(run 39451895620). 빠른 토글 경합 자체(앱/Electron)는 darwin 전용 `test.fail()` 특성 테스트로 남겼다 → **M8에서 처리**(재현 조건·스크린샷은 mac-verification "추가 발견"). seek 오차(중앙값 0.3ms)·첫 PDF/영상 시간은 VM 참고값만 있음 — **AC16 기준 장비 측정은 남음**.
- ~~HEVC 재생 여부 기록~~ → 러너에서 재생됨(readyState 4, `canPlayType` probably). 열자마자 캔버스로 읽은 프레임이 검은 경우가 있어(4회 중 2회) 실기에서 확정.
- ~~기본 라이브러리 위치 확인~~ → `~/Library/Application Support/Learn/Library` 확인(macOS 15·26).
- `pnpm dev`(Vite dev server, CSP 없음 + dev 전용 CORS 경로)를 수동으로 한 번 실행해 기록 — 자동 테스트는 빌드본만 검증한다. (미확인)
- PPTX 변환(LibreOffice) 경로와 라이선스 확인(P5 준비). (미확인)
- 패키징(P6): 서명, Electron fuses, hardened runtime JIT 권한. M0에서 서명 없는 `electron-builder --dir` 앱이 ad-hoc 서명 상태로 실행되고 메뉴바에 "Learn"이 나오는 것까지 확인했다(`identity: null`만으로는 서명이 깨진 채로 남음).
- 실기 대화형 점검(VoiceOver, 트랙패드, Finder 드래그, Retina @2x, 전체 화면 빠른 토글)은 Scaleway Mac mini 또는 사용자 Mac에서.

## M0에서 나온 후속 입력

- 러너 화면이 1024×768이라 창이 1024×684로 줄면 표 열의 한국어가 글자 단위로 줄바꿈된다 → M1 타입 규칙(`word-break: keep-all`)·M4 표 열 폭.
- 미지원 코덱 안내의 기술 문자열이 상자 밖으로 넘친다 → M8.
- Playwright 1.64.1 `recordVideo`는 Electron 44에서 첫 창을 멈추게 한다 → 데모 녹화는 macOS `screencapture -v`, 렌더러만은 CDP 화면 녹화(`startScreencast`)를 쓴다.
- ~~데모용 커서·키 입력 오버레이(`LEARN_DEMO_OVERLAY`)는 아직 없다.~~ → **M3에서 해결**: `LEARN_DEMO_OVERLAY=1`(패키지 빌드는 무시)로 커서 고리·키 알약·장 자막을 그리고, `tests/evidence/demo.evidence.ts`가 장 목록이 있는 macOS 데모를 녹화한다([README](../README.md#환경-변수)).

## M2에서 나온 후속 입력 (보류)

- 컬렉션 복원이 따로 삭제해 둔 하위 항목까지 되살린다 → **M6**(휴지통/복원 정책에서 하위 컬렉션을 어떻게 다룰지 정하고 고친다).
- `itemIdsForAsset`이 휴지통에 있는 항목을 제외한다 → **M6**(휴지통 복원 시 같은 자산을 쓰는 항목 처리와 함께 확인).
- 리더의 위치 저장과 열기(`reader.open`)가 `libraryChanged`로 `openedAt`·진행률을 알리지 않는다. M2 렌더러가 이 값을 표시하지 않아 보류 → **M7**(목록에 진행률·마지막 연 시각을 표시할 때 같이 처리). M3 임시 목록에는 진행률·마지막 연 시각 열이 없어 표시할 곳이 없다(M-3). `openedAt` 자체는 최종 리뷰 수정부터 열 때마다 기록된다(ADR-0007 §1). 같은 줄의 `actionError`를 지우는 시점은 M3에서 문제가 사라졌다: `actionError` 상태가 오류 토스트로 바뀌어 없어졌다.
- `isDevBuild`(개발 빌드에서만 개발자 도구 메뉴를 넣는 판정)에 직접 단위 테스트가 없다. E2E "menu: an unpackaged run without LEARN_E2E=1 does show 개발자 도구"로만 덮인다.
- ~~⌘O 정확히 1회 처리(`platform.spec.ts`)와 한국어 메뉴 막대 스크린샷, M2 읽기 위치 복원은 M2 macOS 실행에서 확인한다.~~ → M2 macOS 실행(run 39534378577)에서 확인했다([`mac-verification.md`](mac-verification.md) "M2 실행", [`acceptance.md`](acceptance.md) AC06·AC18). 최종 리뷰 수정에서 더한 E2E 2개(`openedAt` 기록, `ui.windowState()`)는 다음 macOS 실행(M3)에서 같이 돌린다.
