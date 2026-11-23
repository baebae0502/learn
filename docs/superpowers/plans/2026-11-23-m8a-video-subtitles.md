# M8a — 영상 리더 v2 · 자막 · 자막 본문 검색 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 작업마다 아래 "검토 절차"를 따른다.

**Goal:** 강의 영상을 Learn의 재생 컨트롤과 한 글자 키로 보고, SRT·VTT 자막을 세 길(리더의 "자막 파일 추가…", 같이 고른 같은 이름, 영상 탭에 끌어 놓기)로 붙여 화면 아래 오버레이와 왼쪽 대본 칸에서 읽고, 대본 문장을 눌러 그 시각으로 간다. 라이브러리의 '정보와 본문' 검색이 자막 문장까지 찾고, 항목 패널 '본문 일치'의 시간 행이 그 시각에서 영상을 연다. 영상 전체 화면은 창 전체 화면 + 무대 모드로 바꿔 macOS 빠른 토글 멈춤을 없앤다.

**Architecture:** 자막 파일은 main만 연다. `L/subtitles/`의 순수 해석기(`readSubtitle`)가 바이트를 인코딩 판별(BOM → 엄격한 UTF-8 → 커밋한 CP949 표) → SRT/VTT 문법 → 글 정리 → 한도로 큐 목록을 만들고, `L/subtitles/attach.ts`가 관리형 사본(가져오기와 같은 스테이징 → 해시 → 원자적 rename)과 한 트랜잭션(자산 → `item_assets(role='subtitle')` → `subtitle_tracks` → `cue_texts`)으로 붙인다. 스키마 v6(마이그레이션 006)이 `subtitle_tracks`·`cue_texts`·`cue_texts_fts`(trigram)를 더한다. 가져오기 줄(`import-queue.enqueue`)은 같은 묶음 안의 같은 이름 자막을 영상 항목에 걸고, 본문 검색(`search:body`)은 쪽 글과 큐 글의 합집합, `search:matches`는 쪽 행 또는 시간 행을 돌려준다. 렌더러의 새 `R/viewers/video/`가 `<video>`(컨트롤 없음) 위에 무대·재생 컨트롤·자막 오버레이·자막 ▾를, 리더 사이드바에 가상화한 대본 칸을 그린다. 모든 키는 명령 레지스트리의 `key`(렌더러 키맵, `event.code`)이고, 영상 전체 화면은 main의 직렬화 상태 기계(`M/video-stage.ts`)가 창 전체 화면과 무대 모드를 함께 정하고 `windowState` 알림으로 렌더러에 알린다.

**Tech Stack:** Electron 44.9.1(Node 24), React 19.3.1, TypeScript 7.0.2, electron-vite 6.0.0, react-aria-components 1.22.1(`Switch` 포함), lucide-react 1.60.0(`captions`·`captions-off`·`volume-2`·`volume-1`·`volume-x`·`maximize`·`minimize`·`rotate-ccw`·`rotate-cw`·`play`·`pause`), @tanstack/react-virtual 3.14.22, @tanstack/react-query 5.104.5, zustand 5.0.15, zod 4.6.7, better-sqlite3 13.0.3(FTS5 trigram), Playwright 1.64.1, vitest 5.0.5(Node 22.19), pnpm 10.15.1, Python 3(표 생성기 하나 — 빌드 도구, 런타임 아님). **새 런타임 의존성 없음.**

**Spec:** `docs/superpowers/specs/2026-11-23-m8a-video-subtitles-design.md`(아래 "명세", 소유자 승인 2026-11-23 "이대로 진행해줘") + `docs/design/design-spec.md`(아래 "디자인 명세") + Task 2에서 소유자가 승인하는 M8a 목업. 코드 사실은 계획 작성 때 m8a 워크트리 HEAD 588b8f5(main 82b0752 + 명세)에서 확인했고 작업 본문에 파일·줄로 적었다(따로 조사 파일 없음).

## 스파이크 결과 (Task 1, 2026-11-23 — 계획 작성 중 컨트롤러가 함)

- 시스템 Node 22.19(full ICU 77.1)의 `new TextDecoder('euc-kr')`는 **엄격한 EUC-KR**이다: `0x81 0x41`(WHATWG euc-kr = windows-949에서 "갂" U+AC02)을 U+0081 U+0041로 푼다. KS X 1001 밖의 한글 음절 8,822자를 못 읽는다 — vitest(Node)와 앱(Electron main)의 결과가 갈릴 수 있다.
- Python 3의 `cp949` 코덱과 WHATWG `index-euc-kr.txt`(Identifier 1d97134c…, 2024-09-18 — 데이터로만 받아 스크래치에서 비교, 저장소에 넣지 않음)를 모든 2바이트 쌍(리드 0x81–0xFE × 트레일 0x41–0xFE)에서 비교했다: 둘 다 **17,048개, 다른 칸 0개**.
- Electron 44 main의 `TextDecoder('euc-kr')`는 이 서버에서 볼 수 없었다(아래 환경 줄) — 판정 P-2로 그 결과가 필요 없어졌다.
- **환경**: 이 계획을 쓴 세션 서버 `bce-colab-g02`(32코어, 부하 평균 약 600, Debian 13)에는 Xvfb·`xvfb-run`·Electron의 GTK 라이브러리(`libgtk-3`·`libatk-1.0` 등)·ffmpeg가 없다. 예전 서버(40코어, Xvfb `:99`)와 다르다. 로컬 E2E·증거·픽스처 영상 생성이 이 서버에서는 돌지 않는다 — 실행 전에 소유자 답으로 E2E 자리를 정한다(P-22).

## 사전 판정 (2026-11-23, 계획 작성 중)

한 줄 = 판정 하나 — 이유 — 틀렸을 때의 비용 → 반영한 작업.

- **P-0 계획의 모양**: M7c·T1a와 같은 절약형 — 작업마다 파일, 인터페이스(정확한 이름·타입), 정확한 값, 시험(순수 모듈은 시험 코드), 단계. 명세가 정확히 정한 긴 내용(006 SQL, 문구 표, 키 표, 상태 표)은 명세 절을 가리키고 서명과 시험을 적는다 — 같은 글을 두 곳에 두면 갈라진다 — 구현자가 명세를 함께 편다.
- **P-1 목업 게이트와 순서**(명세 13절): Task 1(스파이크 — 끝남), Task 2(목업) 뒤, 승인을 기다리는 동안 Task 3–9(화면 무관)를 한다. Task 6·7·9의 E2E는 `window.learn.*`를 직접 부르는 시험이라 픽셀이 없어 승인 전에 든다. Task 10–17은 승인 뒤 — 화면은 승인한 목업이 정본이라 — 승인이 늦으면 화면 작업 전체가 기다린다. → 작업 목록
- **P-2 CP949는 언제나 커밋한 표**(명세 3.3·J1을 고침): 스파이크 결과대로 Node의 `TextDecoder('euc-kr')`가 엄격한 EUC-KR이라, 판별의 셋째 단계는 `TextDecoder`가 아니라 `L/subtitles/cp949.ts`의 `decodeCp949`(WHATWG euc-kr 복호 알고리즘 + 표, 틀린 바이트가 하나라도 있으면 `null`)다. 표는 `scripts/build-cp949.py`(Python `cp949` 코덱 — WHATWG 색인과 같음을 확인함)가 만든 `L/subtitles/cp949-table.ts`(커밋, 손으로 고치지 않음). 앱과 단위 시험이 같은 함수를 지난다. E2E 하나가 표 전체를 Chromium(Blink)의 `TextDecoder('euc-kr')`와 쌍마다 대조한다. UTF-16 BE는 바이트를 바꿔 `utf-16le`로 푼다(작은 ICU에서도 같게). 새 런타임 의존성 없음 — 표 약 64 KB가 main 번들에 든다. 명세 3.3의 "시스템 Node로 표 생성"은 틀린 전제라 이 판정이 대신한다(Task 17이 명세에 적음). → Task 3·17
- **P-3 인코딩 고정 파일**: Node에는 CP949 인코더가 없으므로 `F/static/subtitles/cp949.srt`는 한 번 만들어 커밋한다(`fixtures/static/README.md`에 만든 명령 — `python3 -I -c "…encode('cp949')"` — `locked.pdf`·mutool과 같은 선례). 그 안에 KS X 1001 밖 음절(`똠`, `갂`)을 넣는다. `utf16le.srt`·`utf16be.srt`는 `F/generate.mjs`가 UTF-8 원문에서 `Buffer`로 만든다(BOM 포함). → Task 3
- **P-4 ⌘F는 `library.find`**(명세 6.3·10절의 `reader.find`를 고침): 레지스트리에 `reader.find`가 없다. ⌘F는 `library.find`(`D/commands.ts:299-303`, 리더에서 이름 "찾기")이고 규칙은 `:951`. 영상 갈래는 이 명령에 붙인다 — 규칙 `c.view === 'viewer' ? (c.pdfOpen === true || (c.videoOpen === true && c.videoCaptions === true)) : c.libraryCount > 0`, 처리기는 보이는 리더가 영상이면 대본 검색 칸으로(J8 그대로) — 명령·가속기·메뉴 항목은 하나 그대로. → Task 13
- **P-5 키의 포커스 예외**(명세 6.3): 키맵은 창의 capture 단계라(`R/commands/keymap.ts:47`) 단추가 스페이스를 먼저 받지 못한다. `KeySpec`(`D/accelerator.ts:5`)에 `yields?: true`를 더한다 — "포커스한 컨트롤이 이 키를 쓰면 그쪽이 먼저". 렌더러 `focusOwnsKey(target, code)`(keymap.ts): 스페이스는 `button, a[href], [role=button|link|checkbox|switch|menuitem|menuitemradio|menuitemcheckbox|tab|radio]` 위에서, ←/→는 `[role=slider|tab|radio|menuitem|menuitemradio|menuitemcheckbox|treeitem|row|gridcell]` 위에서, esc는 `[role=menu|listbox|dialog]` 안에서 그 컨트롤의 것이다. `yields` 키가 그 조건이면 `keyCommand`가 `null`. 대본 목록의 `option`에서는 스페이스·←/→가 영상으로 간다(명세 7.2 "목록에서도 한 글자 키는 동작"). → Task 10·11
- **P-6 키 둘인 명령**: 재생/일시정지는 스페이스와 K 둘이다. `CommandSpec`에 `altKey?: KeySpec`(둘째 키)를 더하고 `keyCommand`가 둘 다 맞춰 보며, ⌘/ 시트·팔레트·툴팁은 "K · 스페이스"로 보인다(`keySpecKeys`를 둘 다). `D/test/commands.test.ts:49-61`의 "한 키는 명령 하나"는 둘째 키까지 센다. → Task 10
- **P-7 명령은 화면 작업에서 더한다**: `commands-coverage.spec.ts`는 모든 명령이 실제로 돌았는지 본다(`:921`). 처리기 없는 명령을 승인 전에 넣으면 가짜 컨트롤이라 `video.*` 명령은 Task 10–13이 처리기와 함께 넣는다. 맥락은 새 `CommandContext`를 만들지 않고 `contexts: ['viewer']` + 규칙 `videoOpen`(명세 6.3의 "새 맥락 `video`"는 ⌘/ 시트의 묶음 이름으로 — `R/sheets/shortcuts.ts`의 `ORDER`에 `'video'`, `groupOf`가 `video.` 접두사를 그 묶음으로, `t.sheets.groups.video = '동영상'`) — `CommandContext`는 보기·대상의 종류라 — 없음. → Task 10
- **P-8 토글 이름**(명세 10절): `stateLabels`에 새 키 `toggle: { on: string; off: string }`(지금 누르면 할 동작: on = 상태가 켜졌을 때의 이름). 어느 상태를 보는지는 `TOGGLE_STATE: Partial<Record<CommandId, 'videoPlaying' | 'videoCaptionsOn' | 'videoMuted' | 'videoStage'>>`(`D/commands.ts`), `LabelState`에 그 넷을 더한다. `commandLabel`은 `labels.toggle && state[TOGGLE_STATE[id]] !== undefined`이면 고른다. `commands.test.ts:422`의 "focus 밖 상태 키는 하나"는 그대로 지켜진다. → Task 10·11·12
- **P-9 영상 전체 화면 상태 기계**(명세 6.6·9.1): main의 `createVideoStage(port, opts)`가 바라는 상태 `want = { full, stage }`와 실제 `full`(창), `stage`(무대 모드), 전환 중 `pending`을 든다. 요청: `toggle`(무대 켜기 = `{ full: true, stage: true }`·들어가기 전 `want.full`을 `restore`로 기억 / 끄기 = `{ full: restore, stage: false }`), `exit`(끄기와 같음), `window`(메뉴 ⌃⌘F = `want.full` 뒤집기, 끄면 `stage: false`). 전환 중 온 요청은 `want`만 고치고(마지막 요청이 이김) 사건 뒤에 처리한다. `enter-full-screen`/`leave-full-screen`에서 `pending`을 풀고 실제를 다시 읽고, 요청하지 않은 나가기(신호등 초록 단추)는 `want`를 `{ full: false, stage: false }`로. 사건이 2초 안에 오지 않으면 `isFullScreen()`으로 확정한다(명세 18절). 무대 모드는 `want.stage && full`일 때만 켜진다. 렌더러에는 `WindowState.videoStage: boolean`(`D/events.ts:8`)으로 알린다 — 렌더러는 그 값만 따른다. 메뉴의 `onToggleFullScreen`(`M/index.ts:262-266`)도 이 기계의 `window` 요청이 된다 — 빠른 ⌃⌘F도 같은 직렬화 — 없음. → Task 9·11
- **P-10 `fullscreen` 권한 빼기는 Task 11**: `first-session.spec.ts:129`가 아직 `requestFullscreen`으로 시험하므로 권한과 그 시험을 같은 작업(F 키 길이 생기는 Task 11)에서 바꾼다. → Task 9·11
- **P-11 붙이기 길의 자리**: `L/subtitles/attach.ts`의 `attachSubtitles(deps, itemId, paths)`가 크기 → 읽기 → `readSubtitle` → sha256(읽은 바이트) → `withManagedPath` 안에서 같은 sha의 관리형 자산 재사용 또는 `Importer.placeManaged(src, sha256, signal?)`(새 공개 메서드 — 지금의 비공개 `place`(`L/importer.ts:172-216`)를 감쌈, 스테이징 사본을 다시 해시해 읽은 뒤 파일이 바뀌면 `HASH_MISMATCH` → 실패 `read-failed`) → `SubtitlesRepository.attach` 트랜잭션. 자산의 `mime`은 형식으로(`application/x-subrip`·`text/vtt`), `original_name`은 NFC 파일 이름, 판본 행 하나(앵커의 근거 — 명세 4.2·4.5). vitest가 임시 폴더의 실제 파일로 시험한다. → Task 6
- **P-12 실패 이유의 코드**: main은 문구가 아니라 코드(`SubtitleFailure`)를 보내고 렌더러가 `t.video.failure[code]`로 그린다(본문 문구는 렌더러의 것 — `strings.test.ts:186`의 "main의 한국어는 `M/strings.ts`에만"과 부딪히지 않게). 코드: 해석 넷(`unreadable`·`no-cues`·`too-large`·`too-many-cues`) + `read-failed`("파일을 읽지 못했습니다" — 명세 12절에 없는 입출력 실패, 문구 하나 더함) + `not-subtitle`(확장자) + `unpaired`(짝 없음) + `video-failed`(영상 실패). 같은 영상에 같은 sha는 실패가 아니라 `AttachResult.existing`(이름 목록) → "이미 붙어 있는 자막입니다". → Task 4·6·12·14
- **P-13 짝짓기 규칙의 폴더**: 같은 묶음 안에서도 **같은 폴더**의 파일끼리만 짝짓는다(줄기 비교는 명세 5.2 그대로) — 두 폴더의 `강의.mp4`·`강의.srt`를 한 번에 끌어 놓아도 엇갈리지 않게 — 다른 폴더의 짝이 실패 행이 된다. 같은 줄기의 영상이 둘이면(`a.mp4`·`a.mov`) 묶음 순서의 첫 영상. 영상 판단은 확장자 `VIDEO_EXTENSIONS = ['mp4','m4v','mov','webm','mkv']`(`IMPORT_FILTERS`의 영상 부분)이고, 그 항목의 가져오기 결과가 종류 `video`가 아니면 `video-failed`. → Task 7
- **P-14 500개 나누기**: 렌더러 `inImportCalls`(`R/library/importRunner.ts:10-17`)는 자막 경로가 **있을 때만** 폴더 + 줄기(자막은 언어 꼬리를 뗀 줄기)로 안정 정렬한 뒤 한 묶음이 경계를 넘지 않게 나눈다(500개를 넘는 묶음 하나는 그대로 나눔). 자막이 없으면 지금 순서 그대로 — 가져오는 순서가 바뀌지 않게 — 없음. → Task 7
- **P-15 `search:matches`의 시간 행**: `{ kind: 'time', startMs, snippet, assetId }` — 명세 8.1의 `track: 언어 코드`를 고친다. 언어가 없는 트랙끼리는 이름을 지을 수 없고, 시각에서 열기(8.3)가 그 트랙을 골라야 하므로 자산 id가 필요하다. 렌더러는 트랙이 둘 이상인 자료에서만 트랙 이름(자막 ▾와 같은 `trackNames`)을 붙인다 — 같은 화면, 다른 필드 — 없음. `PendingJump`의 시간 갈래도 `assetId`. → Task 8·15
- **P-16 고아 자막 치우기의 때**(명세 5.5 J7): 시작 점검(`runCheck(…, { startup: true })`, `M/library-check.ts`)이 끝난 뒤 한 번, `SubtitlesRepository.orphanAssets()`(어느 `item_assets`에도 없고 `mime`이 자막인 자산) → `removeUnusedAssets` → 커밋 뒤 파일 지우기(`M/ipc/trash.ts:18-27`의 `removeFilesAfter`와 같은 길). E2E는 훅 `sweepSubtitleOrphans()`로 같은 함수를 바로 부른다(다시 실행 대신). → Task 6
- **P-17 렌더러의 영상 상태**: 탭마다 `ReaderScope.video: StoreApi<VideoStore>`(`R/viewers/readerScope.tsx:14`에 필드 하나, T1a의 `tutor`와 같은 모양)와 활성 탭의 `useVideo` 훅(`useReader`와 같은 길). 명령은 `R/viewers/video/videoActions.ts`(`readerActions`와 같은 `Pick<CommandEnv, …>`)가 `useVideo.getState().handle`을 부른다 — 처리기 없이는 아무것도 돌지 않게. → Task 10
- **P-18 사이드바 갈래**: `NoPages`에 `'noTranscript'`를 더한다("표시할 대본이 없습니다"). `ViewerHost`(`:95-104`)는 동영상의 원본 없음·잃음·열기 실패를 `'noTranscript'`로, 재생할 수 있는 동영상은 `null`로 쓰고, 영상 리더가 재생 불가에서 `setNoPages('reader', 'noTranscript')`. `ReaderSidebar`(`R/viewers/pdf/ReaderSidebar.tsx:27`)는 `noPages`가 없고 자료가 동영상이면 `TranscriptPane`. → Task 10·13
- **P-19 지금 큐 고르기**: `activeCues(cues, ms, maxEnd)` — `maxEnd[i] = max(end[0..i])`를 큐를 받을 때 한 번 만들고, 시작 ≤ ms인 마지막 큐를 이분 탐색한 뒤 `maxEnd[j] > ms`인 동안 뒤로 걸어 `end > ms`인 큐만 모은다(겹침이 길어도 맞고, 보통 O(log n)). 마지막 3개만 그린다(명세 6.4). → Task 12
- **P-20 대본 가상화**: `@tanstack/react-virtual`(이미 의존성, `LibraryTable.tsx:369-381`)과 라이브러리 표의 포커스 규칙(`rangeExtractor`가 커서 행을 늘 그림, `:359-368`). 행 높이가 문장 길이로 달라지므로 `measureElement`. → Task 13
- **P-21 스위치 부품**: `R/ui/Switch.tsx`(react-aria-components `Switch` — 새 의존성 아님, 목업 `.switch`의 모양을 토큰으로). 앱에 스위치가 처음 생긴다 — 다른 화면은 쓰지 않는다. → Task 13
- **P-22 E2E의 자리**(환경): 이 서버에는 Xvfb·GTK·ffmpeg가 없다. 실행 전에 소유자에게 묻는다 — (가) 예전 서버로 세션을 옮김, (나) 사용자 영역에 `micromamba`로 conda-forge의 Xvfb·GTK·ffmpeg를 설치(설치하는 바이너리를 실행함 — 소유자 승인 필요), (다) 단위 시험만 로컬, E2E는 컨트롤러가 브랜치 Linux CI로 작업 묶음마다(실패 메일이 늘 수 있음). 답을 원장 첫머리에 적고 Global Constraints의 "작업마다 녹색" 줄을 그 답대로 읽는다. → 시작 전
- **P-23 Mac 실행**: 중간 `e2e`는 Task 13 뒤(리더와 자막이 끝난 때 — 명세 15절), 끝 `all`은 Task 17, 최종 코드에서 두 번까지, 서로 다른 간헐 실패는 줄마다. 모두 컨트롤러가 `workflow_dispatch`로. → 작업 목록·Task 17
- **P-24 문구 자리**: 렌더러 새 영역 파일 `R/strings/video.ts`(`t.video` — 리더·대본·자막 ▾·붙이기·실패 이유·컨트롤 툴팁·토글 이름), 기존 파일 고침(`drop.ts`의 `subtitle`, `library.ts`의 범위 설명과 결과 없음 덧붙임, `inspector.ts`의 시간 행·"문장 N개"·"자막" 줄, `toast.ts`의 자막 수 덧붙임, `sheets.ts`의 `'동영상'`). 명령 이름은 `D/commands.ts`. 관형사 + 명사·숫자와 단위는 U+00A0(`이 자막`, `5 MB`, `2만 개`). 새 복합어 `'자막 파일'`·`'현재 위치'`·`'본문 일치'`를 `COMPOUNDS`(`R/strings/strings.test.ts:65`)에. → Task 10–15
- **P-25 주석과 기록**: 판정 번호(P-n, Jn)·실행 id·비평 id는 커밋 메시지에만. 새 코드의 주석은 이유만.
- **P-26 점검의 `:148`은 중복 판정이 아니다**(명세 4.2의 "`library-check.ts:148`의 판정도"를 고침): `corruptEntries`(`M/library-check.ts:144-151`)는 격리된 사본의 sha로 **그 파일의 자료 제목**을 찾는 보고다. 원본 역할로 좁히면 자막 사본이 깨졌을 때 영상 제목을 잃어 명세 4.3("그 영상의 제목으로 보고")과 부딪힌다. 그래서 역할 거르기는 `Importer.settle`(`L/importer.ts:118`) 한 곳만이고, `corruptEntries`는 모든 역할을 보되 원본 역할의 자료를 먼저 고른다 — 같은 sha가 한 자료의 원본이면서 다른 자료의 자막일 일은 드묾 — 없음. → Task 5

