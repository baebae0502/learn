# M8a — 영상 리더 v2 · 자막 · 자막 본문 검색 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 작업마다 아래 "검토 절차"를 따른다.

**Goal:** 강의 영상을 Learn의 재생 컨트롤과 키로 본다. SRT·VTT 자막은 세 길로 붙인다: 리더의 "자막 파일 추가…", 같이 고른 같은 이름의 파일, 영상 탭에 끌어 놓기. 붙인 자막은 화면 오버레이와 왼쪽 대본 칸에서 읽고, 대본 문장을 누르면 그 시각으로 간다. 라이브러리 '정보와 본문' 검색은 자막 문장까지 찾고, 일치한 시각에서 영상을 연다.

**Architecture:**
- **자막 해석(main, 불신 입력):** `L/subtitles/`는 순수 함수다. 바이트를 글로 바꾸고(BOM → 엄격한 UTF-8 → 커밋한 CP949 표), 글을 큐로 바꾼다(SRT·VTT, 태그·개체 정리, 한도).
- **붙이기:** `L/subtitles/attach.ts`가 가져오기와 같은 관리형 사본 길(스테이징 → 해시 → 원자적 rename)로 파일을 들이고, 한 트랜잭션으로 잇는다(`item_assets` role `subtitle` → `subtitle_tracks` → `cue_texts`).
- **스키마 v6(마이그레이션 006):** 새 표 둘과 FTS5 trigram 하나만 더한다.
- **가져오기 큐:** 묶음 하나 안에서 같은 이름의 자막을 영상 항목에 붙인다.
- **본문 검색:** 쪽 글 일치에 살아 있는 영상의 큐 일치를 합친다. `search:matches`가 쪽 행과 시간 행을 돌려준다.
- **렌더러:** 새 `viewers/video/`가 `<video>` 위에 우리 컨트롤·자막 오버레이·자막 ▾를 그리고, 리더 사이드바에 가상화한 대본 칸을 그린다. `<video>`는 화면만 그린다. 한 글자 키는 명령 레지스트리의 `key`로 렌더러 키맵만 처리한다.
- **영상 전체 화면:** HTML 전체 화면 API를 쓰지 않는다. main이 직렬화하는 창 전체 화면과 렌더러의 무대 모드(`WindowState.stage`)로 바꾼다.

**Tech Stack:**
- 앱: Electron 44.9.1(main은 Node 24.22, ICU 78.2), React 19.3.1, TypeScript 7.0.2, electron-vite 6.0.0, react-aria-components 1.22.1.
- 상태·데이터: @tanstack/react-virtual 3.14.22, @tanstack/react-query 5.104.5, zustand 5.0.15, zod 4.6.7, better-sqlite3 13.0.3(FTS5 trigram).
- 시험·도구: Playwright 1.64.1, vitest 5.0.5(Node 22.19), pnpm 10.15.1.
- 생성 도구: ffmpeg(픽스처만), Python 3 표준 라이브러리(CP949 표 생성기만).
- **새 런타임 의존성 없음.**

**Spec:** 아래 셋을 함께 본다.
- `docs/superpowers/specs/2026-11-23-m8a-video-subtitles-design.md`(아래 "명세"). 소유자 승인 2026-11-23 "이대로 진행해줘".
- `docs/design/design-spec.md`(아래 "디자인 명세").
- Task 2에서 소유자가 승인하는 M8a 목업과 Task 1 스파이크 기록(아래).

코드 사실은 계획을 쓸 때 m8a 워크트리 HEAD 588b8f5(main 82b0752 + 명세)에서 확인했고, 작업 본문에 파일·줄로 적었다.

## 스파이크 결과 (Task 1 — 끝남, 컨트롤러, 2026-11-23·25)

명세 3.3의 질문은 "Electron main에서 `TextDecoder('euc-kr')`가 CP949를 읽는가"였다. 같은 바이트(`81 41`, `B0 A1`, `8C 63`)를 세 곳에서 읽었다.

| 어디서 | 결과 | 판단 |
|---|---|---|
| 시스템 Node 22.19(full ICU 77.1, vitest가 도는 곳) | `81 41` → U+0081 U+0041 | **엄격한 EUC-KR**이다. 확장 글자(갂·똠·햏 같은 8,822자)를 못 읽는다 |
| Electron 44.9.1 main(`ELECTRON_RUN_AS_NODE`, Node 24.22, ICU 78.2) | U+AC02(갂) · U+AC00(가) · U+B620(똠) | WHATWG `euc-kr`(= windows-949)이다 |
| Python 3 `cp949` 코덱 | — | WHATWG `index-euc-kr.txt`(Identifier `1d97134c…`, 2024-09-18)와 대조했다. 포인터 17,048개, 차이 0. 표 파일은 스크래치에 데이터로만 받았고 커밋하지 않았다 |

## 사전 판정 (2026-11-25, 계획 작성 중)

판정 하나를 이 모양으로 적는다: **판정** — 이유 — 틀렸을 때의 비용 → 반영한 작업.

**계획 모양과 순서**
- **P-0 계획의 모양**: M7c·T1a와 같은 절약형이다.
  - 작업마다 파일, 인터페이스(정확한 이름·타입), 정확한 값, 시험(순수 모듈은 사례 표나 시험 코드), 단계를 적는다.
  - 명세가 정확히 정한 긴 내용(006 SQL, 문구 표, 키 표, 상태 표)은 명세 절을 가리킨다. 같은 글을 두 곳에 두면 갈라지기 때문이다. 그래서 구현자는 명세를 함께 편다.
- **P-1 목업 게이트와 순서**(명세 13절):
  - Task 1(스파이크, 끝남)과 Task 2(목업) 뒤, 승인을 기다리는 동안 Task 3–9를 한다. 모두 화면과 무관하다.
  - Task 8은 `BodyMatchesSection`이 새 응답 모양을 읽게만 고친다. 픽셀은 바뀌지 않는다.
  - Task 10–17은 승인 뒤다. 승인이 늦으면 화면 작업 전체가 기다린다.
  - M8b의 질문과 목업(명세 0절)은 컨트롤러가 소유자와 이 계획의 실행과 나란히 진행한다. 계획의 작업이 아니다.

**자막 해석과 픽스처**
- **P-2 CP949는 커밋한 표 하나로**(명세 3.3·J1을 바꿈):
  - 이유: vitest가 도는 Node 22.19의 `TextDecoder('euc-kr')`는 엄격한 EUC-KR이라(스파이크), 같은 `readSubtitle`이 시험과 앱에서 다른 결과를 낸다. 표 하나를 쓰면 두 런타임이 같아진다.
  - 생성기: `scripts/build-cp949.py`(Python 3 표준 라이브러리, `python3 -I`)가 `cp949` 코덱으로 `L/subtitles/cp949-table.ts`를 만들고, 생성물을 커밋한다.
  - 표 모양: 포인터 = (lead − 0x81) × 190 + (trail − 0x41)이고 23,940칸이다. 0은 "없음"이다. Uint16 LE를 base64로 둔다.
  - 디코더: `decodeCp949`(WHATWG `euc-kr` 디코더, fatal)가 표를 쓴다. 3.3의 "안 되면"은 지운다.
  - 대조: `E/cp949.spec.ts`가 표를 Electron main의 `TextDecoder('euc-kr', { fatal: true })`와 23,940칸 모두 견준다.
  - 비용: 약 64 KB의 생성 파일. 명세 3.3은 Task 17이 `spec-amendments.md` 16절에 고친다.
  - → Task 3·17
- **P-3 CP949 픽스처는 커밋한다**:
  - 이유: Node에는 CP949 인코더가 없다. 그래서 `build-cp949.py --fixture <in> <out>`이 커밋한 UTF-8 한국어 자막을 `fixtures/static/subtitles/cp949.srt`로 한 번 바꾸고, 그 파일을 커밋한다. `locked.pdf`를 `mutool`로 만든 선례와 같다.
  - UTF-8 BOM · UTF-16 LE/BE 파일은 `fixtures/generate.mjs`가 같은 UTF-8 파일에서 `Buffer`로 만든다.
  - 한국어 자막에는 확장 글자 문장 하나를 넣는다: "옛 글자판에 없던 똠, 햏 같은 글자도 그대로 보입니다."
  - 비용: 없음.
  - → Task 3
- **P-4 언어 꼬리를 좁힌다**(명세 3.8):
  - 규칙:
    - 두 글자 기본(`[a-z]{2}`, 대소문자 무시 → 소문자)과 지역 부분(`-[A-Za-z0-9]{2,8}`, 두 글자 영문이면 대문자로)을 받는다.
    - 세 글자 기본은 명세의 ISO 639-2 열 개만 받고 두 글자로 바꾼다.
    - 나머지 세 글자는 꼬리가 아니다.
  - 이유: 명세 정규식대로면 `강의.new.srt`가 언어 `new`(네와르어)가 된다.
  - 비용: `강의.fil.srt` 같은 드문 세 글자 언어는 이름이 "자막 1"이 된다.
  - → Task 3

**붙이기와 저장**
- **P-5 붙이기는 library 패키지에**:
  - `attachSubtitleFiles(deps, itemId, paths)`(`L/subtitles/attach.ts`)가 파일 검사 → 읽기 → 해석 → 관리형 사본 → 저장소 트랜잭션을 맡고, main의 IPC는 얇다.
  - 관리형 사본은 새 공개 메서드 `Importer.placeManaged(src, sha256, signal?)`로 들인다. `withManagedPath(managedRelativePath(sha), () => this.place(…))`이고, 읽은 바이트의 sha와 스테이징 사본의 해시가 다르면 `HASH_MISMATCH`다.
  - 이유: 가져오기의 스테이징·해시·rename을 두 번 짓지 않는다. vitest에서 실제 파일로 시험된다.
  - 비용: 없음.
  - → Task 6
- **P-6 이미 붙은 자막**(명세 4.2):
  - 같은 영상에 같은 sha를 또 붙이면 실패가 아니라 `AttachResult.already`(파일 이름 목록)에 넣는다.
  - 렌더러는 이미 붙은 파일이 하나라도 있으면 정보 토스트 "이미 붙어 있는 자막입니다"를 성공 · 실패 토스트 곁에 보인다(처음의 "새로 붙은 것이 없고 실패도 없을 때만"을 코드에 맞춰 고쳤다 — 컨트롤러, 2026-11-27, 최종 리뷰).
  - 이유: 명세 12절이 이 문구를 붙이기 토스트 묶음에 두었다. 섞인 경우에도 이미 붙은 쪽을 말하는 편이 낫다.
  - 비용: 섞인 경우 토스트가 하나 더 뜬다.
  - → Task 5·6·12
- **P-7 되돌리기에 언어를 실어 보낸다**(명세 11절 표를 고침):
  - `subtitles:remove`는 `RemovedTrack = { position, language }`를 돌려주고, `subtitles:restore`의 입력에 `language`를 더한다.
  - 이유: 트랙 행이 연결 행을 따라 지워지므로(복합 외래 키) 언어를 다시 알 길이 없다.
  - 비용: 필드 하나.
  - → Task 5·6
- **P-8 고아 자막 치우기의 때**(명세 5.5·J7):
  - DB 부분(`SubtitlesRepository.sweepOrphans()` — 이어진 자료가 없는 자막 MIME 자산 → `removeUnusedAssets`)은 시작 점검 `runCheck({ startup: true })`의 맨 앞에서 돈다. 어떤 `await`보다 앞이고, T1a의 `repairAtStartup`과 같은 자리다(`M/library-check.ts:46`).
  - 파일은 커밋 뒤 `removePurgedFiles`로 지운다(`inUse` 지킴).
  - 이유: 렌더러가 IPC를 보내기 전에 끝나야 이번 실행의 되돌리기 토스트와 겹치지 않는다. 명세의 "다음 실행의 유휴 때"를 시작 점검의 일로 정한다.
  - 비용: 시작이 자막 수만큼 늦어지지만, 보통 0개다.
  - → Task 6
- **P-9 중복 판정의 역할**(명세 4.2):
  - `LibraryRepository.itemIdsForAsset(assetId, role?: 'original' | 'subtitle')`로 넓힌다.
  - 가져오기의 중복 판정(`L/importer.ts:118`)은 `'original'`만 본다.
  - 격리 파일 제목 찾기(`M/library-check.ts:148`)는 `'original'` 먼저, 없으면 `'subtitle'`(그 영상)을 본다. 명세 4.2(잘못된 중복 없음)와 4.3(자막 사본 문제는 영상 제목으로)을 함께 지킨다.
  - 다른 부르는 곳(가용성 알림, `check.ts:111,115`)은 역할을 가리지 않는다. 그래서 자막 사본이 없어도 그 영상이 보고된다.
  - 비용: 없음.
  - → Task 5

**가져오기 짝짓기**
- **P-10 짝짓기의 자리와 모호함**(명세 5.2):
  - 순수 함수 `pairSubtitles(paths)`(`D/subtitle-pairing.ts`)를 큐의 `enqueue`와 렌더러의 나누기가 함께 쓴다.
  - 같은 줄기의 영상이 둘이면(다른 폴더) 같은 폴더의 영상, 없으면 묶음에서 먼저 나온 영상에 붙인다.
  - 영상 확장자는 `VIDEO_EXTENSIONS = ['mp4', 'm4v', 'mov', 'webm', 'mkv']`(지금 열기 필터와 같음)이다. 그 밖의 파일과 짝지으려던 자막은 짝 없음이다.
  - 이유: 짝짓기는 형식 판별 전에 이름으로만 한다.
  - 비용: 확장자가 틀린 영상은 짝을 못 찾는다.
  - → Task 7
- **P-11 큐 안의 자막**(명세 5.2):
  - `Entry`에 `subtitles: string[]`을 더한다.
  - 짝 없는 자막은 그 실행의 `ImportReport.subtitles.failed`(`reason: 'unpaired'`)에 넣는다.
  - 영상 항목이 정해지면(`imported` → 새 id, `duplicate` → `existingItemId`) 큐가 `deps.attachSubtitles(itemId, paths)`를 기다린다. `failed`이면 모두 `'video-failed'`다.
  - 짝 없는 자막만 있는 묶음도 실행 하나로 끝나 보고서를 낸다(`requested` 0).
  - 중복 시트에서 "그래도 가져오기"로 만든 새 사본에는 자막이 붙지 않는다(첫 정산에서 이미 있는 자료에 붙음).
  - 비용: 드문 경우, 한 줄.
  - → Task 7
- **P-12 열기 패널 필터**:
  - `srt`·`vtt`는 가져오기 열기 패널(`library:pickAndImport`)의 새 `IMPORT_PICK_FILTERS`에만 더한다.
  - 다시 잇기(`library.ts:92`)와 점검의 파일 고르기(`index.ts:635`)는 `IMPORT_FILTERS` 그대로다(영상 자리에 자막을 고를 수 없게).
  - 비용: 없음.
  - → Task 7
- **P-13 500개 나누기**: `inImportCalls`가 `groupForCalls(paths, 500)`로 영상과 그 짝 자막을 한 호출에 넣는다. 묶음 하나가 500을 넘는 일은 없다고 보고, 넘으면 자른다. 비용: 없음. → Task 7

**본문 검색**
- **P-14 시간 행의 `track`은 자산 id**(명세 8.1을 고침):
  - 트랙이 둘 이상인 자료의 시간 행은 `track: assetId`, 하나면 `null`이다.
  - 렌더러는 그 id로 이름(3.8 — 언어 없음 "자막 2", 같은 이름 " 2")을 짓고, `PendingJump.track`으로 그 트랙을 고른다.
  - 이유: 언어 코드는 없을 수도 있고 둘이 같을 수도 있어 트랙을 가리키지 못한다.
  - 비용: 없음.
  - → Task 8·15
- **P-15 `search:pages` → `search:matches`는 Task 8에서 바꾼다**: 그때 `BodyMatchesSection`(`R/inspector/BodyMatchesSection.tsx:23`)이 새 응답의 쪽 행만 그린다. 시간 행 그리기는 Task 15다. 비용: 없음. → Task 8·15

**전체 화면**
- **P-16 무대 모드 제어기**(명세 6.6·9.1):
  - main의 `M/video-stage.ts`가 주 창의 전체 화면 변경을 모두 맡는다(F·단추·esc·⌃⌘F 메뉴). 렌더러는 `ui:stage { action: 'toggle' | 'exit' }`만 보낸다.
  - 바라는 상태와 실제:
    - 제어기는 바라는 상태 `want = { full, stage }`를 요청마다 고친다. 토글은 뒤집고, `exit`는 끈다.
    - 실제 상태와 다르면 `setFullScreen` 하나를 보내고, `enter-full-screen`/`leave-full-screen`이나 2초 확정(`isFullScreen()`)까지 다음 일을 미룬다. 그 뒤 다시 맞춘다. 빠른 다섯 번은 마지막 바람으로 끝난다.
  - 무대에 들어갈 때:
    - 창이 이미 전체 화면이면 창은 두고 무대만 켠다. 나올 때도 그대로다.
    - 무대 때문에 창 전체 화면에 들어갔으면, 나올 때 창도 나온다.
  - 바깥 변경: 사용자가 신호등·⌃⌘F로 전체 화면을 나오면 무대도 꺼진다. Linux 메뉴의 `role: 'togglefullscreen'`도 사건으로 들어온다.
  - 무대는 `WindowState.stage`로 알린다(`windowStateOf`·`trackWindowState`의 비교에 더함). 렌더러는 그 값만 따른다.
  - `APP_PERMISSIONS`에서 `'fullscreen'`을 빼는 일은 Task 11이 한다. `first-session.spec.ts:129`가 F 키 길로 바뀌는 작업과 같아야 그 사이 시험이 깨지지 않는다(309e9e5 판의 P-10).
  - 비용: 명세가 정함 — 없음.
  - → Task 9·11

**명령과 키**
- **P-17 영상 명령은 처리기와 함께**:
  - `video.*` 명령은 처리기를 짓는 작업이 레지스트리에 더한다: Task 10이 재생 하나·이동 넷·프레임 둘·속도 둘·음소거 하나, Task 11이 전체 화면 둘, Task 12가 자막 둘. `commands-coverage`가 활성 명령을 모두 실행하므로 처리기 없는 명령을 먼저 넣을 수 없다.
  - 레지스트리 모양:
    - `CommandContext`에 `'video'`를 더한다. `commandAvailable`은 `contexts`에 `'video'`가 있으면 `ctx.view === 'viewer'`일 때 맥락 안으로 본다. 규칙은 `RULES`의 `videoOpen`이다.
    - `KeySpec`에 `yields?: true`를 더한다. 포커스된 컨트롤이 그 키를 쓰면 키맵이 비킨다(아래 `focusOwnsKey`).
    - `CommandSpec`에 `alsoKey?: KeySpec`을 더한다. 재생의 K + 스페이스처럼 키가 둘인 명령을 위해서다.
    - `stateLabels.video?: { field: VideoLabelField; on: string; off: string }`을 더한다(재생/일시정지 등 토글 이름, 명세 10절).
  - 단축키 시트: ⌘/ 시트의 묶음 `video`("동영상")를 `viewer` 뒤에 둔다.
  - 비용: 명세 10절 그대로라 없다.
  - → Task 10–12
- **P-18 esc 명령**: 명세 6.3의 esc를 위해 `video.exitFullScreen`(키 `Escape` + `yields`, 팔레트 숨김, 규칙 `videoStage`)을 둔다. 명세 10절 목록에 하나를 더하는 것이다. 비용: 없음. → Task 11
- **P-19 ⌘F 명령은 `library.find`**(명세 6.3·10절의 `reader.find`를 고침):
  - `reader.find`라는 명령은 없다. ⌘F는 `library.find`(`D/commands.ts:299-303`, 리더에서는 이름 "찾기", 규칙 `:951`)다.
  - J8은 이 명령에 붙는다. 규칙은 `c.view === 'viewer' ? c.pdfOpen === true || (c.videoOpen === true && c.videoCaptions === true) : c.libraryCount > 0`이다.
  - 처리기는 보이는 리더가 영상이면 대본 검색 칸으로 간다.
  - 비용: 없음.
  - → Task 13

**렌더러 구조**
- **P-20 영상 상태는 리더 범위에**:
  - `ReaderScope.video: StoreApi<VideoStore>`(`R/viewers/readerScope.tsx:14`에 더함)와 활성 범위 훅 `useVideo`를 둔다. `useReader`와 같은 모양이다.
  - 명령은 `videoActions`(`R/viewers/video/videoActions.ts`, `readerActions`와 같은 `Pick<CommandEnv, …>`)가 활성 범위의 `VideoHandle`로 부른다.
  - 비용: 없음.
  - → Task 10
- **P-21 사이드바 갈래**:
  - `ReaderSidebar`(`R/viewers/pdf/ReaderSidebar.tsx:27`)가 보이는 리더가 영상이고 `noPages`가 비어 있으면 `TranscriptPane`을 그린다.
  - `ViewerHost`(`:95-104`)의 `noPages`는 영상이 원본 없음·열기 실패면 새 값 `'noTranscript'`(빈 상태 "표시할 대본이 없습니다"), 그 밖에는 `null`이다. 영상 리더는 재생 불가에서 `setNoPages('reader', 'noTranscript')`를 한다.
  - 비용: 없음.
  - → Task 10·13
- **P-22 시각으로 열기**:
  - `PendingJump = { kind: 'page'; pageIndex; query } | { kind: 'time'; startMs; query; track: string | null }`(`R/viewers/pdf/readerStore.ts:69`)다.
  - `CommandEnv.openAtPage` → `openAt(itemId, jump)`로 바꾼다. PDF 리더는 `kind: 'page'`만, 영상 리더는 `kind: 'time'`만 먹는다.
  - 비용: 없음.
  - → Task 15
- **P-23 스위치 부품**: 저장소에 스위치가 없다. 그래서 `R/ui/Switch.tsx`(react-aria-components `Switch`, `role="switch"`)를 새로 짓는다. 모양은 목업 `.transcript-foot`이고, 토큰만 쓴다. 비용: 부품 하나. → Task 13
- **P-24 오버레이의 영상 상자**:
  - 오버레이는 `object-fit: contain`으로 그려진 영상 사각형(무대 크기와 `videoWidth/videoHeight`로 셈) 안에 놓는다.
  - 글 크기는 `clamp(14, 높이 × 0.031, 40)`px를 CSS 변수 `--cue-size`로 둔다.
  - 크기 관찰은 보이는 탭에서만 한다.
  - 비용: 없음.
  - → Task 12

**시험과 실행**
- **P-25 시험 훅**(main, `M/test-hooks.ts:478`의 `LearnTestHooks`에 더함):
  - `cueTextCount(input: { itemId } | { sha256 }): number`
  - `subtitleAssets(): Array<{ id; sha256; links: number; file: boolean }>`
  - `seedCues(input: { videos: number; cuesEach: number }): { itemIds: string[] }`
  - `stageState(): { stage: boolean; fullScreen: boolean; pending: boolean }`
  - E2E 도우미는 같은 이름으로 `E/helpers.ts`에 둔다.
  - 렌더러 손잡이 `window.__learnVideo`(`window.__learnImage`와 같은 자리·같은 조건, `R/viewers/readerScope.tsx:183-190`): `{ state(): VideoProbe }`. `VideoProbe = { timeMs, paused, rate, volume, muted, cueText: string | null, trackId: string | null, captionsOn: boolean, follow: boolean, frameMs: number }`이다.
  - → Task 6·8·9·10·12·13
- **P-26 Mac 실행**: 중간 `e2e`는 Task 13 뒤(리더와 자막이 끝난 때 — 명세 15절), 끝 `all`은 Task 17이다. 최종 코드에서 두 번까지다. 모두 컨트롤러가 돌린다. → 작업 목록
- **P-27 호스트 확인**:
  - 이 세션은 호스트를 옮겨 다닌다. `bce-colab-g02`에는 Xvfb·ffmpeg·Electron의 GTK 라이브러리가 없었고, `g01`에는 있다.
  - 컨트롤러는 작업마다 보내기 전에 `command -v xvfb-run ffmpeg`와 `ldd <electron> | grep 'not found'`(비어야 함)를 본다. 없으면 보내지 않고 소유자에게 알린다.
  - 비용: 없음.
  - → 시작 전
- **P-28 자막 상태의 locator 검사**(명세 4.4): locator의 `captions.assetId`가 지금 트랙 목록에 없으면 명세의 기본 트랙(`ko` 첫 트랙 → 첫 트랙)으로 가고, `on`은 `true`로 둔다. 옛 locator(`captions` 없음)도 같다. 비용: 없음. → Task 12

## Global Constraints

모든 작업의 요구 사항에 아래가 암묵적으로 포함된다. 따옴표 안은 명세 16절 원문이다.

**데이터와 불신 입력**
- "새 데이터 객체는 모두 앵커로 주소를 가질 수 있다: 큐는 영상 판본의 `video` 앵커(`startMs`/`endMs`)로(4.5)." M8a는 앵커를 만들지 않는다.
- "AGPL 코드(Zotero reader, zotero-pdf-translate, LibreTranslate, llm-for-zotero)는 보지도 가져오지도 않는다. 런타임 의존성은 정확히 고정하고 **새로 더하지 않는다**." CP949는 P-2의 커밋한 표다.
  - `LICENSE`와 `package.json`의 `license` 필드는 건드리지 않는다. `^`·`~` 금지.
- "불신 입력: 자막 파일은 main이 한도 안에서 해석하고(3.7), 렌더러는 큐 글을 글 노드로만 그린다. IPC 입력은 zod, 경로는 절대 경로만." `innerHTML`·`dangerouslySetInnerHTML` 금지.
- 마이그레이션 006은 새 표만 더하므로 `foreignKeysOff`를 쓰지 않는다(명세 4.1).

**화면과 키**
- "HTML 전체 화면 API를 쓰지 않는다(`requestFullscreen` 없음, `fullscreen` 권한 거절)."
- "가짜 컨트롤 금지: 시간 메모(M9)는 그리지 않는다. 메뉴·팔레트·키는 레지스트리에서만, 핸들러 없는 항목은 그리지 않는다."
- "한 글자 키는 렌더러 키맵만(메뉴 가속기 금지), `event.code` 비교, 입력란·IME 조합 중 무시."
- "문체는 합니다체, 화면 문구는 `strings/` 영역 파일, 조사는 `josa.ts`, U+00A0 규칙. 내부 용어는 화면에 쓰지 않는다."
  - 화면 말: '큐'는 '문장', '트랙'은 '자막'. 관형사 + 명사, 숫자와 띄어 쓰는 단위는 U+00A0(디자인 명세 9, `strings.test.ts:64`의 `DETERMINER`).
- "가린 탭은 크기 관찰에 반응하지 않는다. 시트 뒤 클릭은 `sheetReleased()` 뒤에."
- "목업 승인 전에는 UI 구현 없음(13절)." (P-1)

**네트워크**
- "실제 번역 주소를 부르지 않는다 — `google-web.live.test.ts`를 돌리지 않고 `LEARN_TRANSLATION_LIVE`를 켜지 않는다."