## Global Constraints

모든 작업의 요구 사항에 아래가 암묵적으로 포함된다. 따옴표 안은 명세 16절 원문이다.

- "새 데이터 객체는 모두 앵커로 주소를 가질 수 있다: 큐는 영상 판본의 `video` 앵커(`startMs`/`endMs`)로(4.5)." M8a는 앵커를 만들지 않는다.
- "AGPL 코드(Zotero reader, zotero-pdf-translate, LibreTranslate, llm-for-zotero)는 보지도 가져오지도 않는다. 런타임 의존성은 정확히 고정하고 **새로 더하지 않는다**(인코딩은 `TextDecoder`, 안 되면 빌드 때 만든 표 — 3.3)." CP949는 P-2대로 언제나 표. `LICENSE`와 `package.json`의 `license` 필드는 건드리지 않는다. `^`·`~` 금지.
- "불신 입력: 자막 파일은 main이 한도 안에서 해석하고(3.7), 렌더러는 큐 글을 글 노드로만 그린다. IPC 입력은 zod, 경로는 절대 경로만." `innerHTML`·`dangerouslySetInnerHTML` 금지(큐 글, 조각, 파일 이름 모두).
- "HTML 전체 화면 API를 쓰지 않는다(`requestFullscreen` 없음, `fullscreen` 권한 거절)." (권한은 Task 11 — P-10)
- "가짜 컨트롤 금지: 시간 메모(M9)는 그리지 않는다. 메뉴·팔레트·키는 레지스트리에서만, 핸들러 없는 항목은 그리지 않는다."
- "한 글자 키는 렌더러 키맵만(메뉴 가속기 금지), `event.code` 비교, 입력란·IME 조합 중 무시." (+ P-5 포커스 예외)
- "문체는 합니다체, 화면 문구는 `strings/` 영역 파일, 조사는 `josa.ts`, U+00A0 규칙. 내부 용어는 화면에 쓰지 않는다." 화면에서 큐는 '문장', 트랙은 '자막', 인코딩은 '글자 인코딩'(실패 이유 한 곳만).
- "가린 탭은 크기 관찰에 반응하지 않는다. 시트 뒤 클릭은 `sheetReleased()` 뒤에."
- "실제 번역 주소를 부르지 않는다 — `google-web.live.test.ts`를 돌리지 않고 `LEARN_TRANSLATION_LIVE`를 켜지 않는다."
- "목업 승인 전에는 UI 구현 없음(13절)." (P-1)
- "구현자는 push·CI 실행·하위 에이전트 실행을 하지 않는다(컨트롤러가 한다). Mac 증거는 컨트롤러만." macOS 워크플로도 돌리지 않는다. 실제 에이전트·연결 도구를 띄우지 않는다.
- **마이그레이션**: 006은 새 표만 더하므로 `foreignKeysOff`를 쓰지 않는다. 실행기(`DB/migrate.ts`)와 `.pre-v6.bak`은 그대로.
- **커밋 꼬리말** — 모든 커밋 끝에 정확히(명세 16절):
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01LH2FDh4QwsGUFR3V2KewHi
  ```
  커밋은 `git commit -F <파일>`, 경로를 하나씩 `git add`.
- **PR 본문 끝**(컨트롤러):
  ```
  🤖 Generated with [Claude Code](https://claude.com/claude-code)

  https://claude.ai/code/session_01LH2FDh4QwsGUFR3V2KewHi
  ```
- **git**: amend 금지, force-push 금지, 그냥 `git stash` 금지(치울 것은 WIP 커밋). `.superpowers/`·`evidence/` 아래는 `git add`하지 않는다.
- **비밀값·자격 증명**: `~/.claude`·`~/.codex`·`~/.learn-live` 아래를 읽거나 고치지 않는다. 소유자의 이메일을 다른 서비스에 보내지 않는다.
- **IPC**: 새·바뀐 채널은 기존 `handle()` 래퍼(`M/ipc/register.ts:106` `createHandle` — 발신자 검사 + zod `.strict()` + Result)와 `M/ipc/channel-kinds.ts` 허용 목록(`MAIN`)을 쓴다. preload는 이름공간 API만(`P/surfaces.test.ts`가 둘을 맞춘다), 알림은 `D/event-channels.ts`·`D/events.ts`·`P/main.ts` `events`·`P/surfaces.test.ts` `EVENTS.main` 네 곳에.
- **토큰만**: 화면 코드에서 색·간격·반경·글자 크기를 직접 쓰지 않는다. 토큰이 아닌 값은 같은 줄에 `/* local: 이유 */`(예: 자막 바탕 `oklch(0% 0 0 / 0.72)`, 오버레이 글 크기 공식). 한글 UI에 700 없음. `css-lint.test.ts`가 막는다. 새 토큰은 `R/design/tokens.ts`에 두고 `pnpm tokens`.
- **시험의 기다림**: 시험은 실제 앱 상태(속성·포커스·훅 값·`currentTime`)를 기다리고 고정 `sleep`/`waitForTimeout`을 쓰지 않는다. "없음"을 확인하는 부정 확인은 같은 경로에서 "있음"을 먼저 확인한(양성 대조) 뒤에만 두고, 남는 고정 대기는 까닭을 주석으로 적는다. 재생 시각에 기대는 시험은 `currentTime`·`paused` 조건으로(명세 18절).
- **부하 경합**: 단일 E2E spec은 `taskset -c 0-1`, 전체는 `taskset -c 0-3`. E2E 화면 1920×1200×24, 증거 1440×900×24. `/home`이 NFS라 가져오기 시간 시험이 로컬에서 실패하는 것은 환경 탓이고 CI가 판정한다(보고서에 적는다).
- **프로세스**: 자기가 띄운 정확한 PID만 끝낸다. `pkill -f` 금지, `find /` 금지, `/tmp`를 쓸어 지우지 않는다(`/tmp/.git`도 그대로). `evidence/` 위에서 `grep -r`을 하지 않는다. Playwright 출력은 `--output=/tmp/<고유 이름>`. 예전 서버라면 Xvfb `:99`(PID 1049723)를 끝내지 않는다(`:100`·`:101`은 우리 것이 아님).
- **내려받은 것**: 내려받거나 푼 파일은 새 빈 폴더에 두고 실행하지 않으며 Python은 `-I`로 읽는다. (P-22 (나)가 승인되면 그 설치만 예외)
- **작업마다 녹색**: 작업을 끝낼 때 `pnpm typecheck`, `pnpm test`, `pnpm tokens:check`, `taskset -c 0-3 pnpm e2e:xvfb`, `taskset -c 0-3 xvfb-run -a -s "-screen 0 1440x900x24" pnpm exec playwright test -c playwright.evidence.config.ts`가 통과한다. 화면을 바꾼 작업은 그 spec을 `taskset -c 0-1 xvfb-run -a -s "-screen 0 1024x768x24" pnpm exec playwright test <spec>`으로도 한 번(Mac 러너 화면 크기). 긴 실행은 포그라운드로 나눠 돌리거나 백그라운드로 돌리고 끝날 때까지 직접 기다린다(포그라운드 `sleep` 금지). 실패하면 실패한 spec만 고쳐 다시, 그다음 전체 한 번 더. **E2E를 이 서버에서 돌릴 수 없으면 P-22의 답대로**(원장 첫머리).

## 검토 절차 (모든 작업)

1. **구현자**: 작업 목록의 모델로. 단계를 순서대로(시험 먼저 → 실패 확인 → 구현 → 통과 → 커밋). 하위 에이전트를 부르지 않는다. 보고서는 컨트롤러가 정한 파일에, 답에는 상태·커밋·시험 한 줄·우려만.
2. **작업 검토**: 명세 준수(작업 요구, Global Constraints, 사전 판정)와 품질(실패할 수 있는 단언인지, 양성 대조, 접근성 속성, 명세 14절 예산에 닿는 복잡도)을 한 번에. 계획과 다르게 구현했다면 이유가 커밋 본문에 있어야 한다. 검토자는 sonnet, **Task 3·6·9는 opus**(불신 입력 해석기와 인코딩, 파일·트랜잭션·관리형 사본, 전체 화면 상태 기계의 경합).
3. **디자인 비평(UI 작업 10–16, opus)**: 승인 목업 렌더와 Linux 투어 PNG를 나란히 놓고 디자인 명세·루브릭으로 blocker/major/minor, blocker·major 0건까지 반복. 라이트·다크 둘 다.
4. **macOS 증거**(P-23의 두 지점): 컨트롤러가 CI 녹색 뒤 `scripts/evidence.sh m8a-video <suite> <label>`.
5. **브랜치 전체 검토(opus)**: Task 17의 Mac `all` 뒤, PR 전에 한 번.

## 경로 줄임말

`D` = `packages/domain/src`, `DB` = `packages/db/src`, `L` = `packages/library/src`, `LS` = `packages/library/src/subtitles`, `M` = `apps/desktop/src/main`, `P` = `apps/desktop/src/preload`, `R` = `apps/desktop/src/renderer/src`, `RV` = `apps/desktop/src/renderer/src/viewers/video`, `E` = `tests/e2e`, `V` = `tests/evidence`, `F` = `fixtures`. 시험 폴더: `packages/<pkg>/test/`, main·렌더러 단위 시험은 원본 옆 `*.test.ts`.

## 작업 목록

| # | 작업 | 화면 | 구현 모델 | 앞선 조건 |
|---|---|---|---|---|
| 1 | CP949 스파이크 — 위 "스파이크 결과", P-2 | 스파이크 | **컨트롤러**(끝남) | — |
| 2 | M8a 목업(명세 13절 ①–⑦) + 비평 + 소유자 승인 | 목업 | sonnet + opus 비평 | — |
| 3 | 자막 해석기(순수): CP949 표·인코딩·SRT/VTT·글 정리·한도·언어 꼬리, 고정 자막 파일 | 화면 무관 (승인 대기 중 진행) | sonnet | 1 |
| 4 | 스키마 v6: 마이그레이션 006 + 자막 도메인 타입·IPC 입력·이벤트 | 화면 무관 (승인 대기 중 진행) | sonnet | 3 |
| 5 | 자막 저장소: 붙이기·목록·큐·제거·되돌리기·고아, 영구 삭제의 큐 글, 중복 판정의 역할, 백업 수 | 화면 무관 (승인 대기 중 진행) | sonnet | 4 |
| 6 | 붙이기 길(main): `attachSubtitles`·`Importer.placeManaged`·`subtitles:*` IPC·알림·preload·시험 훅·고아 치우기·API E2E | 화면 무관 (승인 대기 중 진행) | sonnet | 5 |
| 7 | 가져오기의 같은 이름 묶기: `pairSubtitles`·`enqueue`·`ImportReport.subtitles`·열기 패널 필터·500개 나누기 | 화면 무관 (승인 대기 중 진행) | sonnet | 6 |
| 8 | 자막 본문 검색(main): 큐 질의·합집합·`search:matches`·시드 훅·`search-perf` | 화면 무관 (승인 대기 중 진행) | sonnet | 5 |
| 9 | 영상 전체 화면 상태 기계(main)·`WindowState.videoStage`·`ui:videoStage`·⌃⌘F 길, 설정 셋, locator `captions` | 화면 무관 (승인 대기 중 진행) | sonnet | 4 |
| — | **소유자 목업 승인** (P-1) | | | 2 |
| 10 | 영상 리더 v2: 무대·재생 컨트롤·스크러버·속도 ▾·음량·키·설정 기억·여는 중·재생 불가 안내·F6·읽기 절 E2E | 목업 승인 뒤 | sonnet | 승인, 9 |
| 11 | 영상 전체 화면: 무대 모드·F/esc/단추·컨트롤 숨김·`fullscreen` 권한 빼기·빠른 토글 시험 | 목업 승인 뒤 | sonnet | 10 |
| 12 | 자막 오버레이·자막 ▾·트랙 상태: 기본 트랙·C·추가·제거와 되돌리기·붙이기 토스트·항목 패널 "자막" 줄·CP949 대조 E2E | 목업 승인 뒤 | sonnet | 6, 11 |
| 13 | 대본 칸: 머리·검색·가상 목록·이동·따라가기 스위치·⌘F·끝 상태·`video-perf` | 목업 승인 뒤 | sonnet | 12 |
| — | **Mac 중간 `e2e`** (P-23, 컨트롤러) | | | 13 |
| 14 | 끌어 놓기와 가져오기의 자막 화면: 영상 탭 오버레이·MIME 거르기·드롭 요약·가져오기 토스트·실패 행 | 목업 승인 뒤 | sonnet | 7, 12 |
| 15 | 자막 본문 검색 화면: 범위 설명·결과 없음·시간 행·"문장 N개"·시각에서 열기 | 목업 승인 뒤 | sonnet | 8, 13 |
| 16 | Mac 증거 사진 `m8a-shots`(suite `m8a`)·투어 장면 | 목업 승인 뒤 | sonnet | 15 |
| 17 | 마무리: axe·키보드 여정·`commands-coverage`·데모·문서(명세 17절, P-2·P-4·P-15 고침)·Mac `all` | 목업 승인 뒤 | sonnet(+컨트롤러) | 16 |

## 작업 사이의 계약 (요약 — 작업 본문의 Interfaces가 정본)

- Task 3 → 4·5·6·7·12: `LS/index.ts`의 `readSubtitle(bytes, name): SubtitleResult`, `decodeSubtitle(bytes): { text, encoding } | null`, `decodeCp949(bytes): string | null`, `CP949_COUNT`, `F/static/subtitles/*`, `F/generated/{utf16le,utf16be,long-2000,limit-20000,too-large}.srt`, `lecture-60s.mp4`. 타입은 Task 3이 `D/subtitles.ts`에 처음 만든다(`Cue`·`SubtitleFormat`·`SubtitleEncoding`·`SubtitleParseFailure`·`SubtitleResult`·`SUBTITLE_LIMITS`·`languageOfName`·`subtitleStem`·`isSubtitleName`).
- Task 4 → 5–15: 스키마 v6(`LATEST_SCHEMA_VERSION` 6), `D/subtitles.ts`에 `SubtitleTrack`·`SubtitleFailure`·`AttachResult`·`SUBTITLE_MIME`·`VIDEO_EXTENSIONS`, `D/ipc.ts`의 `subtitlesItemInput`·`subtitleAssetInput`·`subtitlesAttachInput`·`subtitlesRestoreInput`·`searchMatchesInput`.
- Task 5 → 6·7·8: `SubtitlesRepository`(아래 서명), `LibraryContext.subtitles`, `LibraryCounts.subtitleTracks`, `removeUnusedAssets`의 `cue_texts`, `itemIdsForAsset(assetId, role?)`.
- Task 6 → 7·12·14: `attachSubtitles`, `Importer.placeManaged`, `LearnApi.subtitles`·`Channels.subtitles`·`window.learn.subtitles.{list,cues,pick,attach,remove,restore}`, 알림 `'subtitles:changed'`, 훅 `cueTextCount`·`sweepSubtitleOrphans`·`subtitleAssetCount`, E2E 도우미 같은 이름(`E/helpers.ts`), `E/subtitles-api.spec.ts`.
- Task 7 → 14: `pairSubtitles`(`D/subtitles.ts`), `ImportReport.subtitles`, `groupForImport`(`R/library/importRunner.ts`).
- Task 8 → 15: `BodyMatch`·`BodyMatches`(`D/body-search.ts`), `window.learn.search.matches`, `cueItemIds`·`cueLikeChunks`·`cueMatches`(`DB/body-search.ts`), 훅 `seedCues`.
- Task 9 → 10·11: `createVideoStage`·`VideoStagePort`·`VideoStage`(`M/video-stage.ts`), `WindowState.videoStage`, `window.learn.ui.videoStage({ action })`, 설정 `video.playbackRate`·`video.volume`·`video.muted`, `PLAYBACK_RATES`, locator `captions`.
- Task 10 → 11–16: `RV/VideoReader.tsx`, `VideoStore`·`VideoHandle`·`ReaderScope.video`·`useVideo`, `videoActions`, `formatClock`·`spokenClock`, `CommandContextState.videoOpen/videoPlaying/videoMuted`, `KeySpec.yields`, `CommandSpec.altKey`, `stateLabels.toggle`·`TOGGLE_STATE`, `M8A_COMMANDS`, `window.__learnVideo`(시험 손잡이), `NoPages` `'noTranscript'`, `R/strings/video.ts`.
- Task 11 → 12–16: `useVideoStage()`, `CommandContextState.videoStage`, `.video-reader[data-stage]`.
- Task 12 → 13–16: `useSubtitles(itemId)`(`tracks`·`cues`), `trackNames`·`pickTrack`·`activeCues`·`cueMaxEnds`, `VideoStore.track/captionsOn/cues`, `CommandContextState.videoCaptions/videoCaptionsOn`, `SubtitlesMenu`, `R/inspector/FileSection.tsx`의 `data-field="subtitles"`.
- Task 13 → 15·16: `RV/TranscriptPane.tsx`, `transcriptMatches`·`stepMatch`, `VideoStore.transcript`(질의·지금 일치·따라가기), `R/ui/Switch.tsx`, `V/video-perf.evidence.ts`.
- Task 15 → 16·17: `PendingJump`(쪽 | 시간), `CommandEnv.openAt`.

## 시작 전

- 워크트리 `/home/baejs/projects/tutor/.worktrees/m8a`, 브랜치 `m8a-video`(upstream 없음 — 컨트롤러가 `git push origin HEAD:refs/heads/m8a-video`). 워크트리에 `node_modules`가 없다: `pnpm install --frozen-lockfile` 다음 `pnpm fixtures`(영상 픽스처는 ffmpeg가 필요하다 — P-22).
- **P-22 답**: 컨트롤러가 소유자에게 묻고 원장 첫머리에 적는다. 답이 오기 전에도 Task 2(목업 — 렌더는 Playwright Chromium이라 같은 라이브러리 문제가 있을 수 있음, 그때는 Task 3부터)와 Task 3–5(단위 시험만)는 진행할 수 있다.
- 기준선: Task 3 전에 컨트롤러가 `pnpm typecheck && pnpm test`로 녹색을 확인한다(NFS에서 흔들리는 import 시간 시험은 Global Constraints의 "부하 경합" 줄대로 판정).
- 컨트롤러가 이 계획을 커밋한다.

---

### Task 1: CP949 스파이크 (컨트롤러, 명세 3.3) — 끝남

위 "스파이크 결과"와 P-2·P-3이 결과다. 남는 일은 Task 3(표 생성기와 디코더), Task 12(Blink 대조 E2E), Task 17(명세 3.3 고침)이 한다. 스크래치의 WHATWG 색인 파일은 저장소에 넣지 않는다.

---

### Task 2: M8a 목업 (명세 13절 ①–⑦)

**Files:**
- Modify: `docs/design/mockups/assets/views.js`(`videoWindow`·`videoMain`·`videoSidebar`·`videoControls`(`:1702-1807`)에 `m=8a` 분기 — 옛 장면은 그대로 둔다. `libraryWindow`(`:671`)의 `m=8a` 분기, 파일 머리 주석(`:1-29`)의 쿼리 목록), `docs/design/mockups/assets/mockup.css`(`.video-*`·`.subtitle`·`.cue`·`.transcript-foot`(`:1891-2101`) 옆에 새 상태), `docs/design/mockups/assets/data.js`(큐 2,000개 대신 장면용 30줄, 영어 트랙 문장, 본문 일치 시간 행), `docs/design/mockups/assets/icons.js`(`node scripts/build-mockup-icons.mjs` — `captions-off`·`volume-1`·`volume-x`·`minimize`·`pause`·`rotate-cw`가 없으면 더함), `scripts/mockups/manifest.mjs`(`Render.group`(`:4`)에 `'m8a'`, M7c 블록(`:156-206`)과 같은 모양의 M8a 블록), `docs/design/design-spec.md`(10.4 `reader-video.html` 쿼리 목록에 `m=8a` 쿼리, 10.1 `library.html` 쿼리 목록에 `m=8a` 쿼리)

**Interfaces:**
- Produces: 렌더 이름(아래), 새 요소의 `data-ms="M8a …"`(시간 메모는 `M9` 그대로 — `m=8a` 장면에는 그리지 않음). Task 10–16 비평의 짝.

요구 사항(명세 6–8·12·13절):
- `reader-video.html?m=8a` — M7b 이후 규칙: 리더 도구 막대 44에 **제목 없음**, 오른쪽 **자막 ▾만**(시간 메모 단추 없음). 사이드바 머리는 세그먼트 없이 "대본" 한 줄(패널 머리 문법). 스크러버의 메모 점 없음.
  - ① 기본(정지, 재생 단추 `play`) · `play=1`(재생 중 — `pause` 아이콘, 툴팁 이름 "일시정지") · `hover=1`(스크러버 6 높이·손잡이 12·`.hover-time` 말풍선 "24:05") · `drag=1`(손잡이 14) · 속도 단추 "1.25×" · `muted=1`(`volume-x`, 막대 비움) · `sub=2`(두 줄 자막 오버레이) · 라이트·다크.
  - ② `menu=subtitles`(한국어 ✓ · 영어 · 끄기 `C` · — · 자막 파일 추가… · — · 이 자막 제거) · `menu=speed`(0.5× · 0.75× · 1× · 1.25× ✓ · 1.5× · 1.75× · 2×) · `state=nosubs&menu=subtitles`(자막 파일 추가… 한 줄).
  - ③ 대본 칸: 기본(지금 큐 `--accent-soft`, 지나간 문장 2차색) · `state=match`(검색 "증폭" · "2개" · `<mark>`) · `state=nomatch`(빈 상태 문구 — 명세 7.4) · `state=nosubs`(명세 12절 빈 상태 + [자막 파일 추가…], 컨트롤의 자막 단추 비활성) · `follow=0`(스위치 꺼짐, 목록이 지금 큐에서 벗어남) · `cursor=1`(행 포커스 고리 `.is-cursor`) · `long=1`(세 줄로 넘는 긴 문장) · `wrap=1`(개수 자리 "처음부터 · 1 / 2").
  - ④ `drop=subs`(사이드바 오른쪽 리더 전체를 덮는 오버레이: 56 타일 `captions` + "자막으로 붙이기" + "SRT · VTT 파일을 이 동영상에 붙입니다" — 창 드롭 오버레이 문법, 복사/연결 카드 없음) · `toast=attached`("자막 1개를 붙였습니다") · `toast=attach-failed`(머리 "자막 1개를 붙이지 못했습니다" + 행 "broken.srt — 자막 문장을 찾지 못했습니다") · `toast=removed`("‘영어’ 자막을 제거했습니다" + [실행 취소]) · `toast=existing`("이미 붙어 있는 자막입니다").
  - ⑤ `full=1`(무대 모드: 탭 줄·사이드바·도구 막대 없음, 무대 + 컨트롤이 창을 채움, 전체 화면 단추 `minimize`) · `full=1&idle=1`(컨트롤과 포인터 숨김, 오버레이가 컨트롤 자리까지 내려옴).
  - ⑥ `w=1024` · `w=960`(리더 폭 < 560 — 음량 막대 접힘, 음소거 단추만) · `w=960&hover=volume`(막대가 단추 위로 뜸) · `codec=1&w=1024`(재생 불가 안내가 `.stage-center` 안, 단추 둘이 줄바꿈 — 명세 9.2) · `state=opening`(어두운 무대, 컨트롤 비활성, 사이드바 머리 + 자리 상자).
- `library.html?m=8a` — ⑦ `panel=video`(파일 절 "자막 · 한국어 · 영어") · `panel=video&matches=time`(본문 일치: 머리 "본문 일치" + 3차색 "문장 3개", 행 "18:20" + 두 줄 조각) · `matches=time2`(트랙 둘: "18:20 · 영어") · `search=scope-menu`(정보와 본문 설명 "PDF 본문·자막 포함") · `state=noresults&scope=fulltext`(덧붙임 "·PDF 본문·자막") · `state=drop`("파일 3개(동영상 1 · 자막 2)") · `toast=unpaired`(가져오기 실패 토스트: 행 "notes.ko.srt — 자막 파일은 동영상에 붙입니다" + 공통 안내 "동영상 탭에 끌어 놓거나 자막 ▾의 ‘자막 파일 추가…’로 붙이세요.").
- 오버레이 글 크기는 목업에서도 공식대로(`clamp(14px, 3.1cqh, 40px)`처럼 상자 높이 비례 — 720 상자에서 22/32).
- `manifest.mjs`: `variant(screen, t, 'B', query, suffix, label)` 모양의 M8a 블록(라이트·다크, `group: 'm8a'`), `--only m8a`로 렌더. 기본 28장은 그대로.

- [ ] **Step 1**: 위 쿼리를 구현하고 `pnpm mockups:render -- --only m8a`로 PNG를 만든다(렌더가 이 서버에서 돌지 않으면 보고서에 적고 컨트롤러가 P-22 자리에서 렌더).
- [ ] **Step 2**: 디자인 명세 10.4·10.1의 쿼리 목록을 적는다.
- [ ] **Step 3**: 커밋 `docs(m8a): mockups — the video reader's controls, subtitle and speed menus, transcript states, drop and toasts, stage mode, narrow windows and the fixed codec notice; the library's subtitle row, time matches and scope copy`.
- 컨트롤러: opus 디자인 비평(디자인 명세 2.1·2.5·6·7.3·7.4·10.1·10.4, 루브릭, M1 승인 `reader-video.html`과 대조) → blocker/major 0건까지 → Artifact와 대조표로 소유자 승인. 승인과 바뀐 문구는 명세 0절 표와 12절에 적는다.

---

### Task 3: 자막 해석기 (순수) — CP949 표·인코딩·SRT/VTT·글 정리·한도·언어 꼬리

**Files:**
- Create: `scripts/build-cp949.py`, `LS/cp949-table.ts`(생성물, 커밋), `LS/cp949.ts`, `LS/decode.ts`, `LS/parse.ts`, `LS/clean.ts`, `LS/index.ts`, `D/subtitles.ts`, `packages/library/test/subtitles.test.ts`, `packages/library/test/cp949.test.ts`, `packages/domain/test/subtitles.test.ts`, `F/static/subtitles/lecture-60s.ko.srt`, `F/static/subtitles/lecture-60s.en.vtt`, `F/static/subtitles/broken.srt`, `F/static/subtitles/notes.ko.srt`, `F/static/subtitles/cp949.srt`
- Modify: `L/index.ts`(내보내기), `D/index.ts`(내보내기), `F/generate.mjs`(정적 자막 복사 + 생성 다섯 + `lecture-60s.mp4`), `F/static/README.md`(cp949.srt를 만든 명령, 문장의 출처 "이 저장소가 쓴 문장")

**Interfaces:**
- Produces (`D/subtitles.ts`):
  ```ts
  export const SUBTITLE_LIMITS = { bytes: 5 * 1024 * 1024, cues: 20_000, cueChars: 1_000, maxMs: 24 * 60 * 60 * 1000, lines: 3, attachPaths: 50 } as const;
  export const SUBTITLE_EXTENSIONS = ['srt', 'vtt'] as const;
  export interface Cue { startMs: number; endMs: number; text: string }
  export type SubtitleFormat = 'srt' | 'vtt';
  export type SubtitleEncoding = 'utf-8' | 'utf-8-bom' | 'utf-16le' | 'utf-16be' | 'cp949';
  export type SubtitleParseFailure = 'unreadable' | 'no-cues' | 'too-large' | 'too-many-cues';
  export type SubtitleResult =
    | { ok: true; format: SubtitleFormat; encoding: SubtitleEncoding; language: string | null; cues: Cue[] }
    | { ok: false; reason: SubtitleParseFailure };
  /** NFC basename → its language tail (명세 3.8) or null. */
  export function languageOfName(name: string): string | null;
  /** NFC, lower-cased basename without the extension, and without a language tail when `dropLanguage`. */
  export function subtitleStem(name: string, dropLanguage?: boolean): string;
  export function isSubtitleName(name: string): boolean; // .srt / .vtt, 대소문자 무시
  ```
- Produces (`LS/index.ts`): `readSubtitle(bytes: Uint8Array, name: string): SubtitleResult`, `decodeSubtitle(bytes: Uint8Array): { text: string; encoding: SubtitleEncoding } | null`, 그리고 `LS/cp949.ts`의 `decodeCp949(bytes: Uint8Array): string | null`, `CP949_COUNT`.

요구 사항(명세 3절 전부 + P-2·P-3):
- `scripts/build-cp949.py`: 리드 0x81–0xFE × 트레일 0x41–0xFE를 `bytes([lead, trail]).decode('cp949')`로 풀어(실패·두 글자 이상은 0) 리틀 엔디언 `uint16` 배열 23,940칸(포인터 = (lead − 0x81) × 190 + (trail − 0x41))을 만들고, 0이 아닌 칸이 **17,048**인지 `assert`, 모든 값이 BMP인지 `assert`, base64로 `LS/cp949-table.ts`를 쓴다:
  ```ts
  // Generated by scripts/build-cp949.py from Python's cp949 codec (= the WHATWG euc-kr index). Do not edit.
  export const CP949_COUNT = 17048;
  export const CP949_TABLE_BASE64 = '…';
  ```
  실행: `python3 -I scripts/build-cp949.py`(인자 없음, 저장소 루트 기준 경로).
- `decodeCp949`: WHATWG euc-kr 복호 — 0x00–0x7F 그대로, 0x81–0xFE 리드 + 0x41–0xFE 트레일 → 표, 표가 0이거나, 리드 뒤 바이트가 없거나 범위 밖이거나, 0x80·0xFF면 **`null`**(엄격 — 명세 3.7의 "디코드 실패"). 표는 처음 부를 때 한 번 푼다(`Buffer.from(…, 'base64')`, `DataView.getUint16(i * 2, true)`).
- `decodeSubtitle`: BOM `EF BB BF` → `utf-8-bom`, `FF FE` → `utf-16le`, `FE FF` → `utf-16be`(짝수 바이트를 바꿔 `utf-16le`로; 홀수 길이면 `null`) — 셋 다 `TextDecoder(…, { fatal: true })`, 실패면 `null`. BOM이 없으면 `new TextDecoder('utf-8', { fatal: true })` → 실패면 `decodeCp949` → `null`이면 `null`. 돌려주는 글은 NFC.
- `readSubtitle`: 길이 > `SUBTITLE_LIMITS.bytes`면 디코드 전에 `too-large`. 디코드 `null`이면 `unreadable`. 형식은 내용으로(첫 줄의 BOM·공백 뒤가 `WEBVTT`로 시작 → VTT, 아니면 SRT). 블록 나누기·시간 줄·글 줄·VTT 머리와 `NOTE`/`STYLE`/`REGION`·식별자·설정 꼬리 — 명세 3.4·3.5. 시간의 소수 자리 1–3은 **소수**로 읽는다(`,5` = 500ms, `,25` = 250ms). 시간 줄이 앞뒤 공백을 가져도 받는다(명세 18절 방언). 글 정리 — 명세 3.6(태그 먼저 지우고 개체를 푼다: `&lt;b&gt;`는 글 `<b>`로 남음, 루비는 `<rt>` 안 글을 버림, 줄 넷 이상은 셋째 줄에 공백으로 이음, 줄마다 앞뒤 공백 지움, 빈 큐 버림). 1,000자(코드 포인트)를 넘는 큐는 앞 999자 + `…`. 시간 ≥ 24시간이거나 끝 ≤ 시작인 큐는 버린다. 남은 큐가 `SUBTITLE_LIMITS.cues`를 넘으면 `too-many-cues`, 0이면 `no-cues`. 시작 시각으로 안정 정렬. 언어는 `languageOfName(name)` → 없으면 VTT 머리 `Language:`(꼬리 규칙과 같은 정규식으로 검사) → `null`.
- `languageOfName`: 이름(NFC)의 확장자를 뗀 뒤 마지막 마디가 `^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$`이면 그 값, 세 글자 `kor·eng·jpn·zho·chi·deu·ger·fra·fre·spa`는 `ko·en·ja·zh·zh·de·de·fr·fr·es`. 마디가 하나뿐인 이름(`ko.srt`)은 꼬리가 아니다.
- 픽스처(명세 15절 "픽스처"): 커밋 넷은 이 저장소가 쓴 한국어·영어 강의 문장(제3자 저작물 없음) — `lecture-60s.ko.srt`(60초 안 큐 약 20개, 두 줄 큐 하나, 겹치는 큐 하나, `<i>` 태그 하나, 첫 큐 0:01–0:04 "오늘은 세포 신호 전달을 살펴봅니다."), `lecture-60s.en.vtt`(같은 시간의 영어, `Language: en` 머리, `NOTE` 블록, 설정 꼬리), `broken.srt`(시간 줄 없는 글 블록만 — `no-cues`), `notes.ko.srt`(짝 없는 정상 자막). `cp949.srt`는 `lecture-60s.ko.srt`의 앞 세 큐 + 첫 문장 끝에 "똠 갂"을 더해 cp949로 인코딩(README에 명령). 생성(`F/generate.mjs`, ffmpeg 없이 Node만): `utf16le.srt`·`utf16be.srt`(cp949.srt와 같은 문장, BOM 포함), `long-2000.srt`(큐 2,000개, 1.5초 간격, 합성 문장 `문장 0001 세포 신호 전달 …`), `limit-20000.srt`(큐 정확히 2만 개), `too-large.srt`(5 MiB + 1바이트 넘는 유효 SRT). 영상: `lecture-60s.mp4` — `sample-h264-aac.mp4`(`:389-395`)와 같은 인자에 `-t 60`, `testsrc2=size=1280x720:rate=30`, `-b:v 300k`(작게).

시험(`packages/library/test/subtitles.test.ts` — 핵심 사례, 나머지는 명세 15절 "해석기" 목록을 빠짐없이):
```ts
import { describe, expect, test } from 'vitest';
import { readSubtitle, decodeSubtitle } from '../src/subtitles';

const utf8 = (s: string) => new TextEncoder().encode(s);
const cues = (r: ReturnType<typeof readSubtitle>) => (r.ok ? r.cues : r.reason);

test('SRT: no numbers, CRLF, a dot, hours left out, coordinates dropped, fractions as fractions', () => {
  const r = readSubtitle(utf8('00:00:01,000 --> 00:00:02,500 X1:10 X2:20\r\n첫 문장\r\n\r\n2\r\n00:03.5 --> 00:04.25\r\n둘째\r\n'), 'a.srt');
  expect(r).toEqual({ ok: true, format: 'srt', encoding: 'utf-8', language: null,
    cues: [{ startMs: 1000, endMs: 2500, text: '첫 문장' }, { startMs: 3500, endMs: 4250, text: '둘째' }] });
});
test('VTT: Language header, NOTE/STYLE skipped, identifier and settings dropped, tags then entities', () => {
  const r = readSubtitle(utf8('WEBVTT\nLanguage: en\n\nNOTE a note\n\nSTYLE\n::cue { color: red }\n\nintro\n00:01.000 --> 00:02.000 position:10% align:start\n<v Kim><i>Hello</i> &amp; &lt;b&gt;</v>\n'), 'x.vtt');
  expect(r).toMatchObject({ ok: true, format: 'vtt', language: 'en', cues: [{ startMs: 1000, endMs: 2000, text: 'Hello & <b>' }] });
});
test('ruby text, timestamp tags and ASS overrides go; unknown entities stay; a fourth line joins the third', () => {
  const r = readSubtitle(utf8('1\n00:00:01,000 --> 00:00:02,000\n{\\an8}<ruby>漢<rt>かん</rt></ruby> <00:00:01.500>a &foo;\nb\nc\nd\n'), 'a.srt');
  expect(cues(r)).toEqual([{ startMs: 1000, endMs: 2000, text: '漢 a &foo;\nb\nc d' }]);
});
test('backwards, 24 h and empty cues drop; the rest sort by start, overlaps stay', () => { /* 명세 3.7 표 */ });
test('limits: too-large before decoding, too-many-cues, a long cue cut to 999 + …, no-cues', () => { /* SUBTITLE_LIMITS */ });
test('five encodings give the same cues', () => { /* utf-8, BOM, UTF-16 LE/BE (BOM), CP949 bytes (0xB0 0xA1 = 가, 0x81 0x41 = 갂) */ });
test('bytes that are neither UTF-8 nor CP949 are unreadable', () => {
  expect(readSubtitle(Uint8Array.of(0x31, 0x0a, 0x80, 0xff), 'a.srt')).toEqual({ ok: false, reason: 'unreadable' });
});
test('the limit file parses within a second', () => { /* 2만 큐를 메모리에서 만들어 performance.now(), console.log('[measure] subtitle-parse', ms) */ });
```
`packages/library/test/cp949.test.ts`: `CP949_COUNT === 17048`이고 표의 0 아닌 칸 수가 같음, `decodeCp949(Uint8Array.of(0xb0, 0xa1, 0x81, 0x41, 0x41)) === '가갂A'`, `0x80`·`0xff`·끝의 외톨이 리드·`0xc9 0xa1`(사용자 정의 영역 — 표 0)이 `null`. `packages/domain/test/subtitles.test.ts`: `languageOfName` 표(`강의.ko.srt`→`ko`, `lecture.en-US.vtt`→`en-US`, `강의.kor.srt`→`ko`, `lecture.v2.srt`→`null`, `lecture.srt`→`null`, `ko.srt`→`null`, NFD 이름도 같음), `subtitleStem`, `isSubtitleName`.

- [ ] **Step 1**: `scripts/build-cp949.py`를 쓰고 `python3 -I scripts/build-cp949.py`로 `LS/cp949-table.ts`를 만든다.
- [ ] **Step 2**: 시험 셋을 쓰고 `pnpm vitest run packages/library/test/subtitles.test.ts packages/library/test/cp949.test.ts packages/domain/test/subtitles.test.ts` → 모듈 없음으로 실패.
- [ ] **Step 3**: `D/subtitles.ts`, `LS/cp949.ts`·`decode.ts`·`clean.ts`·`parse.ts`·`index.ts`를 구현한다.
- [ ] **Step 4**: 시험 통과, 측정값을 보고서에.
- [ ] **Step 5**: 픽스처(정적 다섯 + README, `generate.mjs`의 생성 여섯)를 더한다. ffmpeg가 없으면 `lecture-60s.mp4`만 건너뛰는지 확인(기존 `need`·`runFfmpeg` 규칙 — 없으면 오류가 맞으면 보고서에 적음).
- [ ] **Step 6**: 녹색 확인 후 커밋 `feat(subtitles): the SRT/VTT parser — BOM, strict UTF-8 and a committed CP949 table, tags and entities, limits, language tails; subtitle fixtures`.

---

### Task 4: 스키마 v6 — 마이그레이션 006 + 자막 도메인 타입·IPC 입력·이벤트

**Files:**
- Create: `DB/migrations/006-subtitles.ts`
- Modify: `DB/migrations/index.ts`(`MIGRATIONS`에 `{ version: 6, name: 'subtitles', sql }`), `packages/db/test/migrate.test.ts`(`:43` 6, 새 v5 → v6 시험, 1만 항목 시간), `D/subtitles.ts`, `D/ipc.ts`(입력 스키마만)

**Interfaces:**
- Consumes: Task 3의 `Cue`·`SubtitleParseFailure`.
- Produces (`D/subtitles.ts`에 더함):
  ```ts
  export const VIDEO_EXTENSIONS = ['mp4', 'm4v', 'mov', 'webm', 'mkv'] as const;
  export const SUBTITLE_MIME = { srt: 'application/x-subrip', vtt: 'text/vtt' } as const;
  export type SubtitleFailure = SubtitleParseFailure | 'read-failed' | 'not-subtitle' | 'unpaired' | 'video-failed';
  export interface SubtitleTrack { assetId: string; language: string | null; position: number; originalName: string; cueCount: number }
  export interface AttachResult { added: SubtitleTrack[]; existing: string[]; failed: Array<{ name: string; reason: SubtitleFailure }> }
  ```
- Produces (`D/ipc.ts`): `subtitlesItemInput = z.object({ itemId: z.uuid() }).strict()`, `subtitleAssetInput = z.object({ itemId: z.uuid(), assetId: z.uuid() }).strict()`, `subtitlesAttachInput = z.object({ itemId: z.uuid(), paths: z.array(absolutePathSchema).min(1).max(SUBTITLE_LIMITS.attachPaths) }).strict()`, `subtitlesRestoreInput = subtitleAssetInput.extend({ position: z.number().int().min(0) }).strict()`, `searchMatchesInput`(지금의 `bodyPagesInput`(`:48`)과 같은 모양 — 새 이름만 더하고, 옛 이름과 채널 바꾸기는 Task 8).
- **이 작업은 `LearnApi`·`Channels`·이벤트를 건드리지 않는다**: `Channel`이 `LearnApi` × `Channels`에서 나오고(`M/ipc/register.ts:73-79`) `CHANNEL_KINDS`가 `Record<Channel, …>`라, 채널을 더하는 순간 main 처리기와 preload 노출(`P/surfaces.test.ts`)이 함께 필요하다 — 그래서 `LearnApi.subtitles`·`Channels.subtitles`·이벤트 `'subtitles:changed'`는 처리기와 같은 Task 6에서 더한다.

요구 사항: 006 SQL은 명세 4.1 그대로(트리거 셋은 `DB/migrations/004-images-text.ts:61-70`의 `page_texts_*`와 같은 모양으로 `cue_texts_ai`·`_ad`·`_au`). `foreignKeysOff` 없음.

시험(`migrate.test.ts`, v4 → v5 시험(`:374-422`)과 같은 틀):
- `seedV5(db)`: v5까지 올린 DB에 PDF·동영상·이미지 자료, 휴지통 자료, 쪽 글 한 줄, 대화·메시지·출처 한 벌, 앵커(쪽·span·image) — `KEPT` 표 목록(v5의 모든 표) 행과 rowid가 006 뒤 같음.
- 결과 `{ from: 5, to: 6, backupFile: \`${file}.pre-v6.bak\` }`, `foreign_key_check` 빈 배열, `PRAGMA foreign_keys = 1`, 새 표 둘과 색인 `subtitle_tracks_asset`·`cue_texts_time`, 트리거 셋, 스냅숏의 `currentVersion === 5`.
- `cue_texts_fts`: 넣기 → MATCH 한 줄, 고치기 → 옛 글 안 맞고 새 글 맞음, 지우기 → 안 맞음(`:360-371`과 같은 모양).
- 복합 외래 키: `item_assets(role='subtitle')` 행이 없는 `subtitle_tracks` 넣기는 실패, 그 `item_assets` 행을 지우면 트랙 행이 따라 지워짐, **자료를 지우면**(`items` → `item_assets` → `subtitle_tracks`) 두 단계로 따라 지워짐.
- CHECK: `role <> 'subtitle'`, `language` 1자·36자, `end_ms <= start_ms` 실패.
- 1만 항목 006이 1초 안(`'[measure] migrate-006'`).

- [ ] **Step 1**: 시험을 쓰고 실패 확인(`pnpm vitest run packages/db/test/migrate.test.ts`).
- [ ] **Step 2**: 006과 `MIGRATIONS`, 도메인 타입·입력·채널·이벤트를 더한다.
- [ ] **Step 3**: 통과. `smoke`·`backup` 등 스키마 판을 적은 시험이 있으면 6으로(`grep -rn "schemaVersion\|LATEST_SCHEMA_VERSION" packages tests apps --include=*.ts`).
- [ ] **Step 4**: 녹색 확인 후 커밋 `feat(db): schema v6 — subtitle_tracks over item_assets' subtitle role, cue_texts with a trigram index; the subtitle domain types, inputs and event`.

---

### Task 5: 자막 저장소 — 붙이기·목록·큐·제거·되돌리기·고아, 영구 삭제의 큐 글, 중복 판정의 역할, 백업 수

**Files:**
- Create: `DB/subtitles-repository.ts`, `packages/db/test/subtitles-repository.test.ts`
- Modify: `DB/index.ts`, `DB/trash.ts`(`:168-175`), `DB/library-repository.ts`(`itemIdsForAsset`(`:170-176`)에 역할 인자, `LibraryCounts`(`:42-58`)·`counts()`(`:488-506`)에 `subtitleTracks`), `L/importer.ts`(`:117-118`), `M/library-check.ts`(`:148`), `L/backup.ts`(`:141-150`에 `subtitleTracks: z.number().int().nonnegative().optional()`), 그 시험들(`packages/db/test/trash.test.ts`·`packages/library/test/importer.test.ts`·`packages/library/test/backup.test.ts`)

**Interfaces:**
- Consumes: Task 4의 스키마·`SubtitleTrack`·`Cue`, `AssetRow`(`DB/library-repository.ts:14-29`).
- Produces:
  ```ts
  export interface NewSubtitleRecord {
    itemId: string; asset: AssetRow; assetIsNew: boolean; revision: { id: string; createdAt: string } | null;
    language: string | null; cues: readonly Cue[]; now: string;
  }
  export class SubtitlesRepository {
    constructor(db: Database);
    /** 순서(position, created_at, rowid)대로. 큐 수는 그 자산 sha의 cue_texts 수. */
    tracks(itemId: string): SubtitleTrack[];
    /** 그 자료에 붙은 자산이 아니면 []. 시작 순. */
    cues(itemId: string, assetId: string): Cue[];
    /** 한 트랜잭션: 자산(assetIsNew) → 판본 → item_assets(subtitle) → subtitle_tracks(position = max + 1, 없으면 0) → cue_texts(ON CONFLICT DO NOTHING). 이미 이어져 있으면 아무것도 쓰지 않고 'existing'. */
    attach(rec: NewSubtitleRecord): SubtitleTrack | 'existing';
    /** item_assets 행을 지운다(트랙 행은 따라 지워짐). 없으면 LearnError NOT_FOUND. */
    remove(itemId: string, assetId: string): { position: number; language: string | null };
    /** 같은 자산·같은 순서로 다시 잇는다. 자산이 없으면 NOT_FOUND, 이미 이어져 있으면 그 트랙. */
    restore(itemId: string, assetId: string, position: number, now: string): SubtitleTrack;
    /** 어느 item_assets에도 없고 mime이 SUBTITLE_MIME 값인 자산. */
    orphanAssets(): string[];
    cueTextCount(sha256: string): number;
    count(): number; // subtitle_tracks 행 수
  }
  ```
  `LibraryRepository.itemIdsForAsset(assetId: string, role?: 'original' | 'subtitle' | 'derived'): string[]`(역할을 주면 그 역할만), `LibraryCounts.subtitleTracks: number`.

요구 사항(명세 4.1–4.3):
- `attach`의 자료 검사: 자료가 있고, 휴지통이 아니고, 종류 `video`가 아니면 `LearnError('VALIDATION_FAILED', …)`(main 내부 문장 — 화면 문구 아님, `M/strings.ts`가 아닌 영어 메시지면 `strings.test.ts:186`에 걸리지 않음 — 기존 `LearnError` 메시지 관례를 따른다).
- 중복 판정(명세 4.2 "중복 검사 주의", P-26): `Importer.settle`(`L/importer.ts:118`)은 `itemIdsForAsset(a.id, 'original')`. 같은 sha의 자산 재사용(`:125-128`)은 그대로. `corruptEntries`(`M/library-check.ts:148`)는 모든 역할을 보되 원본 역할의 자료를 먼저 고른다.
- 점검(명세 4.3): 자막 사본이 없거나 해시가 다르면 그 **영상의 제목**으로 보고되는지 시험으로 확인한다(`L/check.ts`·`M/library-check.ts`의 자산 → 자료 잇기가 역할을 가리지 않으면 이미 됨 — 안 되면 고친다).
- 영구 삭제: `removeUnusedAssets`(`DB/trash.ts:168-175`)의 `page_texts` 줄 옆에 `DELETE FROM cue_texts WHERE sha256 IN (SELECT value FROM json_each(?))`(트리거가 색인 행을 지움).

시험(`subtitles-repository.test.ts`, `packages/db/test/fixtures.ts`의 `freshDb`·`seedItem({ type: 'video' })`):
- 붙이기: 새 자산 → 트랙 `{ position: 0, cueCount: 2 }`, 둘째 붙이기 `position: 1`, 같은 영상 같은 자산 → `'existing'`(행 수 그대로), 다른 영상에 같은 자산(`assetIsNew: false`) → 큐 글 행 수 그대로(sha 공유), PDF·휴지통 자료 → `VALIDATION_FAILED`.
- `cues`가 시작 순, 다른 자료의 자산 id → `[]`.
- 제거 → `tracks` 빔, `{ position: 1 }` 반환, 되돌리기 → 같은 `position`·같은 큐 수, 없는 자산 되돌리기 → `NOT_FOUND`.
- `orphanAssets`: 제거 뒤 그 자산, 다른 영상이 여전히 이으면 안 나옴, 원본 역할 자산은 안 나옴.
- 영구 삭제(`purgeTrash`): 자막이 붙은 영상을 휴지통 → 영구 삭제 → 트랙 행 0, 자막 자산 행 0, `cueTextCount(sha) === 0`; 같은 sha를 다른 영상이 쓰면 큐 글이 남음.
- 중복 판정: 자막과 바이트가 같은 PDF(sha 같음)를 가져오면 `duplicate`가 아님(`importer.test.ts`, 임시 폴더의 실제 파일 — 자막 자산을 먼저 `attach`로 심음).
- 백업: `counts().subtitleTracks`, 매니페스트 왕복(`backup.test.ts`).

- [ ] **Step 1**: 시험을 쓰고 실패 확인.
- [ ] **Step 2**: 구현.
- [ ] **Step 3**: 통과 + 기존 trash·importer·backup·library-check 시험 녹색.
- [ ] **Step 4**: 커밋 `feat(db): the subtitles repository — attach in one transaction, tracks and cues, remove and restore, orphans; purge drops cue texts; duplicates look at originals only; backup counts tracks`.

---

### Task 6: 붙이기 길(main) — `attachSubtitles`·`Importer.placeManaged`·`subtitles:*` IPC·알림·preload·시험 훅·고아 치우기·API E2E

**Files:**
- Create: `LS/attach.ts`, `packages/library/test/attach.test.ts`, `M/ipc/subtitles.ts`, `M/ipc/subtitles.test.ts`(있는 IPC 시험의 모양으로), `E/subtitles-api.spec.ts`
- Modify: `L/importer.ts`(공개 `placeManaged`), `L/index.ts`, `D/ipc.ts`(`LearnApi.subtitles: { list(i): Promise<Result<{ tracks: SubtitleTrack[] }>>; cues(i): Promise<Result<{ cues: Cue[] }>>; pick(i): Promise<Result<AttachResult>>; attach(i): Promise<Result<AttachResult>>; remove(i): Promise<Result<{ position: number }>>; restore(i): Promise<Result<SubtitleTrack>> }`), `D/ipc-channels.ts`(`subtitles: { list: 'subtitles:list', cues: 'subtitles:cues', pick: 'subtitles:pick', attach: 'subtitles:attach', remove: 'subtitles:remove', restore: 'subtitles:restore' }`), `D/event-channels.ts`(`'subtitles:changed': 'evt:subtitles-changed'`), `D/events.ts`(`LearnEventMap['subtitles:changed']: { itemId: string }`), `M/ipc/all.ts`(`MODULES`), `M/ipc/channel-kinds.ts`, `M/ipc/library.ts`(`showOpen`(`:29-33`)을 내보내거나 `M/ipc/dialogs.ts`로 옮김), `M/strings.ts`(`importFilters.subtitles: '자막(SRT · VTT)'`), `M/library-context.ts`(또는 `LibraryContext`가 있는 파일 — `subtitles: SubtitlesRepository`), `M/library-check.ts`(시작 점검 끝의 고아 치우기), `M/test-hooks.ts`, `P/main.ts`(`requests.subtitles`, `events`), `P/surfaces.test.ts`, `E/helpers.ts`(도우미)

**Interfaces:**
- Consumes: Task 3 `readSubtitle`, Task 5 `SubtitlesRepository`, `withManagedPath`(`L/asset-lock.ts`), `managedRelativePath`(`L/layout.ts`), `sha256`(`L/hash.ts` — 바이트용이 없으면 `node:crypto`).
- Produces:
  ```ts
  // L/importer.ts
  /** 관리형 사본을 해시 주소 자리에 둔다(스테이징 → 재해시 → rename). withManagedPath 안에서 부른다. 돌려주는 것은 라이브러리 상대 경로. */
  async placeManaged(src: string, sha256: string, signal?: AbortSignal): Promise<string>;
  // LS/attach.ts
  export interface AttachDeps { repo: LibraryRepository; subtitles: SubtitlesRepository; importer: Importer; now?: () => string }
  export async function attachSubtitles(deps: AttachDeps, itemId: string, paths: readonly string[]): Promise<AttachResult>;
  export async function sweepSubtitleOrphans(deps: { db: Database; subtitles: SubtitlesRepository; removeFiles(assets: PurgedAsset[]): Promise<void> }): Promise<number>;
  ```
  `window.learn.subtitles.{list,cues,pick,attach,remove,restore}`(명세 11절 표), 알림 `subtitles:changed`(붙이기·제거·되돌리기 커밋 뒤 `broadcast`), 훅(`M/test-hooks.ts`의 `LearnTestHooks`): `cueTextCount(input: { itemId: string } | { sha256: string }): number`, `subtitleAssetCount(): number`, `sweepSubtitleOrphans(): Promise<number>`, E2E 도우미 같은 이름(`E/helpers.ts` — `seedBodyText`(`:1930`)와 같은 `app.evaluate` 모양).

요구 사항(명세 4.2·5.1·5.4·5.5, P-11·P-12·P-16):
- `attachSubtitles`: 자료 검사(Task 5와 같은 조건, 아니면 `VALIDATION_FAILED`로 통째 거절) → 경로마다(순서대로): `isSubtitleName` 아니면 `not-subtitle` → `fs.stat` 크기 > 한도면 `too-large`(읽지 않음) → `fs.readFile` 실패면 `read-failed` → `readSubtitle` 실패면 그 이유 → sha256(바이트) → `withManagedPath(managedRelativePath(sha), …)` 안에서 같은 sha의 관리형 자산이 있으면 재사용(파일이 없거나 해시가 다르면 `placeManaged`로 다시 둠), 없으면 `placeManaged` → `subtitles.attach(…)`. `'existing'`이면 `existing`에 이름. `placeManaged`의 `HASH_MISMATCH`·입출력 오류는 `read-failed`. 이름은 NFC 파일 이름(`displayFileName`, `L/importer.ts:220`).
- IPC(`M/ipc/subtitles.ts`, 모두 `MAIN`): `list`·`cues`는 저장소 그대로. `pick`: `showOpen(deps, event, { properties: ['openFile', 'multiSelections'], filters: [{ name: mainStrings.importFilters.subtitles, extensions: ['srt', 'vtt'] }, { name: mainStrings.importFilters.all, extensions: ['*'] }] })` → 비면 `{ added: [], existing: [], failed: [] }`, 아니면 `attachSubtitles`(열기 패널의 경로는 main이 받은 것이라 50개 한도는 IPC 입력에만 걸리고, 고른 경로는 개수와 상관없이 순서대로 모두 붙인다). `remove`·`restore` 뒤와 `added`가 있는 붙이기 뒤에만 `broadcast('subtitles:changed', { itemId })`.
- 고아 치우기: `startLibraryCheck`의 시작 점검이 끝난 뒤 한 번 `sweepSubtitleOrphans`(트랜잭션 안 `removeUnusedAssets(db, orphanAssets())` → 커밋 뒤 `removePurgedFiles`, `inUse` 검사는 `M/ipc/trash.ts:18-27`과 같게). 실패는 기록만 하고 시작을 막지 않는다.

시험:
- `attach.test.ts`(임시 라이브러리 폴더 + 실제 파일, `Importer`와 저장소는 실물): 정상 둘(`ko.srt`·`en.vtt`) → 트랙 둘, 관리형 파일이 `assets/xx/<sha>`에 있고 `mime`·`original_name` 맞음; `broken.srt` → `no-cues`이고 파일·행 없음; 5 MiB 넘음 → `too-large`이고 읽지 않음(`fs.readFile` 감시 또는 큰 희소 파일); `.txt` → `not-subtitle`; 같은 파일 두 번 → 둘째는 `existing`; 다른 영상에 같은 파일 → 자산 행 하나·파일 하나; 읽는 동안 바뀐 파일(스테이징 전 훅으로 내용 바꿈) → `read-failed`; 2만 큐 파일 붙이기 시간 `'[measure] subtitle-attach'` < 1초(명세 14절 단위 상한).
- `sweepSubtitleOrphans`: 제거한 자막 → 치운 뒤 자산·파일 없음; 다른 영상이 이으면 남음.
- `M/ipc/subtitles.test.ts`: 입력 검사(상대 경로·51개·빈 배열 거절), 알림이 붙인 것이 있을 때만.
- `E/subtitles-api.spec.ts`(창 없이 API만 — 승인 전 가능): MP4 가져오기 → `learn.subtitles.attach({ itemId, paths: [ko.srt, en.vtt, broken.srt] })` → `added` 둘·`failed` 하나(`no-cues`) → `list` 순서·언어(`ko`, `en`) → `cues` 첫 큐 "오늘은 세포 신호 전달을 살펴봅니다." → `subtitles:changed` 받음(렌더러에서 `learn.on`) → `remove` → `list` 하나 → `restore` → 둘 → `stubOpenDialog`로 `pick` → 붙음 → `remove` 뒤 `sweepSubtitleOrphans()` → `subtitleAssetCount()` 줄어듦 → `cp949.srt`·`utf16le.srt`·`utf16be.srt`를 붙인 세 트랙의 첫 큐 글이 같음(명세 1절 "CP949 자막이 같은 큐 — E2E 하나").

- [ ] **Step 1**: 단위 시험을 쓰고 실패 확인.
- [ ] **Step 2**: `placeManaged`, `attachSubtitles`, `sweepSubtitleOrphans` 구현 → 단위 통과.
- [ ] **Step 3**: IPC·채널·preload·알림·훅·고아 치우기 연결, `P/surfaces.test.ts` 갱신.
- [ ] **Step 4**: `E/subtitles-api.spec.ts`를 쓰고 `taskset -c 0-1 xvfb-run -a -s "-screen 0 1920x1200x24" pnpm exec playwright test tests/e2e/subtitles-api.spec.ts --repeat-each=3`.
- [ ] **Step 5**: 녹색 확인 후 커밋 `feat(subtitles): attaching in main — managed copies through the importer's placing, the subtitles channels and change event, test hooks, an orphan sweep after the startup check`.

---

### Task 7: 가져오기의 같은 이름 묶기 — `pairSubtitles`·`enqueue`·`ImportReport.subtitles`·열기 패널 필터·500개 나누기

**Files:**
- Modify: `D/subtitles.ts`(`pairSubtitles`), `packages/domain/test/subtitles.test.ts`, `D/library.ts`(`ImportReport`(`:160-181`)), `M/jobs/import-queue.ts`(`enqueue`(`:241-265`), `Entry`(`:114-126`), 결과 정리(`settle` `:354`, `finishRun` `:477-485`)), `M/jobs/import-queue.test.ts`, `M/ipc/library.ts`(`IMPORT_FILTERS`(`:18-21`)), `M/index.ts`(큐 의존성에 붙이기 — `:476-500`), `R/library/importRunner.ts`(`groupForImport`, `inImportCalls`), `R/library/importRunner.test.ts`, `E/subtitles-api.spec.ts`(짝 시험 더함)

**Interfaces:**
- Consumes: Task 6 `attachSubtitles`.
- Produces:
  ```ts
  // D/subtitles.ts
  export interface SubtitlePairing { media: string[]; pairs: Map<string, string[]>; unpaired: string[] }
  /** 같은 폴더 + 줄기 규칙(명세 5.2, P-13). media = 자막이 아닌 모든 경로(입력 순서), pairs = 영상 경로 → 그 자막 경로들(입력 순서). */
  export function pairSubtitles(paths: readonly string[]): SubtitlePairing;
  // D/library.ts ImportReport에 더함
  subtitles: { attached: number; failed: Array<{ name: string; reason: SubtitleFailure }> };
  // R/library/importRunner.ts
  export function groupForImport(paths: readonly string[]): string[];
  ```
  큐 의존성 `ImportQueueDeps.attachSubtitles(itemId: string, paths: string[]): Promise<AttachResult>`.

요구 사항(명세 5.2, P-12·P-13·P-14):
- `enqueue`가 경로를 `Entry`로 바꾸기 전에 `pairSubtitles`: `media`만 `Entry`가 되고, 영상 `Entry`에 `subtitles: string[]`, 짝 없는 자막은 곧바로 그 실행의 `subtitles.failed`에 `unpaired`. 자막은 `requested`·진행 바이트에 세지 않는다.
- 영상 항목이 마지막 결과에 이르면: `imported` → 그 새 자료, `duplicate`로 끝남(건너뜀 — 지금 길의 `run.duplicates`와 그 물음의 결과를 따라간다) → `existingItemId`, 중복을 허락해 새로 가져옴 → 그 새 자료, `failed`·취소 → 그 자막 모두 `video-failed`, 결과 자료의 종류가 `video`가 아니면 `video-failed`. 붙이기 결과의 `added` 수는 `attached`에, `failed`는 그대로, `existing`은 `attached`에 세지 않고 실패도 아니다.
- 붙이기는 그 영상 항목의 다음 항목을 막지 않게 하되 `finishRun` 전에 모두 끝낸다(보고가 셀 수 있게). 붙인 자료마다 `subtitles:changed`.
- `IMPORT_FILTERS`의 미디어 확장자에 `'srt', 'vtt'`(함께 고를 수 있게). 다시 잇기(`:92`)와 점검의 `pickFile`(`M/index.ts:635`)은 자막을 고르면 안 되므로 미디어 목록을 두 상수(`MEDIA_EXTENSIONS`·`IMPORT_EXTENSIONS`)로 나눠 그 둘은 옛 목록을 쓴다.
- `groupForImport`: 자막 경로가 없으면 입력 그대로. 있으면 `(폴더, subtitleStem(이름, true))`로 안정 정렬(같은 열쇠는 입력 순서). `inImportCalls`는 그 결과를 500개씩 나누되, 같은 열쇠 묶음이 경계를 넘으면 그 묶음을 다음 호출로 미룬다(묶음 자체가 500보다 크면 그냥 나눔).

시험:
- `pairSubtitles`(도메인): 같은 줄기, 언어 꼬리(`강의.ko.srt`·`강의.en-US.vtt`), 대소문자(`Lecture.SRT`), NFD 파일 이름, 다른 폴더는 짝 아님, 같은 줄기 영상 둘이면 첫 영상, PDF와 같은 줄기는 짝 아님(`unpaired`), 영상 없이 자막만 → 모두 `unpaired`.
- 큐(`import-queue.test.ts`, 가짜 `importer`·`attachSubtitles`): 짝 → 영상 결과 뒤 붙이기 한 번(그 자료 id로), 영상 실패 → `video-failed`, 중복 건너뜀 → 이미 있는 자료에 붙임, 짝 없음 → `unpaired`, 보고의 `subtitles.attached`·`failed`, `requested`가 자막을 세지 않음.
- `groupForImport`·`inImportCalls`: 자막 없으면 순서 그대로, 499번째 영상의 자막이 다음 호출로 갈리지 않음.
- E2E(`subtitles-api.spec.ts`에 더함): `learn.library.import({ paths: [lecture-60s.mp4, lecture-60s.ko.srt, lecture-60s.en.vtt, notes.ko.srt] })` → 보고 `subtitles.attached === 2`, `failed`에 `notes.ko.srt`·`unpaired` → 그 영상의 `list` 둘. 같은 묶음을 다시 → 중복 건너뜀 → `existing`이므로 트랙 그대로 둘.

- [ ] **Step 1**: 시험을 쓰고 실패 확인.
- [ ] **Step 2**: 구현.
- [ ] **Step 3**: 통과 + 기존 import-queue 단위·E2E(`import-queue*.spec.ts`, `drop.spec.ts`) 녹색.
- [ ] **Step 4**: 커밋 `feat(import): subtitles chosen with their video attach to it — pairing by folder and stem, the report's subtitle counts and reasons, the open panel's filter, 500-path calls that keep a pair together`.

---

### Task 8: 자막 본문 검색(main) — 큐 질의·합집합·`search:matches`·시드 훅·`search-perf`

**Files:**
- Modify: `DB/body-search.ts`(큐 질의 셋), `packages/db/test/body-search.test.ts`, `D/body-search.ts`(`BodyMatch`·`BodyMatches`), `D/ipc.ts`·`D/ipc-channels.ts`(`search.pages` → `search.matches`, `'search:pages'` → `'search:matches'`), `M/text/search.ts`(`searchBody` 합집합, `searchPages` → `searchMatches`), `M/ipc/search.ts`(`:24`), `M/ipc/channel-kinds.ts`(`:89-91`), `P/main.ts`(`search: ['body', 'matches', 'progress']`), `P/surfaces.test.ts`, `R/inspector/BodyMatchesSection.tsx`(새 모양 — 쪽 행만 그림, 화면 그대로), `M/test-hooks.ts`(`seedCues`), `E/helpers.ts`, `V/search-perf.evidence.ts`, `E/body-search.spec.ts`(API 줄 하나)

**Interfaces:**
- Consumes: Task 5 스키마, `bodyQueryWords`·`ftsMatch`·`likePattern`·`likeSnippet`·`MARK_START`/`MARK_END`·`TEXT_LIMITS`(`D/body-search.ts`).
- Produces:
  ```ts
  // D/body-search.ts
  export type BodyMatch = { kind: 'page'; pageIndex: number; snippet: string } | { kind: 'time'; startMs: number; snippet: string; assetId: string };
  export interface BodyMatches { matches: BodyMatch[]; total: number }
  // DB/body-search.ts
  export function cueItemIds(db: Database, words: BodyWords): string[];
  export function cueLikeChunks(db: Database, like: readonly string[], chunk?: number): Generator<string[]>;
  export function cueMatches(db: Database, itemId: string, words: BodyWords): { matches: Extract<BodyMatch, { kind: 'time' }>[]; total: number };
  // M/text/search.ts
  export function searchMatches(db: Database, itemId: string, query: string): BodyMatches;
  ```
  `window.learn.search.matches({ itemId, query })`, 훅 `seedCues(input: { videos: number; cuesPerVideo: number; words?: string[] }): { itemIds: string[] }`(같은 모양의 E2E 도우미).

요구 사항(명세 8.1, P-15):
- 큐의 살아 있는 조인: `FROM cue_texts_fts f JOIN cue_texts c ON c.id = f.rowid JOIN assets a ON a.sha256 = c.sha256 JOIN subtitle_tracks st ON st.asset_id = a.id JOIN items i ON i.id = st.item_id AND i.deleted_at IS NULL AND i.type = 'video'`(덩어리 훑기는 `page_texts`의 `CHUNK_JOIN`(`:5-7`)과 같이 `CROSS JOIN`). 낱말 규칙·큐 하나 안의 AND·2글자 훑기·취소는 쪽 글과 같다.
- `searchBody`(`M/text/search.ts:12`): 결과 `itemIds` = 쪽 일치 ∪ 큐 일치(순서: 쪽 결과 뒤 큐 결과, 중복 없음). 2글자 훑기는 두 표를 차례로(같은 `signal`).
- `cueMatches`: 그 자료의 트랙 자산들의 큐에서 `snippet(cue_texts_fts, 0, char(57344), char(57345), '…', 48)`, `ORDER BY c.start_ms, st.position LIMIT TEXT_LIMITS.pagesShown`, `total`은 20 미만이면 행 수 아니면 COUNT 질의(`bodyPages`(`:64-85`)와 같은 규칙), 2글자만이면 JS `likeSnippet`. `searchMatches`는 자료가 살아 있고 `pdf`면 지금 `bodyPages`를 `kind: 'page'`로, `video`면 `cueMatches`, 그 밖은 빈 결과.
- `BodyMatchesSection`은 `learn.search.matches`를 부르고 `kind === 'page'` 행만 그린다(동영상에는 아직 절이 켜지지 않음 — Task 15). 화면 변화 없음.
- `search-perf.evidence.ts`: 기존 PDF 1,000 시드에 `seedCues({ videos: 200, cuesPerVideo: 1000 })`를 더해 `search:body` p95(≤ 300ms)와 동영상의 `search:matches` p95(≤ 100ms) 줄을 더한다(`tests/evidence/budget.ts`의 2배 규칙).

시험(`body-search.test.ts`): 큐 하나 안의 AND(두 낱말이 다른 큐에 있으면 안 맞음), 2글자 훑기, 휴지통 영상 제외, PDF ∪ 영상 합집합, `cueMatches`의 시작 순·20행·`total`·조각 표시, 트랙 둘이면 각 행의 `assetId`, 자막이 없는 영상 빈 결과. E2E 줄 하나(`body-search.spec.ts`, API만): 자막을 붙인 영상이 `search.body`에 들고, 휴지통에 넣으면 빠지고, 영구 삭제 뒤 `cueTextCount === 0`(명세 1절).

- [ ] **Step 1**: 시험을 쓰고 실패 확인.
- [ ] **Step 2**: 질의·합집합·채널 이름 바꾸기·렌더러 호출 고침.
- [ ] **Step 3**: 시드 훅과 `search-perf` 줄. 증거 설정으로 `search-perf`만 한 번(`-g search`).
- [ ] **Step 4**: 녹색 확인 후 커밋 `feat(search): subtitle cues in body search — trigram and two-letter scans over live videos' cues, search:matches with page or time rows, a cue seed for search-perf`.

---

### Task 9: 영상 전체 화면 상태 기계(main) · `WindowState.videoStage` · `ui:videoStage` · ⌃⌘F 길 · 설정 셋 · locator `captions`

**Files:**
- Create: `M/video-stage.ts`, `M/video-stage.test.ts`, `E/video-stage.spec.ts`
- Modify: `D/events.ts`(`WindowState`(`:8-22`)에 `videoStage: boolean`), `M/window-state.ts`(`windowStateOf`(`:45`)가 무대 값을 읽고, `trackWindowState`(`:58-76`)의 비교에 `videoStage`), `M/index.ts`(주 창마다 기계 하나, `onToggleFullScreen`(`:262-266`)을 `stage.request('window')`로), `D/ipc.ts`·`D/ipc-channels.ts`(`ui.videoStage`), `M/ipc/ui.ts`, `M/ipc/channel-kinds.ts`, `P/main.ts`, `P/surfaces.test.ts`, `M/window-state.test.ts`·`M/ipc/ui.test.ts`(새 필드), `D/settings.ts`(`SETTINGS`(`:35-74`)), `D/reading.ts`(`:24`), `packages/domain/test/*`(설정·locator)

**Interfaces:**
- Produces:
  ```ts
  // M/video-stage.ts
  export interface VideoStagePort {
    isFullScreen(): boolean;
    setFullScreen(on: boolean): void;
    onEnter(fn: () => void): void;   // 'enter-full-screen'
    onLeave(fn: () => void): void;   // 'leave-full-screen'
    push(): void;                    // windowState를 다시 보냄
  }
  export type StageRequest = 'toggle' | 'exit' | 'window';
  export interface VideoStage { request(r: StageRequest): void; readonly stage: boolean; dispose(): void }
  export function createVideoStage(port: VideoStagePort, opts?: { settleMs?: number; setTimer?: (fn: () => void, ms: number) => unknown; clearTimer?: (t: unknown) => void }): VideoStage;
  export const STAGE_SETTLE_MS = 2000;
  // D/settings.ts
  export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;
  'video.playbackRate': z.union(PLAYBACK_RATES.map((r) => z.literal(r))),  // unset reads as 1
  'video.volume': z.number().min(0).max(1),                              // unset reads as 1
  'video.muted': z.boolean(),                                            // unset reads as false
  // D/reading.ts — video 갈래
  z.object({ kind: z.literal('video'), timeMs: z.number().int().min(0), captions: z.object({ assetId: z.uuid(), on: z.boolean() }).strict().optional() })
  ```
  `window.learn.ui.videoStage({ action: 'toggle' | 'exit' })` → `ok(undefined)`(주 창만, 입력 `z.object({ action: z.enum(['toggle', 'exit']) }).strict()`).

요구 사항(P-9, 명세 6.6·18절):
- 상태 기계는 P-9 그대로. 불변식: (1) 전환 중(`pending`)에는 `setFullScreen`을 다시 부르지 않는다. (2) 모든 요청 뒤와 모든 사건 뒤에 `drive()` — `pending`이 아니고 `actualFull !== want.full`이면 `setFullScreen(want.full)` + `pending` + 시한(`settleMs`), 같으면 `stage = want.stage && actualFull`. (3) `stage`가 바뀔 때만 `push()`. (4) 요청 없이 온 `leave`(그때 `pending` 아님 또는 `want.full === true`인데 나감)는 `want = { full: false, stage: false }`. (5) 시한이 지나면 `pending`을 풀고 `actualFull = isFullScreen()`으로 `drive()`.
- 무대 모드가 켜진 채 다른 창 상태(시트)는 그대로 보낸다 — `windowStateOf`는 `{ …, videoStage: stage.stage }`.
- 렌더러는 Task 11까지 이 값을 쓰지 않는다(화면 변화 없음).

시험:
- `video-stage.test.ts`(가짜 포트 — 사건을 손으로 쏨, 가짜 시계): 켜기 → `setFullScreen(true)` 한 번 → 사건 전 `stage` 거짓 → `enter` → `stage` 참·`push` 한 번; 이미 창 전체 화면에서 켜기 → `setFullScreen` 없이 `stage` 참, 끄기 → 창은 그대로; 전환 중 토글 다섯(켜기 + 넷) → `setFullScreen`은 한 번, 사건 뒤 마지막 바람(켜짐)으로 끝; 켜는 중 끄기 → `enter` 뒤 `setFullScreen(false)` → `leave` 뒤 `stage` 거짓·창 거짓; 무대에서 신호등 나가기(요청 없는 `leave`) → `stage` 거짓; `window` 요청(⌃⌘F)이 무대를 끔; 사건이 오지 않으면 2초 뒤 `isFullScreen()`으로 확정; 같은 값이면 `push` 없음.
- `E/video-stage.spec.ts`(API만 — 승인 전 가능, Linux·Mac): `learn.ui.videoStage({ action: 'toggle' })`를 50ms 간격으로 다섯 번 → `expect.poll`로 `win.isFullScreen()`과 `learn.ui.windowState()`의 `videoStage`가 둘 다 참(같은 값)으로 자리 잡음 → `exit` → 둘 다 거짓. 메뉴 `⌃⌘F` 길(`runMenuCommand` 또는 `onToggleFullScreen` 훅)도 직렬화됨(빠르게 셋 → 같은 값).
- 도메인: 설정 셋의 허용·거절, locator 옛 값(`captions` 없음)과 새 값 둘 다 통과, `captions.assetId`가 uuid 아니면 거절.

- [ ] **Step 1**: 단위 시험을 쓰고 실패 확인.
- [ ] **Step 2**: `M/video-stage.ts` 구현 → 통과.
- [ ] **Step 3**: 창·메뉴·IPC·preload·`WindowState` 연결, 설정·locator.
- [ ] **Step 4**: `E/video-stage.spec.ts`(`--repeat-each=5`, `taskset -c 0-1`)와 기존 `platform.spec.ts`·`shell.spec.ts`의 전체 화면 줄 녹색.
- [ ] **Step 5**: 커밋 `feat(window): a serialized video stage in main — one full-screen transition at a time, the last request wins, a settle timeout; windowState.videoStage, ui:videoStage, the menu's full screen through it; video settings and the locator's captions`.

---

### Task 10: 영상 리더 v2 — 무대·재생 컨트롤·스크러버·속도 ▾·음량·키·설정 기억·여는 중·재생 불가 안내·F6·읽기 절 E2E (목업 승인 뒤)

**Files:**
- Create: `RV/VideoReader.tsx`(지금의 `R/viewers/VideoViewer.tsx`를 옮겨 키움 — 옛 파일 지움), `RV/videoStore.ts`, `RV/VideoControls.tsx`, `RV/Scrubber.tsx`, `RV/SpeedMenu.tsx`, `RV/VolumeControl.tsx`, `RV/time.ts`, `RV/time.test.ts`, `RV/videoActions.ts`, `RV/useVideoSettings.ts`, `RV/frameStep.ts`, `RV/frameStep.test.ts`, `R/strings/video.ts`, `R/styles/screens/video.css`, `E/video.spec.ts`
- Modify: `R/viewers/ViewerHost.tsx`(`:95-108`·`:139-146`·`:153-164`), `R/viewers/readerScope.tsx`(`video`), `R/viewers/pdf/readerStore.ts`(`NoPages`에 `'noTranscript'`), `R/viewers/pdf/ReaderSidebar.tsx`(`EMPTY`에 `noTranscript` → `captions-off` + `t.video.noTranscript`), `R/viewers/ReaderNotices.tsx`(`CodecNotice`(`:109-122`)를 `.stage-center` 안으로), `R/styles/components/notice.css`(`.notice .actions { flex-wrap: wrap; gap: var(--space-2) }`), `R/styles/screens/reader.css`(`:41-58`), `R/strings/index.ts`, `R/strings/sheets.ts`(`groups.video`), `R/sheets/shortcuts.ts`(`ORDER`·`groupOf`), `D/accelerator.ts`(`KeySpec.yields`), `D/commands.ts`(명령 열둘·`CommandId`·`altKey`·`stateLabels.toggle`·`TOGGLE_STATE`·`LabelState`·`CommandContextState`·`RULES`), `D/ipc.ts`(`commandContextInput`(`:133-193`)), `D/test/commands.test.ts`, `R/commands/keymap.ts`(+ 시험), `R/commands/registry.ts`(`CommandEnv`·`COMMAND_HANDLERS`·`contextOf`(`:337-377`)), `R/app/MainWindow.tsx`(`env`(`:476`), `videoOpen` 등), `M/menu/app-menu.ts`(`MenuLabelState`가 새 `LabelState`를 받음), `R/shell/panes.ts`(`:9-10` `video[controls]` → `[data-video-stage]` — 무대는 `tabIndex=0`이라 기존 `[tabindex="0"]`로 닿으면 줄만 지움), `E/keyboard.spec.ts`(`:956-969`), `E/a11y.ts`(`:10-13` 주석), `E/position.spec.ts`, `E/commands-coverage.spec.ts`(`M8A_COMMANDS`, `:339`의 리더 묶음 계산)

**Interfaces:**
- Consumes: Task 9 설정·`WindowState`, 승인 목업 ①②⑥.
- Produces:
  ```ts
  // RV/videoStore.ts
  export interface VideoHandle {
    play(): void; pause(): void; toggle(): void;
    seekBy(ms: number): void; seekTo(ms: number, opts?: { keepPaused?: boolean }): void;
    frame(dir: -1 | 1): void; setRate(rate: PlaybackRate): void; stepRate(dir: -1 | 1): void;
    setVolume(v: number): void; toggleMute(): void;
  }
  export interface VideoStore {
    status: 'opening' | 'ready' | 'unplayable';
    playing: boolean; timeMs: number; durationMs: number; bufferedMs: number;
    handle: VideoHandle | null;
    set(p: Partial<Omit<VideoStore, 'set'>>): void;
  }
  export function createVideoStore(): StoreApi<VideoStore>;
  export const useVideo: <T>(sel: (s: VideoStore) => T) => T; // 활성 탭의 스코프 — useReader와 같은 길
  // RV/time.ts
  export function formatClock(ms: number, totalMs?: number): string;  // "18:20", 한 시간 이상이면 "1:02:03" (total이 한 시간 이상이면 같은 자릿수)
  export function spokenClock(ms: number): string;                    // "18분 20초", "1시간 2분 3초"
  // RV/frameStep.ts
  export function frameStepMs(samples: readonly number[]): number;    // mediaTime 차이의 중앙값, 표본 없으면 1000/30
  // D/commands.ts
  export type VideoToggleState = 'videoPlaying' | 'videoCaptionsOn' | 'videoMuted' | 'videoStage';
  export const TOGGLE_STATE: Partial<Record<CommandId, VideoToggleState>>;
  ```
  명령(맥락 `['viewer']`, 규칙 `videoOpen`, 메뉴 없음 — J9): `video.playPause`(`{ code: 'Space', yields: true }`, `altKey: { code: 'KeyK' }`), `video.back10`(`KeyJ`), `video.forward10`(`KeyL`), `video.back5`(`ArrowLeft`, yields), `video.forward5`(`ArrowRight`, yields), `video.frameBack`(`Comma`), `video.frameForward`(`Period`), `video.slower`(`Comma` + shift), `video.faster`(`Period` + shift), `video.toggleMute`(`KeyM`). 이름·토글 이름은 명세 10절. `CommandContextState`(+ `commandContextInput`, `contextOf`)에 `videoOpen`·`videoPlaying`·`videoMuted`. 시험 손잡이 `window.__learnVideo`(개발·시험 빌드만, 활성 탭의 `{ timeMs, playing, rate, volume, muted, frameStepMs }`).
  Task 11·12가 `video.toggleFullScreen`·`video.exitFullScreen`·`video.toggleCaptions`·`video.addSubtitles`를 더한다(P-7).

요구 사항(명세 6.1·6.2·6.3·6.7·9.2·9.3, P-5·P-6·P-8·P-17·P-18):
- 배치: `div.reader.video-reader` > 도구 막대 44(`.reader-toolbar`, 이 작업에서는 오른쪽 자리가 비어 있음 — 자막 ▾는 Task 12. 비어 있는 막대가 목업과 다르면 비평이 Task 12로 미룸을 기록) + 무대(`div.video-stage[data-video-stage][tabIndex=0][role=region]`, 접근성 이름 = 제목, `aria-describedby` = 숨긴 "스페이스로 재생") + 컨트롤 막대(`.video-controls`). `<video>`에 `controls` 없음, 무대 클릭은 재생/일시정지.
- 컨트롤: 명세 6.2의 값과 툴팁(키캡은 레지스트리의 `keySpecKeys`로). 스크러버는 `role="slider"`, `aria-valuetext` = `"${spokenClock(t)} / ${spokenClock(d)}"`, ←/→ 5초 · PageUp/PageDown 10초 · Home/End, 끌기 중 `seekTo`는 끌기 끝에 한 번 + 끌기 중 미리보기 시간. 음량은 `role="slider"` 0–100, ←/→ 5. 속도 ▾는 `MenuButton`(`R/ui/MenuButton.tsx:175`, `checked`). 리더 폭 < 560(ResizeObserver — 가린 탭은 관찰하지 않음)이면 음량 막대 접힘, 음소거 단추 호버·포커스에서 위로 뜸. 여는 중(첫 프레임 전) 모든 컨트롤 `isDisabled`.
- 설정 기억: `useVideoSettings()`가 `video.playbackRate`·`video.volume`·`video.muted`를 읽어(없으면 1·1·false) 영상에 적용하고, 바꿀 때 `saveSetting`(`R/data/saveSetting.ts:12`). 탭 둘이 같은 설정을 본다.
- 한 프레임: 정지 중에만, `frameStepMs`(재생 중 `requestVideoFrameCallback`의 `mediaTime` 차이 표본 최근 30개).
- 위치 저장: 지금의 `usePosition` 길(`TIME_SAVE` 스로틀 2000) 그대로. locator는 Task 12까지 `{ kind: 'video', timeMs }`.
- 재생 불가: `status: 'unplayable'` → 컨트롤·도구 막대 그리지 않음, `CodecNotice`가 `.stage-center` 안(명세 9.2), 사이드바 `noTranscript`. 원본 없음·잃음·열기 실패도 `noTranscript`(P-18). 재생할 수 있는 동영상은 `noPages` `null`이고 `ReaderSidebar`는 Task 13 전까지 빈 패널 대신 같은 `noTranscript`를 보인다(Task 13이 대본 칸으로 바꿈 — 이 작업의 사이드바는 목업과 다름을 비평에 적음).
- 키: `keyCommand`가 `altKey`도 맞춰 보고, `yields` 키는 `focusOwnsKey`(P-5)면 `null`. 영상 키는 입력란·IME 중 무시(기존).
- 가린 탭: 기존 `useReaderShown` 멈춤 유지(`E/tabs.spec.ts:408-423` 그대로 녹색).

시험:
- 단위: `formatClock`(0 → "0:00", 61_000 → "1:01", 3_723_000 → "1:02:03", total 한 시간 이상이면 61_000 → "0:01:01"), `spokenClock`, `frameStepMs`, `keyCommand`(K와 스페이스가 같은 명령, `yields`가 단추·슬라이더·탭에서 비켜남, 목록 `option`에서는 안 비켜남, 한글 입력 상태의 `event.code`), `commandLabel`의 토글 이름, `commands.test.ts`(둘째 키 포함 한 키 한 명령).
- `E/video.spec.ts`(`lecture-60s.mp4`): 마우스로 재생·정지·±10초·속도 ▾ 1.5×·음소거·음량 막대·스크러버 끌기와 호버 시간; 키 전부(한국어 입력 상태 — `ime.spec.ts`의 입력 소스 흉내 방식), 스페이스는 포커스한 단추 위에서 그 단추의 동작(양성 대조: 무대 포커스에서 스페이스는 재생); 한 프레임은 정지 중에만 시각이 바뀜(재생 중에는 그대로); 속도·음량·음소거가 다시 실행 뒤 같음; 무대 F6 포커스(`keyboard.spec.ts` 고침과 같은 단언); 재생 불가(`sample-mpeg4part2.mp4` 또는 HEVC) 안내가 1024 창에서 잘리지 않음(단추 둘의 상자가 무대 안).
- `E/position.spec.ts`: 영상을 18초까지 재생 → 라이브러리 → 항목 패널 읽기 절 "0:18에서 멈춤 · 오늘 …"과 진행 막대(명세 9.3 — 지금의 읽기 절 문구로).
- `commands-coverage.spec.ts`: `M8A_COMMANDS`에 이 작업의 열을 넣고 영상을 열어 하나씩 돌린 뒤 효과(시각·속도·음소거)를 본다.

- [ ] **Step 1**: 단위 시험을 쓰고 실패 확인.
- [ ] **Step 2**: 도메인(키·명령·상태·라벨)과 키맵 → 단위 통과.
- [ ] **Step 3**: 리더·컨트롤·설정·끝 상태·안내 고침.
- [ ] **Step 4**: E2E(`video.spec.ts`, 고친 `keyboard`·`position`·`tabs`·`commands-coverage`)를 1920·1024 두 화면에서.
- [ ] **Step 5**: 투어 장면(`E/visual/tour.ts`에 영상 리더 기본·좁은 창·재생 불가 — 라이트·다크) 갱신.
- [ ] **Step 6**: 녹색 확인 후 커밋 `feat(video): the video reader v2 — our stage and controls, scrubber, speed menu and volume, single-letter keys by event.code with focus exceptions, remembered rate and volume, the opening state and the codec notice that wraps`.

---

### Task 11: 영상 전체 화면 — 무대 모드·F/esc/단추·컨트롤 숨김·`fullscreen` 권한 빼기·빠른 토글 시험 (목업 승인 뒤)

**Files:**
- Create: `RV/useVideoStage.ts`, `RV/useIdleHide.ts`, `RV/useIdleHide.test.ts`
- Modify: `RV/VideoReader.tsx`, `RV/VideoControls.tsx`(전체 화면 단추), `R/app/MainWindow.tsx`(무대 모드에서 탭 줄·사이드바·도구 막대 숨김, 무대 모드인데 보이는 것이 재생할 수 있는 영상 리더가 아니면 `exit` 요청), `R/shell/useWindowState.ts`(`data-video-stage`), `R/styles/screens/video.css`·`shell.css`, `D/commands.ts`(`video.toggleFullScreen` `KeyF`, `video.exitFullScreen` `{ code: 'Escape', yields: true }` palette 거짓, 규칙 `videoOpen && videoStage`), `CommandContextState.videoStage`, `M/permissions.ts`(`:7`에서 `'fullscreen'` 뺌), `M/permissions.test.ts`(있으면), `E/first-session.spec.ts`(`:37-54`·`:129`·`:157-180`), `E/video.spec.ts`, `E/commands-coverage.spec.ts`

**Interfaces:**
- Consumes: Task 9 `ui.videoStage`·`WindowState.videoStage`, Task 10 리더.
- Produces: `useVideoStage(): { stage: boolean; toggle(): void; exit(): void }`, `useIdleHide(opts: { active: boolean; ms?: number }): { hidden: boolean }`(기본 2000ms), `.video-reader[data-stage]`, `CommandContextState.videoStage`.

요구 사항(명세 6.6, P-9·P-10):
- 렌더러는 `WindowState.videoStage`만 따른다(요청을 보내고 상태를 스스로 바꾸지 않음). F·단추·`video.toggleFullScreen` → `toggle`, esc·`video.exitFullScreen` → `exit`.
- 무대 모드: 탭 줄·사이드바·도구 막대를 그리지 않고(접근성 트리에서도 빠짐 — `inert` 또는 그리지 않음) 무대와 컨트롤이 창을 채운다. 신호등 자리는 macOS 전체 화면에서 사라지므로 따로 비우지 않는다.
- 컨트롤 숨김: 무대 모드 + 재생 중 + 포인터가 2초 움직이지 않음 → 컨트롤과 포인터(`cursor: none`) 숨김, 오버레이 자리 내려옴(Task 12가 쓰는 `data-controls-hidden`). 포인터 이동·키·정지에서 다시 보임. 움직임 줄이기에서는 바로 숨김/보임.
- 무대 모드 중 탭이 바뀌거나 영상 탭이 닫히면 `exit`.
- `APP_PERMISSIONS`에서 `'fullscreen'`을 뺀다 — 페이지의 `requestFullscreen()`은 거절된다.
- `first-session.spec.ts`: `toggleFullscreen`을 F 키 길로(무대 포커스 → F → `isFullScreen()` 참과 `[data-stage]` → F → 둘 다 거짓), darwin `test.fail()` 시험(`:157-180`)은 지우고 새 시험 "빠른 토글이 자리 잡는다"(F를 50ms 간격으로 다섯 번 → `expect.poll`로 `isFullScreen()`과 `[data-stage]`가 같은 값(참)으로 끝남 → esc → 둘 다 거짓) — Linux·Mac 모두. `V/spikes.evidence.ts`의 HTML 전체 화면 줄은 그대로(역사 기록 — 권한이 빠져 그 시험이 깨지면 그 줄을 "권한 거절 확인"으로 바꾸고 커밋 본문에 적음).

시험: `useIdleHide`(가짜 시계 — 2초 뒤 숨김, 움직임에 다시 보임, `active` 거짓이면 늘 보임). E2E(`video.spec.ts`): 단추로 들어가고 나오기, esc, 무대 모드에서 탭 줄·사이드바가 없고 영상 상자가 창 폭, 2초 뒤 컨트롤 숨김과 포인터 이동에 다시 보임, 무대 모드에서 ⌘W로 탭을 닫으면 창도 나옴, 페이지의 `document.documentElement.requestFullscreen()`이 거절됨(양성 대조: 같은 시험에서 F 길은 들어감).

- [ ] **Step 1**: 단위 시험을 쓰고 실패 확인 → 구현 → 통과.
- [ ] **Step 2**: 무대 모드·명령·권한·`first-session` 고침.
- [ ] **Step 3**: E2E(`video.spec.ts`, `first-session.spec.ts` `--repeat-each=5`, `platform`·`shell`의 전체 화면 줄), 1024 화면 한 번.
- [ ] **Step 4**: 투어 장면(무대 모드 보임·숨김) 갱신.
- [ ] **Step 5**: 커밋 `feat(video): full screen as the window's own plus a stage mode — F, esc and the button through main's serialized stage, controls that hide while playing, no HTML full screen (the permission goes); the macOS rapid-toggle test replaces the known-failure one`.

---

### Task 12: 자막 오버레이·자막 ▾·트랙 상태 — 기본 트랙·C·추가·제거와 되돌리기·붙이기 토스트·항목 패널 "자막" 줄·CP949 대조 E2E (목업 승인 뒤)

**Files:**
- Create: `RV/tracks.ts`, `RV/tracks.test.ts`, `RV/cues.ts`, `RV/cues.test.ts`, `RV/useSubtitles.ts`, `RV/SubtitleOverlay.tsx`, `RV/SubtitlesMenu.tsx`, `RV/attachToasts.ts`, `E/subtitles.spec.ts`
- Modify: `RV/videoStore.ts`(`track`·`captionsOn`·`cues`·`maxEnds`), `RV/VideoReader.tsx`(locator `captions`, 걸린 트랙 복원), `RV/VideoControls.tsx`(자막 단추), `RV/videoActions.ts`, `D/commands.ts`(`video.toggleCaptions` `KeyC` 규칙 `videoOpen && videoCaptions`, `video.addSubtitles` 키 없음 규칙 `videoOpen`), `CommandContextState.videoCaptions`·`videoCaptionsOn`, `R/inspector/FileSection.tsx`(`:49-55` 옆 "자막" 줄), `R/strings/video.ts`·`inspector.ts`, `R/styles/screens/video.css`, `E/commands-coverage.spec.ts`

**Interfaces:**
- Consumes: Task 6 `learn.subtitles.*`·`subtitles:changed`, Task 10 리더, Task 11 `data-controls-hidden`.
- Produces:
  ```ts
  // RV/tracks.ts
  export function trackNames(tracks: readonly SubtitleTrack[], displayNames?: Intl.DisplayNames): Map<string, string>; // assetId → "한국어" | "영어(미국)" | "자막 1"; 같은 이름의 뒤 것에 " 2"
  export function pickTrack(tracks: readonly SubtitleTrack[], saved: { assetId: string; on: boolean } | undefined): { assetId: string | null; on: boolean };
  // RV/cues.ts
  export function cueMaxEnds(cues: readonly Cue[]): Float64Array;
  export function activeCues(cues: readonly Cue[], maxEnds: Float64Array, ms: number): number[]; // 시작 순 인덱스
  export function cueIndexAt(cues: readonly Cue[], ms: number): number; // 시작 ≤ ms인 마지막, 없으면 -1 (대본의 지금 큐)
  // RV/useSubtitles.ts
  export function useSubtitles(itemId: string): { tracks: SubtitleTrack[] | undefined; cues(assetId: string | null): Cue[] | undefined };
  ```
  `VideoStore`에 `track: string | null; captionsOn: boolean; cues: Cue[]; maxEnds: Float64Array; setTrack(assetId: string | null): void; setCaptionsOn(on: boolean): void`.

요구 사항(명세 4.4·5.1·5.4·5.5·6.4·6.5·6.8, P-19):
- 질의 열쇠 `['subtitles', itemId]`·`['subtitles', itemId, assetId, 'cues']`. `subtitles:changed`가 오면 그 자료의 둘과 본문 검색 질의(`['search', …]` — 지금 열쇠 이름대로)를 무효로.
- 기본 트랙(`pickTrack`): 저장값의 자산이 트랙 목록에 있으면 그 값, 아니면 `language === 'ko'`인 첫 트랙(언어 비교는 `ko` 또는 `ko-*`), 없으면 순서가 처음인 트랙, 켬. 트랙이 없으면 `{ assetId: null, on: false }`.
- locator: 저장할 때 `captions: { assetId, on }`(트랙이 있을 때만). 트랙을 바꾸거나 C를 누르면 `pos.update` 뒤 `pos.flush()`(명세 4.4).
- 오버레이: 명세 6.4(바탕·글 크기 `clamp(14px, 높이 × 3.1%, 40px)`는 영상 상자 높이를 ResizeObserver로 읽어 CSS 변수로, 줄 높이 1.45, 최대 3줄, 글 노드만). 지금 큐는 재생 중 `requestVideoFrameCallback`의 `mediaTime`으로, 정지·이동은 `seeked`로 `activeCues`. 큐가 바뀔 때만 다시 그린다. `data-controls-hidden`이면 아래로.
- 자막 ▾(도구 막대 오른쪽, `MenuButton` `placement="bottom end" variant="plain" size="small"`, `data-testid="subtitles-menu"`): 명세 6.5. "이 자막 제거"는 맨 아래, 트랙이 켜져 있을 때만. 단추 이름·아이콘은 명세 6.5.
- 자막 단추(컨트롤): 트랙 없으면 비활성 + 이유 "자막 없음", 켬/끔은 `captions`/`captions-off`, 툴팁은 토글 이름 + `C`.
- 추가(`video.addSubtitles`, 자막 ▾의 항목, 빈 상태 단추는 Task 13): `learn.subtitles.pick` → 결과 토스트(`attachToasts.ts`): `added` ≥ 1 → "자막 N개를 붙였습니다"(새 트랙 중 첫 것을 고르고 켬), `existing`만 → "이미 붙어 있는 자막입니다"(정보), `failed` ≥ 1 → 실패 토스트(가져오기 실패 토스트 `importToast`(`R/library/import-flow.ts:10`)와 같은 모양, 머리 "자막 N개를 붙이지 못했습니다", 줄마다 "이름 — 이유"). 시트가 닫힌 뒤의 클릭은 `sheetReleased()` 뒤.
- 제거: `learn.subtitles.remove` → `showUndoToast("‘{이름}’ 자막을 제거했습니다", () => restore)`(`R/ui/toasts.tsx:180`), 남은 트랙 중 `pickTrack`으로 다음 트랙(없으면 끔).
- 항목 패널: 동영상의 파일 절에 `data-field="subtitles"` 줄 "자막" — 트랙 이름을 순서대로 " · "로, 셋 넘으면 "한국어 · 영어 외 2개"(명세 6.8). 트랙 없으면 줄 없음.
- CP949 대조 E2E(P-2): 시험 러너(Node)가 `LS/cp949-table.ts`를 읽어 포인터마다 기대 글자를 만들고, 렌더러에서 `new TextDecoder('euc-kr').decode(Uint8Array.of(lead, trail))`를 23,940쌍 모두 풀어(한 번의 `page.evaluate`) 비교 — 표 0인 칸은 Blink가 U+FFFD를 내는지(트레일이 ASCII면 U+FFFD + 그 글자). 다른 칸 0.

시험:
- 단위: `trackNames`(`ko`·`en`·`en-US`·`null` 둘 → "자막 1"·"자막 2", 같은 언어 둘 → "한국어"·"한국어 2"), `pickTrack`(저장값 있음·자산 사라짐·`ko` 먼저·`ko-KR`·트랙 없음), `activeCues`(겹침, 긴 큐가 짧은 큐 여럿을 덮음, 경계 = 시작 포함·끝 제외), `cueIndexAt`.
- `E/subtitles.spec.ts`(이 작업 몫): `stubOpenDialog`로 "자막 파일 추가…" → 토스트·오버레이가 0:01–0:04에 첫 문장(`currentTime`을 2초로 옮기고 기다림 — 양성 대조 뒤 4.5초에서 다른 글) → 자막 ▾로 영어 → 오버레이 영어 → C로 끔(오버레이 없음 — 양성 대조 뒤) → 다시 실행 뒤 같은 트랙·같은 켬/끔 → 제거와 되돌리기 → 깨진 파일 실패 토스트와 붙지 않음 → 같은 파일 다시 → "이미 붙어 있는 자막입니다" → 항목 패널 "자막" 줄 → CP949 대조.

- [ ] **Step 1**: 단위 시험을 쓰고 실패 확인 → 구현 → 통과.
- [ ] **Step 2**: 오버레이·자막 ▾·컨트롤 단추·명령·locator·토스트·항목 패널.
- [ ] **Step 3**: E2E(`subtitles.spec.ts`, `commands-coverage`), 1024 한 번.
- [ ] **Step 4**: 투어 장면(자막 한 줄·두 줄, 자막 ▾ 열림, 붙이기·제거 토스트).
- [ ] **Step 5**: 커밋 `feat(video): subtitles on screen — the overlay sized to the picture, the subtitles menu (tracks, off, add, remove with undo), a Korean track first, the choice kept in the reading position; the item panel's subtitles row; the CP949 table checked against Chromium`.

---

### Task 13: 대본 칸 — 머리·검색·가상 목록·이동·따라가기 스위치·⌘F·끝 상태·`video-perf` (목업 승인 뒤)

**Files:**
- Create: `RV/TranscriptPane.tsx`, `RV/transcriptSearch.ts`, `RV/transcriptSearch.test.ts`, `RV/useFollow.ts`, `R/ui/Switch.tsx`, `R/styles/components/switch.css`, `V/video-perf.evidence.ts`
- Modify: `R/viewers/pdf/ReaderSidebar.tsx`(동영상 갈래), `RV/videoStore.ts`(`transcript: { query: string; matches: number[]; current: number; wrapped: boolean; follow: boolean }`), `RV/videoActions.ts`, `D/commands.ts`(`library.find` 규칙 — P-4), `R/commands/registry.ts`(`openFind` 처리기의 영상 갈래 또는 `library.find` 처리기), `R/strings/video.ts`, `R/styles/screens/video.css`·`sidebar.css`, `R/strings/strings.test.ts`(`COMPOUNDS`), `E/subtitles.spec.ts`

**Interfaces:**
- Consumes: Task 12 `useSubtitles`·`cueIndexAt`·`VideoStore.track/cues`, Task 10 `VideoHandle.seekTo`.
- Produces:
  ```ts
  // RV/transcriptSearch.ts
  /** NFC, 대소문자·발음 부호 무시 부분 일치(trim한 질의가 비면 []). 큐 인덱스 오름차순. */
  export function transcriptMatches(cues: readonly Cue[], query: string): number[];
  /** 다음(1)/이전(-1) 일치. 지금 시각 기준으로 처음 고르고, 끝을 넘으면 처음으로(wrapped = true). */
  export function stepMatch(matches: readonly number[], from: number, dir: 1 | -1): { index: number; wrapped: boolean } | null;
  /** 큐 글을 [글, 일치 여부] 조각으로(<mark>는 화면이 그림). */
  export function markParts(text: string, query: string): Array<[string, boolean]>;
  // R/ui/Switch.tsx
  export function Switch(props: { isSelected: boolean; onChange(v: boolean): void; children: ReactNode; testId?: string }): JSX.Element;
  ```

요구 사항(명세 7절, P-4·P-20·P-21):
- 머리 "대본"(패널 머리 문법 — `reader-nav-head` 자리, 세그먼트 없음), 아래 검색 칸(`.nav-search` 모양의 `SearchField`, 자리표시 "대본에서 찾기", 오른쪽 개수 "N개" — `tabular-nums`, 지우기 단추). 검색은 150ms 디바운스.
- 목록: `role="listbox"`, 행 `role="option"`(시간 footnote 3차색 위 · 문장 13/20 아래, 지금 큐 `--accent-soft` + 시간 강조색, 지나간 문장 2차색, 일치 `<mark>`는 `--find-match`), `@tanstack/react-virtual` `measureElement`, 커서 행은 `rangeExtractor`로 늘 그림, ↑↓·Home/End·PageUp/PageDown. 클릭·↩ → `seekTo(cue.startMs, { keepPaused: true })`(재생 중이면 계속 재생). 행에 포커스가 있어도 한 글자 키는 영상으로(P-5).
- 지금 트랙의 큐를 보인다. C로 꺼도 마지막에 고른 트랙을 그대로.
- 따라가기(`useFollow`): 아래 막대 40의 `Switch` "현재 위치 따라가기", 탭을 열 때 켬(저장 안 함). 켜져 있으면 지금 큐를 칸 위쪽 1/3에(움직임 줄이기면 바로, 아니면 160ms 부드럽게 — `scrollTo({ behavior })`). 사용자의 휠·끌기·키보드 스크롤(목록 스크롤 사건 중 우리 스크롤이 아닌 것)이면 끔. 대본 클릭·검색 이동은 끄지 않음. 다시 켜면 지금 큐로.
- 검색 ↩/⇧↩: `stepMatch` → 그 큐로 스크롤 + `seekTo`(명세 7.4). 감으면 개수 자리에 한 번 "처음부터 · 1 / N"(2초, FindBar의 `WRAP_NOTE_MS`와 같음). 결과 없음 빈 상태(명세 7.4 문구, `search-x`). esc: 질의 지우고 목록으로 포커스.
- ⌘F(P-4): `library.find` 규칙에 영상 갈래, 처리기는 보이는 리더가 영상이면 사이드바가 접혀 있으면 펴고(`toggledSidebar` 길) 대본 검색 칸에 포커스.
- 끝 상태(명세 6.7): 여는 중 = 머리 + 자리 상자(비활성), 자막 없음 = `PaneEmpty`(`captions-off`, "자막이 없습니다", 설명, [자막 파일 추가…] → `video.addSubtitles`), 재생 불가·원본 없음·열기 실패 = `noTranscript`(Task 10).
- `V/video-perf.evidence.ts`(`@perf`, `video-perf.json`): 명세 14절의 대본 다섯 줄(큐 2,000 스크롤 프레임 p95, 2배속 20초 따라가기 + 오버레이 프레임 p95, 큐 전환 ≤ 1프레임(큐 40개 — `requestVideoFrameCallback`의 `mediaTime`이 큐 시작을 넘은 다음 그리기에서 오버레이 글이 바뀌었는지), 대본 검색 입력 → 강조 p95, 붙이기 2만 큐 main 시간). 프레임 측정은 `V/long-frames.ts`·`percentile.ts` 재사용.

시험: `transcriptMatches`(대소문자·발음 부호·NFD 질의·빈 질의), `stepMatch`(앞·뒤·감기·일치 하나), `markParts`. E2E(`subtitles.spec.ts`에 더함): 대본 클릭으로 그 시각(재생 상태 유지 — 정지에서 정지, 재생에서 재생), 행 ↩, 검색 "세포" 개수·↩·⇧↩가 시각을 옮김·감기 문구, 결과 없음 문구, esc, 따라가기(재생 중 지금 큐가 보임 → 휠 스크롤 → 스위치 꺼짐 → 다시 켜면 지금 큐로), ⌘F가 대본 검색 칸(사이드바를 접은 상태에서도), 자막 없는 영상의 빈 상태와 [자막 파일 추가…], 재생 불가의 "표시할 대본이 없습니다".

- [ ] **Step 1**: 단위 시험을 쓰고 실패 확인 → 구현 → 통과.
- [ ] **Step 2**: `Switch`, 대본 칸, 따라가기, 검색, ⌘F.
- [ ] **Step 3**: E2E와 `video-perf`(증거 설정 `-g video-perf`), 1024 한 번.
- [ ] **Step 4**: 투어 장면(대본 보통·일치·결과 없음·자막 없음·따라가기 꺼짐·키보드 포커스 행).
- [ ] **Step 5**: 커밋 `feat(video): the transcript pane — a virtual list that seeks on click and return, a follow switch that a manual scroll turns off, a search that steps through matches by time, ⌘F into it; video-perf`.
- 컨트롤러: CI 녹색 뒤 **Mac 중간 `e2e`**(P-23).

---

### Task 14: 끌어 놓기와 가져오기의 자막 화면 — 영상 탭 오버레이·MIME 거르기·드롭 요약·가져오기 토스트·실패 행 (목업 승인 뒤)

**Files:**
- Create: `RV/SubtitleDropOverlay.tsx`
- Modify: `R/shell/drop.ts`(`DropSummary.subtitle`, `summarizeDrop`, `dropSummaryText`, `windowDropTarget`의 `accepts?`), `R/shell/drop.test.ts`, `R/app/MainWindow.tsx`(`:714` 옆 둘째 문 `subtitleDropOpen`), `R/strings/drop.ts`(`subtitle: '자막'`), `R/library/import-flow.ts`(`importToast`에 자막 수와 자막 실패 줄), `R/strings/toast.ts`, `R/styles/screens/drop.css`, `E/subtitles.spec.ts`, `E/drop.spec.ts`(`:226-240`)

**Interfaces:**
- Consumes: Task 6 `learn.subtitles.attach`, Task 7 `ImportReport.subtitles`, Task 12 `attachToasts`.
- Produces: `windowDropTarget({ …, accepts?: (items: ReadonlyArray<{ kind: string; type: string }>) => boolean })`(거짓이면 `preventDefault`도 오버레이도 없음 — 놓을 수 없음 커서), `SUBTITLE_DRAG_TYPES = ['text/vtt', 'application/x-subrip', 'text/plain', '']`, `SubtitleDropOverlay({ enabled, itemId })`.

요구 사항(명세 5.2·5.3):
- 둘째 문: `subtitleDropOpen = view.kind === 'reader' && 보이는 리더가 재생할 수 있는 동영상 && !blocked && !held`. 창 드롭 오버레이(`dndOpen`)와 동시에 열리지 않는다.
- 끄는 중: 모든 항목이 파일이고 MIME이 `SUBTITLE_DRAG_TYPES` 중 하나일 때만 받는다(PDF·영상·이미지 MIME이 섞이면 놓을 수 없음).
- 오버레이: 사이드바 오른쪽 리더 전체(`sidebarRight()` 재사용), 56 타일 `captions` + "자막으로 붙이기" + "SRT · VTT 파일을 이 동영상에 붙입니다", 창 드롭 오버레이와 같은 문법(복사/연결 카드 없음, ⌥ 무시).
- 놓으면 `isSubtitleName`으로 다시 거르고, 나머지는 실패 행(`not-subtitle`)으로 같은 결과 토스트에 합친다. 붙이기는 `learn.subtitles.attach`(경로 50개씩).
- 드롭 요약(라이브러리 창 오버레이): MIME `text/vtt`·`application/x-subrip`은 '자막'으로 센다 — "파일 3개(동영상 1 · 자막 2)". 빈 MIME·`text/plain`은 지금처럼 '기타'.
- 가져오기 토스트: 성공 제목 끝에 " · 자막 N개"(N ≥ 1, 예 "자료 2개를 가져왔습니다 · 자막 3개"). 자막 실패가 있으면 가져오기 실패 토스트의 줄에 "이름 — 이유"를 더하고 공통 안내 "동영상 탭에 끌어 놓거나 자막 ▾의 ‘자막 파일 추가…’로 붙이세요."(`unpaired`가 있을 때만).

시험: `drop.test.ts`(`summarizeDrop`의 자막, `accepts` 거짓이면 `preventDefault` 없음·`show` 없음, 참이면 지금과 같음). E2E(`subtitles.spec.ts`): 영상 탭에 자막만 끌어 놓기(`E/dnd-helpers.ts`의 합성 드래그 — `text/vtt` MIME) → 오버레이 → 붙음 토스트·트랙; 자막 + PDF를 끌면 놓을 수 없음(`dropEffect === 'none'`, 오버레이 없음 — 양성 대조 뒤); 이름이 `.txt`인 `text/plain` 파일 → 실패 행; 라이브러리에 영상 + 자막 둘 + 짝 없는 자막을 끌어 놓기 → 요약 "파일 4개(동영상 1 · 자막 3)" → 토스트 "자료 1개를 가져왔습니다 · 자막 2개"와 실패 줄 `notes.ko.srt`; 열기 패널로 같이 고르기(`stubOpenDialog`) → 같은 결과. `drop.spec.ts:226`: PDF 탭은 여전히 놓을 수 없음, 영상 탭은 자막만.

- [ ] **Step 1**: 단위 시험을 쓰고 실패 확인 → 구현 → 통과.
- [ ] **Step 2**: 둘째 문·오버레이·요약·토스트.
- [ ] **Step 3**: E2E, 1024 한 번, 투어 장면(드롭 오버레이 `drop=subs`, 라이브러리 요약).
- [ ] **Step 4**: 커밋 `feat(video): drop subtitles on a video tab — a second drop gate with a subtitle MIME filter and its overlay; the library's drop summary counts subtitles; the import toast tells attached and failed subtitles`.

---

### Task 15: 자막 본문 검색 화면 — 범위 설명·결과 없음·시간 행·"문장 N개"·시각에서 열기 (목업 승인 뒤)

**Files:**
- Modify: `R/strings/library.ts`(`:47` "PDF 본문·자막 포함", `:59-60` "·PDF 본문·자막"), `R/inspector/BodyMatchesSection.tsx`(동영상 갈래), `R/inspector/InfoPane.tsx`(`:166` 동영상에도 절), `R/strings/inspector.ts`(`matches.sentences: (n) => \`문장 ${n}개\``, `matches.time`, `more`의 동영상 문구 "외 N문장"), `R/viewers/pdf/readerStore.ts`(`PendingJump`(`:69`)), `R/commands/registry.ts`(`openAtPage`(`:40`) → `openAt`), `R/app/MainWindow.tsx`(`:455-461`), `R/viewers/pdf/PdfReader.tsx`(`:58`·`:171-214`의 `kind === 'page'`), `RV/VideoReader.tsx`(시간 갈래 소비), `RV/videoStore.ts`, `E/body-search.spec.ts`

**Interfaces:**
- Consumes: Task 8 `learn.search.matches`, Task 12 `trackNames`, Task 13 `VideoStore.transcript`.
- Produces:
  ```ts
  export type PendingJump = { kind: 'page'; pageIndex: number; query: string } | { kind: 'time'; startMs: number; query: string; assetId: string };
  // CommandEnv
  openAt(itemId: string, jump: PendingJump): void;
  ```

요구 사항(명세 8.2·8.3, P-15):
- '본문 일치' 절이 동영상에도: 머리 "본문 일치" + 3차색 "문장 N개"(`total`), 행 = `formatClock(startMs)` + 두 줄 조각(`<mark>` — `MARK_START`/`MARK_END`를 글 노드로 나눔), 트랙이 둘 이상인 자료만 " · 영어"(`trackNames`). 20행 넘음은 "외 N문장".
- 행 클릭·↩ → `env.openAt(itemId, { kind: 'time', startMs, query: findWordOf(query), assetId })`.
- 영상 리더: 걸린 시간 이동이 있으면 위치 복원 대신 그 시각(정지, 자동 재생 없음), 그 트랙을 고르고 켬, 대본 검색 칸에 질의를 넣고 그 큐를 지금 일치로(따라가기 켬). 이미 열린 탭이면 그 탭에서 같은 일(`keepsPendingJump`(`:78`)의 영상 판).
- PDF는 `kind: 'page'`로 지금과 같다(`openAtPage`를 부르던 곳을 모두 `openAt`으로).

시험(E2E `body-search.spec.ts`에 더함): 자막을 붙인 영상이 '정보와 본문'에서 표에 듦(제목에 없는 자막 낱말로), 항목 패널 시간 행 "0:12"와 머리 "문장 N개", 행을 누르면 그 시각에서 정지한 채 열리고 대본 검색 칸에 질의·그 큐가 지금 일치, 트랙 둘인 자료의 행에 " · 영어"와 그 행으로 열면 영어 트랙, 휴지통 자료는 빠짐, 범위 ▾ 설명과 결과 없음 덧붙임 문구. 단위: `PendingJump` 소비(`keepsPendingJump`)의 두 갈래.

- [ ] **Step 1**: 시험을 쓰고 실패 확인 → 구현 → 통과.
- [ ] **Step 2**: E2E, 1024 한 번, 투어 장면(시간 행 하나·둘, 범위 설명, 결과 없음).
- [ ] **Step 3**: 커밋 `feat(search): subtitle matches on screen — 문장 counts and time rows in the item panel, opening the video paused at that time with the query in its transcript; the scope and no-results copy name subtitles`.

---

### Task 16: Mac 증거 사진 `m8a-shots`(suite `m8a`)·투어 장면 (목업 승인 뒤)

**Files:**
- Create: `V/m8a-shots.evidence.ts`
- Modify: `.github/workflows/macos-evidence.yml`(`:11` 선택지에 `m8a`, 시간 예산 주석 갱신), `scripts/evidence.sh`(사용법과 suite 검사), 증거 README의 태그 목록, `E/visual/tour.ts`(13절 ①–⑦의 앱 장면이 모두 있는지 맞춤)

**Interfaces:**
- Consumes: Task 10–15의 화면, `V/t1a-shots.evidence.ts`의 틀(`TAG`·`THEMES`·`setTheme`·`shoot`·`shootBoth`·`Shot`, `V/capture.ts`의 `nativeWindowShot`·`pageShot`).
- Produces: 태그 `@m8a`, 이름 `m8a-<장면>-<light|dark>`.

요구 사항(명세 15절 "Mac"): 명세 13절 ①–⑦의 앱 상태를 라이트·다크 창 사진(Mac만 `screencapture -l`)과 페이지 사진으로 — 리더 기본(재생 중 자막 한 줄)·두 줄 자막·자막 ▾·속도 ▾·대본 일치·결과 없음·자막 없음·따라가기 꺼짐·드롭 오버레이·붙이기/실패/제거 토스트·무대 모드(보임·숨김)·좁은 창 960·재생 불가(1024)·항목 패널 "자막" 줄과 시간 행·드롭 요약. 영상은 정한 시각에 정지(`seekTo` 후 `seeked` 기다림)해 사진마다 같은 프레임. 실제 재생·전체 화면 전환·한 프레임 이동은 `video.spec.ts`가 Mac `e2e`에서 본다.

- [ ] **Step 1**: spec을 쓰고 Linux 증거 설정으로 `-g @m8a` 한 번(페이지 사진만).
- [ ] **Step 2**: 워크플로·스크립트·README.
- [ ] **Step 3**: 커밋 `test(evidence): m8a-shots — the video reader and subtitle states in light and dark as Mac window shots; ci(mac): the suite m8a`.

---

### Task 17: 마무리 — axe·키보드 여정·`commands-coverage`·데모·문서·Mac `all` (목업 승인 뒤)

**Files:**
- Modify: `E/keyboard.spec.ts`(여정: F6 → 무대 → 컨트롤 Tab → 대본 목록 ↓↩; 새 상태마다 axe — `video-caption` 규칙은 계속 끄고 이유 주석 "자막은 `<track>`이 아니라 Learn이 그림"), `E/a11y.ts`, `E/commands-coverage.spec.ts`(원장 `:884-926`에 M8a — `M8A_COMMANDS` 모두 돌았음), `V/demo.evidence.ts`(데모 `m8a-demo` — 명세 15절 "데모"의 장 순서), 문서: `docs/design/design-spec.md`(명세 17절 1–7), `docs/spec-amendments.md`(새 `## 16. 영상 리더 v2 · 자막 (M8a)`), `docs/decisions/0003-storage-layout.md`(스키마 v6), `0005-commands-menus-shortcuts.md`(J9, `yields`·`altKey`, ⌘F의 리더 종류 갈래 — P-4), `0007-settings-and-preferences.md`(설정 셋·locator `captions`), `0008-body-search.md`(큐 표와 FTS, 붙일 때 색인, `search:matches`의 시간 행 — P-15), `0009-anchor-hub-and-links.md`(큐의 주소), `docs/acceptance.md`(AC16·자막 가져오기·자막 검색·M8a 완료 조건), `docs/next-session.md`("M8a 결과", "M8b 입력"), `docs/mac-verification.md`("M8a", 전체 화면 멈춤 해결, 끄는 중 MIME 실제 값), 명세 `2026-11-23-m8a-video-subtitles-design.md`(3.3을 P-2로, 6.3·10절의 `reader.find`를 `library.find`로, 8.1의 `track`을 `assetId`로, 4.2의 "`library-check.ts:148`의 판정도"를 P-26으로 — 고친 곳마다 "(구현 중 고침: …)")

요구 사항:
- 전체 Linux 녹색(`pnpm typecheck`·`pnpm test`·`pnpm tokens:check`·`taskset -c 0-3 pnpm e2e:xvfb`·증거 설정 전체).
- 데모(3–4분, 장 목록): 명세 15절 "데모" 그대로.
- 컨트롤러: CI 녹색 → Mac `all`(`scripts/evidence.sh m8a-video all m8a-final`) → Mac PNG·데모 프레임 디자인 비평(라이트·다크) → blocker/major 0건 → 브랜치 전체 검토(opus) → PR(본문에 Mac 실행 id·성능 표·소유자 결정·판정 목록) → 소유자 병합 승인 대기.

- [ ] **Step 1**: 키보드 여정·axe·커버리지 원장.
- [ ] **Step 2**: 데모 spec.
- [ ] **Step 3**: 문서.
- [ ] **Step 4**: 전체 녹색, 커밋 `docs(m8a): …`·`test(m8a): …`(나눠서).

---

## 자기 점검 (2026-11-23)

### 명세 대응표 — 일이 필요한 절·항목마다 그것을 짓는 작업

| 명세 | 작업 |
|---|---|
| 0 결정(세 길, 자막 본문 검색만, 우리 컨트롤) | 6·7·12·14 (세 길), 8·15, 10 |
| 1 완료 조건: 재생 컨트롤·키·한글 입력·기억 | 10 |
| 1 세 길·인코딩 다섯·깨진 파일·트랙·C·제거·기억 | 3·6·7·12·14 |
| 1 대본·검색·따라가기·p95 | 13 |
| 1 자막 본문 검색·시간 행·휴지통·영구 삭제 | 5·8·15 |
| 1 전체 화면 빠른 토글(Linux·Mac) | 9·11 |
| 1 마이그레이션 005→006 | 4 |
| 3.1–3.8 해석기·인코딩·한도·언어 | 3 (+ P-2) |
| 4.1 스키마 v6 | 4 |
| 4.2 자산·판본·중복 판정 | 5·6 |
| 4.3 휴지통·영구 삭제·백업·점검 | 5 (+ P-26) |
| 4.4 locator `captions`·기본 트랙·설정 셋·따라가기 저장 안 함 | 9·12·13 |
| 4.5 앵커 | Global Constraints(만들지 않음), 17(ADR-0009) |
| 5.1 자막 파일 추가… | 6(`pick`)·12 |
| 5.2 같은 이름 묶기·필터·500개·요약 | 7·14 |
| 5.3 영상 탭에 끌어 놓기 | 14 |
| 5.4 붙이는 흐름 | 6 |
| 5.5 제거·되돌리기·고아 | 5·6·12 |
| 6.1 배치·F6 | 10 |
| 6.2 컨트롤·좁은 리더·여는 중 | 10 |
| 6.3 키·포커스 예외·J8·J9 | 10·11·12·13 (+ P-4·P-5·P-6) |
| 6.4 오버레이 | 12 |
| 6.5 자막 ▾ | 12 |
| 6.6 전체 화면·무대 모드·권한 | 9·11 |
| 6.7 상태 표 | 10·13 |
| 6.8 항목 패널 | 12·15 |
| 7.1–7.4 대본 칸 | 13 |
| 8.1 질의·`search:matches` | 8 |
| 8.2·8.3 화면·시각으로 열기 | 15 |
| 9.1 macOS 빠른 토글 | 9·11 |
| 9.2 재생 불가 안내 | 10 |
| 9.3 읽기 절 영상 줄 | 10 |
| 10 명령·토글 이름·커버리지 | 10·11·12·17 (+ P-7·P-8) |
| 11 IPC 표 | 4·6·8·9 |
| 12 문구 | 10–15 (+ P-24) |
| 13 목업 게이트 | 2 |
| 14 성능 예산 | 3(해석 단위)·6(붙이기 단위)·8(`search-perf`)·13(`video-perf`)·기존 `baseline`(첫 프레임) |
| 15 단위·E2E·픽스처·Mac·데모·비평 | 3–17 |
| 16 Global Constraints | 위 절 |
| 17 디자인 명세·ADR·문서 | 17 |
| 18 위험 | P-2(CP949), 14(MIME 기록 → Task 17 `mac-verification`), 9(사건 시한), 12(`seeked`), 10(한 프레임 보고값), 3(SRT 방언), 13(가상화 포커스), Global Constraints(시험의 기다림) |

### 그 밖의 점검

- 이름 맞춤: `searchMatches`·`search:matches`·`learn.search.matches`(Task 8) ↔ Task 15의 소비. `PendingJump`의 시간 갈래 `assetId`(P-15)는 Task 8의 `BodyMatch.assetId`와 같은 값. `VideoStore`는 Task 10이 만들고 12·13·15가 필드를 더한다(각 작업 Interfaces에 적음). `CommandContextState`의 영상 필드: `videoOpen`·`videoPlaying`·`videoMuted`(10), `videoStage`(11), `videoCaptions`·`videoCaptionsOn`(12) — 모두 `commandContextInput`·`contextOf`에 함께.
- 승인 전 작업(3–9)은 화면을 바꾸지 않는다: Task 8의 `BodyMatchesSection`은 호출과 모양만 바꾸고 그림은 그대로, Task 9의 `WindowState.videoStage`는 렌더러가 Task 11까지 읽지 않는다, Task 6·7·9의 E2E는 API만.
- `fullscreen` 권한은 Task 11에서만 뺀다(P-10) — Task 9까지 `first-session.spec.ts:129`가 녹색이어야 한다.