**역할과 기록**
- "구현자는 push·CI 실행·하위 에이전트 실행을 하지 않는다(컨트롤러가 한다). Mac 증거는 컨트롤러만." macOS 워크플로도 돌리지 않는다.
- **커밋 꼬리말** — 모든 커밋 끝에 정확히:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01LH2FDh4QwsGUFR3V2KewHi
  ```
  커밋은 `git commit -F <파일>`로 하고, 경로를 하나씩 적어 스테이지한다.
- **PR 본문 끝**(컨트롤러):
  ```
  🤖 Generated with [Claude Code](https://claude.com/claude-code)

  https://claude.ai/code/session_01LH2FDh4QwsGUFR3V2KewHi
  ```
- **git**: amend 금지, force-push 금지, 그냥 `git stash` 금지(치울 것은 WIP 커밋). `.superpowers/`·`evidence/` 아래는 `git add`하지 않는다.
- **주석**: 새 코드의 주석에는 이유만 적는다. 판정 번호(P-n, Jn)·실행 id·비평 id는 커밋 메시지에 적는다.

**코드 규칙**
- **IPC**:
  - 새·바뀐 채널은 기존 `handle()` 래퍼(`M/ipc/register.ts:106` `createHandle` — 발신자 검사 + zod `.strict()` + Result)와 `M/ipc/channel-kinds.ts:20` `CHANNEL_KINDS`를 쓴다. 자막·무대 채널은 주 창만(`MAIN`)이다.
  - preload는 이름공간 API만 내놓는다(`P/surface.ts` `exposeSurface`, `P/surfaces.test.ts`가 둘을 맞춘다).
  - 알림은 `D/event-channels.ts`·`D/events.ts`·preload `events`·`surfaces.test.ts` `EVENTS`의 네 곳에 적는다.
- **토큰만**:
  - 화면 코드에서 색·간격·반경·글자 크기를 직접 쓰지 않는다. 토큰이 아닌 값은 같은 줄에 `/* local: 이유 */`를 붙인다. 한글 UI에 700 없음. `css-lint.test.ts`가 막는다.
  - 새 토큰은 `R/design/tokens.ts`에 두고 `pnpm tokens`를 돌린다.
  - 자막 바탕 `oklch(0% 0 0 / 0.72)`는 목업 값이다. Task 12가 토큰 `--subtitle-bg`로 옮긴다.

**시험과 실행 환경**
- **시험의 기다림**:
  - 시험은 실제 앱 상태(속성·포커스·훅 값·`currentTime`)를 기다리고, 고정 `sleep`/`waitForTimeout`을 쓰지 않는다.
  - "없음"을 확인하는 부정 확인은 같은 경로에서 "있음"을 먼저 확인한(양성 대조) 뒤에만 둔다. 남는 고정 대기는 까닭을 주석으로 적는다.
  - 영상 재생 시각에 기대는 시험은 `currentTime` 조건을 기다린다(명세 18절 — R48류 Mac 간헐 실패).
- **부하 경합**:
  - 단일 E2E spec은 `taskset -c 0-1`, 전체는 `taskset -c 0-3`으로 돌린다.
  - E2E 화면은 1920×1200×24, 증거는 1440×900×24다.
  - `/home`이 NFS라 import 시간에 민감한 시험이 로컬에서 실패할 수 있다. 그 판정은 CI가 한다(보고서에 적는다).
- **프로세스**:
  - 자기가 띄운 정확한 PID만 끝낸다. `pkill -f` 금지, `find /` 금지, `/tmp`를 쓸어 지우지 않는다.
  - 남이 띄운 Xvfb를 끝내지 않는다. `xvfb-run -a`가 자기 화면을 고른다.
  - Playwright 출력은 `--output=/tmp/<고유 이름>`에 둔다.
- **작업마다 녹색**:
  - 작업을 끝낼 때 이것들이 통과한다:
    - `pnpm typecheck`
    - `pnpm test`
    - `pnpm tokens:check`
    - `taskset -c 0-3 pnpm e2e:xvfb`
    - `taskset -c 0-3 xvfb-run -a -s "-screen 0 1440x900x24" pnpm exec playwright test -c playwright.evidence.config.ts`
  - 화면을 바꾼 작업은 그 spec을 `taskset -c 0-1 xvfb-run -a -s "-screen 0 1024x768x24" pnpm exec playwright test <spec>`으로도 한 번 돌린다(Mac 러너 화면 크기).
  - 긴 실행은 백그라운드로 돌리고 끝날 때까지 직접 기다린다(포그라운드 `sleep` 금지).
  - 실패하면 실패한 spec만 고쳐 다시 돌리고, 그다음 전체를 한 번 더 돌린다.

## 검토 절차 (모든 작업)

1. **구현자**: 작업 목록의 모델로 한다. 단계를 순서대로 밟는다(시험 먼저 → 실패 확인 → 구현 → 통과 → 커밋). 하위 에이전트를 부르지 않는다. 보고서는 컨트롤러가 정한 파일에 쓰고, 답에는 상태·커밋·시험 한 줄·우려만 적는다.
2. **작업 검토**:
   - 명세 준수(작업 요구, Global Constraints, 사전 판정)와 품질을 한 번에 본다. 품질은 실패할 수 있는 단언인지, 양성 대조, 접근성 속성, 명세 14절 예산에 닿는 복잡도다.
   - 계획과 다르게 구현했다면 이유가 커밋 본문에 있어야 한다.
   - 검토자는 sonnet이다. **Task 3·6·9는 opus**다. 이유는 불신 입력 해석, 붙이기의 트랜잭션과 파일 순서, 전체 화면 직렬화의 경합이다.
3. **디자인 비평(UI 작업 10–15, opus)**: 승인 목업 렌더와 Linux 투어 PNG를 나란히 놓고, 디자인 명세·루브릭으로 blocker/major/minor를 매긴다. blocker·major가 0건이 될 때까지 반복한다.
4. **macOS 증거**(P-26의 두 지점): 컨트롤러가 CI 녹색 뒤 `scripts/evidence.sh m8a-video <suite> <label>`을 돌린다.
5. **브랜치 전체 검토(opus)**: Task 17의 Mac `all` 뒤, PR 전에 한 번 한다.

## 경로 줄임말

| 줄임말 | 경로 |
|---|---|
| `D` | `packages/domain/src` |
| `DB` | `packages/db/src` |
| `L` | `packages/library/src` |
| `M` | `apps/desktop/src/main` |
| `P` | `apps/desktop/src/preload` |
| `R` | `apps/desktop/src/renderer/src` |
| `RV` | `apps/desktop/src/renderer/src/viewers/video` |
| `E` | `tests/e2e` |
| `V` | `tests/evidence` |
| `F` | `fixtures` |

시험 폴더: 패키지 시험은 `packages/<pkg>/test/`, main·렌더러 단위 시험은 원본 옆 `*.test.ts`다.

## 작업 목록

| # | 작업 | 화면 | 구현 모델 | 앞선 조건 |
|---|---|---|---|---|
| 1 | CP949 스파이크 — 위 "스파이크 결과" | 스파이크 | **컨트롤러**(끝남) | — |
| 2 | M8a 목업(명세 13절 ①–⑦) + 비평 + 소유자 승인 | 목업 | sonnet + opus 비평 | — |
| 3 | 자막 해석기(순수): 인코딩·CP949 표·SRT·VTT·정리·한도·언어 꼬리, 픽스처, CP949 대조 E2E | 화면 무관 (승인 대기 중 진행) | sonnet | 1 |
| 4 | 스키마 v6: 마이그레이션 006 | 화면 무관 (승인 대기 중 진행) | sonnet | — |
| 5 | 자막 저장소: 붙이기 트랜잭션·목록·큐·제거·되돌리기·고아·영구 삭제·중복 판정의 역할·백업 수 | 화면 무관 (승인 대기 중 진행) | sonnet | 3, 4 |
| 6 | 붙이기(main): `attachSubtitleFiles`·`placeManaged`·`subtitles:*` IPC·알림·시작 때 고아 치우기·시험 훅 | 화면 무관 (승인 대기 중 진행) | sonnet | 5 |
| 7 | 가져오기 짝짓기: `pairSubtitles`·큐의 자막·`ImportReport.subtitles`·열기 필터·500개 나누기 | 화면 무관 (승인 대기 중 진행) | sonnet | 6 |
| 8 | 자막 본문 검색: 큐 질의·합집합·`search:matches`·검색 성능 증거의 큐 | 화면 무관 (승인 대기 중 진행) | sonnet | 5 |
| 9 | 설정·locator·무대 제어기(main)·`WindowState.stage`·`ui:stage` | 화면 무관 (승인 대기 중 진행) | **opus** | — |
| — | **소유자 목업 승인** (P-1) | | | 2 |
| 10 | 영상 리더 v2: 무대·도구 막대·재생 컨트롤·스크러버·속도 ▾·음량·키·설정 기억·여는 중·재생 불가 안내 | 목업 승인 뒤 | sonnet | 승인, 9 |
| 11 | 영상 전체 화면(무대 모드): F·esc·단추·컨트롤 숨김·빠른 토글·첫 세션 시험 고침 | 목업 승인 뒤 | sonnet | 10 |
| 12 | 자막 오버레이·자막 ▾·추가·제거와 되돌리기·기본 트랙·locator·항목 패널 "자막" 줄 | 목업 승인 뒤 | sonnet | 6, 10 |
| 13 | 대본 칸: 가상화 목록·클릭과 ↩·따라가기 스위치·대본 검색·⌘F·끝 상태·`video-perf` | 목업 승인 뒤 | sonnet | 12 |
| 14 | 영상 탭에 끌어 놓기·가져오기 화면(요약 '자막'·토스트 '· 자막 N'·실패 행) | 목업 승인 뒤 | sonnet | 7, 12 |
| — | **Mac 중간 `e2e`** (P-26, 컨트롤러) | | | 13 |
| 15 | 자막 본문 검색 화면: 범위 설명·결과 없음·시간 행·시각으로 열기·읽기 절 영상 줄 | 목업 승인 뒤 | sonnet | 8, 13 |
| 16 | 증거 사진 `m8a-shots`(suite `m8a`)·투어 장면·axe·키보드 여정 | 목업 승인 뒤 | sonnet | 15 |
| 17 | 마무리: 데모·문서(명세 17절, P-2·P-7·P-14·P-18·P-19의 명세 고침)·Mac `all` | 목업 승인 뒤 | sonnet(+컨트롤러) | 16 |

## 작업 사이의 계약 (요약 — 작업 본문의 Interfaces가 정본)

- **Task 3 → 5·6·7·12·13**:
  - `D/subtitles.ts`: `SUBTITLE_EXTENSIONS`·`SubtitleFormat`·`SUBTITLE_MIMES`·`SUBTITLE_LIMITS`·`SubtitleEncoding`·`SubtitleFailure`·`Cue`·`subtitleFormatOf`·`fileStem`·`languageTail`.
  - `L/subtitles`: `readSubtitle`·`SubtitleResult`·`decodeSubtitleBytes`·`decodeCp949`·`CP949_TABLE_B64`.
  - 픽스처 `F/static/subtitles/*`, 생성 픽스처 이름(Task 3 Files).
- **Task 4 → 5·8**: 스키마 v6(`subtitle_tracks`, `cue_texts`, `cue_texts_fts`, 트리거 셋), `LATEST_SCHEMA_VERSION` 6.
- **Task 5 → 6·7·8·12**:
  - `D/subtitles.ts` 더함: `SubtitleTrack`·`RemovedTrack`·`AttachFailureReason`·`AttachFailure`·`AttachResult`.
  - `SubtitlesRepository`(아래 서명)·`NewSubtitle`.
  - `LibraryRepository.itemIdsForAsset(assetId, role?)`, `LibraryCounts.subtitleTracks`, `LibraryContext.subtitles`.
- **Task 6 → 7·12·14·16**:
  - `attachSubtitleFiles`·`AttachDeps`, `Importer.placeManaged`.
  - `window.learn.subtitles.{list,cues,pick,attach,remove,restore}`, 알림 `'subtitles:changed'`.
  - 훅과 E2E 도우미 `cueTextCount`·`subtitleAssets`.
- **Task 7 → 14**:
  - `D/subtitle-pairing.ts`(`VIDEO_EXTENSIONS`·`pairSubtitles`·`SubtitlePairing`·`groupForCalls`).
  - `ImportReport.subtitles`, `IMPORT_PICK_FILTERS`.
- **Task 8 → 15**:
  - `D/body-search.ts` 더함: `PageMatch`·`TimeMatch`·`BodyMatch`·`BodyMatches`.
  - `DB/cue-search.ts`(`cueItemIds`·`cueLikeChunks`·`cueMatches`).
  - `window.learn.search.matches`, 훅 `seedCues`.
- **Task 9 → 10·11·12**:
  - `D/video.ts`(`PLAYBACK_RATES`·`PlaybackRate`·`RATE_STEP`·`VIDEO_TIMING`).
  - 설정 `video.playbackRate`·`video.volume`·`video.muted`, locator `captions`.
  - `WindowState.stage`, `window.learn.ui.stage`, `createStageController`·`StagePort`·`StageController`, 훅 `stageState`.
- **Task 10 → 11–16**:
  - `RV/videoStore.ts`(`VideoStore`·`VideoHandle`·`createVideoStore`)·`useVideo`·`ReaderScope.video`.
  - `RV/VideoReader.tsx`, `RV/videoActions.ts`, `RV/videoTime.ts`(`formatClock`·`spokenClock`).
  - `focusOwnsKey`, `KeySpec.yields`, `CommandSpec.alsoKey`, `stateLabels.video`, 맥락 `'video'`·`videoOpen`·`videoPlaying`·`videoMuted`.
  - `R/strings/video.ts`(`t.video`), `window.__learnVideo`, `M8A_COMMANDS`.
- **Task 11 → 16**: 명령 `video.toggleFullScreen`·`video.exitFullScreen`, 맥락 `videoStage`, 셸 속성 `data-video-stage`.
- **Task 12 → 13·14·15**:
  - `RV/useSubtitles.ts`(`useTracks`·`useCues`), `RV/trackNames.ts`(`trackNames`), `RV/activeCues.ts`(`activeCues`·`cueIndexAt`), `RV/defaultTrack.ts`(`pickTrack`).
  - 명령 `video.toggleCaptions`·`video.addSubtitles`, 맥락 `videoCaptions`·`videoCaptionsOn`, 토큰 `--subtitle-bg`.
- **Task 13 → 15·16**: `RV/TranscriptPane.tsx`, `RV/transcriptSearch.ts`(`findInCues`), `R/ui/Switch.tsx`, `VideoStore.transcript`, `V/video-perf.evidence.ts`.
- **Task 15 → 16·17**: `PendingJump` 합집합, `CommandEnv.openAt`.

## 시작 전

- **워크트리**: `/home/baejs/projects/tutor/.worktrees/m8a`, 브랜치 `m8a-video`(upstream 없음). 푸시는 컨트롤러가 `git push origin HEAD:refs/heads/m8a-video`로 한다.
- **설치**: 워크트리에 `node_modules`가 없다. `pnpm install --frozen-lockfile` 다음 `pnpm fixtures`.
- **호스트(P-27)**: 작업을 보내기 전에 `command -v xvfb-run ffmpeg`와 `ldd $(readlink -f apps/desktop/node_modules/electron)/dist/electron | grep 'not found'`(비어야 함)를 본다.
- **기준선**: Task 3 전에 컨트롤러가 `pnpm typecheck && pnpm test`로 녹색을 확인한다. NFS에서 흔들리는 import 시간 시험은 Global Constraints의 "부하 경합" 줄대로 판정한다.
- **커밋**: 컨트롤러가 이 계획을 커밋한다. 명세의 고침(P-2·P-7·P-14·P-18·P-19)은 Task 17이 `spec-amendments.md` 16절에 적는다. 명세 파일 본문에는 Task 17이 "(계획 판정 P-n으로 고침)" 줄만 단다.

---

### Task 1: CP949 스파이크 (컨트롤러) — 끝남

위 "스파이크 결과"와 P-2·P-3이 기록이다. 저장소에 남긴 파일은 없다(WHATWG 표는 스크래치의 데이터). Task 3이 그 결과를 짓는다.

---

### Task 2: M8a 목업 (명세 13절 ①–⑦)

**Files:**
- Modify: `docs/design/mockups/assets/views.js`
  - `videoSidebar(mode)` 1702-1739, `videoControls({...})` 1741-1759, `videoMain({codec,mode})` 1761-1787, `videoWindow({codec})` 1789-1807에 `m=8a` 분기를 단다.
  - 머리 주석 1-29의 `reader-video` 쿼리 목록을 고친다.
  - `libraryWindow`(:671)의 `m=8a` 분기를 단다(`m=7c`의 `libraryWindow7c` 선례, :672).
- Modify: `docs/design/mockups/assets/mockup.css`
  - 바꾸는 규칙: `.video-stage` 1891, `.subtitle` 1907, `.video-controls` 1921, `.scrubber*` 1930-2010, `.control-row` 2011, `.speed-btn` 2026, `.transcript` 2056, `.cue*` 2062-2090, `.transcript-foot` 2091, `.cue.is-cursor` 2415.
  - 새로 더하는 것: 끌어 놓기 오버레이, 무대 모드, 호버 시간 말풍선, 음량 접힘, 스위치.
- Modify: `docs/design/mockups/assets/data.js`(두 트랙 자막 문장, 시간 행 조각).
- Modify: `docs/design/mockups/assets/icons.js`. `node scripts/build-mockup-icons.mjs`로 다시 만든다. 필요한 아이콘: `captions`, `captions-off`, `rotate-ccw`, `rotate-cw`, `play`, `pause`, `volume-1`, `volume-2`, `volume-x`, `maximize`, `minimize`. 이미 있는 것은 그대로 둔다.
- Modify: `scripts/mockups/manifest.mjs`. `Render` 형의 `group` 합집합(:4)에 `'m8a'`를 더하고, M7c 블록(:156-206)과 같은 모양의 M8a 블록을 만든다(라이트·다크 × 레이아웃 B, `group: 'm8a'`).
- Modify: `docs/design/design-spec.md`
  - 10.4 `reader-video.html`의 쿼리 목록에 `m=8a` 장면을 적는다.
  - 10.1 `library.html`의 쿼리 목록에 `m=8a` 장면을 적는다.

**Interfaces:**
- Produces: 렌더 이름(아래 쿼리)과 새 요소의 `data-ms="M8a …"`. Task 10–16 비평의 짝이다.

**`reader-video.html?m=8a` 공통 틀**
- 탭 줄: M7b의 탭 줄(라이브러리 + 리더 탭, 영상 탭 아이콘 `clapperboard`)이다.
- 리더 도구 막대 44: 오른쪽에 **자막 ▾만** 둔다. 제목·시간 메모 단추는 없다.
- 무대(`--video-stage`): 이 저장소의 시험 무늬 강의 화면(`lectureSlide`)을 쓴다.
- 재생 컨트롤 막대: 명세 6.2의 값과 툴팁 문구를 쓴다.
- 사이드바: 명세 7절의 "대본" 머리 + 검색 칸 + 목록 + 아래 막대 "현재 위치 따라가기" 스위치다. [대본 | 시간 메모] 세그먼트는 그리지 않는다.

**장면**
- ① 기본(재생 중, 지금 큐, 자막 한 줄):
  - `play=paused`, `hover=1`(스크러버 호버 + 시간 말풍선 "18:20"), `drag=1`(트랙 6 · 손잡이 14), `speed=1.25`, `muted=1`(`volume-x`), `sub=two`(두 줄 자막).
  - 모두 라이트·다크 둘 다.
- ②:
  - `menu=subtitles`: 한국어 ✓ · 영어 · 끄기 `C` · — · 자막 파일 추가… · — · 이 자막 제거.
  - `menu=speed`: 0.5× … 2×, 1.25× ✓.
  - `menu=subtitles&tracks=0`: "자막 파일 추가…" 한 줄.
- ③:
  - `state=match`: "칼슘 펌프" 일치 2개 + `<mark>` + 머리 "2개".
  - `state=nomatch`: 명세 7.4 빈 상태.
  - `state=nosubs`: 명세 6.7 빈 상태, 자막 단추 비활성.
  - `follow=off`: 스위치 꺼짐.
  - `cursor=1`: 키보드 포커스 행 `.is-cursor`.
  - `cue=long`: 세 줄이 넘는 문장.
- ④:
  - `drop=subs`: 리더 영역 오버레이 — 56 타일 `captions` + "자막으로 붙이기" + "SRT · VTT 파일을 이 동영상에 붙입니다".
  - `toast=attached`: "자막 1개를 붙였습니다".
  - `toast=attach-failed`: 실패 머리 + 이유 한 줄씩.
  - `toast=removed`: "‘한국어’ 자막을 제거했습니다" + [실행 취소].
- ⑤:
  - `full=1`: 탭 줄·사이드바·도구 막대 없음, 무대 + 컨트롤이 창을 채움.
  - `full=1&idle=1`: 컨트롤·포인터 숨김, 자막이 아래로 내려옴.
- ⑥:
  - `w=1024`, `w=960`: 리더 폭 < 560이면 음량 막대를 접고 음소거 단추만 둔다. 호버 장면 `w=960&volume=hover`도 그린다.
  - `state=unplayable&w=1024`: 명세 9.2 — `.stage-center` 안 안내, 단추 줄바꿈, 사이드바 "표시할 대본이 없습니다".
  - `state=opening`: 어두운 무대, 컨트롤 비활성, 대본 머리 + 자리 상자.

**`library.html?m=8a`** (⑦)
- `panel=video-subs`: 동영상 항목 패널 파일 절의 "자막 · 한국어 · 영어". `panel=video-subs-many`는 "한국어 · 영어 외 2개".
- `matches=time`: '본문 일치' 머리 "본문 일치" + 3차색 "문장 3개", 행 "18:20" + 두 줄 조각.
- `matches=time2`: 트랙 둘이라 "18:20 · 영어".
- `matches=time-many`: 20행 + "외 14문장".
- `search=scope-menu`: 정보와 본문 설명 "PDF 본문·자막 포함".
- `state=noresults&scope=fulltext`: 덧붙임 "·PDF 본문·자막".
- `state=drop`: 요약 "파일 3개(동영상 1 · 자막 2)".
- `toast=unpaired`: 가져오기 실패 토스트 — "자막 파일은 동영상에 붙입니다" + 공통 안내.

**규칙**
- 문구는 명세 12절, 숫자와 단위의 U+00A0, 합니다체를 따른다.
- 자막 바탕 `oklch(0% 0 0 / 0.72)`, 글 크기 `clamp(14px, 높이 × 3.1%, 40px)`, 줄 높이 1.45(명세 6.4).

- [ ] **Step 1**: 위 쿼리를 구현하고 `pnpm mockups:render -- --only m8a`로 PNG를 만든다.
- [ ] **Step 2**: 디자인 명세 10.4·10.1의 쿼리 목록을 적는다.
- [ ] **Step 3**: 커밋 `docs(m8a): mockups — the video reader's toolbar, controls, speed and subtitle menus, transcript states, drop overlay, toasts, stage mode, narrow widths; the item panel's 자막 line and time matches, the scope copy, the drop summary`.
- 컨트롤러:
  1. opus 디자인 비평을 받는다(디자인 명세 2.1·2.5·6·7.3·7.4·10.4, 루브릭, M1 승인 `reader-video.html`과 대조). blocker·major 0건까지 반복한다.
  2. Artifact와 대조표로 소유자 승인을 받는다(J10 "문장 3개"를 묻는 줄 포함).
  3. 승인과 바뀐 문구는 명세 0절 표와 12절에 적는다.

---

### Task 3: 자막 해석기 (순수) · CP949 표 · 픽스처

**Files:**
- 만들 파일:
  - `D/subtitles.ts`
  - `scripts/build-cp949.py`
  - `L/subtitles/cp949-table.ts`(생성물 — 커밋)
  - `L/subtitles/cp949.ts`
  - `L/subtitles/decode.ts`
  - `L/subtitles/parse.ts`
  - `L/subtitles/index.ts`
- 만들 시험:
  - `packages/domain/test/subtitles.test.ts`
  - `packages/library/test/cp949.test.ts`
  - `packages/library/test/subtitles.test.ts`
  - `E/cp949.spec.ts`
- 만들 픽스처(커밋), 모두 `F/static/subtitles/` 아래:
  - `lecture-60s.ko.srt`
  - `lecture-60s.en.vtt`
  - `broken.srt`
  - `notes.ko.srt`
  - `cp949.srt`(P-3, 생성기로 만듦)
  - `README.md`
- 고칠 파일:
  - `D/index.ts`(내보내기)
  - `L/index.ts`(`readSubtitle`·`SubtitleResult` 내보내기)
  - `F/generate.mjs`(아래 생성 픽스처)
  - `F/static/README.md`(자막 줄)

**Interfaces:**
- Produces (`D/subtitles.ts`):
  ```ts
  export const SUBTITLE_EXTENSIONS = ['srt', 'vtt'] as const;
  export type SubtitleFormat = (typeof SUBTITLE_EXTENSIONS)[number];
  export const SUBTITLE_MIMES: Readonly<Record<SubtitleFormat, string>> = { srt: 'application/x-subrip', vtt: 'text/vtt' };
  export const SUBTITLE_LIMITS = { bytes: 5 * 1024 * 1024, cues: 20_000, cueChars: 1_000, lines: 3, maxMs: 24 * 3_600_000 } as const;
  export type SubtitleEncoding = 'utf-8' | 'utf-8-bom' | 'utf-16le' | 'utf-16be' | 'cp949';
  export type SubtitleFailure = 'unreadable' | 'no-cues' | 'too-large' | 'too-many-cues';
  export interface Cue { startMs: number; endMs: number; text: string }
  /** By the name's extension (case-insensitive): what the attach routes filter on; the parser judges by content (spec 3.2). */
  export function subtitleFormatOf(name: string): SubtitleFormat | null;
  /** The file name without its last extension, NFC (both `/` and `\` separate folders). */
  export function fileStem(name: string): string;
  /** `강의.ko` → { base: '강의', language: 'ko' }; `lecture.en-us` → 'en-US'; `강의.kor` → 'ko'; `강의.v2` → { base: '강의.v2', language: null } (P-4). */
  export function languageTail(stem: string): { base: string; language: string | null };
  ```
- Produces (`L/subtitles/index.ts`):
  ```ts
  export type SubtitleResult =
    | { ok: true; format: SubtitleFormat; encoding: SubtitleEncoding; language: string | null; cues: Cue[] }
    | { ok: false; reason: SubtitleFailure };
  export function readSubtitle(bytes: Uint8Array, name: string): SubtitleResult;
  ```
  `decode.ts`: `decodeSubtitleBytes(bytes): { text: string; encoding: SubtitleEncoding } | null`. `cp949.ts`: `decodeCp949(bytes): string | null`. `parse.ts`: `parseSrt(text): Cue[]`, `parseVtt(text): { cues: Cue[]; language: string | null }`, `cleanCueText(raw: string): string`, `parseTimestamp(s: string): number | null`.

**요구 사항** — 명세 3절 그대로, 아래는 그 정확한 값이다.

**CP949 표와 디코더 (P-2)**
- `scripts/build-cp949.py`:
  - 인자가 없으면 표를 쓴다: lead 0x81–0xFE × trail 0x41–0xFE를 `bytes([lead, trail]).decode('cp949')`로 읽어, 한 글자면 그 코드 포인트, 오류면 0을 넣는다(Uint16 LE).
  - 0이 아닌 칸이 정확히 17,048개인지, 모두 0xFFFF 이하인지 `assert`한다.
  - TS 파일 머리에는 "Generated by scripts/build-cp949.py — do not edit. Python's cp949 codec equals the WHATWG index-euc-kr (17,048 pointers)."를 적는다.
  - 본문은 `export const CP949_TABLE_B64 = [ …76자 줄… ].join('');`이다.
  - `--fixture <in> <out>`이면 UTF-8 파일을 `cp949`로 다시 써서 `cp949.srt`를 만든다(줄바꿈 그대로).
  - 표준 라이브러리만 쓴다(`argparse`, `base64`, `pathlib`).
- `decodeCp949(bytes)`(WHATWG `euc-kr` 디코더, fatal):
  - 바이트 < 0x80이면 그대로 둔다.
  - 0x80·0xFF이면 실패다.
  - lead 0x81–0xFE 다음에는 trail 0x41–0xFE가 와야 하고, 표 값 0이면 실패다. 끝에서 lead가 혼자 남아도 실패다.
  - 실패면 `null`이다.
  - 표는 처음 부를 때 `Buffer.from(b64, 'base64')`로 한 번 풀어 `Uint16Array`로 둔다.

**`decodeSubtitleBytes`** (3.3)
- `EF BB BF`이면 나머지를 `TextDecoder('utf-8', { fatal: true })`로 읽는다(`utf-8-bom`).
- `FF FE`이면 `utf-16le` fatal로 읽는다.
- `FE FF`이면 짝수 바이트를 맞바꿔 `utf-16le` fatal로 읽는다(`utf-16be`). Node·Electron 모두 `utf-16be` 라벨에 기대지 않는다.
- BOM이 없으면 `utf-8` fatal → `decodeCp949` 순서로 시도하고, 모두 실패하면 `null`이다.
- 결과 글은 `.normalize('NFC')`한다.

**`readSubtitle`**
1. `bytes.length > SUBTITLE_LIMITS.bytes`이면 `too-large`다.
2. 디코드에 실패하면 `unreadable`이다.
3. BOM·공백 뒤 첫 줄이 `WEBVTT`로 시작하면 VTT, 아니면 SRT다.
4. 남은 큐가 20,000개를 넘으면 `too-many-cues`, 0개이면 `no-cues`다.
5. 큐는 시작 시각으로 안정 정렬한다.
6. 언어는 `languageTail(fileStem(name)).language ?? (VTT 머리의 Language) ?? null`이다.

**시각 · SRT · VTT**
- 시각: `^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[,.](\d{1,3}))?$`이다.
  - 분·초는 60 미만이어야 한다. 소수부는 오른쪽을 0으로 채운다(`.5` → 500ms, `.25` → 250ms).
  - 결과 ≥ `maxMs`이면 그 큐를 버린다.
- SRT:
  - 줄 단위로 읽는다(`\r\n`·`\r`·`\n`).
  - `-->`가 있는 줄이 시간 줄이고, 새 큐를 시작한다.
  - 그다음 줄들은 빈 줄(공백만 있는 줄 포함)이나 다음 시간 줄까지 글이다.
  - 시간 줄 바로 앞의 숫자만 있는 줄은 번호이고, 빈 줄 없이 붙어 있어도 그렇다.
  - 시간 줄의 끝 시각 뒤 내용(`X1:…`)은 버린다.
- VTT:
  - 머리 블록(첫 빈 줄까지)의 `Language: xx` 줄이 언어 후보다(`languageTail`의 꼬리 규칙으로 검사).
  - `NOTE`·`STYLE`·`REGION`으로 시작하는 블록은 건너뛴다.
  - 시간 줄 앞의 `-->` 없는 줄은 식별자다. 끝 시각 뒤 설정은 버린다.

**`cleanCueText`** (3.6)
- 지우는 것:
  - `<rt>…</rt>`·`<rp>…</rp>`는 내용째 지운다.
  - 그 밖의 모든 `<…>` 태그(시각 태그 `<00:00:01.000>` 포함)를 지운다.
  - `{\…}` 덮어쓰기를 지운다.
- 개체를 푼다: `&amp; &lt; &gt; &quot; &#39; &nbsp;`(→ U+00A0), `&lrm; &rlm;`(→ U+200E/U+200F), `&#\d+;`, `&#x[0-9a-fA-F]+;`. 그 밖의 `&…;`은 그대로 둔다.
- 줄마다 앞뒤 공백을 지우고, 빈 줄은 버린다.
- 4줄째부터는 3줄째 끝에 공백으로 잇는다.
- 1,000자(코드 포인트)를 넘으면 앞 999자 + `…`로 자른다.
- 결과가 빈 글이면 그 큐를 버린다.

**언어 꼬리 (P-4)**
- 마지막 `.` 뒤 마디를 `^([A-Za-z]{2}|[A-Za-z]{3})(-[A-Za-z0-9]{2,8})*$`로 본다.
- 두 글자 기본은 소문자로 받는다.
- 세 글자 기본은 `{ kor: 'ko', eng: 'en', jpn: 'ja', zho: 'zh', chi: 'zh', deu: 'de', ger: 'de', fra: 'fr', fre: 'fr', spa: 'es' }`에 있을 때만 받는다.
- 지역 부분은 두 글자 영문이면 대문자로 바꾼다(`en-us` → `en-US`).
- 길이가 2–35를 벗어나면 꼬리가 아니다.

**고정 자막 (커밋, 이 저장소가 쓴 문장)**
- `lecture-60s.ko.srt`: 0–60초 안의 큐 16개. 아래를 모두 담는다:
  - 큐 1: "세포막은 물질의 출입을 조절합니다."
  - 두 줄 큐 하나.
  - 앞 큐와 시간이 겹치는 큐 하나.
  - `<i>…</i>`와 `&amp;`가 든 큐.
  - "칼슘 펌프"가 두 번 나오는 큐 둘(검색·목업 ③의 짝).
  - P-3의 확장 글자 문장.
- `lecture-60s.en.vtt`:
  - 머리에 `Language: en`, NOTE 블록, STYLE 블록, 식별자 줄, `position:10%` 설정을 둔다.
  - 큐 16개는 한국어 큐의 영어 문장이다. 큐 1: "The cell membrane controls what goes in and out."
- `broken.srt`: 시간 줄이 없는 글 세 줄.
- `notes.ko.srt`: 정상 큐 둘. 짝 없는 자막 시험에 쓴다.
- `cp949.srt`: `python3 -I scripts/build-cp949.py --fixture F/static/subtitles/lecture-60s.ko.srt F/static/subtitles/cp949.srt`.
- `README.md`: 위 파일들의 출처(이 저장소가 씀)와 `cp949.srt`를 다시 만드는 명령을 적는다.

**생성 픽스처** (`F/generate.mjs`, 지금 `need()`·`ffmpeg()` 선례 :340-410)
- `lecture-60s.mp4`:
  ```
  ffmpeg -f lavfi -i testsrc2=size=1280x720:rate=30 -f lavfi -i sine=frequency=440:sample_rate=48000 -t 60
         -c:v libx264 -profile:v high -pix_fmt yuv420p -g 60 -b:v 400k -c:a aac -b:a 64k -movflags +faststart
  ```
- 위 고정 자막 다섯을 생성 폴더로 복사한다. 이름은 그대로다(`lecture-60s.ko.srt`·`lecture-60s.en.vtt`가 `lecture-60s.mp4`와 짝).
- `utf8-bom.srt`·`utf16le.srt`·`utf16be.srt`: `lecture-60s.ko.srt`의 바이트에 BOM을 붙이거나 `Buffer.from(text, 'utf16le')` + `FF FE`, BE는 그 짝 바이트를 맞바꾸고 `FE FF`로 만든다.
- `long-2000.srt`: 큐 2,000개를 1.5초 간격, 1.2초 길이로 둔다. 문장은 "{n}번째 문장: 세포막의 운반 단백질은 농도 기울기를 거슬러 물질을 옮깁니다."를 바꿔 가며 쓰고, 열에 한 번은 두 줄로 한다.
- `limit-20000.srt`: 큐 20,000개, 100ms 간격, 글 "문장 {n}".
- `too-many.srt`: 같은 모양으로 20,001개.
- `too-large.srt`: 정상 큐를 되풀이해 크기가 5 MiB + 1바이트 이상이 되게 한다.

**시험 사례**

`packages/domain/test/subtitles.test.ts`:

| 부름 | 기대 |
|---|---|
| `subtitleFormatOf('A.SRT')` · `('b.vtt')` · `('c.txt')` | `'srt'` · `'vtt'` · `null` |
| `fileStem('/x/강의.ko.srt')` · `fileStem('C:\\y\\a.b.vtt')` | `'강의.ko'` · `'a.b'` |
| `languageTail('강의.ko')` | `{ base: '강의', language: 'ko' }` |
| `languageTail('lecture.en-us')` | `{ base: 'lecture', language: 'en-US' }` |
| `languageTail('강의.kor')` · `('강의.KO')` | `'ko'` · `'ko'` |
| `languageTail('강의.v2')` · `('강의.new')` · `('강의')` | language `null`, base 그대로 |

`packages/library/test/cp949.test.ts`:

| 입력 바이트 | 기대 |
|---|---|
| `B0 A1` · `81 41` · `8C 63` · `C1 64`(햏) | `'가'` · `'갂'` · `'똠'` · `'햏'` |
| `41 B0 A1 42` | `'A가B'` |
| `80` · `B0` (끝에 lead 홀로) · `81 20` · `A2 E8`(표 0 칸) | `null` |
| 표 | 0이 아닌 칸 17,048, 길이 23,940 |

`packages/library/test/subtitles.test.ts`(각 줄이 `it` 하나):
- SRT의 CRLF·번호 없음·`.` 소수점·시 생략·좌표 꼬리:
  - `'1\r\n00:00:01,000 --> 00:00:02,500 X1:10\r\n안녕하세요\r\n\r\n00:03.5 --> 00:04.25\r\n둘째\r\n'`
  - → `[{1000,2500,'안녕하세요'},{3500,4250,'둘째'}]`, `format: 'srt'`, `encoding: 'utf-8'`.
- 빈 줄 없이 붙은 블록: `'1\n00:00:01,000 --> 00:00:02,000\n하나\n2\n00:00:03,000 --> 00:00:04,000\n둘\n'` → 큐 둘.
- VTT: 머리 `Language: en`, NOTE·STYLE·REGION, 식별자, `position:10% align:start` → 큐만 남고 `language: 'en'`. 이름의 꼬리(`a.ko.vtt`)가 머리보다 앞선다.
- 정리:
  - `'<i>기울임</i> <font color="red">빨강</font> <c.yellow>노랑</c> <v 교수>말</v> <ruby>漢<rt>한</rt></ruby>'` → `'기울임 빨강 노랑 말 漢'`.
  - `'{\\an8}위 <00:00:01.000>시각 &amp; &lt;b&gt; &#44032; &#xAC00; &unknown;'` → `'위 시각 & <b> 가 가 &unknown;'`.
- 다섯 줄 → 세 줄(`'a\nb\nc d e'`). 1,500자 → 1,000자(끝 `…`).
- 빈 큐는 버린다. 끝 ≤ 시작은 버린다. `24:00:00,000`은 버린다. 정렬은 시작 순이고 같으면 원래 순서다. 겹침은 그대로 둔다.
- 인코딩 다섯:
  - `F/static/subtitles/lecture-60s.ko.srt`를 UTF-8 · UTF-8 BOM · UTF-16 LE BOM · UTF-16 BE BOM(시험 안에서 바이트로 만듦)과 `cp949.srt`(파일)로 읽는다.
  - → `cues`가 모두 같고, `encoding`은 각각 `'utf-8'`·`'utf-8-bom'`·`'utf-16le'`·`'utf-16be'`·`'cp949'`다.
- 한도:
  - 5 MiB + 1바이트 → `too-large`.
  - 큐 20,001 → `too-many-cues`, 20,000 → `ok`.
  - `broken.srt` → `no-cues`.
  - `FF FE` + 홀수 바이트 → `unreadable`.
  - 큐 20,000개 해석 시간을 `console.log('[measure] parse-20000', ms)`로 남기고 `< 1000`.

`E/cp949.spec.ts`(창 하나, 픽셀 없음):
- `launch()` 뒤 `app.evaluate`로 main에서 lead 0x81–0xFE × trail 0x41–0xFE를 `new TextDecoder('euc-kr', { fatal: true })`로 하나씩 읽는다. 한 글자면 그 코드, 오류면 0이다.
- 시험 쪽에서 `CP949_TABLE_B64`를 풀어 23,940칸을 견준다. 다른 칸이 0개여야 한다.
- 양성 대조로 길이 23,940과 0이 아닌 칸 17,048을 먼저 확인한다.

- [ ] **Step 1**: 생성기와 표 — `python3 -I scripts/build-cp949.py`, `cp949.test.ts` 실패 → `cp949.ts` → 통과.
- [ ] **Step 2**: 도메인 시험 → `D/subtitles.ts` → 통과.
- [ ] **Step 3**: 고정 자막 넷을 쓰고 `--fixture`로 `cp949.srt`를 만든다.
- [ ] **Step 4**: `subtitles.test.ts` 실패 → `decode.ts`·`parse.ts`·`index.ts` → 통과.
- [ ] **Step 5**: `F/generate.mjs`에 생성 픽스처를 더하고 `pnpm fixtures`로 만든다. `E/cp949.spec.ts`를 `taskset -c 0-1 xvfb-run -a -s "-screen 0 1920x1200x24" pnpm exec playwright test tests/e2e/cp949.spec.ts`로 통과시킨다.
- [ ] **Step 6**: 작업마다 녹색. 커밋 `feat(subtitles): the subtitle reader — BOM, strict UTF-8 and a committed CP949 table; SRT and VTT cues cleaned to text within limits; language tails; fixtures and a table check against Electron's decoder`.

---

### Task 4: 스키마 v6 — 마이그레이션 006

**Files:**
- Create: `DB/migrations/006-subtitles.ts`(`export const sql`).
- Modify:
  - `DB/migrations/index.ts`: `MIGRATIONS`(:15-21)에 `{ version: 6, name: 'subtitles', sql }`를 더한다. `foreignKeysOff` 없음.
  - `packages/db/test/migrate.test.ts`: :43의 `toBe(5)` → `toBe(6)`, 새 시험들.
  - 스키마 5를 단언하는 다른 시험이 있으면 그것도 고친다(`E/smoke.spec.ts:14`는 상수를 쓰므로 그대로).

**Interfaces:**
- Produces: 스키마 v6(명세 4.1의 SQL 그대로)과 트리거 `cue_texts_ai`·`cue_texts_ad`·`cue_texts_au`. 트리거 본문은 `004-images-text.ts:51-70`의 `page_texts` 트리거와 같은 모양이고 이름만 `cue_texts`다. `LATEST_SCHEMA_VERSION` = 6.

**`migrate.test.ts`에 더할 것** (v4→v5 시험 :374-422의 틀)
- `seedV5(db)`: v5까지 올린 DB에 넣는다:
  - PDF·동영상·이미지·휴지통 자료, 쪽 글 한 줄.
  - 대화 하나(메시지·출처·도구 기록 — `005-tutor.ts`의 표), 앵커 몇 개.
  - 동영상 자료의 `item_assets` role `subtitle` 행 하나(v5에서도 CHECK가 받음).
- 그 뒤 `migrate`:
  - `{ from: 5, to: 6, backupFile: \`${file}.pre-v6.bak\` }`.
  - v5의 모든 표의 `SELECT rowid AS _rowid, * … ORDER BY rowid`가 같다.
  - `foreign_key_check`가 빈 배열이고, `foreign_keys = 1`이다.
  - `subtitle_tracks`·`cue_texts`·`cue_texts_fts`, 색인 `subtitle_tracks_asset`·`cue_texts_time`이 있다.
  - 스냅숏을 열면 `currentVersion(snap) === 5`다.
- 트리거: `cue_texts`에 넣기 → `cue_texts_fts MATCH '칼슘'`이 그 행을 찾고, UPDATE 뒤 새 글로 찾고, DELETE 뒤 0행이다.
- 복합 외래 키:
  - `item_assets`의 subtitle 행을 지우면 그 `subtitle_tracks` 행이 사라진다.
  - `items` 행을 지우면(연쇄) 둘 다 사라진다.
  - 역할이 `original`인 연결에 트랙 행을 넣으면 실패한다(외래 키).
- CHECK: `role = 'original'` 직접 넣기, `language` 1자·36자, `end_ms <= start_ms`, `sha256` 63자가 모두 실패한다.
- 실패 사례: `[...v5, { version: 6, name: 'bad', sql: 'CREATE TABLE subtitle_tracks(x); CREATE TABLE subtitle_tracks(y);' }]` → `/^v6 업데이트에 실패했습니다\. 데이터베이스는 v5 상태입니다\./`.
- 1만 항목: v5까지 올린 DB에 `seedItem` + `insertItemsForAsset` 10,000개(:342-358 모양) → 006 시간 `console.log('[measure] migrate-006', ms)`, `< 1000`.

- [ ] **Step 1**: 시험을 쓴다 → 실패(006 없음).
- [ ] **Step 2**: 006을 쓴다 → 통과.
- [ ] **Step 3**: 작업마다 녹색. 커밋 `feat(db): schema v6 — subtitle_tracks keyed to the item's subtitle link and cue_texts with a trigram index, added without turning foreign keys off`.

---

### Task 5: 자막 저장소

**Files:**
- Create:
  - `DB/subtitles-repository.ts`
  - `packages/db/test/subtitles-repository.test.ts`
- Modify:
  - `D/subtitles.ts`(아래 형)
  - `DB/index.ts`(내보내기)
  - `DB/library-repository.ts`: `itemIdsForAsset`(:170-176)에 `role?`, `LibraryCounts`(:42-58)·`counts()`(:488-506)에 `subtitleTracks`
  - `DB/trash.ts`: `removeUnusedAssets`(:168-175)에 `cue_texts` 지우기
  - `L/importer.ts:118`(`'original'`)
  - `M/library-check.ts:148`(P-9)
  - `L/backup.ts:141-150`(선택 수 `subtitleTracks`)
  - `M/library-context.ts`(`LibraryContext.subtitles`; 파일 이름은 `LibraryContext`를 정의한 곳)
  - 각 시험: `packages/db/test/trash.test.ts`, `packages/library/test/importer.test.ts`, `packages/library/test/backup.test.ts:62`(수 목록에 `subtitleTracks: 0`)

**Interfaces:**
- Produces (`D/subtitles.ts`에 더함):
  ```ts
  export interface SubtitleTrack { assetId: string; language: string | null; position: number; originalName: string; cueCount: number }
  export interface RemovedTrack { position: number; language: string | null }
  export type AttachFailureReason = SubtitleFailure | 'not-subtitle' | 'unpaired' | 'video-failed' | 'io';
  export interface AttachFailure { name: string; reason: AttachFailureReason }
  export interface AttachResult { added: SubtitleTrack[]; already: string[]; failed: AttachFailure[] }
  ```
- Produces (`DB/subtitles-repository.ts`):
  ```ts
  export interface NewSubtitle {
    itemId: string; asset: AssetRow; assetIsNew: boolean; revision: { id: string; createdAt: string } | null;
    language: string | null; cues: readonly Cue[]; createdAt: string;
  }
  export class SubtitlesRepository {
    constructor(db: Database);
    /** One transaction: asset (if new) → item_assets(role subtitle) → revision (if new) → subtitle_tracks(position = max + 1) → cue_texts (ON CONFLICT DO NOTHING). */
    attach(rec: NewSubtitle): SubtitleTrack | 'already';
    list(itemId: string): SubtitleTrack[];                       // position, then created_at
    cues(itemId: string, assetId: string): Cue[];                // by the asset's sha, cue_index order
    remove(itemId: string, assetId: string): RemovedTrack;       // deletes the item_assets row; the track follows
    restore(itemId: string, assetId: string, removed: RemovedTrack, now: string): SubtitleTrack;
    isLinked(itemId: string, sha256: string): boolean;           // this item already has a subtitle with this sha
    hasCues(sha256: string): boolean;
    /** Subtitle-MIME assets that no item links to: removed with their rows (removeUnusedAssets), in one transaction. */
    sweepOrphans(): PurgedAsset[];
    count(): number;                                             // subtitle_tracks rows, for backup counts
    cueTextCount(by: { itemId: string } | { sha256: string }): number;
  }
  ```
- Consumes: `AssetRow`(`DB/library-repository.ts:14-29`), `PurgedAsset`·`removeUnusedAssets`(`DB/trash.ts:5,148`), `Cue`(Task 3).

**요구 사항**
- `attach`:
  - 자료가 살아 있는 `video`가 아니면 `LearnError('NOT_FOUND')`다.
  - `isLinked`이면 `'already'`이고 아무것도 쓰지 않는다.
  - `cueCount`는 그 sha의 `cue_texts` 수다.
  - 같은 sha의 큐가 이미 있으면 넣지 않는다(다른 영상이 같은 파일을 씀).
  - `asset.mime`은 `SUBTITLE_MIMES`의 값이어야 한다(아니면 `VALIDATION_FAILED`).
- `cues`: 그 자료에 그 자산이 subtitle로 이어져 있지 않으면 `NOT_FOUND`다.
- `restore`:
  - 자산 행과 그 sha의 큐가 있어야 한다(없으면 `NOT_FOUND`). 이미 이어져 있으면 그 트랙을 그대로 돌려준다.
  - `position`과 `language`를 그대로 쓴다. 같은 순서 값이 있어도 된다(정렬은 position → created_at).
- `sweepOrphans`:
  - `assets.mime IN (자막 MIME)`이고 `item_assets` 행이 하나도 없는 자산을 모아 `removeUnusedAssets`(한 트랜잭션)에 넘긴다.
  - 그 함수가 sha의 마지막 자산이면 `cue_texts`도 지운다(아래).
- `DB/trash.ts` `removeUnusedAssets`: sha에 남은 자산이 없을 때 `page_texts`를 지우는 줄(:173-174) 옆에 `DELETE FROM cue_texts WHERE sha256 IN (SELECT value FROM json_each(?))`를 둔다. 트리거가 FTS 행을 지운다.
- `itemIdsForAsset(assetId, role?)`: `role`이 있으면 `AND ia.role = ?`.
  - `L/importer.ts:118`은 `'original'`을 쓴다.
  - `M/library-check.ts:148`은 `[...ids('original'), ...ids('subtitle')][0]`을 쓴다.
- 백업: `LibraryCounts.subtitleTracks`, `counts()`, `BackupManifestSchema`의 선택 수(`.nonnegative().optional()`). 복원 확인은 있는 수만 견준다(기존 :507-508).

**시험**(`subtitles-repository.test.ts`, `packages/db/test/fixtures.ts`의 `freshDb`·`seedItem({ type: 'video' })`)
- 붙이기와 목록:
  - 새 자산이면 목록 하나(`position 0`), 둘째 파일은 `position 1`이다.
  - 다른 sha의 같은 영상, 같은 sha를 다른 영상에 붙이면 자산 행 하나·큐 한 벌이다.
  - 같은 영상에 같은 sha를 또 붙이면 `'already'`이고 행 수가 그대로다.
- 거절:
  - 휴지통 영상, PDF 자료, 없는 자료 → `NOT_FOUND`.
  - 자막이 아닌 MIME → `VALIDATION_FAILED`.
- 큐: `cues` 순서와 값, 이어지지 않은 자산은 `NOT_FOUND`.
- 제거와 되돌리기:
  - `remove` → 목록 비고, 트랙 행 0, `item_assets` 행 0, 자산 행과 큐는 남는다.
  - `restore` → 같은 언어·순서. 다시 `restore`해도 하나다.
- 고아:
  - 제거 뒤 `sweepOrphans` → 자산 행 0, `cue_texts` 0, 돌려준 `PurgedAsset` 하나(`relativePath` 있음).
  - 같은 sha를 다른 영상이 쓰면 0개다.
  - PDF 원본 자산(이어진 자료 있음)은 건드리지 않는다.
- 영구 삭제:
  - 영상을 휴지통 → `purgeTrash` → 자막 자산·`cue_texts` 0.
  - 다른 영상이 같은 sha를 쓰면 남는다.
  - 트랙 행은 연쇄로 0이다.
- 중복 판정(`packages/library/test/importer.test.ts`): 자막으로만 쓰인 sha와 같은 바이트의 파일을 가져올 때 `duplicate`가 아니다. 실제로는 형식 판별이 막으므로, 시험은 `repo`에 자막 연결을 직접 넣고 같은 sha의 PDF를 가져온다 → `imported`.
- 점검(`library-check`의 격리 파일 제목): sha가 영상의 자막이면 그 영상 제목이다.
- 백업: `counts().subtitleTracks`, 매니페스트 라운드트립, `backup.test.ts:62`.

- [ ] **Step 1**: 시험 → 실패. **Step 2**: 구현 → 통과. **Step 3**: 작업마다 녹색. 커밋 `feat(db): the subtitles repository — attach in one transaction, list, cues, remove and restore, orphan sweep; cue_texts go with their last asset; duplicate checks see original links only; backup counts subtitle tracks`.

---

### Task 6: 붙이기 (main) — `attachSubtitleFiles` · IPC · 알림 · 시작 때 고아 치우기

**Files:**
- Create:
  - `L/subtitles/attach.ts`, `packages/library/test/subtitle-attach.test.ts`
  - `M/ipc/subtitles.ts`, `M/ipc/subtitles.test.ts`
  - `E/subtitles-data.spec.ts`
- Modify:
  - `L/importer.ts`: 공개 `placeManaged`, `private place`(:172) 그대로.
  - `L/index.ts`
  - `D/ipc.ts`: 입력 스키마 넷과 `LearnApi.subtitles`.
  - `D/ipc-channels.ts`(:29 옆 `subtitles`)
  - `D/event-channels.ts`·`D/events.ts`(`'subtitles:changed'`)
  - `M/ipc/channel-kinds.ts`, `M/ipc/all.ts`(:19 `MODULES`)
  - `M/ipc/library.ts`: `showOpen`(:29-33)을 내보내고 `mainStrings.importFilters.subtitles`를 쓴다.
  - `M/strings.ts`: `importFilters.subtitles: '자막(SRT · VTT)'`.
  - `P/main.ts`(:21 `requests`, :28-31 `events`), `P/surfaces.test.ts`
  - `M/library-check.ts`(P-8 — `runCheck`의 startup 앞머리), `M/index.ts`(파일 지우기 연결)
  - `M/test-hooks.ts`(`cueTextCount`·`subtitleAssets`), `E/helpers.ts`(같은 이름의 도우미)

**Interfaces:**
- Produces:
  ```ts
  // L/importer.ts
  /** A verified managed copy of `src` at the hash-addressed path (the import's staging → hash → rename), for files that are not items. */
  placeManaged(src: string, sha256: string, signal?: AbortSignal): Promise<string>;   // returns the library-relative path

  // L/subtitles/attach.ts
  export interface AttachDeps { repo: LibraryRepository; subtitles: SubtitlesRepository; importer: Pick<Importer, 'placeManaged'>; now?: () => string }
  export function attachSubtitleFiles(deps: AttachDeps, itemId: string, paths: readonly string[]): Promise<AttachResult>;

  // D/ipc.ts
  export const subtitlesItemInput = z.object({ itemId: uuid }).strict();
  export const subtitlesTrackInput = z.object({ itemId: uuid, assetId: uuid }).strict();
  export const subtitlesAttachInput = z.object({ itemId: uuid, paths: z.array(absolutePathSchema).min(1).max(50) }).strict();
  export const subtitlesRestoreInput = z.object({ itemId: uuid, assetId: uuid, position: z.number().int().min(0), language: z.string().min(2).max(35).nullable() }).strict();
  // LearnApi.subtitles: list(i) → { tracks: SubtitleTrack[] }; cues(i) → { cues: Cue[] }; pick(i) → AttachResult;
  //   attach(i) → AttachResult; remove(i) → RemovedTrack; restore(i) → SubtitleTrack
  // Channels.subtitles = { list: 'subtitles:list', cues: 'subtitles:cues', pick: 'subtitles:pick', attach: 'subtitles:attach', remove: 'subtitles:remove', restore: 'subtitles:restore' }
  // LearnEventMap['subtitles:changed']: { itemId: string }   (event channel 'evt:subtitles-changed')
  ```
  `uuid`·`absolutePathSchema`는 `D/ipc.ts`에 이미 있는 것을 쓴다(`importPathsInput` :37이 쓰는 것).
- Produces (훅, P-25): `cueTextCount(input: { itemId: string } | { sha256: string }): number`, `subtitleAssets(): Array<{ id: string; sha256: string; links: number; file: boolean }>`. `file`은 관리형 사본 파일이 디스크에 있는지다.

**`attachSubtitleFiles`** (명세 5.4, 경로 하나씩 차례로)
1. 이름: `displayFileName(p)`(`L/importer.ts:220`)를 쓴다.
2. 확장자: `subtitleFormatOf(name) === null`이면 `{ name, reason: 'not-subtitle' }`이다.
3. 크기: `fs.stat`의 `size > SUBTITLE_LIMITS.bytes`이면 `'too-large'`이고 읽지 않는다.
4. 내용:
   - 읽기 → sha256(`node:crypto`) → `readSubtitle(bytes, name)`. 실패면 그 `reason`이다.
   - `subtitles.isLinked(itemId, sha)`이면 `already`에 이름을 넣는다.
5. 자산:
   - `repo.findAssetsBySha(sha)`에서 관리형 자산이 있으면 다시 쓴다(`assetIsNew: false`, revision `null`).
   - 없으면 새 `AssetRow`를 만든다:
     ```
     { id: newId(), sha256, storageMode: 'managed', relativePath: managedRelativePath(sha),
       externalPath: null, originalName: name, mime: SUBTITLE_MIMES[format], size,
       availability: 'available', createdAt: now, checkedAt: now }
     ```
     revision은 `{ id: newId(), createdAt: now }`다.
   - 어느 쪽이든 `importer.placeManaged(p, sha)`로 사본을 확인하거나 놓는다.
6. 트랜잭션: `subtitles.attach(…)` → `added`에 넣는다.
7. 오류:
   - 읽기·놓기의 파일 오류와 `HASH_MISMATCH`는 `'io'`다.
   - 자료가 살아 있는 영상이 아니면(첫 경로 전에 `repo.getItem`로 본다) 호출 전체가 `LearnError('NOT_FOUND')`다.

**IPC** (`M/ipc/subtitles.ts` — `registerSubtitlesIpc(handle, deps)`)
- `list`·`cues`는 저장소를 그대로 부른다.
- `attach`는 `attachSubtitleFiles`를 부른다.
- `pick`은 `showOpen(deps, event, …)` 뒤 `attach`다. 패널 옵션:
  ```
  { properties: ['openFile', 'multiSelections'],
    filters: [{ name: mainStrings.importFilters.subtitles, extensions: ['srt', 'vtt'] },
              { name: mainStrings.importFilters.all, extensions: ['*'] }] }
  ```
  빈 고르기는 `{ added: [], already: [], failed: [] }`이다.
- `remove`·`restore`는 저장소를 부른다.
- `added`가 있거나 remove·restore가 끝나면 커밋 뒤 `broadcast('subtitles:changed', { itemId })`(`M/events.ts:20`)를 보낸다.
- 모두 `CHANNEL_KINDS`의 `MAIN`이다.

**시작 때 고아 치우기 (P-8)**
- `runCheck`(`M/library-check.ts:43`)의 `opts.startup` 앞머리, `repairAtStartup` 다음, 첫 `await` 전에 `ctx.subtitles.sweepOrphans()`를 부른다(try/catch, 실패는 코드만 `console.warn`).
- 돌려준 자산은 `CheckContext`에 더한 `removeFiles(assets)`로 넘긴다. 구현은 `M/ipc/trash.ts:18-27` `removeFilesAfter`와 같은 `removePurgedFiles(layout, assets, { inUse })`다.
- `CheckContext`(`:25`)의 `Pick`에 `subtitles`를 더한다.

**시험**
- `subtitle-attach.test.ts`(실제 임시 라이브러리 + `Importer`):
  - 세 파일(ko srt, en vtt, broken) → `added` 둘(`language` `'ko'`·`'en'`, `position` 0·1), `failed: [{ name: 'broken.srt', reason: 'no-cues' }]`.
  - 관리형 사본의 해시가 맞다.
  - 같은 파일 다시 → `already: ['lecture-60s.ko.srt']`.
  - `.txt` → `'not-subtitle'`.
  - 5 MiB 넘음 → `'too-large'`(파일을 열지 않음 — `fs.readFile` 감시).
  - PDF 자료 → `NOT_FOUND`.
  - 두 영상에 같은 파일 → 자산 하나.
  - 큐 20,000개 파일의 붙이기 시간 `console.log('[measure] attach-20000', ms)`, `< 1000`(명세 14절).
- `M/ipc/subtitles.test.ts`: 처리기와 알림(가짜 `broadcast`), 빈 고르기.
- `E/subtitles-data.spec.ts`(화면 없음, `window.learn.subtitles.*`와 훅):
  - `lecture-60s.mp4` 가져오기 → `attach`(ko, en) → `list` 둘 → `cues` 첫 문장.
  - `utf8-bom`·`utf16le`·`utf16be`·`cp949` 넷을 각각 새 영상에 붙여 첫 문장이 같다(명세 1절 "E2E 하나").
  - `broken.srt` 실패.
  - `remove` → `subtitleAssets()`의 `links` 0, `file: true` → 앱 다시 실행 → 그 자산이 없다(`subtitleAssets()`에 없음, 파일 없음).
  - `restore`한 것은 다시 실행 뒤에도 남는다.
  - 영상 영구 삭제 → `cueTextCount({ sha256 })` 0.

- [ ] **Step 1–3**: 시험 → 실패 → 구현 → 통과. **Step 4**: 작업마다 녹색. 커밋 `feat(subtitles): attach subtitle files in main — managed copies through the import's staging path, the subtitles:* channels and their change event, the startup sweep of unlinked subtitle copies, test hooks`.

---

### Task 7: 가져오기 짝짓기

**Files:**
- Create: `D/subtitle-pairing.ts`, `packages/domain/test/subtitle-pairing.test.ts`.
- Modify:
  - `D/library.ts`: `ImportReport`(:160-181)에 `subtitles`.
  - `M/jobs/import-queue.ts`: `Entry`(:114-126), `enqueue`(:241-265), `ImportQueueDeps`(:51), `settle`(:354), `finishRun`(:477-485).
  - `M/jobs/import-queue.test.ts`(큐 시험 파일 — 없으면 같은 폴더의 큐 시험)
  - `M/index.ts:476-500`(`attachSubtitles` 연결)
  - `M/ipc/library.ts:18-21,61-65`(`IMPORT_PICK_FILTERS`)
  - `R/library/importRunner.ts:10-17`(`inImportCalls` → `groupForCalls`)
  - `E/import-queue.spec.ts` 또는 새 `E/subtitles-import.spec.ts`

**Interfaces:**
- Produces (`D/subtitle-pairing.ts`):
  ```ts
  export const VIDEO_EXTENSIONS = ['mp4', 'm4v', 'mov', 'webm', 'mkv'] as const;
  export interface SubtitlePairing {
    /** Every path that is not a subtitle, in the batch's order. */
    rest: string[];
    /** video path → its subtitle paths, in the batch's order. */
    subtitlesOf: Map<string, string[]>;
    /** Subtitle paths with no video of the same stem in the batch. */
    unpaired: string[];
  }
  export function pairSubtitles(paths: readonly string[]): SubtitlePairing;
  /** Calls of at most `size` paths that never part a video from its subtitles (the renderer's 500-path chunker). */
  export function groupForCalls(paths: readonly string[], size?: number): string[][];
  ```
- Produces (`D/library.ts`): `ImportReport.subtitles: { attached: number; failed: AttachFailure[] }`.
- Produces (`M/ipc/library.ts`): `IMPORT_PICK_FILTERS`(미디어 확장자 + `srt`·`vtt`, 그다음 '모든 파일').
- Consumes: `fileStem`·`languageTail`·`subtitleFormatOf`(Task 3), `AttachResult`·`AttachFailure`(Task 5), `attachSubtitleFiles`(Task 6).

**규칙** (명세 5.2, P-10·P-11·P-13)
- 짝 키:
  - 영상: `fileStem(name).normalize('NFC').toLowerCase()`.
  - 자막: 줄기 그대로, 또는 `languageTail(줄기).language`가 있으면 그 `base`. 둘 다 후보다.
  - 영상 키가 둘 중 하나와 같으면 짝이다.
- 후보가 여럿이면 같은 폴더(경로의 마지막 구분자 앞이 같음) → 묶음에서 먼저 나온 영상 순서로 고른다.
- `groupForCalls`:
  - 순서는 원래 순서다. 다만 영상의 자막은 그 영상 바로 뒤로 옮기고, 짝 없는 자막은 제자리에 둔다.
  - `size`개씩 담되 영상과 그 자막을 가르지 않는다. 한 묶음이 `size`보다 크면 그때만 가른다.
- 큐:
  - `enqueue`는 `pairSubtitles(batch.paths)`의 `rest`로만 `Entry`를 만들고, 영상 `Entry`에 `subtitles`를 단다.
  - 짝 없는 자막은 실행의 `subtitles.failed`에 `'unpaired'`로 넣는다.
  - 항목 정산 뒤:
    - 자막이 있으면 `await deps.attachSubtitles(itemId, entry.subtitles)` → `attached += added.length`, `failed`를 이어 붙인다.
    - 영상이 `failed`이거나 `cancelled`이면 그 자막은 `'video-failed'`다. 취소된 실행의 남은 항목은 보고하지 않는다.
  - `attachSubtitles`가 던지면 그 자막들을 `'io'`로 적고 실행은 계속한다.
  - `rest`가 비고 `unpaired`만 있는 묶음도 실행을 열고 곧 끝내 보고서를 알린다.
- `mainStrings`의 실패 문구는 렌더러가 이유로 고르므로 main에는 넣지 않는다(Task 14).

**시험**
- `subtitle-pairing.test.ts`:

  | 입력 | 기대 |
  |---|---|
  | `['/a/강의.mp4', '/a/강의.srt', '/a/강의.ko.vtt', '/a/강의.en-US.srt']` | 셋 모두 `/a/강의.mp4`에 |
  | `['/a/Lecture.MP4', '/b/lecture.srt']` | 짝(대소문자·폴더 무관) |
  | NFD 이름 `'/a/가'.normalize('NFD') + '.srt'`와 NFC `'/a/가.mp4'` | 짝 |
  | `['/a/강의.pdf', '/a/강의.srt']` | `unpaired: ['/a/강의.srt']` |
  | `['/a/x.mp4', '/b/x.mp4', '/b/x.srt']` | `/b/x.mp4`에(같은 폴더) |
  | `['/a/강의.v2.srt', '/a/강의.mp4']` | 짝 없음(`v2`는 꼬리가 아님) |

  `groupForCalls`: 1,000개(영상 400 + 자막 400 + PDF 200, 자막을 뒤쪽에 섞음) → 모든 호출 ≤ 500, 어느 영상도 자기 자막과 다른 호출에 있지 않다.
- 큐 시험(가짜 `importer`·`attachSubtitles`):
  - 영상 + 자막 둘 → `attachSubtitles` 한 번, `subtitles.attached` 2.
  - 중복 영상 → `existingItemId`로 붙인다.
  - 실패 영상 → `'video-failed'` 둘.
  - 자막만 → 보고서 `requested` 0, `failed` `'unpaired'`.
  - `attachSubtitles` 거절 → `'io'`.
- E2E(새 `E/subtitles-import.spec.ts`, 화면 없음 — `window.learn.library.importPaths`와 `subtitles.list`):
  - `lecture-60s.mp4` + `lecture-60s.ko.srt` + `lecture-60s.en.vtt` → 보고서 `subtitles.attached` 2, 목록 둘.
  - `notes.ko.srt` 혼자 → `unpaired`.
  - 크기 0인 `empty.mp4`(시험이 만듦) + `empty.srt` → `'video-failed'`.
  - 같은 묶음을 다시 → 영상 중복 + 자막 `already`(붙은 수 0).

- [ ] **Step 1–3**: 시험 → 실패 → 구현 → 통과. **Step 4**: 작업마다 녹색. 커밋 `feat(import): pair subtitle files with the videos picked or dropped with them — same stem or a language tail, attached once the video's item is known; unpaired ones are reported; calls of 500 never part a pair`.

---

### Task 8: 자막 본문 검색

**Files:**
- Create: `DB/cue-search.ts`, `packages/db/test/cue-search.test.ts`.
- Modify:
  - `D/body-search.ts`(매치 형), `DB/index.ts`
  - `M/text/search.ts`: `searchBody`(:12) 합집합, `searchPages`(:33) → `searchMatches`.
  - `M/ipc/search.ts`: `search:pages`(:24) → `search:matches`.
  - `D/ipc.ts`: `bodyPagesInput`(:47-48) → `bodyMatchesInput`, `LearnApi.search`(:418-425).
  - `D/ipc-channels.ts:29`, `M/ipc/channel-kinds.ts:89-91`, `P/main.ts:21`, `P/surfaces.test.ts`
  - `R/inspector/BodyMatchesSection.tsx`(P-15: 새 응답의 `kind: 'page'` 행만, 화면 그대로)
  - `M/test-hooks.ts`(`seedCues`), `E/helpers.ts`
  - `V/search-perf.evidence.ts`(큐 씨앗과 두 줄)
  - `E/body-search.spec.ts`(채널 이름이 나오는 곳)

**Interfaces:**
- Produces (`D/body-search.ts`):
  ```ts
  export interface PageMatch { kind: 'page'; pageIndex: number; snippet: string }
  export interface TimeMatch { kind: 'time'; startMs: number; snippet: string; track: string | null }   // track = asset id when the item has 2+ tracks (P-14)
  export type BodyMatch = PageMatch | TimeMatch;
  export interface BodyMatches { matches: BodyMatch[]; total: number }
  ```
- Produces (`DB/cue-search.ts`):
  ```ts
  export function cueItemIds(db: Database, words: BodyWords): string[];
  export function cueLikeChunks(db: Database, like: readonly string[], chunk?: number): Generator<string[]>;
  export function cueMatches(db: Database, itemId: string, words: BodyWords): { matches: TimeMatch[]; total: number };
  ```
- Produces: `window.learn.search.matches({ itemId, query }) → BodyMatches`. `search.pages`는 없어진다.
- Produces (훅): `seedCues(input: { videos: number; cuesEach: number }): { itemIds: string[] }`. 영상 자료와 자막 연결·트랙·큐를 DB에 직접 넣는다(파일 없음). `seedBodyText`(`M/text/seed-body-text.ts`)와 같은 자리에 둔다.

**질의** (명세 8.1, `DB/body-search.ts`의 `LIVE_JOIN`·`LIKE_CLAUSE`·`PAGES_SQL` 틀)
- 살아 있는 큐 조인:
  ```sql
  JOIN assets a ON a.sha256 = c.sha256
  JOIN item_assets ia ON ia.asset_id = a.id AND ia.role = 'subtitle'
  JOIN subtitle_tracks st ON st.item_id = ia.item_id AND st.asset_id = ia.asset_id
  JOIN items i ON i.id = ia.item_id AND i.deleted_at IS NULL AND i.type = 'video'
  ```
- `cueItemIds`: `cue_texts_fts MATCH ftsMatch(fts)` + 2글자 낱말마다 `AND c.text LIKE ? ESCAPE '\'`(큐 하나 안의 AND), `DISTINCT i.id`.
- 2글자만인 질의: `cueLikeChunks`가 `cue_texts`의 id 범위를 덩어리로 훑는다(`bodyLikeChunks` :24의 모양, 취소는 부르는 쪽이 덩어리 사이에서 본다).
- `cueMatches`:
  - 그 자료의 트랙들 큐 가운데 일치를 `start_ms, st.position` 순으로 20행까지 둔다.
  - 조각은 `snippet(cue_texts_fts, 0, char(57344), char(57345), '…', 48)`이다. 2글자만이면 `likeSnippet`을 쓴다.
  - `total`은 20행 미만이면 행 수, 아니면 따로 센다.
  - 트랙이 둘 이상이면 `track = st.asset_id`다.
- main `searchBody`: PDF 쪽 일치 id ∪ `cueItemIds`. 2글자 훑기는 쪽과 큐를 모두 덩어리로 돌고 같은 취소 신호를 본다.
- `searchMatches(db, itemId, query)`: 자료가 살아 있는 `pdf`이면 `bodyPages` 결과를 `kind: 'page'`로, `video`이면 `cueMatches`, 그 밖에는 `{ matches: [], total: 0 }`이다.
- 진행 줄(`search:progress`)은 그대로 PDF만 센다.

**시험**
- `cue-search.test.ts`:
  - "칼슘 펌프"(3글자 이상 둘) → 두 낱말이 한 큐에 있는 자료만 나온다. 다른 큐에 나뉘면 안 나온다.
  - 2글자 "세포"(LIKE) → 찾는다.
  - 휴지통 영상은 빠진다. 자막 연결을 지우면 빠진다.
  - 트랙 둘 → `track`이 자산 id, 하나 → `null`.
  - 25개 일치 → 20행 + `total` 25.
  - `cueLikeChunks`가 모든 덩어리를 돈다.
- main 검색 시험(`M/text/search.test.ts`가 있으면 거기): PDF + 영상 합집합, 휴지통 영상 제외, `searchMatches`의 두 갈래.
- `E/body-search.spec.ts`: 채널 이름을 바꾸고, 기존 쪽 시험은 그대로 통과한다.
- `V/search-perf.evidence.ts`(명세 14절):
  - 지금 PDF 1,000 씨앗 + `seedCues({ videos: 200, cuesEach: 1000 })`.
  - `search:body` p95 ≤ 300ms(같은 예산 줄, 큐 포함).
  - 영상 하나의 `search:matches` p95 ≤ 100ms(새 줄 `cueMatchesMs`).
  - `budget.ts`는 2배 넘을 때만 실패시킨다.

- [ ] **Step 1–3**: 시험 → 실패 → 구현 → 통과. **Step 4**: 작업마다 녹색. 커밋 `feat(search): subtitle cues in body search — trigram and two-letter scans within one cue, live videos only; search:pages becomes search:matches with page and time rows; search-perf seeds cues`.

---

### Task 9: 설정 · locator · 무대 제어기 (main)

**Files:**
- Create:
  - `D/video.ts`, `packages/domain/test/video.test.ts`
  - `M/video-stage.ts`, `M/video-stage.test.ts`
  - `E/video-stage.spec.ts`
- Modify:
  - `D/settings.ts:35-74`(`SETTINGS`)
  - `D/reading.ts:24`(video locator)
  - `D/events.ts:8-22`(`WindowState.stage`)
  - `D/ipc.ts`(`stageInput`, `LearnApi.ui.stage`), `D/ipc-channels.ts`(`ui.stage`)
  - `M/window-state.ts:45-76`(`windowStateOf`에 `stage`, `pushState` 비교에 `stage`), `M/window-state.test.ts`
  - `M/ipc/ui.ts`(`ui:stage` 처리기), `M/ipc/channel-kinds.ts`, `P/main.ts`, `P/surfaces.test.ts`
  - `M/index.ts`: `openMainWindow`(:155-185)에서 제어기를 만든다. `onToggleFullScreen`(:262-266) → `stage.toggleWindow()`.
  - `M/test-hooks.ts`(`stageState`), `E/helpers.ts`
  - `R/shell/useWindowState.ts:9`(`data-video-stage` 속성만 — 화면 규칙은 Task 11)

**Interfaces:**
- Produces (`D/video.ts`):
  ```ts
  export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;
  export type PlaybackRate = (typeof PLAYBACK_RATES)[number];
  export const RATE_STEP = 0.25;
  export const VIDEO_TIMING = { controlsIdleMs: 2000, stageSettleMs: 2000, frameFallbackMs: 1000 / 30, skipShortMs: 5000, skipLongMs: 10000 } as const;
  export const isPlaybackRate = (n: number): n is PlaybackRate => (PLAYBACK_RATES as readonly number[]).includes(n);
  ```
- Produces (설정, 기본값은 렌더러의 "없으면" 규칙):
  - `'video.playbackRate': z.number().refine(isPlaybackRate)` — 없으면 1.
  - `'video.volume': z.number().min(0).max(1)` — 없으면 1.
  - `'video.muted': z.boolean()` — 없으면 `false`.
- Produces (locator): `z.object({ kind: z.literal('video'), timeMs: z.number().int().min(0), captions: z.object({ assetId: z.string().uuid(), on: z.boolean() }).optional() })`.
- Produces (창 상태): `WindowState.stage: boolean`(영상 무대 모드), `stageInput = z.object({ action: z.enum(['toggle', 'exit']) }).strict()`, `Channels.ui.stage = 'ui:stage'`, `window.learn.ui.stage(i) → void`.
- Produces (`M/video-stage.ts`):
  ```ts
  export interface StagePort {
    isFullScreen(): boolean;
    setFullScreen(on: boolean): void;
    onEnter(fn: () => void): void;   // 'enter-full-screen'
    onLeave(fn: () => void): void;   // 'leave-full-screen'
    changed(): void;                 // re-push the window state (resyncWindowState)
  }
  export interface StageController {
    request(action: 'toggle' | 'exit'): void;   // ui:stage
    toggleWindow(): void;                       // the 전체 화면 menu item (⌃⌘F)
    stage(): boolean;
    pending(): boolean;
    dispose(): void;
  }
  export function createStageController(port: StagePort, opts?: { settleMs?: number; timers?: { set(fn: () => void, ms: number): unknown; clear(h: unknown): void } }): StageController;
  /** The stage of a main window, for windowStateOf: false for a window without a controller. */
  export function stageOf(win: BrowserWindow): boolean;
  ```

**제어기의 규칙 (P-16)** — 상태는 `want: { full; stage }`, `stage`(실제), `pending: 'enter' | 'leave' | null`, `fullForStage: boolean`이다.

1. 요청은 `want`만 고치고 `drive()`를 부른다:
   - `request('toggle')`: `want.stage = !want.stage`.
     - 켜면 `fullForStage = !want.full && !port.isFullScreen()`, `want.full = true`.
     - 끄면 `fullForStage`일 때만 `want.full = false`.
   - `request('exit')`: 무대가 켜졌거나 켜질 참이면 위의 끄기와 같다. 아니면 아무것도 안 한다.
   - `toggleWindow()`: `want.full = !want.full`. 끄면 `want.stage = false`, `fullForStage = false`.
2. `drive()`는 `pending`이면 아무것도 하지 않는다. 아니면 이 순서로 한 단계만 한다:
   1. `!want.stage && stage`이면 `stage = false`, `changed()`, 다시 `drive()`.
   2. `want.full !== port.isFullScreen()`이면 `pending = want.full ? 'enter' : 'leave'`, `setFullScreen(want.full)`, `settleMs` 확정 타이머를 건다.
   3. `want.stage && !stage && port.isFullScreen()`이면 `stage = true`, `changed()`.
3. 사건:
   - `enter`/`leave`가 오면 `pending`을 풀고(타이머 해제) `drive()`한다.
   - 기다리지 않던 사건이면 바깥 변경이다:
     - leave면 `want = { full: false, stage: false }`, `fullForStage = false`, 무대가 켜져 있었으면 끄고 `changed()`.
     - enter면 `want.full = true`.
   - 확정 타이머가 먼저 울리면 `pending = null`, `want.full`을 `port.isFullScreen()`과 맞추지 않고 `drive()`한다(같은 요청을 다시 보냄). 다시 확정이 울리면 `want.full = port.isFullScreen()`으로 받아들인다.
4. `stageOf`는 `WeakMap<BrowserWindow, StageController>`로 본다. 창이 닫히면 `dispose`다.

**시험**
- `M/video-stage.test.ts`(가짜 포트 + 가짜 타이머 — 사건은 시험이 직접 보낸다):
  - 창 모드에서 토글 → `setFullScreen(true)` 한 번, 무대는 enter 전 `false`, enter 뒤 `true`.
  - 다시 토글 → 무대 `false` 먼저, 그다음 `setFullScreen(false)`.
  - 이미 전체 화면(⌃⌘F)에서 토글 → `setFullScreen` 없이 무대만 켠다. 끌 때 창은 전체 화면 그대로다.
  - enter를 기다리는 동안 토글 네 번 더(모두 다섯) → enter 뒤 `stage === true && isFullScreen`이고, `setFullScreen`은 한 번뿐이다.
  - 토글 여섯 번 → 끝에 둘 다 `false`이고, `setFullScreen` 호출은 `[true, false]`다.
  - 바깥 leave(사용자가 신호등) → 무대 끔.
  - 사건 없음 → 2초 뒤 다시 보냄 → 또 없음 → `isFullScreen()`을 받아들임.
  - `exit`는 무대가 꺼져 있으면 아무것도 하지 않는다.
- `M/window-state.test.ts`: `stage`가 바뀌면 다시 보낸다.
- `packages/domain/test/video.test.ts`: `isPlaybackRate`, 설정 쓰기 스키마가 0.3·2.5를 거절한다. locator가 옛 값과 `captions`가 든 값을 받고, `captions.assetId`가 uuid가 아니면 거절한다.
- `E/video-stage.spec.ts`(화면 없음 — `window.learn.ui.stage`와 훅):
  - `stage({ action: 'toggle' })` → `stageState()`가 `{ stage: true, fullScreen: true, pending: false }`가 될 때까지 기다린다. 렌더러의 `windowState().stage === true`이고 `<html data-video-stage>`가 있다.
  - 50ms 간격으로 다섯 번 → `pending: false`가 될 때까지 기다린 뒤 `stage === fullScreen`이다(양성 대조로 첫 토글의 `true`를 먼저 봄).
  - `exit` → 둘 다 `false`.
  - 시험 쪽에서 창을 `setFullScreen(false)`로 직접 나오게 하면 무대 `false`.

- [ ] **Step 1–3**: 시험 → 실패 → 구현 → 통과. **Step 4**: `taskset -c 0-1`로 `video-stage.spec.ts`를 `--repeat-each=10`으로 돌린다(1920×1200). **Step 5**: 작업마다 녹색. 커밋 `feat(video): settings and the video locator's captions; main serializes full screen for the video stage — one transition at a time, the last wish wins, a two-second settle; the window state carries the stage`.

---

### Task 10: 영상 리더 v2 — 무대 · 도구 막대 · 재생 컨트롤 · 키 · 설정 기억 · 재생 불가 안내 (목업 승인 뒤)

**Files:**
- Create:
  - `RV/VideoReader.tsx`(지금 `R/viewers/VideoViewer.tsx`를 옮겨 넓히고 옛 파일은 지운다)
  - 상태: `RV/videoStore.ts`, `RV/videoActions.ts`, `RV/useVideoSettings.ts`
  - 화면 부품: `RV/VideoToolbar.tsx`, `RV/VideoControls.tsx`, `RV/Scrubber.tsx`, `RV/SpeedMenu.tsx`, `RV/VolumeControl.tsx`
  - 순수 모듈과 시험: `RV/videoTime.ts`(+ `.test.ts`), `RV/frameStep.ts`(+ `.test.ts`), `R/commands/focusOwnsKey.ts`(+ `.test.ts`)
  - 문구·스타일·E2E: `R/strings/video.ts`, `R/styles/screens/video.css`, `E/video.spec.ts`
- Modify (도메인):
  - `D/accelerator.ts:5-11`(`KeySpec.yields`)
  - `D/commands.ts`:
    - `CommandId` :18-120, `CommandContext` :138, `CommandSpec` :184-245(`alsoKey`, `stateLabels.video`)
    - `LabelState` :685, `commandLabel` :691-704
    - `CommandContextState` :724-805, `RULES` :950-1065, `commandAvailable` :1088-1098
  - `D/ipc.ts:133-193`(`commandContextInput`)
  - `packages/domain/test/commands.test.ts:49-61`(`alsoKey`도 하나뿐인 키)
- Modify (렌더러):
  - 명령: `R/commands/registry.ts`(`CommandEnv` :7-173, `COMMAND_HANDLERS` :212-334, `contextOf` :337-377), `R/commands/keymap.ts:15-24,47-66`
  - 앱 환경: `R/app/MainWindow.tsx:476-637`(env와 맥락)
  - 리더: `R/viewers/ViewerHost.tsx:95-108,139-146,153-164`, `R/viewers/readerScope.tsx:14-31,183-190`(`video`, `window.__learnVideo`), `R/viewers/ReaderNotices.tsx:109-122`
  - 단축키 시트: `R/sheets/shortcuts.ts:25-34`(묶음 `video`), `R/strings/sheets.ts:14`(`video: '동영상'`)
  - 문구·스타일·포커스: `R/strings/index.ts`, `R/styles/components/notice.css`, `R/styles/screens/reader.css:41-58`, `R/shell/panes.ts:9-10`(`video[controls]` 뺌 — 무대는 `[tabindex="0"]`로 잡힘)
- Modify (시험):
  - `E/keyboard.spec.ts:956-969`(F6 → `video-stage`), `E/a11y.ts:10-13`(주석: 자막은 Learn이 그림)
  - `E/tabs.spec.ts:408-423`, `E/position.spec.ts:96-148`(원래 단언 그대로, 선택자만)
  - `E/commands-coverage.spec.ts`(`M8A_COMMANDS` :118 옆, 원장 :884-926)

**Interfaces:**
- Produces (`D`):
  ```ts
  // D/accelerator.ts
  export interface KeySpec { code: string; shift?: boolean; inText?: boolean; /** The focused control's own use of this key comes first (Space on a button, arrows on a slider, a tab or a list). */ yields?: true }
  // D/commands.ts
  export type CommandContext = 'app' | 'library' | 'viewer' | 'item' | 'collection' | 'tag' | 'trash' | 'session' | 'video';
  export type VideoLabelField = 'videoPlaying' | 'videoMuted' | 'videoStage' | 'videoCaptionsOn';
  // CommandSpec: alsoKey?: KeySpec; stateLabels.video?: { field: VideoLabelField; on: string; off: string }
  // CommandContextState: videoOpen?, videoPlaying?, videoMuted? (Task 11: videoStage?, Task 12: videoCaptions?, videoCaptionsOn?)
  ```
- Produces (`RV/videoStore.ts`):
  ```ts
  export type VideoStatus = 'opening' | 'ready' | 'unplayable' | 'failed';
  export interface VideoHandle {
    togglePlay(): void; seekBy(ms: number): void; seekTo(ms: number): void; frame(dir: -1 | 1): void;
    setRate(rate: PlaybackRate): void; nudgeRate(dir: -1 | 1): void; toggleMute(): void; setVolume(v: number): void;
  }
  export interface VideoStore {
    status: VideoStatus; playing: boolean; timeMs: number; durationMs: number; bufferedMs: number; frameMs: number;
    handle: VideoHandle | null;
    patch(p: Partial<Omit<VideoStore, 'patch' | 'setHandle'>>): void; setHandle(h: VideoHandle | null): void;
  }
  export function createVideoStore(): StoreApi<VideoStore>;
  export const useVideo: <T>(select: (s: VideoStore) => T) => T;   // the active reader scope's, like useReader
  ```
  Task 12·13이 같은 저장소에 필드를 더한다.
- Produces (순수 함수):
  - `RV/videoTime.ts`: `formatClock(ms: number, durationMs: number): string`, `spokenClock(ms: number): string`.
  - `RV/frameStep.ts`: `frameDurationMs(mediaTimesSec: readonly number[]): number`.
  - `R/commands/focusOwnsKey.ts`: `focusOwnsKey(target: EventTarget | null, code: string): boolean`.
- Produces (렌더러):
  - `R/strings/video.ts`의 `t.video`(컨트롤 툴팁·이름, 속도, 음량, 안내).
  - `window.__learnVideo.state(): VideoProbe`(P-25).
  - `videoActions: Pick<CommandEnv, 'video'>`. `CommandEnv.video(action: VideoAction): void`이고 `VideoAction = 'playPause' | 'back10' | 'forward10' | 'back5' | 'forward5' | 'frameBack' | 'frameForward' | 'slower' | 'faster' | 'toggleMute'`이다(Task 11·12가 더함).
- Produces (testid): `video-stage`(무대), `video`(`<video>` 그대로 — `V/baseline.evidence.ts:48`가 씀), `video-controls`, `video-scrubber`, `video-play`, `video-time`, `video-speed`, `video-mute`, `video-volume`, `video-toolbar`.

**명령** (P-17 — 모두 `contexts: ['video']`, 메뉴 없음, 이름은 디자인 명세 7.4·명세 10절)

| id | label | key / alsoKey | 규칙(`RULES`) | stateLabels.video |
|---|---|---|---|---|
| `video.playPause` | 재생/일시정지 | `KeyK` / `Space` + yields | `videoOpen` | `videoPlaying`: on '일시정지', off '재생' |
| `video.back10` | 10초 뒤로 | `KeyJ` | `videoOpen` | — |
| `video.forward10` | 10초 앞으로 | `KeyL` | `videoOpen` | — |
| `video.back5` | 5초 뒤로 | `ArrowLeft` + yields | `videoOpen` | — |
| `video.forward5` | 5초 앞으로 | `ArrowRight` + yields | `videoOpen` | — |
| `video.frameBack` | 한 프레임 뒤로 | `Comma` | `videoOpen && !videoPlaying` | — |
| `video.frameForward` | 한 프레임 앞으로 | `Period` | `videoOpen && !videoPlaying` | — |
| `video.slower` | 재생 속도 느리게 | `Comma` + shift | `videoOpen` | — |
| `video.faster` | 재생 속도 빠르게 | `Period` + shift | `videoOpen` | — |
| `video.toggleMute` | 음소거 | `KeyM` | `videoOpen` | `videoMuted`: on '음소거 해제', off '음소거' |

- `commandAvailable`: 명령의 `contexts`에 `'video'`가 있으면 `ctx.view === 'viewer'`를 맥락 안으로 본다(그다음 `RULES`).
- `commandLabel`: `stateLabels.video`가 있으면 `state[field] ? on : off`를 고른다. 순서는 `view` 다음이다.
- `LabelState`는 `VideoLabelField` 넷을 더 고른다. 팔레트(`R/palette/Palette.tsx:124`)가 그 상태를 넘긴다.
- 키맵:
  - `keyCommand(e, editing, commands, owns)`는 `c.key` 또는 `c.alsoKey`가 맞는 명령을 찾는다.
  - 맞은 사양이 `yields`이고 `owns(code)`이면 `null`이다.
  - `useKeymap`은 `owns = (code) => focusOwnsKey(e.target, code)`를 넘긴다.
- `focusOwnsKey`:
  - `Space`·`Enter`: 대상이 `button`·`a[href]`이거나 역할이 `button|link|menuitem|menuitemradio|menuitemcheckbox|option|tab|checkbox|radio|switch`이면 참이다.
  - `ArrowLeft|ArrowRight|ArrowUp|ArrowDown|Home|End|PageUp|PageDown`: 역할이 `slider|tab|radio|menuitem*|treeitem|row|gridcell|spinbutton`이거나 `input[type=range]`이면 참이다. `option`은 `ArrowUp|ArrowDown|Home|End|PageUp|PageDown`에만 참이다.
  - `Escape`: 대상이 열린 메뉴·대화상자 안(`closest('[role="menu"], [role="dialog"]')`)이면 참이다. 대본 검색 칸의 esc는 입력란이라 키맵이 처음부터 비킨다.
  - 그 밖에는 거짓이다.
- 단축키 시트(⌘/): 묶음 `video`("동영상")를 `viewer` 뒤에 두고, 키 두 개는 "K · 스페이스"로 쓴다.

**화면** (명세 6.1·6.2·6.7·9.2, 승인 목업 ①②⑥)
- `ViewerHost`:
  - `'video'` → `<VideoReader key item />`.
  - `ReaderFrame`의 영상 자리표시는 `div.reader.video-reader > div.reader-toolbar + div.video-stage + div.video-controls(비활성)`이다.
  - `noPages`는 영상이면 모든 상태에서 `'noTranscript'`다. Task 13이 재생 가능 영상을 `null`로 바꾼다.
  - `ReaderSidebar`의 `EMPTY`(:16-21)에 `noTranscript: { icon: CaptionsOff, title: t.video.noTranscript }`("표시할 대본이 없습니다")를 더한다.
- `VideoReader` 구조:
  - `div.reader.video-reader` > `VideoToolbar`(44, 오른쪽 빈 칸 — 자막 ▾는 Task 12) + `div.video-stage[role=region][tabIndex=0][aria-label=제목][aria-describedby=스페이스로 재생 안내]` > `<video data-testid="video" preload="metadata">`(**`controls` 없음**) + `VideoControls`.
  - 무대를 누르면 재생/일시정지다(두 번 누름은 아무것도 안 함 — 전체 화면은 Task 11의 단추·F).
- `VideoControls`:
  - 위 `Scrubber`.
  - 아래 줄 32: 10초 뒤로(`rotate-ccw`) · 재생/일시정지(`play`/`pause`) · 10초 앞으로(`rotate-cw`) · 시간 `**18:20** / 52:10` · 빈 칸 · `SpeedMenu` 단추 "1.25×" · (자막 단추 자리 — Task 12) · `VolumeControl` · (전체 화면 단추 자리 — Task 11).
  - 툴팁은 명세 6.2의 문구와 키캡이다(레지스트리의 `keySpecKeys`로 쓴다).
- `Scrubber`(`role="slider"`):
  - `aria-valuemin 0`, `aria-valuemax`는 길이(초), `aria-valuenow`, `aria-valuetext`는 `${spokenClock(t)} / ${spokenClock(d)}`.
  - 트랙 4 → 호버·끌기 6, 손잡이 12 → 끌기 14(명세 6.2). 재생한 곳은 `--meter`, 받아 둔 곳은 `buffered`, 호버하면 시간 말풍선이다.
  - 포인터 끌기는 놓을 때 `seekTo`이고, 끄는 동안 미리 보기 시간만 바꾼다.
  - 키: ←/→ 5초, PageUp/PageDown 10초, Home/End.
- `SpeedMenu`: `MenuButton`(`R/ui/MenuButton.tsx:175`, `placement="bottom end" variant="plain" size="small"`), 일곱 줄에 지금 값 `checked`, 이름 "1.25×"(숫자 `.num`).
- `VolumeControl`:
  - 음소거 단추(`volume-2`/`volume-1`(≤ 0.5)/`volume-x`) + react-aria-components `Slider` 가로 막대다.
  - 리더 폭 < 560(크기 관찰은 보이는 탭에서만)이면 막대를 접는다. 단추에 호버하거나 포커스하면 막대가 단추 위로 뜬다.
- 설정(`useVideoSettings` — `R/viewers/image/useImageBackground.ts:9`의 쿼리 모양 셋 + `saveSetting`):
  - 속도·음소거는 바꿀 때 쓴다. 음량은 `onChangeEnd`에 쓴다.
  - 여러 영상 탭이 같은 값을 따른다.
- 시간과 기억:
  - 시간 형식: 길이가 1시간 이상이면 `h:mm:ss`, 아니면 `m:ss`(앞 0 없는 분). `tabular-nums`(`.num`)다.
  - 한 프레임: 재생 중 `requestVideoFrameCallback`의 `mediaTime` 최근 12개로 `frameDurationMs`(양수 차이의 가운데 값을 1000/120–1000/10로 자름, 3개 미만이면 `VIDEO_TIMING.frameFallbackMs`)를 구한다. 이동은 일시정지 중 `currentTime ± frame`이다.
  - 속도 바꾸기: ⇧,/⇧.는 `RATE_STEP`씩 0.5–2 안에서다.
  - 위치 기억: 지금 `usePosition`·`TIME_SAVE`·`restoreVideoSeconds` 그대로다. Task 12가 `captions`를 더한다.
- 상태:
  - 여는 중(첫 프레임 전, `data-frame` 없음): 컨트롤·도구 막대를 그대로 두고 비활성으로 그린다.
  - 재생 불가·열기 실패: 컨트롤과 도구 막대를 그리지 않는다. `CodecNotice`를 `div.stage-center` 안에 두고(명세 9.2), `notice.css`의 `.notice .actions`에 `flex-wrap: wrap; gap: var(--space-2)`를 둔다. `setNoPages('reader', 'noTranscript')`.
  - 가린 탭은 멈춘다(기존 `useReaderShown`).
- 맥락:
  - `MainWindow`의 env에 `videoOpen`(보이는 리더가 영상이고 `status === 'ready'`), `videoPlaying`, `videoMuted`를 둔다.
  - `contextOf`(:357 모양)와 `commandContextInput`에 같은 필드를 둔다.

**시험**
- `videoTime.test.ts`:

  | 부름 | 기대 |
  |---|---|
  | `formatClock(1_100_000, 3_130_000)` | `'18:20'` |
  | `formatClock(18_000, 60_000)` | `'0:18'` |
  | `formatClock(3_723_000, 4_000_000)` | `'1:02:03'` |
  | `formatClock(5_000, 4_000_000)` | `'0:00:05'` |
  | `spokenClock(1_100_000)` · `(3_723_000)` · `(0)` | `'18분 20초'` · `'1시간 2분 3초'` · `'0초'` |
- `frameStep.test.ts`:

  | 입력 | 기대 |
  |---|---|
  | 30fps 간격 12개 | ≈ 33.3 |
  | 2개 | 33.33(fallback) |
  | 간격 0이 섞임 | 무시 |
  | 1fps | 100(자름) |
- `focusOwnsKey.test.ts`(jsdom 요소):

  | 포커스 | 키 | 기대 |
  |---|---|---|
  | `button` | `Space` | 참 |
  | `div[tabindex=0]`(무대) | `Space` | 거짓 |
  | `[role=slider]` | `ArrowRight` | 참 |
  | `[role=option]` | `ArrowRight` | 거짓 |
  | `[role=option]` | `ArrowDown` | 참 |
  | `[role=tab]` | `ArrowLeft` | 참 |
  | 메뉴 안 `menuitemradio` | `Escape` | 참 |
- `packages/domain/test/commands.test.ts`:
  - 키 하나뿐(`key`·`alsoKey` 모두).
  - `commandLabel`이 `{ videoPlaying: true }`에서 '일시정지'다.
  - `video.frameBack`이 재생 중 불가다.
  - `'video'` 맥락 명령이 라이브러리 보기에서 불가다.
- `E/video.spec.ts`(`lecture-60s.mp4`, 1920×1200):
  - 마우스:
    - 재생 → `__learnVideo.state().paused === false` → 일시정지.
    - 10초 앞으로 → `timeMs ≥ 10_000`을 기다린다.
    - 스크러버의 50% 지점 클릭 → `≈ 30_000`(±500).
    - 호버 → 말풍선 글.
    - 속도 ▾ 1.25× → `rate === 1.25`, 단추 "1.25×".
    - 음소거 → `muted`. 음량 막대 → 값이 바뀜.
  - 키(무대 포커스):
    - K·스페이스 → 재생/정지.
    - J/L → ±10초. ←/→ → ±5초.
    - 일시정지 중 `.` → `timeMs` 증가 ≤ 100ms, `,` → 감소. 재생 중 `.` → 그대로다(양성 대조로 일시정지 때의 증가를 먼저 봄).
    - ⇧. → 1.25, ⇧, → 1. M.
  - 한글 입력 상태: 같은 키를 `code: 'KeyK'`, `key: 'ㅏ'`로 보낸다(`E/ime.spec.ts`가 쓰는 CDP `Input.dispatchKeyEvent` 길, 조합 아님). 재생이 바뀐다.
  - 포커스 예외:
    - Tab으로 재생 단추에 간 뒤 스페이스 → 재생 상태가 한 번만 바뀐다(단추의 동작).
    - 스크러버 포커스에서 → → 정확히 +5초(키맵이 한 번 더 하지 않음).
  - 기억: 속도 1.5 · 음량 0.4 · 음소거 → 다시 실행 → 같다.
  - 재생 불가: `sample-mpeg4part2.mp4`, 1024×768 창(`setSize`) → 안내의 두 단추와 제목 상자가 무대 상자 안이다. 컨트롤·도구 막대가 없다. 사이드바가 "표시할 대본이 없습니다"다.
  - `commands-coverage`: `M8A_COMMANDS`에 위 열 개를 둔다. 영상을 열고 팔레트 실행(`runPaletteCommand` 류 — 메뉴에 없음)으로 각 명령을 돌린다. 원장 줄을 더한다.

- [ ] **Step 1**: 순수 모듈 시험 → 실패 → 구현 → 통과.
- [ ] **Step 2**: 레지스트리·키맵 → 도메인 시험 통과.
- [ ] **Step 3**: 화면 → `E/video.spec.ts` → 통과. 바꾼 spec들은 1024×768에서도 돌린다.
- [ ] **Step 4**: 투어 PNG(라이트·다크)를 컨트롤러에게 넘긴다(디자인 비평).
- [ ] **Step 5**: 작업마다 녹색. 커밋 `feat(video): the video reader v2 — our own controls (scrubber, skips, speed menu, volume), single-letter keys through the renderer keymap with focus exceptions, remembered speed and volume, the opening and unplayable states`.

---

### Task 11: 영상 전체 화면 — 무대 모드 · `fullscreen` 권한 빼기 (목업 승인 뒤)

**Files:**
- Modify: `M/permissions.ts:7`(`'fullscreen'` 뺌)과 그 시험, `D/commands.ts`(명령 둘, `videoStage`), `D/ipc.ts`(`commandContextInput`), `R/commands/registry.ts`, `RV/videoActions.ts`·`RV/VideoControls.tsx`(전체 화면 단추), `RV/VideoReader.tsx`(컨트롤 숨김), `R/app/MainWindow.tsx`(무대에서 숨김, 영상을 떠나면 `exit`), `R/styles/screens/video.css`·`R/styles/screens/shell.css`, `E/video.spec.ts`, `E/first-session.spec.ts:37-54,129,157-180`, `E/commands-coverage.spec.ts`.

**Interfaces:**
- Consumes: `window.learn.ui.stage`, `WindowState.stage`, `<html data-video-stage>`(Task 9).
- Produces: 명령 둘(아래), 맥락 `videoStage`, `VideoAction`에 `'toggleFullScreen' | 'exitFullScreen'`, 컨트롤 숨김 속성 `.video-reader[data-idle]`.

| id | label | key | 규칙 | stateLabels.video |
|---|---|---|---|---|
| `video.toggleFullScreen` | 전체 화면 | `KeyF` | `videoOpen` | `videoStage`: on '전체 화면 끝내기', off '전체 화면으로 보기' |
| `video.exitFullScreen` | 전체 화면 끝내기 | `Escape` + yields | `videoStage` | — (`palette: false`) |

**요구 사항** (명세 6.6, P-16·P-18)
- 무대 모드:
  - 처리기는 `ui.stage({ action: 'toggle' | 'exit' })`만 보낸다. 화면은 `windowState.stage`만 따른다.
  - `data-video-stage`에서는 탭 줄·사이드바·리더 도구 막대를 숨기고(토스트는 그대로), 무대 + 컨트롤이 창을 채운다(목업 ⑤).
- 컨트롤 숨김:
  - 무대 모드에서 재생 중이고 포인터가 `VIDEO_TIMING.controlsIdleMs` 동안 움직이지 않으면 `data-idle`이다. 컨트롤과 포인터(`cursor: none`)를 숨기고, 오버레이 자리를 내린다(Task 12의 오버레이가 이 속성을 읽음).
  - 포인터 움직임·키 누름·정지면 다시 보인다.
- 전체 화면 단추: `maximize`/`minimize`, 툴팁 "전체 화면으로 보기 F"/"전체 화면 끝내기 F".
- 권한: `APP_PERMISSIONS`에서 `'fullscreen'`을 뺀다(명세 6.6·9.1, P-16). 이 작업에서 `first-session.spec.ts`가 F 길로 바뀌므로 함께 한다.
- 무대를 떠나는 경우: 무대 모드에서 보이는 탭이 영상 리더가 아니게 되거나(탭 바꿈·닫기·휴지통) 영상이 재생 불가가 되면 `exit`를 보낸다.
- 시험 고침:
  - `first-session.spec.ts`의 `toggleFullscreen`을 F 길로 바꾼다: 무대 포커스 → F → `stageState()`가 `{ stage: true, fullScreen: true }`를 기다림 → F → 둘 다 `false`. `requestFullscreen`/`exitFullscreen`/`fullscreenElement` 단언을 지운다.
  - darwin `test.fail` 시험(:157-180)을 지우고 "빠른 토글이 자리 잡는다"로 바꾼다: F를 50ms 간격으로 다섯 번 → `pending: false`를 기다림 → `stage === fullScreen === true`, 그리고 `<html data-video-stage>`가 있다. Linux·Mac 모두다.
  - `V/spikes.evidence.ts`의 HTML 전체 화면 줄은 역사 기록으로 둔다(명세 9.1). 권한을 뺐으므로 그 스파이크가 거절로 끝나면 그 결과를 기록 값으로 받는다.

**시험** (`E/video.spec.ts`에 더함)
- F → 무대(탭 줄 숨김을 본다) → esc → 나옴.
- 단추 → 들어감 → 단추 → 나옴.
- 무대에서 속도 ▾를 열고 esc → 메뉴만 닫히고 무대는 그대로 → 다시 esc → 나옴.
- 창 직접 나옴(`app.evaluate`로 `setFullScreen(false)`) → 무대 끝.
- 재생 중 포인터를 멈추면 `data-idle` → 포인터 움직이면 사라짐.
- 무대에서 ⌃Tab으로 다른 탭 → 무대 끝.
- 권한: 페이지에서 `document.documentElement.requestFullscreen()`이 거절되고(약속이 거부됨), 창 `isFullScreen()`은 그대로 `false`다.
- `commands-coverage`에 두 명령을 더한다.

- [ ] **Step 1–3**: 시험 → 구현 → 통과(`first-session.spec.ts`와 `video.spec.ts`를 `--repeat-each=10`, `taskset -c 0-1`). **Step 4**: 투어 PNG → 비평. **Step 5**: 작업마다 녹색. 커밋 `feat(video): full screen as a stage mode — window full screen through main's serializer, the chrome hidden, idle controls hidden; pages may no longer enter HTML full screen; the macOS fast-toggle freeze test becomes a settle test on both platforms`.

---

### Task 12: 자막 오버레이 · 자막 ▾ · 추가 · 제거와 되돌리기 · 기본 트랙 · 항목 패널 "자막" 줄 (목업 승인 뒤)

**Files:**
- Create:
  - 데이터·순수 모듈: `RV/useSubtitles.ts`, `RV/trackNames.ts`(+ `.test.ts`), `RV/activeCues.ts`(+ `.test.ts`), `RV/defaultTrack.ts`(+ `.test.ts`)
  - 화면 부품: `RV/SubtitleOverlay.tsx`, `RV/SubtitlesMenu.tsx`
  - 토스트: `RV/subtitleToasts.ts`(+ `.test.ts`)
  - E2E: `E/subtitles.spec.ts`
- Modify:
  - 영상 리더: `RV/videoStore.ts`, `RV/VideoReader.tsx`(locator, 프레임 콜백), `RV/VideoToolbar.tsx`, `RV/VideoControls.tsx`(자막 단추), `RV/videoActions.ts`
  - 명령·맥락: `D/commands.ts`, `D/ipc.ts`(`commandContextInput`), `R/commands/registry.ts`, `R/app/MainWindow.tsx`(맥락 둘, `subtitles:changed` 구독)
  - 항목 패널: `R/inspector/FileSection.tsx:29-56`(자막 줄)
  - 문구·토큰·스타일: `R/strings/video.ts`, `R/strings/inspector.ts`, `R/design/tokens.ts`(`--subtitle-bg`, `--subtitle-fg`), `R/styles/screens/video.css`
  - 시험: `E/commands-coverage.spec.ts`

**Interfaces:**
- Produces (데이터 훅):
  ```ts
  // RV/useSubtitles.ts — queries ['subtitles', itemId] and ['subtitles', itemId, assetId, 'cues']; subtitles:changed invalidates both
  export function useTracks(itemId: string | null): SubtitleTrack[] | undefined;
  export function useCues(itemId: string | null, assetId: string | null): Cue[] | undefined;
  ```
- Produces (순수 함수):
  ```ts
  // RV/trackNames.ts
  export function trackNames(tracks: readonly SubtitleTrack[]): Map<string, string>;   // assetId → 화면 이름(명세 3.8)
  // RV/activeCues.ts
  export interface CueIndex { cues: readonly Cue[]; maxEnd: Float64Array }            // maxEnd[i] = max(endMs of cues[0..i])
  export function indexCues(cues: readonly Cue[]): CueIndex;
  export function activeCues(ix: CueIndex, ms: number, max?: number): number[];       // start ≤ ms < end, start order, the last `max` (3)
  export function cueIndexAt(ix: CueIndex, ms: number): number;                       // last index with start ≤ ms, −1 before the first
  // RV/defaultTrack.ts
  export function pickTrack(tracks: readonly SubtitleTrack[], saved: { assetId: string; on: boolean } | undefined): { trackId: string | null; on: boolean };
  // RV/subtitleToasts.ts
  export function attachToasts(result: AttachResult): ToastData[];   // success / failure / already (P-6)
  ```
- Produces (저장소·명령·토큰):
  - `VideoStore`에 `tracks: SubtitleTrack[]`, `trackId: string | null`, `captionsOn: boolean`, `cueText: string | null`(오버레이 글, 손잡이용)을 더한다.
  - `VideoAction`에 `'toggleCaptions' | 'addSubtitles'`를 더한다.
  - 맥락 `videoCaptions`(트랙 있음)·`videoCaptionsOn`, 토큰 `--subtitle-bg`·`--subtitle-fg`.

| id | label | key | 규칙 | stateLabels.video |
|---|---|---|---|---|
| `video.toggleCaptions` | 자막 켜기/끄기 | `KeyC` | `videoOpen && videoCaptions` | `videoCaptionsOn`: on '자막 끄기', off '자막 켜기' |
| `video.addSubtitles` | 자막 파일 추가… | — | `videoOpen` | — |

**요구 사항** (명세 3.8·4.4·5.1·5.4·5.5·6.4·6.5·6.8, P-6·P-24·P-28)
- 트랙 이름:
  - `new Intl.DisplayNames(['ko'], { type: 'language' }).of(lang)`을 쓴다. 던지면 코드를 그대로 쓴다.
  - 언어 없음은 "자막 {트랙 순서 1부터}"다. 같은 이름의 둘째부터 " 2", " 3"을 붙인다.
  - 이 호스트의 Node·Electron 모두 `ko`→"한국어", `en-US`→"영어(미국)", `fil`→"필리핀어"를 낸다.
- 기본 트랙(`pickTrack`): `saved.assetId`가 목록에 있으면 그것이다. 없으면 `language === 'ko'` 또는 `ko-`로 시작하는 첫 트랙, 그다음 첫 트랙이고 `on: true`다. 트랙이 없으면 `{ trackId: null, on: false }`다.
- 위치 기억:
  - `readLatest`의 locator에 `captions: { assetId: trackId, on: captionsOn }`(트랙이 있을 때)를 넣는다.
  - 트랙을 바꾸거나 C를 누르면 `pos.flush()`한다.
  - 복원은 `pos.saved.locator.captions`를 `pickTrack`에 넘긴다.
- 오버레이:
  - 무대의 영상 사각형(P-24) 안, 아래 6%, 가운데, 최대 폭 78%다. 바탕은 `--subtitle-bg`, 글은 `--subtitle-fg`, 굵기 500, 반경 `--radius-sm`, `word-break: keep-all`, 줄 높이 1.45, 글 크기 `--cue-size`다.
  - 큐마다 한 덩어리(`white-space: pre-line`)를 **글 노드로만** 그린다.
  - 재생 중에는 `requestVideoFrameCallback`마다 `activeCues`를 부르고, 바뀔 때만 상태를 고친다. 정지·이동은 `seeked`에서 고친다.
  - `data-idle`(Task 11)이면 컨트롤 높이만큼 아래로 내려온다.
- 자막 ▾(`MenuButton`, `placement="bottom end" variant="plain" size="small"`, testid `subtitles-menu`):
  - 단추: `captions` + 트랙 이름 / `captions-off` + "자막 끔" / `captions-off` + "자막 없음".
  - 항목:
    - 트랙들(`checked`), 끄기(`accelerator: 'C'`, 꺼져 있으면 `checked`).
    - 구분선, "자막 파일 추가…".
    - 구분선, "이 자막 제거"(켜진 트랙이 있을 때만 사용 가능).
  - 트랙이 없으면 "자막 파일 추가…" 하나다.
- 컨트롤의 자막 단추: `captions`/`captions-off`, 트랙이 없으면 비활성 + 이유 "자막 없음".
- 추가: `video.addSubtitles` → `subtitles.pick({ itemId })` → `attachToasts`를 띄운다. 새로 붙은 첫 트랙을 고르고 켠다.
- 제거:
  - `subtitles.remove` → `showUndoToast(t.video.removed(name), restore)`(`R/ui/toasts.tsx:180`)를 띄운다. 그 뒤 기본 트랙 규칙으로 다시 고른다.
  - 되돌리기는 `subtitles.restore({ itemId, assetId, position, language })` → 그 트랙을 고르고 켠다.
- 토스트 문구는 명세 12절이다.
  - 실패 토스트 머리는 "자막 N개를 붙이지 못했습니다", 줄마다 `${name} — ${이유}`다.
  - 이유 문구는 `t.video.attachFailed[reason]`의 일곱 개다. `'io'`는 "파일을 읽지 못했습니다"다(새 문구 — 목업 ④ 비평에서 확인).
- 항목 패널:
  - `FileSection`은 동영상 자료이고 트랙이 있으면 `data-field="subtitles"` 행 "자막"을 그린다. 값은 `trackNames` 순서로 " · "로 잇고, 넷 이상이면 앞 둘 + `외 ${n − 2}개`다.
  - 자리는 승인 목업 ⑦이다. `subtitles:changed`로 다시 읽는다.
- `__learnVideo.state()`에 `cueText`·`trackId`·`captionsOn`을 채운다.
- 문구 검사: `R/strings/strings.test.ts:65` `COMPOUNDS`에 "자막 파일"을 더한다(명세 12절 끝).

**시험**
- `trackNames.test.ts`:

  | 트랙 | 기대 이름 |
  |---|---|
  | `[ko, en]` | 한국어, 영어 |
  | `[en-US]` | 영어(미국) |
  | `[null, null]` | 자막 1, 자막 2 |
  | `[ko, ko]` | 한국어, 한국어 2 |
  | `['xx-invalid!']` | 코드 그대로 |
- `activeCues.test.ts`:
  - 겹침 셋(0–5, 1–2, 3–6) → `activeCues(…, 1500)` `[0,1]`, `(4000)` `[0,2]`.
  - 앞 큐 넷이 겹치면 마지막 셋이다.
  - 끝 시각 경계는 `<`다.
  - `cueIndexAt` 앞(−1)·사이·끝 뒤.
  - 2만 큐의 1만 번 호출 < 50ms.
- `defaultTrack.test.ts`:

  | 트랙 · 저장 값 | 기대 |
  |---|---|
  | `[en, ko]` · 없음 | ko, on |
  | `[en, ko]` · `{ en, off }` | en, off |
  | 저장된 자산이 없어짐 | ko |
  | `[en]` · 없음 | en |
  | `[]` | null |
- `subtitleToasts.test.ts`: added 1 · failed 0 → 성공 하나, added 0 · already 1 → 정보, failed 둘 → 실패 하나 + 줄 둘.
- `E/subtitles.spec.ts`(1920×1200):
  - "자막 파일 추가…": 자막 ▾ → `stubOpenDialog([ko, en])` → 토스트 "자막 2개를 붙였습니다" → ▾ 단추 "한국어".
  - 오버레이 문장: 1.0초로 이동 → 오버레이 글이 큐 1이다. 큐 5 시작으로 이동 → 큐 5다(`cueText` 조건).
  - 트랙과 끄기: ▾에서 영어 → 영어 문장. C → 오버레이 없음, ▾ "자막 끔" → C → 다시.
  - 제거: "이 자막 제거" → 토스트 → 실행 취소 → 목록 둘.
  - 다시 실행: 영어·끔으로 두고 다시 실행하면 그대로다.
  - 깨진 파일: `broken.srt` 추가 → 실패 토스트 "자막 문장을 찾지 못했습니다".
  - 같은 파일 다시 → "이미 붙어 있는 자막입니다".
  - 항목 패널 "자막 · 한국어 · 영어".
  - `commands-coverage`에 두 명령을 더한다.

- [ ] **Step 1–3**: 시험 → 구현 → 통과. **Step 4**: 투어 PNG → 비평. **Step 5**: 작업마다 녹색. 커밋 `feat(video): subtitles on screen — the overlay sized to the picture, the 자막 menu with tracks, off, add and remove with undo, the default Korean track remembered per item, attach toasts, the item panel's 자막 line`.

---

### Task 13: 대본 칸 (목업 승인 뒤)

**Files:**
- Create:
  - 대본 칸: `RV/TranscriptPane.tsx`, `RV/TranscriptList.tsx`
  - 검색: `RV/transcriptSearch.ts`(+ `.test.ts`)
  - 스위치 부품: `R/ui/Switch.tsx`, `R/styles/components/switch.css`
  - 성능 증거: `V/video-perf.evidence.ts`
- Modify:
  - 사이드바·리더: `R/viewers/pdf/ReaderSidebar.tsx:27`(영상 갈래), `R/viewers/ViewerHost.tsx:95-104`(재생 가능 영상은 `noPages` `null` — P-21), `RV/videoStore.ts`(`transcript`)
  - 명령: `D/commands.ts:951`(`library.find` 규칙 — P-19), `R/commands/registry.ts`(`library.find` 처리기의 영상 갈래)
  - 문구·스타일: `R/strings/video.ts`, `R/styles/screens/video.css`
  - 시험·예산: `E/subtitles.spec.ts`, `V/budget.ts`(새 줄)

**Interfaces:**
- Produces:
  ```ts
  // RV/transcriptSearch.ts
  export function foldForSearch(text: string): { folded: string; map: number[] };   // NFC; Latin diacritics off, lower case; Hangul kept; map[i] = index in text
  export interface CueHit { index: number; ranges: Array<[number, number]> }       // ranges in the cue's own text
  export function findInCues(cues: readonly Cue[], query: string): CueHit[];
  // VideoStore.transcript
  transcript: { follow: boolean; query: string; hits: CueHit[]; hit: number; cursor: number; wrapped: boolean };
  ```
- Produces: `R/ui/Switch.tsx`(`Switch({ isSelected, onChange, children, testId })`, react-aria-components `Switch`).
- Produces (testid): `transcript`, `transcript-search`, `transcript-count`, `transcript-follow`, `cue-row`(`data-index`, `data-current`).

**요구 사항** (명세 7·6.7, P-19·P-21·P-23)
- 머리와 갈래:
  - 머리 "대본" 한 줄(`reader-nav-head` 문법) → 검색 칸(`.nav-search`, 자리표시 "대본에서 찾기", 개수, 지우기) → 목록 → 아래 막대 40의 `Switch` "현재 위치 따라가기"다.
  - 칸은 지금 고른 트랙의 큐를 보인다. 자막을 꺼도 마지막에 고른 트랙을 보인다.
- 목록:
  - `@tanstack/react-virtual`(`R/library/LibraryTable.tsx:369-381`의 모양, 행 높이는 `measureElement`)과 `role="listbox"`·행 `role="option"`을 쓴다.
  - 커서 행은 `rangeExtractor`가 늘 그린다(:359-368 — 포커스를 잃지 않게).
  - 행은 시간(footnote, 3차색, `.num`) 위, 문장 아래다. 지금 큐는 `--accent-soft` 바탕 + 시간 강조색 굵게, 지나간 큐 문장은 2차색이다. 일치에는 `<mark>`(`--find-match`)를 둔다. 모두 글 노드로 그린다.
- 이동:
  - 클릭·↩ → `seekTo(cue.startMs)`. 재생 상태는 그대로다.
  - ↑↓·Home/End·PageUp/PageDown은 커서를 옮긴다.
- 따라가기:
  - 탭을 열 때 켜져 있다(저장 안 함).
  - 켜져 있으면 `cueIndexAt`이 바뀔 때 그 행을 칸의 위쪽 1/3에 둔다. 움직임 줄이기에서는 바로, 아니면 `behavior: 'smooth'`다.
  - 사용자 스크롤(휠·스크롤 막대 끌기·목록 안 키 스크롤)이면 꺼진다. 우리 스크롤은 표시로 가려 끄지 않는다. 다시 켜면 지금 큐로 간다.
  - 클릭·검색 이동은 끄지 않는다.
- 검색:
  - 150ms 디바운스, `findInCues`, 머리 개수 "N개"다.
  - ↩/⇧↩는 다음/이전 일치 큐로 가서 그 시각으로 이동한다. 끝에서 돌면 2초 동안 "처음부터 · i / N"이다(`R/viewers/pdf/FindBar.tsx:14,57-58`의 문법, 말하는 영역 포함).
  - 결과 없음: 빈 상태 "‘{질의}’가 나오는 문장이 없습니다" + 설명(명세 7.4).
  - esc는 질의를 지우고 목록으로 간다.
- ⌘F(P-19):
  - `library.find`의 규칙에 영상 갈래를 더한다.
  - 처리기는 보이는 리더가 영상이면 사이드바가 접혀 있을 때 편다(`view.toggleSidebar`와 같은 함수 — `keepFocusAcross`). 그다음 대본 검색 칸에 포커스하고 글을 고른다.
- 끝 상태:
  - 여는 중은 머리 + 자리 상자(비활성)다.
  - 자막 없음은 `PaneEmpty`(`captions-off`, "자막이 없습니다", 설명, [자막 파일 추가…] → `video.addSubtitles`)다.
  - 재생 불가·원본 없음은 `noTranscript`(Task 10)다.
- 큐 2만 개까지 그린다.
- 키보드: 목록에 포커스가 있어도 동영상 한 글자 키는 동작한다(`focusOwnsKey`가 `option`에서 ←/→·글자를 비킴 — Task 10).
- 문구 검사: `COMPOUNDS`에 "현재 위치"를 더한다.

**시험**
- `transcriptSearch.test.ts`:

  | 질의 · 큐 | 기대 |
  |---|---|
  | 'cafe' · 'Café 앞' | `[[0,4]]` |
  | 'ÉCOLE' · 'ecole' | 일치 |
  | '칼슘 펌프' · '칼슘 펌프와 칼슘 펌프' | 범위 둘 |
  | 공백만 | `[]` |
  | 2,000 큐 | < 20ms |
- `E/subtitles.spec.ts`에 더한다:
  - 일시정지 중 큐 5 클릭 → `timeMs ≈ 큐 5 시작`, 계속 일시정지.
  - 재생 중 ↩ → 계속 재생.
  - 검색 "칼슘 펌프" → "2개" → ↩ → 첫 일치 시각 → ↩ → 둘째 → ↩ → "처음부터 · 1 / 2".
  - "없는말" → 빈 상태. esc → 질의 빔.
  - 재생 중 지금 행 `data-current`가 보인다(칸 안). 휠 → 스위치 꺼짐 → 켜기 → 지금 행으로.
  - ⌘F → 검색 칸 포커스(사이드바를 접어 둔 경우도).
  - 자막 없는 영상 → 빈 상태와 단추.
  - `long-2000.srt`를 붙인 영상 → 마지막 큐까지 키 End로 간다.
- `V/video-perf.evidence.ts`(`@perf`, 결과 `video-perf.json`, 명세 14절):
  - `long-2000.srt` 영상에서 따라가기를 끄고 목록 스크롤 프레임 p95 ≤ 16.7ms.
  - 2배속 20초 재생 중 따라가기 + 오버레이 프레임 p95 ≤ 16.7ms.
  - 큐 40개 구간의 큐 전환 → 오버레이 글 바뀜 ≤ 1프레임. 프레임 콜백 `mediaTime`이 큐 시작을 넘은 다음 그리기를 `__learnVideo`의 시각 기록으로 잰다.
  - 대본 검색 입력 → 강조 그리기 p95 ≤ 50ms.
  - `budget.ts`에 줄들을 더한다(2배 넘으면 실패).

- 컨트롤러: 이 작업 뒤 CI 녹색이면 Mac 중간 `e2e`(P-26).

- [ ] **Step 1–3**: 시험 → 구현 → 통과. **Step 4**: 투어 PNG → 비평. **Step 5**: 작업마다 녹색(증거 config 포함). 커밋 `feat(video): the transcript pane — a virtualized list that seeks on click and return, follows the current sentence until the user scrolls, searches within the track with wrap-around, ⌘F; video-perf evidence`.

---

### Task 14: 영상 탭에 끌어 놓기 · 가져오기 화면 (목업 승인 뒤)

**Files:**
- Create:
  - 끌어 놓기: `R/shell/subtitleDrop.ts`(+ `.test.ts`), `RV/SubtitleDropOverlay.tsx`
  - E2E: `E/subtitles-drop.spec.ts`
- Modify:
  - 끌어 놓기: `R/app/MainWindow.tsx:714-715,774`(두 번째 문), `R/shell/drop.ts:16-34`(`summarizeDrop`·`dropSummaryText`의 `subtitles`), `R/strings/drop.ts`
  - 가져오기 토스트: `R/library/import-flow.ts:10`(`importToast` — 자막 수와 실패 줄), `R/strings/toast.ts`
  - 스타일: `R/styles/screens/drop.css`
  - 시험: `E/drop.spec.ts:226-240`

**Interfaces:**
- Produces (`R/shell/subtitleDrop.ts`):
  ```ts
  export const SUBTITLE_DRAG_TYPES = ['text/vtt', 'application/x-subrip', 'text/plain', ''] as const;
  export function acceptsSubtitleDrag(items: ReadonlyArray<{ kind: string; type: string }>): boolean;
  ```
  모든 항목이 `kind === 'file'`이고 type이 위 넷 가운데 하나이며 하나 이상이면 참이다.
- Produces: `DropSummary.subtitles`(MIME `text/vtt`·`application/x-subrip`만), testid `subtitle-drop-overlay`.

**요구 사항** (명세 5.2·5.3, 12절)
- 두 번째 문: `subsDropOpen = view.kind === 'reader' && videoOpen && !blocked && !held`. 라이브러리의 `dndOpen`(:714)과 같은 방식으로 문을 연다(`setDndGate`, `windowDropTarget`). PDF·이미지 탭은 그대로 놓을 수 없다.
- 끄는 중:
  - `acceptsSubtitleDrag`가 참일 때만 `dropEffect = 'copy'`다.
  - 리더 영역(사이드바 오른쪽 리더 전체)에 오버레이를 그린다: 56 타일 `captions` + "자막으로 붙이기" + "SRT · VTT 파일을 이 동영상에 붙입니다". 창 드롭 오버레이 문법이다(`R/shell/DropOverlay.tsx:34`, 목업 ④).
- 놓으면:
  - 경로(preload `pathForFile`)를 `subtitleFormatOf`로 거른다. 나머지는 실패 행 `'not-subtitle'`이다.
  - `subtitles.attach` → `attachToasts`(Task 12)를 띄운다. 거른 것만 남으면 실패 토스트 하나다.
- 가져오기 토스트:
  - `t.toast.imported(n)` 뒤에 `subtitles.attached > 0`이면 " · 자막 N개"를 붙인다("자료 2개를 가져왔습니다 · 자막 3개").
  - 실패 토스트 줄에 `report.subtitles.failed`를 이유 문구로 넣는다(`t.video.attachFailed`).
  - `'unpaired'`·`'not-subtitle'`이 있으면 공통 안내 "동영상 탭에 끌어 놓거나 자막 ▾의 '자막 파일 추가…'로 붙이세요."를 한 번 붙인다.
- 드롭 요약: "파일 3개(동영상 1 · 자막 2)". 빈 MIME·`text/plain`은 '기타'로 센다(끄는 중에는 이름을 모름). Mac의 실제 MIME은 Task 16 증거가 기록한다(명세 18절).

**시험**
- `subtitleDrop.test.ts`:

  | 끄는 항목 | 기대 |
  |---|---|
  | `[{file, ''}]` · `[{file, 'text/vtt'}, {file, 'application/x-subrip'}]` | 참 |
  | `[{file, 'video/mp4'}]` · `[{file, ''}, {file, 'application/pdf'}]` · `[{string, 'text/plain'}]` · `[]` | 거짓 |
- `E/subtitles-drop.spec.ts`(`E/dnd-helpers.ts`의 끌기 도우미):
  - 영상 탭에 `lecture-60s.en.vtt` → 오버레이 → 놓음 → 토스트 → 목록에 영어.
  - 자막 + `notes.pdf` 섞임 → 끄는 중 놓을 수 없음(`dropEffect` `'none'`).
  - 재생 불가 영상 탭 → 놓을 수 없음.
  - 라이브러리에 `lecture-60s.mp4` + 자막 둘 → 요약 "파일 3개(동영상 1 · 자막 2)" → 토스트 "… · 자막 2개".
  - `notes.ko.srt` 혼자 → 실패 토스트와 공통 안내.
- `E/drop.spec.ts:226`: PDF 탭은 그대로 놓을 수 없음.

- [ ] **Step 1–3**: 시험 → 구현 → 통과. **Step 4**: 투어 PNG → 비평. **Step 5**: 작업마다 녹색. 커밋 `feat(video): drop subtitle files on a video tab; the import toast counts attached subtitles and lists the ones that could not be attached; the drop summary names subtitles`.

---

### Task 15: 자막 본문 검색 화면 · 시각으로 열기 · 읽기 절의 영상 줄 (목업 승인 뒤)

**Files:**
- Modify:
  - 문구: `R/strings/library.ts:47,59-60`, `R/strings/inspector.ts:30-41`
  - 본문 일치 절: `R/inspector/BodyMatchesSection.tsx:23-104`, `R/inspector/InfoPane.tsx:166`(동영상에도 절)
  - 시각으로 열기: `R/viewers/pdf/readerStore.ts:69-78`(`PendingJump` 합집합), `R/commands/registry.ts:40`(`openAt`), `R/app/MainWindow.tsx:455-461`
  - 리더: `R/viewers/pdf/PdfReader.tsx:58,171-214`(`kind: 'page'`만), `RV/VideoReader.tsx`·`RV/TranscriptPane.tsx`(`kind: 'time'`)
  - 시험: `E/body-search.spec.ts`, `E/position.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export type PendingJump =
    | { kind: 'page'; pageIndex: number; query: string }
    | { kind: 'time'; startMs: number; query: string; track: string | null };
  // CommandEnv: openAt(itemId: string, jump: PendingJump): void   (openAtPage goes)
  ```
  `keepsPendingJump`(:78)는 두 종류에 같게 쓴다.
- Produces: `t.inspector.matches.cueCount(n)` = `문장 ${n}개`, `t.inspector.matches.moreCues(n)` = `외 ${n}문장`(승인 목업 ⑦ 값을 따른다), `t.inspector.matches.time(clock, track?)`.

**요구 사항** (명세 8.2·8.3·9.3)
- 검색 문구: 범위 설명 "PDF 본문·자막 포함", 결과 없음 덧붙임 "·PDF 본문·자막".
- `BodyMatchesSection`:
  - 동영상 자료에도 그린다.
  - 시간 행은 `formatClock(startMs, durationMs)` + `track`이 있으면 ` · {trackNames 이름}`(Task 12 — `useTracks`), 그 아래 조각(`<mark>`)이다.
  - 머리 개수는 동영상이면 "문장 N개"다.
  - 행 `data-time`, 클릭·↩ → `env.openAt(itemId, { kind: 'time', startMs, query: findWordOf(query), track })`.
- 영상 리더가 걸린 이동을 먹는 규칙:
  - 첫 복원이면 위치 복원 대신 `startMs`로 간다(정지, 자동 재생 없음).
  - `track`이 있으면 그 트랙을 고르고 켠다.
  - 대본 검색에 `query`를 넣고, `hit`을 그 시각의 큐로 둔다. 따라가기는 켠다.
  - 이미 열린 탭이면 그 탭에서 같은 일을 하고 `setPendingJump(null)`이다.
- 문구 검사: `COMPOUNDS`에 "본문 일치"를 더한다.
- 읽기 절(명세 9.3): `position.spec.ts`에 줄 하나 — 영상을 18초까지 재생(조건 기다림) → 라이브러리 → 항목 패널 읽기 절 "0:18에서 멈춤 · 오늘 …"과 진행 막대.

**시험** (`E/body-search.spec.ts`에 더함, 명세 15절)
- 범위 '정보와 본문'에서 자막에만 있는 낱말 → 표에 그 영상.
- 항목 패널 시간 행 "0:12"(픽스처 큐 시각). 누르면 영상 탭이 열리고 `timeMs ≈ 12_000`, 정지, 대본 검색 칸에 질의, 그 큐가 지금 일치다.
- 트랙 둘이면 " · 영어".
- 휴지통 영상은 빠진다.
- 영구 삭제 뒤 `cueTextCount` 0.
- PDF의 쪽 행은 그대로 그 쪽에서 연다(회귀).

- [ ] **Step 1–3**: 시험 → 구현 → 통과. **Step 4**: 투어 PNG → 비평. **Step 5**: 작업마다 녹색. 커밋 `feat(search): subtitle matches in the item panel — time rows that open the video at that sentence with the transcript search filled; the scope copy names subtitles; the reading section's video line`.

---

### Task 16: 증거 사진 `m8a-shots` · 투어 장면 · axe · 키보드 여정 (목업 승인 뒤)

**Files:**
- Create: `V/m8a-shots.evidence.ts`.
- Modify:
  - 투어: `E/visual/tour.ts`·`E/visual/tour.spec.ts`(+ 스냅숏)
  - 접근성·키보드: `E/a11y.ts`(사용처), `E/keyboard.spec.ts`
  - Mac 증거 실행: `.github/workflows/macos-evidence.yml:11`(suite `m8a`), `scripts/evidence.sh`(usage·suite 확인), `README.md`의 꼬리표 목록(T1a 커밋 a93c2d4와 같은 세 파일)
  - 명령 원장: `E/commands-coverage.spec.ts`

**요구 사항**
- `V/m8a-shots.evidence.ts`(`V/t1a-shots.evidence.ts`의 틀 — `TAG = { tag: '@m8a' }`, `THEMES`, `setTheme`, `shoot`/`shootBoth`, Mac `nativeWindowShot` + `pageShot`):
  - 명세 13절 ①–⑦의 앱 상태를 라이트·다크로 찍는다.
  - 영상 탭 끌어 놓기 중의 실제 `DataTransferItem.type`을 `record`로 남긴다(명세 18절).
- 워크플로:
  - suite 선택지에 `m8a`를 더하고 `evidence.sh`의 suite 확인에도 더한다.
  - 시간 한도 주석을 T1a처럼 다시 셈한다(m8a-shots + video-perf의 Linux 시간으로).
- 투어:
  - 영상 리더(재생 중, 자막 한 줄), 자막 ▾, 속도 ▾, 대본 검색 일치, 자막 없음, 무대 모드, 1024 좁은 창, 재생 불가, 항목 패널 자막 줄·시간 행 — 라이트·다크다.
- axe와 키보드:
  - 새 상태마다 `expectNoSeriousA11y`를 돌린다. `video-caption` 규칙은 계속 끈다. 주석: 자막을 `<track>`이 아니라 Learn이 그림.
  - 키보드 여정: F6 → 무대 → Tab으로 컨트롤을 차례로 → 대본 목록 ↓·↩ → 그 시각.
- `commands-coverage`: 원장 `:913-915`의 집합에 M8A를 넣고 `COVERED_ELSEWHERE`가 비었는지 본다.

- [ ] **Step 1–3**: 쓰기 → Linux 증거 config로 통과 → 투어 스냅숏 갱신(라이트·다크). **Step 4**: 작업마다 녹색. 커밋 `test(evidence): m8a shots in light and dark (suite m8a), tour scenes, axe on the new states, the keyboard journey through the video reader`.

---

### Task 17: 마무리 — 데모 · 문서 · Mac `all` (목업 승인 뒤)

**Files:**
- Modify:
  - 데모: `V/demo.evidence.ts`(M8a 장 — 명세 15절 "데모" 순서, 3–4분)
  - 결정 기록(ADR): `docs/decisions/0003-storage-layout.md`, `0005-commands-menus-shortcuts.md`, `0007-settings-and-preferences.md`, `0008-body-search.md`, `0009-anchor-hub-and-links.md`
  - 명세 문서: `docs/design/design-spec.md`(명세 17절 1–7), `docs/spec-amendments.md`(새 16절), 명세 파일(고친 줄 표시)
  - 진행 기록: `docs/acceptance.md`, `docs/next-session.md`, `docs/mac-verification.md`

**요구 사항**
- 데모: 명세 15절의 장 목록을 그대로 따른다. 장 제목과 시각은 `demo-chapters.json`에 적는다(기존 데모 틀).
- 문서: 명세 17절의 목록을 따르고, 아래를 더한다.
  - `spec-amendments.md` 16절에 이 계획의 명세 고침을 적는다: P-2(CP949 표), P-4(언어 꼬리), P-7(`RemovedTrack.language`), P-14(`track` = 자산 id), P-18(`video.exitFullScreen`), P-19(`library.find`).
  - `mac-verification.md`에 "HTML 전체 화면 해제 멈춤 — M8a에서 무대 모드로 해결"과 Mac 실행 id를 적는다.
  - `next-session.md`에 "M8a 결과"(측정값, 남은 것)와 "M8b 입력"(큐 표·`cue_texts_time`·시간 행·무대 모드)을 적는다.
- 컨트롤러:
  1. CI 녹색 뒤 Mac `all`을 돌린다(최종 코드에서 두 번까지). 실패는 줄마다 기록한다.
  2. Mac PNG와 데모 프레임(라이트·다크)으로 opus 디자인 비평을 받는다.
  3. 브랜치 전체 검토(opus) → PR(본문 끝 Global Constraints) → 소유자 승인 뒤 병합한다.

- [ ] **Step 1**: 데모 장. **Step 2**: 문서. **Step 3**: 작업마다 녹색. 커밋 `docs(m8a): ADRs, design spec, amendments §16, acceptance, next session and Mac verification; the M8a demo chapters`.

---

## 자기 점검 (2026-11-25)

### 명세 대응표 — 일이 필요한 절·항목마다 그것을 짓는 작업

| 명세 | 작업 |
|---|---|
| 0 결정(나누기·세 길·자막 검색·접근안) | 3–15 전체, M8b는 컨트롤러가 나란히 |
| 1 완료 조건 — 재생·키·기억 | 10 |
| 1 완료 조건 — 자막 세 길·인코딩·깨짐·트랙·기억 | 6·7·12·14 |
| 1 완료 조건 — 대본 | 13 |
| 1 완료 조건 — 자막 본문 검색 | 8·15 |
| 1 완료 조건 — 전체 화면 빠른 토글 | 9·11 |
| 1 완료 조건 — 마이그레이션 005→006 | 4 |
| 1 완료 조건 — 성능 | 3·6·8·13 |
| 2 범위 밖(시간 메모·M8b 등) | Global Constraints "가짜 금지", Task 2 목업이 그리지 않음 |
| 3.1–3.7 해석기·인코딩·SRT·VTT·정리·한도 | 3(P-2) |
| 3.8 언어 | 3(P-4), 이름은 12 |
| 4.1 마이그레이션 006 | 4 |
| 4.2 자산과 판본·중복 판정 | 5(P-9)·6 |
| 4.3 휴지통·영구 삭제·백업·점검 | 5 |
| 4.4 locator·설정 | 9·12(P-28) |
| 4.5 앵커 | Global Constraints(만들지 않음), 17 ADR-0009 |
| 5.1 자막 파일 추가 | 6(`pick`)·12 |
| 5.2 같이 고른 같은 이름 | 7·14 |
| 5.3 영상 탭에 끌어 놓기 | 14 |
| 5.4 붙이는 흐름 | 6 |
| 5.5 제거와 되돌리기 | 5·6(P-7·P-8)·12 |
| 6.1–6.3 배치·컨트롤·키 | 10(P-17) |
| 6.4 오버레이 | 12(P-24) |
| 6.5 자막 ▾ | 12 |
| 6.6 전체 화면 | 9·11(P-16·P-18) |
| 6.7 상태 | 10·13 |
| 6.8 항목 패널 | 12·15 |
| 7 대본 칸 | 13(P-19·P-23) |
| 8.1 질의 | 8(P-14·P-15) |
| 8.2·8.3 화면·시각으로 열기 | 15(P-22) |
| 9.1 macOS 빠른 토글 | 9·11 |
| 9.2 재생 불가 안내 | 10 |
| 9.3 읽기 절 영상 줄 | 15 |
| 10 명령 | 10·11·12·13 |
| 11 IPC | 6·8·9 |
| 12 문구 | 10·12·13·14·15, 문구 검사는 아래 |
| 13 목업 게이트 | 2 |
| 14 성능 | 3(해석)·4(마이그레이션)·6(붙이기)·8(본문 검색)·13(`video-perf`) |
| 15 검증·픽스처·Mac·데모 | 3·16·17, P-26 |
| 16 Global Constraints | 위 절 |
| 17 문서 | 17 |
| 18 위험 | CP949 → 1·3, MIME → 14·16, 전환 → 9, 프레임 콜백 → 12, 프레임 정확도 → 10(보고값), SRT 방언 → 3, 가상화 포커스 → 13, 간헐 실패 → Global Constraints |

### 그 밖의 점검
- **문구 검사**(명세 12절 끝): 새 복합어 "자막 파일", "현재 위치", "본문 일치"는 Task 12(자막 파일)·13(현재 위치)·15(본문 일치)가 `R/strings/strings.test.ts:65` `COMPOUNDS`에 더한다. main의 한국어는 `M/strings.ts`에만 둔다(`importFilters.subtitles` — Task 6).
- **이름의 일관성**: `SubtitleTrack`·`AttachResult`·`RemovedTrack`(5) → 6·7·12·14, `BodyMatches`·`TimeMatch`(8) → 15, `VideoStore`·`VideoHandle`·`VideoAction`(10) → 11·12·13·15, `PendingJump`(15)를 확인했다. `video.*` 명령 열넷(10에서 열, 11에서 둘, 12에서 둘)과 `library.find`(13)도 확인했다.
- **자리표시 없음**: 정확한 값은 표·코드로 두었고, 긴 고정 내용(006 SQL, 문구, 키·상태 표)은 명세 절을 가리킨다(P-0).
