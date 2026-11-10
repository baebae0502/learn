# M7c — 이미지 · PDF 본문 검색 · 성능 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 작업마다 아래 "검토 절차"를 따른다.

**Goal:** 사진·도판·스크린샷(래스터 5종)을 PDF처럼 가져와 탭에서 맞춰 보고 확대·이동·회전하며 자리를 기억하고, 빠른 검색이 범위 '정보와 본문'에서 PDF 본문까지 찾아 그 쪽을 열며, M5·M6에서 넘어온 성능 줄을 예산 안으로 되돌린다.

**Architecture:** 마이그레이션 004가 외래 키를 끄는 실행기 길로 `items`·`anchors`를 다시 만들어 CHECK를 넓히고 `assets.width/height`와 `page_texts` + FTS5 trigram 외부 내용 표를 더한다. 이미지는 main이 머리 1 MiB에서 형식과 크기를 읽어 가져오고, 렌더러의 새 이미지 리더가 순수 함수 `imageFit`으로 배치한다. PDF 본문은 main의 일정기가 `utilityProcess` 일꾼(pdf.js, DB 없음)에 파일 하나씩 맡기고 일꾼이 보낸 쪽 글 묶음을 main이 zod로 검사해 한 트랜잭션씩 쓴다. 검색은 main의 `search:*` 채널(3글자 이상 FTS 구, 2글자 `LIKE` 덩어리 훑기, 창마다 하나·취소)이 답하고 렌더러가 정보 결과와 합친다.

**Tech Stack:** Electron 44.9.1(Node 24.22, `utilityProcess`), React 19.3.1, TypeScript 7.0.2, electron-vite 6.0.0, react-aria-components 1.22.1 (+ react-aria 3.53.1), lucide-react 1.60.0, @tanstack/react-query 5.104.5, @tanstack/react-virtual 3.14.22, zustand 5.0.15, zod 4.6.7, better-sqlite3 13.0.3(SQLite 3.53.4, FTS5), pdfjs-dist 6.4.299, Playwright 1.64.1, vitest 5.0.5(Node 22.19), pnpm 10.15.1.

**Spec:** `docs/superpowers/specs/2026-11-08-m7c-images-search-perf-design.md`(아래 "명세", 소유자 승인 2026-11-08) + `docs/design/design-spec.md`(아래 "디자인 명세") + Task 1에서 소유자가 승인하는 M7c 목업. 코드 사실은 계획 작성 때 m7c 워크트리 HEAD fba33b7(main 4e57fad + 명세)에서 확인했고 작업 본문에 파일·줄로 적었다(따로 조사 파일 없음).

## 사전 판정 (2026-11-08, 계획 작성 중)

한 줄 = 판정 하나 → 반영한 작업.

- **P-0 계획의 모양**: M7b와 같은 절약형 — 작업마다 파일, 인터페이스(정확한 이름·타입), 정확한 값, 시험(순수 모듈은 시험 코드), 단계. 명세가 정확히 정한 긴 코드(004 SQL, zod 모양, 바이트 규칙)는 명세 절을 가리키고 서명과 시험을 적는다. 구현자 sonnet, 작업 검토 sonnet, 디자인 비평·최종 검토 opus.
- **P-1 목업 게이트와 순서**(명세 12절): Task 1(목업) 뒤 소유자 승인을 기다리는 동안 Task 2–10(화면 무관)을 한다. 명세 12절의 목록에 없는 Task 10의 목차 스크롤·탭 패널 연결은 새 크롬이 없고(픽셀이 바뀌지 않는 동작·속성) 투어 기준 PNG도 그대로여야 하므로 승인 전에 한다 — 투어 PNG가 바뀌면 그 부분은 승인 뒤로 미룬다. Task 11–15는 승인 뒤.
- **P-2 `AssetRow`의 크기**: `width?: number | null; height?: number | null`(선택 필드, 없으면 `NULL`). `AssetRow`를 만드는 곳(시험 픽스처, `seedAssets`, `edited-copies`)은 고치지 않는다. `LibraryItem.imageSize`도 `imageSize?: { width: number; height: number } | null`(선택 — 도메인은 library 패키지의 `PixelSize`를 가져오지 않는다) — `LibraryItem` 리터럴이 40개 파일에 있다. 저장소는 늘 채운다(이미지가 아니면 `null`). → Task 4
- **P-3 실행기의 거절과 문구**: `foreignKeysOff` 마이그레이션 안의 모든 실패(트랜잭션 안에서 부름, `PRAGMA foreign_keys`가 0이 아님, `foreign_key_check` 행)는 지금의 `catch`가 감싸 같은 `MIGRATION_FAILED` 문구("v4 업데이트에 실패했습니다. 데이터베이스는 v3 상태입니다. …")가 된다. → Task 2
- **P-4 `slideAnchor`의 이름**: 004가 행을 `'slides'`로 고치므로 도메인 `slideAnchor.kind = 'slides'`와 `precisionOf`의 `'slides'`는 Task 2(마이그레이션과 같은 커밋)에서 바꾼다. `imageAnchor`는 Task 4.
- **P-5 머리 파서와 종류를 나눔**: `sniffImage`·`imageSize`(순수, `packages/library`)는 Task 3, 그것을 가져오기에 잇고 `ItemType`에 `'image'`를 더하는 일(타입이 렌더러까지 퍼진다)은 Task 4. 검토자가 바이트 규칙만 따로 판정할 수 있게.
- **P-6 상자 머리**(명세 3.2 보충): `meta`·`pitm`·`ipma`·`ispe`는 ISO BMFF 전체 상자(FullBox)라 몸 앞에 판·플래그 4바이트가 있다 — `ispe`의 가로는 몸+4, 세로는 몸+8. `irot`은 전체 상자가 아니다(몸의 첫 바이트 & 3). 계획 작성 중 스크래치에서 ImageMagick·ffmpeg가 만든 AVIF 둘 모두 `pitm` → 항목 1 → `ispe` 40×30으로 읽혔다. → Task 3
- **P-7 고정 이미지 만들기**: ImageMagick 7(`magick`)·ffmpeg(`libaom-av1`, `libwebp` 있음)로 만들고, EXIF 방향 6 JPEG는 `magick -orient`가 Exif 프로필 없이는 아무것도 쓰지 않아(스크래치 확인) node 한 줄로 APP1을 끼운다. 명령은 `fixtures/static/README.md`. → Task 3
- **P-8 추출 작업 키와 버전 상수**: `PDF_TEXT_EXTRACTOR = 'pdf-text-1'`과 `extractKey(sha)`는 도메인(`D/body-search.ts`)에 두고 `importer.ts`의 `EXTRACTOR_VERSION`이 그것을 쓴다(DB 패키지는 library 패키지를 가져올 수 없다). 가져오기는 PDF에만 작업을 넣고 `payload = { sha256, type: 'pdf', nextPage: 0, pages: null, chars: 0, truncated: false }`. 채워 넣기의 `created_at`은 그 sha를 쓰는 PDF 자료의 가장 늦은 `items.created_at`(그래야 "최근 먼저"가 옛 PDF에도 맞다), 작업 id는 `newId()`(일꾼 메시지의 `jobId`가 UUID) — 한 트랜잭션. → Task 5
- **P-9 `payload`의 뜻**: `pages` = 문서의 쪽 수('opened'), `nextPage` = 색인한 쪽 수(다음에 시작할 쪽), `chars` = 저장한 글자 수. `BodyTextState`의 `done.pages`·`empty.pages`는 `nextPage`, `empty`는 `chars < 10 × max(1, nextPage)`이고 잘리지 않았을 때. `search:progress`의 `done`은 이 버전 작업이 `done` 또는 `failed`인 휴지통 아닌 PDF 자료 수(끝난 것은 어느 쪽이든 셈), `total`은 휴지통 아닌 PDF 자료 수. → Task 5
- **P-10 묶음 쓰기 전 확인**: main은 묶음마다 그 작업 행이 아직 있고 `running`인지 같은 트랜잭션에서 먼저 본다. 아니면(영구 삭제가 작업을 지웠거나 휴지통으로 멈춤) 쓰지 않고 일꾼을 멈춘다 — 지운 sha의 쪽 글이 고아로 남지 않는다. → Task 5·7
- **P-11 일꾼 시험의 자리**: vitest는 Node 22.19(CI `node-version: 22.19.0`)에서 돈다. pdfjs-dist 6.4.299 `build/`는 `Promise.try`와 `Uint8Array.prototype.toHex`를 쓰고 Node 22에는 둘 다 없다(계획 작성 중 스크래치: `TypeError: Promise.try is not a function`, `hashOriginal.toHex is not a function`). 그래서 pdf.js를 부르는 코드는 Electron(Node 24) 안에서만 시험한다 — E2E 훅 `extractFile`이 앱의 진짜 일꾼을 돌린다. 단위 시험은 순수 부분(쪽 글 정리, 메시지 검사, 자료 파일 팩터리의 이름 검사)과 가짜 포트로 본 프로세스 관리. 명세 17절의 "단위·E2E를 먼저"는 E2E로 읽는다. → Task 6
- **P-12 일꾼 자료 폴더**: `assetsDir = path.join(rendererDir, 'pdfjs')`, `rendererDir`은 `handleAppProtocol`이 받는 그 폴더(`path.join(here, '../renderer')`, `M/index.ts`). 개발 실행에서 그 폴더가 없으면 `apps/desktop/src/renderer/public/pdfjs`. → Task 7
- **P-13 E2E에서는 멈춘 채 시작**: `LEARN_E2E=1`이면 일정기가 멈춘 상태로 시작하고 시험이 `textExtraction('resume' | 'now')`로 켠다 — 기존 시험(1만 개의 가짜 PDF를 심는 `seedAssets` 성능 시험 포함)에 뒤에서 도는 추출이 끼어들지 않게. `LEARN_TEXT_EXTRACTION=run`이면 E2E에서도 켜진 채 시작한다(냉시작 증거 줄과 데모). → Task 7
- **P-14 원본이 없는 sha**: 일정기가 고른 작업의 sha에 읽을 수 있는 파일(관리 사본 또는 연결 파일)이 없으면 그 작업은 `queued`로 두고 이 실행 동안 건너뛴다(시도를 세지 않음). 다음 실행에서 다시 본다. → Task 7
- **P-15 2글자 훑기와 취소**: DB 쪽은 `bodyLikeChunks()` 생성기(쪽 `id` 범위 2,000행씩)이고, main의 `searchBody`가 덩어리 사이에 `setImmediate`로 놓아주며 `AbortSignal`을 본다. 창마다 진행 중인 요청 하나는 `ipc/search.ts`의 `Map<webContents.id, AbortController>`. → Task 5·8
- **P-16 `tags:togglePosition`의 답**(성능 P3): 답에 바뀐 항목 `itemIds: string[]`을 더한다(`TagsRepository.togglePositionChanged`가 이미 계산함). 렌더러는 그것으로 스냅샷의 `tagged`를 정확히 고치고, 뒤따르는 같은 `libraryChanged{tags, itemIds}`는 한 번 소비해 다시 읽지 않는다. → Task 9
- **P-17 메뉴 막대의 정리 읽기**(P2): `readMenuOrganize(db): OrganizeSnapshot`은 컬렉션과 태그만 읽고 `members`·`tagged`·`duplicates`는 비우고 `trashCount: 0`. 메뉴 막대는 늘 `itemIds: []`로 만든다(`M/menu/app-menu.ts:118`) — 소속을 읽을 일이 없다. → Task 9
- **P-18 정리 스냅샷의 전송 모양**(P1): `OrganizeWire`와 `packOrganize`·`unpackOrganize`·`organizeWireBytes`는 도메인 `organize.ts`. main이 싸고 렌더러 `useOrganize`와 E2E 도우미 `organizeSnapshot`이 푼다. `organize-perf`의 바이트는 `JSON.stringify` 대신 페이지 안에서 `itemIds`·나머지 JSON + `Uint32Array.byteLength`의 합으로 잰다(형식 배열의 JSON은 오히려 커진다). → Task 9
- **P-19 ⌘/ 시트 미리 만들기**(P7): `shortcuts` 종류만 미리 만든 창을 쓴다. `SheetHost.prepare(parent)`가 숨긴 시트 창 하나를 띄워 두고 그 창의 `sheet:payload`는 `open`이 올 때까지 답을 붙든다. 닫히면 1,000ms 뒤 다음 것을 준비한다. → Task 9
- **P-20 P8도 승인 전**: 표 행 메모·스크롤 처리기의 레이아웃 읽기 제거는 픽셀이 바뀌지 않는다(투어 그대로). → Task 9
- **P-21 이미지 리더의 상태 자리**: 범위의 reader store에 `image: ImageState | null`, `imageHandle: ImageViewHandle | null`(+ `setImage`, `setImageHandle`)를 더하고 `readerActions`의 `zoom`·`setZoom`·`rotate`가 이미지 핸들이 있으면 그리로 보낸다(`'page-fit'` → `'fit'`, `'page-width'` → `'width'`, `zoom('actual')` → 1). → Task 11
- **P-22 이미지의 진행 저장**: 첫 그림에서 진행 1은 `api().reader.savePosition({ itemId, revisionId, locator, progress: 1 })`를 마운트마다 한 번 직접 부른다 — `createPositionSaver`는 locator가 마지막 것과 같으면 보내지 않고(`R/viewers/positionSaver.ts` `keyOf`), 기본 locator `{ kind: 'image' }`는 `markOpened`가 만든 행과 같다. → Task 11
- **P-23 `pendingJump`**: 범위의 reader store에 `pendingJump: { pageIndex: number; query: string } | null` + `setPendingJump`. 명세 5.8의 "`placePage` 규칙"은 M7b의 `PdfViewHandle.place`와 `restore`의 쪽 놓기다(그런 이름의 함수는 없다). 여는 길은 `CommandEnv.openAtPage(itemId, at)` — `afterEditing` 안에서 `pendingJump`를 두고 탭을 연다(편집 확인을 취소하면 점프도 남지 않는다). 레지스트리 명령이 아니다(썸네일 누름과 같은 패널 동작). → Task 15
- **P-24 아이콘 한 곳**: `R/library/itemIcon.ts`의 `itemIcon(type)`이 여덟 곳의 `item.type === 'video' ? Clapperboard : FileText`를 대신한다. → Task 13
- **P-25 명령 전수**: `M7C_COMMANDS` = 배경 명령 셋. `commands-coverage.spec.ts:740`의 리더 명령 목록 비교에 더한다. → Task 12
- **P-26 `mac-flakes`와 겹침**: 열린 `mac-flakes` 브랜치가 `view-modes.spec.ts`·`reader-pdf.spec.ts`를 고친다. Task 10의 대기 정리는 그 PR이 main에 병합되고 컨트롤러가 main을 `m7c-images-search`에 병합한 뒤에 한다(그 전에는 같은 작업의 목차 스크롤·탭 패널 연결과 `tabs`·`history` spec만).
- **P-27 Mac 실행**: 중간 `e2e`는 Task 15 뒤(이미지 리더와 본문 검색이 모두 들어간 때 — 명세 14절), 끝 `all`은 Task 16. 최종 코드에서 `all`은 두 번까지, 서로 다른 간헐 실패는 줄마다 적는다(M7b R48). 모두 컨트롤러가 `workflow_dispatch`로.
- **P-28 ADR-0008은 없다**: ADR-0009 6절이 번호만 예약했다(`docs/decisions/0008-*` 없음). Task 16이 `docs/decisions/0008-body-search.md`를 만든다.
- **P-29 시작 점검 뒤에 시작**: 시작 점검(`startLibraryCheck` → `runCheck({ startup: true })` → `checkLibrary({ interruptJobs: true })`)은 창을 만든 뒤 배경에서 돌고, 연결 파일을 먼저 `stat`하므로(`M/library-check.ts:35-39`) 느린 디스크에서는 첫 유휴 + 5초보다 늦을 수 있다. 그 전에 일정기가 시작한 작업은 점검이 `interrupted`로 바꿔 버린다. 그래서 일정기는 첫 유휴 **와** 시작 점검의 첫 `runCheck`가 끝난 뒤에 시작한다(`StartCheckDeps.onChecked`, 점검이 실패해도 부름). → Task 7

## Global Constraints

모든 작업의 요구 사항에 아래가 암묵적으로 포함된다. 따옴표 안은 명세 15절 원문이다.

- **앵커**: "새 데이터 객체는 모두 앵커로 주소를 가질 수 있다(제품 방향 합의): 이미지는 `image` 앵커(4.5), 쪽 글은 sha + 쪽 번호라 그 revision의 pdf 앵커(`pageIndex`)로 가리킬 수 있다."
- **라이선스·의존성**: "AGPL 코드(Zotero reader, zotero-pdf-translate, LibreTranslate)는 보지도 가져오지도 않는다. pdf.js(Apache-2.0) 소스는 읽어도 된다 — 일꾼 번들에 pdf.js가 들어가므로 고지를 렌더러와 같이 확인한다. 런타임 의존성은 정확히 고정하고 새로 더하지 않는다(이미지 머리 파서·FTS5·`utilityProcess`는 모두 있는 것)." `LICENSE`와 `package.json`의 `license` 필드는 건드리지 않는다. `^`·`~` 금지.
- **불신 입력**: "PDF는 `utilityProcess` 일꾼에서만 연다(main은 열지 않는다). 이미지 머리는 main이 1 MiB 안에서 범위 검사를 하며 읽는다. 일꾼은 DB를 만지지 않고, main은 일꾼의 모든 메시지를 zod로 검사한다. 쓰기는 main 하나."
- **마이그레이션**: "마이그레이션의 외래 키 끄기는 실행기의 `foreignKeysOff` 길에서만, 커밋 전 `foreign_key_check`, 끝나면 반드시 다시 켠다."
- **네트워크**: "원격 요청은 main만, 허용 호스트 하나, 동의 전·끈 상태에서는 0회(M7a 그대로). **실제 번역 주소를 부르지 않는다 — `google-web.live.test.ts`를 돌리지 않고 `LEARN_TRANSLATION_LIVE`를 켜지 않는다.**"
- **가짜 금지**: "가짜 컨트롤 금지: 메뉴·팔레트·도구 막대는 레지스트리에서만(검색 범위 ▾는 태그 선택기 "…"와 같은 웹 팝업 메뉴이고 실제로 동작하는 값만 둔다), 핸들러 없는 항목은 그리지 않는다."
- **문체**: "문체는 합니다체, 화면 문구는 `strings/` 영역 파일에. 한국어 조사는 `josa.ts`. 내부 용어(메타데이터·FTS·trigram·추출기)는 화면에 쓰지 않는다." 관형사 + 명사·숫자와 단위는 U+00A0(디자인 명세 9).
- **가린 탭**: "가린 탭은 크기 관찰에 반응하지 않는다(M7a N-1) — 이미지 리더도."
- **macOS 시트**: "시트 뒤 클릭은 `sheetReleased()` 뒤에(macOS 250ms)."
- **목업 게이트**: "목업 승인 전에는 UI 구현 없음(12절)." (P-1)
- **역할**: "구현자는 push·CI 실행·하위 에이전트 실행을 하지 않는다(컨트롤러가 한다)." macOS 워크플로도 돌리지 않는다.
- **커밋 꼬리말**: "커밋 꼬리말 두 줄(Co-Authored-By, Claude-Session)." — 모든 커밋 끝에 정확히:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01LH2FDh4QwsGUFR3V2KewHi
  ```
- **PR 본문 끝**(컨트롤러):
  ```
  🤖 Generated with [Claude Code](https://claude.com/claude-code)

  https://claude.ai/code/session_01LH2FDh4QwsGUFR3V2KewHi
  ```
- **git**: amend 금지, force-push 금지, 그냥 `git stash` 금지(치울 것은 WIP 커밋). `.superpowers/`·`evidence/` 아래는 `git add`하지 않는다.
- **번역**: 실제 번역 주소를 부르지 않고, `google-web.live.test.ts`를 돌리지 않고, `LEARN_TRANSLATION_LIVE`를 두지 않는다(Task 16의 조사는 공개 문서 읽기만).
- **IPC**: 새·바뀐 채널은 기존 `handle()` 래퍼(발신자 검사 + zod `.strict()` + Result)와 `channel-kinds.ts` 허용 목록을 쓴다. preload는 이름공간 API만(`preload/surfaces.test.ts`가 둘을 맞춘다).
- **토큰만**: 화면 코드에서 색·간격·반경·글자 크기를 직접 쓰지 않는다. 토큰이 아닌 값은 같은 줄에 `/* local: 이유 */`. 한글 UI에 700 없음. `css-lint.test.ts`가 막는다. 새 토큰은 `R/design/tokens.ts`에 두고 `pnpm tokens`.
- **시험의 기다림**: 시험은 실제 앱 상태(속성·포커스·훅 값)를 기다리고 고정 `sleep`/`waitForTimeout`을 쓰지 않는다. "없음"을 확인하는 부정 확인은 같은 경로에서 "있음"을 먼저 확인한(양성 대조) 뒤에만 두고, 남는 고정 대기는 까닭을 주석으로 적는다(명세 7·17절, Mac 간헐 실패의 교훈).
- **부하 경합**: 단일 E2E spec은 `taskset -c 0-1`, 전체는 `taskset -c 0-3`으로 돌린다. `/home`이 NFS라 import 시간에 민감한 단위 시험이 로컬에서 실패할 수 있다 — 그 판정은 CI가 한다(보고서에 적는다).
- **프로세스**: Xvfb `:99`(PID 1049723)를 끝내지 않는다. 자기가 띄운 정확한 PID만 끝낸다. `pkill -f` 금지, `find /` 금지, `/tmp`를 쓸어 지우지 않는다. Playwright 출력은 `--output=/tmp/<고유 이름>`.
- **주석**: 새 코드의 주석에는 이유만. 판정 번호·실행 id·비평 id는 커밋 메시지에.
- **작업마다 녹색**: 작업을 끝낼 때 `pnpm typecheck`, `pnpm test`, `pnpm tokens:check`, `taskset -c 0-3 pnpm e2e:xvfb`, `taskset -c 0-3 xvfb-run -a -s "-screen 0 1440x900x24" pnpm exec playwright test -c playwright.evidence.config.ts`가 통과한다. 화면을 바꾼 작업은 그 spec을 `taskset -c 0-1 xvfb-run -a -s "-screen 0 1024x768x24" pnpm exec playwright test <spec>`으로도 한 번(Mac 러너 화면 크기). 긴 실행은 포그라운드로 나눠 돌리거나 백그라운드로 돌리고 끝날 때까지 직접 기다린다(포그라운드 `sleep` 금지). 실패하면 실패한 spec만 고쳐 다시, 그다음 전체 한 번 더.

## 검토 절차 (모든 작업)

1. **구현자**: 단계를 순서대로(시험 먼저 → 실패 확인 → 구현 → 통과 → 커밋). 하위 에이전트를 부르지 않는다. 보고서는 컨트롤러가 정한 파일에, 답에는 상태·커밋·시험 한 줄·우려만.
2. **작업 검토(sonnet)**: 명세 준수(작업 요구, Global Constraints, 사전 판정)와 품질(실패할 수 있는 단언인지, 양성 대조, 접근성 속성, 명세 13절 예산에 닿는 복잡도)을 한 번에. 계획과 다르게 구현했다면 이유가 커밋 본문에 있어야 한다.
3. **디자인 비평(UI 작업 11–15, opus)**: 승인 목업 렌더와 Linux 투어 PNG를 나란히 놓고 디자인 명세·루브릭으로 blocker/major/minor, blocker·major 0건까지 반복.
4. **macOS 증거**(P-27의 두 지점): 컨트롤러가 CI 녹색 뒤 `scripts/evidence.sh m7c-images-search <suite> <label>`.

## 경로 줄임말

`D` = `packages/domain/src`, `DB` = `packages/db/src`, `L` = `packages/library/src`, `M` = `apps/desktop/src/main`, `P` = `apps/desktop/src/preload`, `R` = `apps/desktop/src/renderer/src`, `E` = `tests/e2e`, `V` = `tests/evidence`, `F` = `fixtures`. 시험 폴더: `packages/<pkg>/test/`, main·렌더러 단위 시험은 원본 옆 `*.test.ts`.

## 작업 목록

| # | 작업 | 화면 | 구현 모델 | 앞선 조건 |
|---|---|---|---|---|
| 1 | M7c 목업(명세 12절 ①–⑧) | 목업 | sonnet + opus 비평 | — |
| 2 | 마이그레이션 004와 외래 키를 끄는 실행기, `'slides'` | 화면 무관 (승인 대기 중 진행) | sonnet | — |
| 3 | 머리 판별과 크기 읽기(순수), 고정 이미지 다섯 | 화면 무관 (승인 대기 중 진행) | sonnet | — |
| 4 | 종류 `image`: 도메인·가져오기·크기 저장·자리·`image` 앵커 | 화면 무관 (승인 대기 중 진행) | sonnet | 2, 3 |
| 5 | 쪽 글 저장소: 추출 작업·쪽 글·본문 상태·본문 질의(DB) | 화면 무관 (승인 대기 중 진행) | sonnet | 2, 4 |
| 6 | 추출 일꾼: `utilityProcess` + pdf.js, 쪽 글 정리, 메시지, 프로세스 관리 | 화면 무관 (승인 대기 중 진행) | sonnet | 5 |
| 7 | 추출 일정: main 연결·한도·다시 실행·휴지통·알림·시험 훅 | 화면 무관 (승인 대기 중 진행) | sonnet | 6 |
| 8 | 본문 검색 IPC(`search:*`)와 `search-perf` 측정 | 화면 무관 (승인 대기 중 진행) | sonnet | 7 |
| 9 | 성능 P1–P5·P7·P8·P10 | 화면 무관 (승인 대기 중 진행) | sonnet | 7(같은 `libraryChange.ts`) |
| 10 | M7b 입력: 목차 현재 항목 스크롤·탭 패널 연결·시험 대기 정리 | 화면 무관 (승인 대기 중 진행) | sonnet | — (대기 정리만 P-26) |
| — | **소유자 목업 승인** (P-1) | | | 1 |
| 11 | 이미지 리더: 무대·맞춤·확대 ▾·이동·회전·자리·진행·끝 상태, `imageOpen` | 목업 승인 뒤 | sonnet | 승인, 4 |
| 12 | 이미지 보기 ▾와 배경: 명령 셋·배경 ▸·설정·토큰·`M7C_COMMANDS` | 목업 승인 뒤 | sonnet | 11 |
| 13 | 라이브러리의 이미지: 아이콘·문구·드롭·통계·미리보기·종류 줄·읽기 줄 | 목업 승인 뒤 | sonnet | 승인, 4 |
| 14 | 검색 범위 ▾·합집합·결과 없음 덧붙임·진행 줄·P6·P11 | 목업 승인 뒤 | sonnet | 승인, 8, 9 |
| 15 | '본문 일치' 절·그 쪽에서 열기·본문 상태 줄 | 목업 승인 뒤 | sonnet | 14 |
| — | **Mac 중간 `e2e`** (P-27, 컨트롤러) | | | 15 |
| 16 | 마무리: 투어·axe·키보드 여정·데모·문서(ADR-0008·0012 재확인)·Mac `all` | 목업 승인 뒤 | sonnet(+컨트롤러) | 15 |

## 작업 사이의 계약 (요약 — 작업 본문의 Interfaces가 정본)

- Task 2 → 4·5·7·8: `Migration.foreignKeysOff?: true`, 스키마 v4(`assets.width/height`, `page_texts`, `page_texts_fts`, 트리거 셋), `slideAnchor.kind = 'slides'`.
- Task 3 → 4·11: `sniffImage(head): ImageMime | null`, `IMAGE_MIMES`, `imageSize(head, mime): PixelSize | null`, `IMAGE_HEAD_BYTES`, `F/static/images/*`.
- Task 4 → 5·11·13: `ItemType = 'pdf' | 'video' | 'image'`, `LibraryItem.imageSize?`, `IMAGE_FORMATS`, locator `{ kind: 'image', zoom?, cx?, cy?, rotation? }`, `imageAnchor`.
- Task 5 → 6·7·8·15: `D/body-search.ts`(`PDF_TEXT_EXTRACTOR`, `extractKey`, `TEXT_LIMITS`, `BodyTextState`, `BodyWords`, `bodyQueryWords`, `ftsMatch`, `likePattern`, `likeSnippet`, `MARK_START/END`), `TextRepository`, `bodyItemIds`, `bodyLikeChunks`, `bodyPages`, `ItemDetail.text`.
- Task 6 → 7: `ExtractRequest`, `WorkerMessage`, `checkWorkerMessage`, `createTextExtractor`, `TextExtractor.run/stop/dispose`, `ExtractOutcome`.
- Task 7 → 8·14·15·16: `createTextScheduler`, `LibraryContext.text`, `libraryChanged{reason:'text'}`, 이벤트 `'search:progress'`, 훅 `seedBodyText`·`textExtraction`·`textIdle`·`pageTextCount`·`textJobs`·`textHold`·`textHeld`·`textStats`, E2E 도우미 같은 이름.
- Task 8 → 14·15: `window.learn.search.body/pages/progress`, `Channels.search`.
- Task 11 → 12·15·16: `ImageState`, `ImageViewHandle`, store `image`/`imageHandle`, `CommandContextState.imageOpen`, `window.__learnImage`, 무대 `.image-stage`(`data-testid="image-stage"`).
- Task 14 → 15: 설정 `library.searchScope`, `useSearchScope()`, `useBodyProgress()`.

## 시작 전

- 워크트리 `.worktrees/m7c`, 브랜치 `m7c-images-search`(upstream 없음 — 컨트롤러가 `git push origin HEAD:refs/heads/m7c-images-search`). 워크트리에 `node_modules`가 없다: `pnpm install --frozen-lockfile` 다음 `pnpm fixtures`.
- 기준선: Task 1 전에 컨트롤러가 `pnpm typecheck && pnpm test`로 녹색을 확인한다(NFS에서 흔들리는 import 시간 시험은 Global Constraints의 "부하 경합" 줄대로 판정).
- `mac-flakes` PR(P-26)의 병합 여부를 Task 10 시작 때 확인한다.

---

### Task 1: M7c 목업 (명세 12절 ①–⑧)

**Files:**
- Create: `docs/design/mockups/reader-image.html`(`reader-pdf.html`과 같은 머리, `<title>Learn 목업 · 이미지 리더</title>`, `Mockup.render('reader-image')`)
- Modify: `docs/design/mockups/assets/views.js`(새 `imageWindow()`와 `screens['reader-image']`, `libraryWindow`·`emptyLibrary`의 `m=7c` 분기), `docs/design/mockups/assets/mockup.css`, `docs/design/mockups/assets/data.js`(이미지 자료·본문 일치 조각), `docs/design/mockups/assets/icons.js`(`node scripts/build-mockup-icons.mjs`로 다시 만듦 — `image`, `image-off`), `scripts/mockups/manifest.mjs`(`Render.group`에 `'m7c'`, M7b 블록과 같은 모양의 M7c 블록), `docs/design/design-spec.md`(10.1·10.2 쿼리 목록에 `m=7c` 쿼리, 새 절 "10.10 이미지 리더 — `reader-image.html`"의 쿼리 목록)

**Interfaces:**
- Produces: 렌더 이름(아래), 새 요소의 `data-ms="M7c …"`. Task 11–15 비평의 짝.

요구 사항(명세 12절, 4·5·11절):
- `reader-image.html?m=7c`: M7b의 탭 줄(라이브러리 + 리더 탭, 이미지 탭 아이콘 `image`) + 리더 도구 막대 44(가운데 확대 필드 + ▾, 오른쪽 보기 ▾ — 뒤로/앞으로·쪽 필드·찾기·항목 패널 토글 없음) + 무대. 큰 사진은 이 저장소의 시험 무늬(그러데이션·도형)로 그린다(제3자 사진 없음). 그림에 테두리·그림자 없음, 맞춤 여백 24.
  - ① `bg=light|dark|checker`(없으면 테마 따름) × 테마 둘, `img=transparent`(투명 PNG, 체크무늬 8px 두 색).
  - ② `zoom=fit`(기본, 큰 사진) · `img=small`(작은 이미지 100%, 키우지 않음) · `zoom=width`(세로 스크롤) · `zoom=400`(끌기 커서 `grab`) · `menu=zoom`(창에 맞춤 · 너비에 맞춤 · 실제 크기 ⌘0 · — · 확대 ⌘+ · 축소 ⌘−, 지금 모드 체크) · `menu=view`(배경 ▸ · — · 시계 방향으로 회전 ⌘R · 반시계 방향으로 회전 ⌘L) · `menu=view-bg`(배경 ▸ 열림: 밝게 · 어둡게 · 체크무늬, 지금 값 체크).
  - ③ `rotate=90` · `state=loading`(무대 바탕만, 컨트롤 비활성, 확대 필드 "…") · `state=error`(끝 상태 Notice: `image-off`, "이 이미지를 표시할 수 없습니다", 명세 11절 본문, 파일 이름·크기, Finder에서 보기 · 기본 앱으로 열기, 도구 막대 없음) · `state=missing|trashed` · `w=1024`.
- `library.html?m=7c`:
  - ④ 검색 필드 맨 앞 범위 단추(돋보기 자리) — `search=scope-states`(기본·호버·눌림·포커스 넷을 한 장에), `search=scope-menu`(정보 + 설명 "제목·저자·태그·출판사·원래 이름·초록·메모" / 정보와 본문 + 설명 "PDF 본문 포함", 체크) + `indexing=1`(구분선 뒤 비활성 "본문 색인 37 / 120"), `scope=fulltext&q=형광`(표 = 정보 ∪ 본문, 본문만 일치한 행에 표시 없음, 자리표시 "제목, 저자, 태그, 본문 검색").
  - ⑤ 항목 패널 '본문 일치' 절(머리 아래 · '읽기' 위): `matches=3` · `matches=many`(20행 + "외 14쪽") · `matches=loading`("찾는 중…") · `matches=indexing`("본문을 색인하는 중입니다.") · `matches=empty`(글자 없음 문구) · `matches=locked`(암호 문구). 머리 "본문 일치" + 3차색 "34쪽", 행 "12쪽" + 두 줄 조각(`<mark>`).
  - ⑥ `panel=image`(미리보기 높이 ≤ 160, `--bg-sunken` 바탕, "이미지 · 4032 × 3024") · `panel=image-large`(5,000만 화소 넘음: 아이콘 칸) · `panel=pdf-indexing`(파일 절 "본문 검색 · 본문을 색인하는 중입니다.") · 표의 종류 열에 '이미지' 행 · `state=noresults&scope=fulltext`(필드 목록 끝 "·PDF 본문" + "본문은 두 글자 이상인 낱말로 찾습니다." / 색인 중 덧붙임).
  - ⑦ 판단 질문: `reader-image.html?m=7c&sidebar=nopages`(동영상처럼 '쪽 없음' 안내 — 추천) 와 `sidebar=folded`(사이드바 자동 접기) 두 장.
- `library-empty.html?m=7c`: ⑧ 지원 형식 줄(명세 11절 `formats`, 1024에서 줄바꿈 `w=1024`) · `state=drop`의 "파일 3개(PDF 1 · 이미지 2)".
- 토큰 이름(명세 12절): `--image-bg-light`, `--image-bg-dark`, `--image-checker-a`, `--image-checker-b` — 목업 CSS에 값을 정해 두고 Task 12가 그 값을 `tokens.ts`로 옮긴다.
- `manifest.mjs`: `variant(screen, t, 'B', query, suffix, label)` 모양의 M7c 블록(라이트·다크 × 레이아웃 B, `group: 'm7c'`), `--only m7c`로 렌더. `reader-image`는 `SCREENS`에 넣지 않는다(기본 28장은 그대로).

- [ ] **Step 1**: 위 쿼리를 구현하고 `pnpm mockups:render -- --only m7c`로 PNG를 만든다.
- [ ] **Step 2**: 디자인 명세 10.1·10.2의 쿼리 목록과 새 10.10 절(쿼리 목록만)을 적는다.
- [ ] **Step 3**: 커밋 `docs(m7c): mockups — the image reader (backgrounds, fits, zoom and view menus, rotation, states), the search scope button and menu, the item panel's 본문 일치 and image preview, the empty library's formats and the drop summary`.
- 컨트롤러: opus 디자인 비평(디자인 명세 2.4·3.1·6·7.3·10.1–10.3, 루브릭, M7b 승인 목업과 대조) → blocker/major 0건까지 → Artifact와 대조표로 소유자 승인(⑦은 질문으로). 승인과 ⑦의 답, 바뀐 문구는 명세 0절 표와 11절에 적는다.

---

### Task 2: 마이그레이션 004와 외래 키를 끄는 실행기

**Files:**
- Create: `DB/migrations/004-images-text.ts`
- Modify: `DB/migrations/index.ts`, `DB/migrate.ts`, `D/anchors.ts`(`slideAnchor.kind`), `DB/anchors-repository.ts`(`precisionOf`), `packages/db/test/migrate.test.ts`(`:42`의 `toBe(3)` → 4, 첫 시험의 표 목록에 `page_texts`, 새 `describe`), `packages/db/test/anchors-repository.test.ts`, `docs/decisions/0003-storage-layout.md`(새 절 "스키마 v4")

**Interfaces:**
- Produces:
  ```ts
  // migrations/index.ts
  export interface Migration { version: number; name: string; sql: string; foreignKeysOff?: true }
  // MIGRATIONS에 더함
  { version: 4, name: 'images-text', sql: imagesText, foreignKeysOff: true }
  // anchors.ts
  export const slideAnchor = z.object({ kind: z.literal('slides'), /* 나머지 그대로 */ });
  ```

요구 사항(명세 3.3):
- `004-images-text.ts`의 `sql`은 명세 3.3 "004 SQL 개요"의 1–5절 그대로(순서가 규칙: 새 표 → 옮김 → 옛 표 지움 → 새 표 이름 바꿈, 002의 색인 둘 다시, `assets.width/height`, `page_texts` + `page_texts_fts` + 트리거 셋, `text-v0` 작업 지움). 머리 주석에 이유(옛 표 이름을 먼저 바꾸면 SQLite 3.26+가 자식의 `REFERENCES`를 고쳐 쓴다).
- 실행기(`migrate.ts`): 기존 루프의 `try` 안에서 `m.foreignKeysOff`면 아래 함수, 아니면 지금 그대로. 실패는 기존 `catch`가 같은 문구로(P-3).
  ```ts
  const record = (db: Db, m: Migration) =>
    db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(m.version, m.name, nowIso());

  /** SQLite ignores PRAGMA foreign_keys inside a transaction: it is switched off before, checked, and always switched back on. */
  function runWithForeignKeysOff(db: Db, m: Migration): void {
    if (db.inTransaction) throw new Error('a foreign-keys-off migration cannot run inside a transaction');
    db.pragma('foreign_keys = OFF');
    try {
      if (db.pragma('foreign_keys', { simple: true }) !== 0) throw new Error('foreign keys are still on');
      db.transaction(() => {
        db.exec(m.sql);
        const broken = db.pragma('foreign_key_check') as unknown[];
        if (broken.length > 0) throw new Error(`foreign_key_check found ${broken.length} rows`);
        record(db, m);
      })();
    } finally {
      db.pragma('foreign_keys = ON');
    }
  }
  ```
- 백업은 그대로(`.pre-v4.bak`, 대기 중인 첫 마이그레이션 앞).
- 도메인 `slideAnchor.kind`를 `'slides'`로, `precisionOf`는 `anchor.kind === 'slides' ? 'region' : 'span'`(P-4).
- ADR-0003 "스키마 v4" 절: 다시 만든 두 표와 이유, `assets.width/height`, `page_texts`·`page_texts_fts`(외부 내용 표, 트리거), 외래 키를 끄는 실행기의 규칙 다섯(명세 3.3 (1)–(5)).

시험(`migrate.test.ts`, 새 `describe('migration v4 (images-text)')`, 파일 안의 `tempDb`·`seedItem(repo, n)`·`tables`를 쓴다):
```ts
const v3 = MIGRATIONS.filter((m) => m.version <= 3);
const rows = (db: Db, table: string) => db.prepare(`SELECT rowid AS _rowid, * FROM ${table} ORDER BY rowid`).all() as Record<string, unknown>[];
const SAME = ['items', 'item_assets', 'source_revisions', 'collections', 'collection_items', 'tags', 'item_tags', 'reading_positions', 'annotations'];

function seedV3(db: Db) {
  const repo = new LibraryRepository(db);
  const pdf = seedItem(repo, 1);                       // a text-v0 extract job comes with it
  const video = seedItem(repo, 2);
  db.prepare(`UPDATE items SET type = 'video' WHERE id = ?`).run(video.itemId);
  const trashed = seedItem(repo, 3);
  db.prepare(`UPDATE items SET deleted_at = '2026-11-01T00:00:00.000Z' WHERE id = ?`).run(trashed.itemId);
  db.prepare(`INSERT INTO collections (id, name, parent_id, created_at) VALUES ('c1', '강의', NULL, 'now')`).run();
  db.prepare(`INSERT INTO collection_items (collection_id, item_id) VALUES ('c1', ?)`).run(pdf.itemId);
  db.prepare(`INSERT INTO tags (id, name) VALUES ('t1', 'm')`).run();
  db.prepare(`INSERT INTO item_tags (item_id, tag_id) VALUES (?, 't1')`).run(trashed.itemId);
  db.prepare(`INSERT INTO reading_positions (item_id, revision_id, locator_json, progress, updated_at) VALUES (?, ?, '{"kind":"pdf","pageIndex":3}', 0.5, 'now')`).run(pdf.itemId, pdf.revisionId);
  const anchor = db.prepare(`INSERT INTO anchors (id, revision_id, kind, locator_json, quote, schema_version, precision, text_json) VALUES (?, ?, ?, ?, ?, 2, ?, ?)`);
  anchor.run('a-pdf', pdf.revisionId, 'pdf', JSON.stringify({ kind: 'pdf', revisionId: pdf.revisionId, precision: 'span', pageIndex: 0, quads: [[0, 0, 1, 0, 0, 1, 1, 1]], coordinateSpace: 'pdf-user-space' }), 'q', 'span', JSON.stringify({ quote: { exact: 'q', prefix: '', suffix: '' } }));
  anchor.run('a-slide', pdf.revisionId, 'slide', JSON.stringify({ kind: 'slide', revisionId: pdf.revisionId, derivedRevisionId: pdf.revisionId, slideIndex: 0, quads: [] }), null, 'region', null);
  anchor.run('a-bad', pdf.revisionId, 'slide', 'not json', null, 'region', null);
  db.prepare(`INSERT INTO annotations (id, anchor_id, type, body_json, operation_id, created_at, updated_at) VALUES ('n1', 'a-slide', 'highlight', '{}', 'op', 'now', 'now')`).run();
  db.prepare(`INSERT INTO jobs (id, kind, dedupe_key, state, payload_json, created_at, updated_at) VALUES ('j-other', 'backup', 'backup:x', 'done', '{}', 'now', 'now')`).run();
  return { pdf };
}

it('upgrades a real v3 library: every row and rowid kept, foreign keys whole and on, slide → slides, text-v0 jobs gone, a v3 snapshot', () => {
  const { db, file } = tempDb();
  migrate(db, { dbFile: file, migrations: v3 });
  const { pdf } = seedV3(db);
  const before = Object.fromEntries([...SAME, 'assets', 'anchors'].map((t) => [t, rows(db, t)]));
  expect(migrate(db, { dbFile: file })).toEqual({ from: 3, to: 4, backupFile: `${file}.pre-v4.bak` });
  for (const t of SAME) expect(rows(db, t), t).toEqual(before[t]);
  expect(rows(db, 'assets')).toEqual(before.assets!.map((r) => ({ ...r, width: null, height: null })));
  expect(rows(db, 'anchors')).toEqual(before.anchors!.map((r) =>
    r.kind !== 'slide' ? r : { ...r, kind: 'slides', locator_json: r.id === 'a-bad' ? r.locator_json : JSON.stringify({ ...JSON.parse(String(r.locator_json)), kind: 'slides' }) }));
  expect(db.pragma('foreign_key_check')).toEqual([]);
  expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  const parents = (t: string) => (db.pragma(`foreign_key_list(${t})`) as { table: string }[]).map((r) => r.table);
  for (const t of ['item_assets', 'collection_items', 'item_tags', 'reading_positions']) expect(parents(t), t).toContain('items');
  expect(parents('annotations')).toEqual(['anchors']);
  const indexes = (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index'`).pluck().all() as string[]);
  expect(indexes).toEqual(expect.arrayContaining(['items_deleted_at', 'anchors_revision']));
  db.prepare(`UPDATE items SET type = 'image' WHERE id = ?`).run(pdf.itemId);
  expect(() => db.prepare(`UPDATE anchors SET kind = 'slide' WHERE id = 'a-slide'`).run()).toThrow(/CHECK/);
  expect(new AnchorsRepository(db).get('a-slide')?.anchor.kind).toBe('slides');
  expect(db.prepare('SELECT id FROM jobs').pluck().all()).toEqual(['j-other']);
  const snap = openDatabase(`${file}.pre-v4.bak`);
  dbs.push(snap);
  expect(currentVersion(snap)).toBe(3);
});
```
더해서:
- "a foreign-keys-off migration that leaves an orphan is rolled back, and foreign keys are on again": v3 + `seedItem` 하나 → `[...v3, { version: 4, name: 'orphan', sql: 'DELETE FROM items;', foreignKeysOff: true as const }]` → `/^v4 업데이트에 실패했습니다\. 데이터베이스는 v3 상태입니다\./`, `currentVersion` 3, `items` 1행, `foreign_keys` 1.
- "refuses to run inside a transaction": v3(`dbFile: null`) → `db.transaction(() => migrate(db, { dbFile: null }))()`이 같은 문구로 던지고 `currentVersion` 3, `foreign_keys` 1.
- "10,000 items rebuild within a second": v3 + `seedItem` 하나 + `repo.insertItemsForAsset`로 1만 행 → `performance.now()`로 잰 `migrate`가 1,000ms 미만(값을 `console.log('[measure] migrate-004', ms)`로 보고 — 명세 13절 보고값).
- "the FTS triggers index, update and delete": v4에서 `page_texts` 넣기 → `SELECT rowid FROM page_texts_fts WHERE page_texts_fts MATCH '"현미경"'` 한 행 → `UPDATE text` → 옛 낱말 0행·새 낱말 1행 → `DELETE` → 0행.
- `anchors-repository.test.ts`: `slides` 앵커를 `create` → `get`이 `precision`이 `region`인 행으로 읽는다.

- [ ] **Step 1**: 시험을 쓰고 실패를 본다(`pnpm vitest run packages/db/test/migrate.test.ts packages/db/test/anchors-repository.test.ts`).
- [ ] **Step 2**: 004 SQL, `Migration.foreignKeysOff`, 실행기, `slideAnchor`·`precisionOf`를 구현해 통과시킨다.
- [ ] **Step 3**: ADR-0003 절을 적는다. 전체 녹색(E2E `smoke.spec`이 `LATEST_SCHEMA_VERSION` 4를 본다).
- [ ] **Step 4**: 커밋 `feat(db): schema v4 — items and anchors rebuilt with foreign keys off (new table, copy with rowid, drop, rename) so the type and kind checks take image and slides; asset width and height; page texts with an FTS5 trigram index; the unused text-v0 jobs removed; the runner checks foreign keys before commit and always turns them back on`.

---

### Task 3: 머리 판별과 크기 읽기 (순수)

**Files:**
- Create: `L/image-size.ts`, `packages/library/test/image-bytes.ts`(시험용 바이트 만들기), `packages/library/test/image-size.test.ts`, `F/static/images/transparent.png`, `F/static/images/orient6.jpg`, `F/static/images/alpha.webp`, `F/static/images/two-frames.gif`, `F/static/images/still.avif`
- Modify: `L/sniff.ts`(`sniffImage`·`IMAGE_MIMES` 더함 — `sniffFile`에는 아직 잇지 않는다, P-5), `L/index.ts`(내보내기), `F/static/README.md`(만든 명령), `F/README.md`("커밋하는 고정 자료" 표)

**Interfaces:**
- Produces:
  ```ts
  // sniff.ts
  export const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'] as const;
  export type ImageMime = (typeof IMAGE_MIMES)[number];
  /** 명세 3.1 표의 바이트 규칙(확장자는 보지 않는다). ftyp는 AVIF만 보고, HEIC 계열 표시가 있으면 null(J1). */
  export function sniffImage(head: Uint8Array): ImageMime | null;
  // image-size.ts
  export const IMAGE_HEAD_BYTES = 1024 * 1024;
  export const IMAGE_SIDE_MAX = 1_000_000;
  export interface PixelSize { width: number; height: number }
  /** 명세 3.2(+ P-6). 모든 읽기는 범위 검사, 넘으면 그 자리에서 null(예외 없음). 한 변이 1–1,000,000 밖이면 null. */
  export function imageSize(head: Uint8Array, mime: string): PixelSize | null;
  ```

규칙: 명세 3.1 표와 3.2의 형식별 바이트(PNG IHDR, GIF 논리 화면, WebP `VP8 `/`VP8L`/`VP8X`, JPEG 세그먼트 걷기·SOF·APP1 Exif 방향 5–8 교환·SOS에서 멈춤, AVIF `meta` → `pitm` → `iprp`/`ipma` → `ipco`의 `ispe`·`irot`). P-6의 전체 상자 머리. `ipma`의 연관 하나는 `flags & 1`이면 u16(맨 위 비트 essential, 아래 15비트 번호) 아니면 u8(맨 위 비트 essential, 아래 7비트), 번호는 1부터. 상자 크기 0·1, 8 미만, 부모 밖은 null. AVIF의 `ftyp` 브랜드 판정은 `sniffImage`와 같은 함수를 쓴다.

시험 도우미(`image-bytes.ts`, Task 4의 `primitives.test.ts`도 쓴다):
```ts
export const bytes = (...parts: Array<readonly number[] | string | Uint8Array>): Uint8Array => {
  const out: number[] = [];
  for (const p of parts) out.push(...(typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p));
  return Uint8Array.from(out);
};
export const u16be = (n: number) => [n >> 8, n & 255];
export const u16le = (n: number) => [n & 255, n >> 8];
export const u24le = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255];
export const u32be = (n: number) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
export const u32le = (n: number) => u32be(n).reverse();
export const box = (type: string, ...body: Array<readonly number[] | string | Uint8Array>) => { const b = bytes(...body); return bytes(u32be(8 + b.length), type, b); };
export const fullBox = (type: string, version: number, flags: number, ...body: Array<readonly number[] | string | Uint8Array>) => box(type, [version, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255], ...body);
export const png = (w: number, h: number) => bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], u32be(13), 'IHDR', u32be(w), u32be(h), [8, 6, 0, 0, 0]);
export const gif = (w: number, h: number, v: '87a' | '89a' = '89a') => bytes(`GIF${v}`, u16le(w), u16le(h), [0, 0, 0]);
export const webpLossy = (w: number, h: number) => bytes('RIFF', u32le(22), 'WEBP', 'VP8 ', u32le(10), [0, 0, 0], [0x9d, 0x01, 0x2a], u16le(w), u16le(h));
export const webpLossless = (w: number, h: number) => bytes('RIFF', u32le(17), 'WEBP', 'VP8L', u32le(5), [0x2f], u32le((w - 1) | ((h - 1) << 14)));
export const webpExtended = (w: number, h: number) => bytes('RIFF', u32le(22), 'WEBP', 'VP8X', u32le(10), [0x10, 0, 0, 0], u24le(w - 1), u24le(h - 1));
const exif = (orientation: number, order: 'II' | 'MM') => {
  const s16 = order === 'II' ? u16le : u16be;
  const s32 = order === 'II' ? u32le : u32be;
  const tiff = bytes(order, s16(42), s32(8), s16(1), s16(0x0112), s16(3), s32(1), s16(orientation), [0, 0], s32(0));
  return bytes([0xff, 0xe1], u16be(2 + 6 + tiff.length), 'Exif\0\0', tiff);
};
export const jpeg = (w: number, h: number, o: { orientation?: number; order?: 'II' | 'MM'; app0?: boolean; fill?: boolean } = {}) => bytes(
  [0xff, 0xd8],
  o.app0 ? bytes([0xff, 0xe0], u16be(16), 'JFIF\0', [1, 1, 0], u16be(1), u16be(1), [0, 0]) : [],
  o.orientation ? exif(o.orientation, o.order ?? 'II') : [],
  o.fill ? [0xff] : [],
  [0xff, 0xc0], u16be(17), [8], u16be(h), u16be(w), [3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1],
  [0xff, 0xda], u16be(8), [1, 1, 0, 0, 63, 0],
);
export const ftyp = (major: string, ...compatible: string[]) => box('ftyp', major, u32be(0), ...compatible);
export const ispe = (w: number, h: number) => fullBox('ispe', 0, 0, u32be(w), u32be(h));
export const irot = (angle: number) => box('irot', [angle]);
export const avif = (o: { primary: number; items: Array<{ id: number; props: number[] }>; props: Uint8Array[]; ipmaFlags?: number; brands?: [string, ...string[]] }) => {
  const wide = ((o.ipmaFlags ?? 0) & 1) === 1;
  return bytes(
    ftyp(...(o.brands ?? ['avif', 'mif1', 'avif'])),
    fullBox('meta', 0, 0,
      fullBox('hdlr', 0, 0, u32be(0), 'pict', u32be(0), u32be(0), u32be(0), [0]),
      fullBox('pitm', 0, 0, u16be(o.primary)),
      box('iprp',
        box('ipco', ...o.props),
        fullBox('ipma', 0, o.ipmaFlags ?? 0, u32be(o.items.length),
          ...o.items.map((it) => bytes(u16be(it.id), [it.props.length], ...it.props.map((p) => (wide ? u16be(p) : [p])))))),
    ),
  );
};
```

시험(`image-size.test.ts`):
```ts
describe('sniffImage (spec 3.1)', () => {
  it('knows the five by their first bytes', () => {
    expect(sniffImage(png(1, 1))).toBe('image/png');
    expect(sniffImage(jpeg(1, 1))).toBe('image/jpeg');
    expect(sniffImage(gif(1, 1, '87a'))).toBe('image/gif');
    for (const w of [webpLossy(1, 1), webpLossless(1, 1), webpExtended(1, 1)]) expect(sniffImage(w)).toBe('image/webp');
    expect(sniffImage(ftyp('avif', 'mif1', 'miaf'))).toBe('image/avif');
    expect(sniffImage(ftyp('avis', 'msf1'))).toBe('image/avif');
    expect(sniffImage(ftyp('mif1', 'avif', 'miaf'))).toBe('image/avif');
  });
  it('turns HEIC away even when it lists avif (J1), an unknown WebP chunk and a video', () => {
    expect(sniffImage(ftyp('heic', 'mif1', 'heic'))).toBeNull();
    expect(sniffImage(ftyp('mif1', 'heic', 'miaf'))).toBeNull();
    expect(sniffImage(ftyp('mif1', 'avif', 'hevc'))).toBeNull();
    expect(sniffImage(bytes('RIFF', u32le(4), 'WEBP', 'ALPH'))).toBeNull();
    expect(sniffImage(ftyp('isom', 'mp42'))).toBeNull();
    expect(sniffImage(bytes('%PDF-1.7'))).toBeNull();
  });
});

describe('imageSize (spec 3.2)', () => {
  it('reads PNG, GIF87a/89a and the three WebP forms', () => {
    expect(imageSize(png(4032, 3024), 'image/png')).toEqual({ width: 4032, height: 3024 });
    expect(imageSize(gif(24, 16, '87a'), 'image/gif')).toEqual({ width: 24, height: 16 });
    expect(imageSize(gif(24, 16), 'image/gif')).toEqual({ width: 24, height: 16 });
    expect(imageSize(webpLossy(640, 480), 'image/webp')).toEqual({ width: 640, height: 480 });
    expect(imageSize(webpLossless(48, 32), 'image/webp')).toEqual({ width: 48, height: 32 });
    expect(imageSize(webpExtended(5000, 3000), 'image/webp')).toEqual({ width: 5000, height: 3000 });
  });
  it.each([1, 2, 3, 4, 5, 6, 7, 8])('JPEG orientation %i, little and big endian: 5–8 swap the sides', (o) => {
    const want = o >= 5 ? { width: 40, height: 60 } : { width: 60, height: 40 };
    expect(imageSize(jpeg(60, 40, { orientation: o, order: 'II' }), 'image/jpeg')).toEqual(want);
    expect(imageSize(jpeg(60, 40, { orientation: o, order: 'MM' }), 'image/jpeg')).toEqual(want);
  });
  it('walks APP segments and fill bytes before the SOF, and stops at SOS', () => {
    expect(imageSize(jpeg(800, 600, { app0: true, orientation: 6, fill: true }), 'image/jpeg')).toEqual({ width: 600, height: 800 });
    expect(imageSize(bytes([0xff, 0xd8, 0xff, 0xda], u16be(8), [1, 1, 0, 0, 63, 0]), 'image/jpeg')).toBeNull();
  });
  it('AVIF follows pitm and ipma: a thumbnail ispe listed first does not win, irot 1 or 3 swaps, u16 indexes and the essential bit', () => {
    const props = [ispe(160, 120), ispe(4032, 3024), irot(1)];
    expect(imageSize(avif({ primary: 1, items: [{ id: 2, props: [1] }, { id: 1, props: [2] }], props }), 'image/avif')).toEqual({ width: 4032, height: 3024 });
    expect(imageSize(avif({ primary: 1, items: [{ id: 1, props: [2, 0x83] }], props }), 'image/avif')).toEqual({ width: 3024, height: 4032 });
    expect(imageSize(avif({ primary: 1, items: [{ id: 1, props: [2, 3] }], props, ipmaFlags: 1 }), 'image/avif')).toEqual({ width: 3024, height: 4032 });
  });
  it('is null and never throws on a cut head, a false length, a box of size 0 or 1, and a side outside 1–1,000,000', () => {
    const full = jpeg(60, 40, { orientation: 6 });
    for (let n = 0; n < full.length; n++) expect(() => imageSize(full.subarray(0, n), 'image/jpeg')).not.toThrow();
    expect(imageSize(png(4032, 3024).subarray(0, 20), 'image/png')).toBeNull();
    const lying = jpeg(60, 40);
    lying[4] = 0xff; // the SOF's length now runs past the buffer
    expect(imageSize(lying, 'image/jpeg')).toBeNull();
    expect(imageSize(bytes(ftyp('avif', 'mif1'), u32be(0), 'meta'), 'image/avif')).toBeNull();
    expect(imageSize(bytes(ftyp('avif', 'mif1'), u32be(1), 'meta', u32be(0), u32be(64)), 'image/avif')).toBeNull();
    expect(imageSize(png(0, 10), 'image/png')).toBeNull();
    expect(imageSize(webpExtended(1_000_001, 10), 'image/webp')).toBeNull();
    for (const mime of IMAGE_MIMES) for (let n = 0; n < 64; n++) expect(() => imageSize(new Uint8Array(n).fill(0xff), mime)).not.toThrow();
  });
  it('reads the committed images', () => {
    const at = (name: string) => new Uint8Array(fs.readFileSync(path.resolve(import.meta.dirname, '../../../fixtures/static/images', name)));
    expect(imageSize(at('transparent.png'), 'image/png')).toEqual({ width: 64, height: 48 });
    expect(imageSize(at('orient6.jpg'), 'image/jpeg')).toEqual({ width: 40, height: 60 });
    expect(imageSize(at('alpha.webp'), 'image/webp')).toEqual({ width: 48, height: 32 });
    expect(imageSize(at('two-frames.gif'), 'image/gif')).toEqual({ width: 24, height: 16 });
    expect(imageSize(at('still.avif'), 'image/avif')).toEqual({ width: 40, height: 30 });
    for (const [name, mime] of [['transparent.png', 'image/png'], ['orient6.jpg', 'image/jpeg'], ['alpha.webp', 'image/webp'], ['two-frames.gif', 'image/gif'], ['still.avif', 'image/avif']] as const) expect(sniffImage(at(name))).toBe(mime);
  });
});
```

고정 이미지(명령은 `F/static/README.md`에 그대로, P-7): 
```sh
magick -size 64x48 gradient:'#2a6fdb-#f2c94c' -alpha set -channel A -fx 'i<32?1:0.25' +channel -depth 8 fixtures/static/images/transparent.png
magick -size 60x40 gradient:'#2a6fdb-#f2c94c' -quality 85 "$TMPDIR/base.jpg"
node --input-type=module -e "import fs from 'node:fs'; const [s, d] = process.argv.slice(1); const j = fs.readFileSync(s); const t = Buffer.from([0x49,0x49,0x2a,0,8,0,0,0,1,0,0x12,1,3,0,1,0,0,0,6,0,0,0,0,0,0,0]); const b = Buffer.concat([Buffer.from('Exif\0\0','latin1'), t]); const l = Buffer.alloc(2); l.writeUInt16BE(b.length + 2); fs.writeFileSync(d, Buffer.concat([j.subarray(0,2), Buffer.from([0xff,0xe1]), l, b, j.subarray(2)]));" "$TMPDIR/base.jpg" fixtures/static/images/orient6.jpg
magick -size 48x32 gradient:'#2a6fdb-#f2c94c' -alpha set -channel A -fx 'j<16?1:0.5' +channel -define webp:lossless=true fixtures/static/images/alpha.webp
magick -delay 50 -size 24x16 xc:'#2a6fdb' xc:'#f2c94c' -loop 0 fixtures/static/images/two-frames.gif
ffmpeg -v error -y -f lavfi -i testsrc2=size=40x30:rate=1 -frames:v 1 -c:v libaom-av1 -still-picture 1 -pix_fmt yuv420p fixtures/static/images/still.avif
```
`magick identify -format '%f %w %h %[orientation]\n' fixtures/static/images/*`로 확인한 줄(`orient6.jpg 60 40 RightTop`)을 README에 함께 적는다. 다섯 파일 모두 1 KB 안팎(계획 작성 중 스크래치 102–523 B).

- [ ] **Step 1**: 고정 이미지를 만들고 README를 적는다.
- [ ] **Step 2**: 시험을 쓰고 실패를 본다(`pnpm vitest run packages/library/test/image-size.test.ts`).
- [ ] **Step 3**: `sniffImage`, `imageSize`를 구현해 통과시킨다. 전체 녹색.
- [ ] **Step 4**: 커밋 `feat(library): the five raster formats by their first bytes (HEIC turned away even when it lists avif) and their pixel size from the head — PNG, GIF, the three WebP forms, JPEG with its EXIF orientation, AVIF by its primary item — bounds-checked, null instead of throwing; five small committed test images`.

---

### Task 4: 종류 `image` — 도메인·가져오기·크기 저장·자리·`image` 앵커

**Files:**
- Modify: `D/library.ts`(`ItemType`, `LibraryItem.imageSize?`, `IMAGE_FORMATS`), `D/reading.ts`(locator 셋째 모양), `D/anchors.ts`(`imageAnchor`, `sourceAnchor`), `D/settings.ts`(`savedTabItemSchema.type`에 `'image'`), `DB/library-repository.ts`(`AssetRow` 크기, `insertImported`의 INSERT, `toAsset`, `ITEM_FROM`·`ItemDbRow`·`toItem`), `DB/reading-repository.ts`(`startLocator`), `DB/anchors-repository.ts`(`precisionOf`), `L/sniff.ts`(`sniffFile`이 `sniffImage`를 씀, `NOT_VIDEO_BRANDS`에서 `avif` 빼지 않음 — ftyp 분기가 AVIF를 먼저 본다), `L/importer.ts`(거절 문구, 머리 1 MiB → `imageSize`), `L/openable.ts`(`EXTENSIONS`), `M/ipc/library.ts:18`(`IMPORT_FILTERS`), `M/strings.ts:25,67`(`importFilters.media`, `exportCopy.filterName.image`), `R/strings/library.ts:16`(`type.image`), `R/library/sort.ts:37`(`TYPE_ORDER`), `R/state/tabs.ts:112`·`R/shell/useTabItem.ts:10`(`type: ItemType`), `packages/db/test/fixtures.ts`(`seedItem`의 `type`에 `'image'`, mime `image/png`), `F/generate.mjs`(정적 이미지 다섯을 `generated/`로 복사, `png-named.jpg` = `transparent.png`의 사본), `F/README.md`, `docs/decisions/0009-anchor-hub-and-links.md`("M7c 결과" 절, 판정 표의 "M7b가 …"를 M7c로 정정)
- Test: `packages/domain/test/reading.test.ts`, `packages/domain/test/domain.test.ts`(앵커 zod), `packages/db/test/library-repository.test.ts`, `packages/db/test/reading-repository.test.ts`, `packages/db/test/anchors-repository.test.ts`, `packages/library/test/importer.test.ts`, `packages/library/test/primitives.test.ts:94`(AVIF 줄을 "가져올 수 없음"에서 이미지로 옮김), `packages/library/test/openable.test.ts`
- Create: `E/images.spec.ts`(이 작업은 시험 하나)

**Interfaces:**
- Consumes: Task 3 `sniffImage`, `imageSize`, `IMAGE_HEAD_BYTES`, `PixelSize`; Task 2 `assets.width/height`.
- Produces:
  ```ts
  // D/library.ts
  export type ItemType = 'pdf' | 'video' | 'image';
  export interface LibraryItem { /* … */ imageSize?: { width: number; height: number } | null }   // P-2
  export const IMAGE_FORMATS = 'PNG\u00a0·\u00a0JPEG\u00a0·\u00a0WebP\u00a0·\u00a0GIF\u00a0·\u00a0AVIF';
  // D/reading.ts — 명세 4.4의 셋째 모양 그대로(zoom: 'fit'|'width'|0.05–8, cx/cy 0–1, rotation 0|90|180|270, 모두 선택)
  // D/anchors.ts — 명세 4.5의 imageAnchor 그대로, sourceAnchor = z.union([pdfAnchor, videoAnchor, epubAnchor, webAnchor, slideAnchor, imageAnchor])
  // DB/library-repository.ts
  export interface AssetRow { /* … */ width?: number | null; height?: number | null }
  ```

요구 사항(명세 3.1–3.2, 3.5 일부, 4.4·4.5):
- `sniffFile`: PDF → ftyp(먼저 `sniffImage`가 `image/avif`면 이미지, 아니면 지금의 동영상 판정) → Matroska → 그 밖은 `sniffImage`(PNG·JPEG·GIF·WebP)면 `{ type: 'image', mime }`.
- `importer.ts` `run`의 거절: `지원하지 않는 형식입니다. 지금은 PDF, 동영상(${VIDEO_FORMATS}), 이미지(${IMAGE_FORMATS})를 가져올\u00a0수 있습니다.` `settle`: `kind.type === 'image'`면 커밋 전에 원본의 처음 `IMAGE_HEAD_BYTES`(작으면 전체)를 한 번 읽어(`fs.open` + `read`, 파일 안 private `readHead`) `imageSize(head, kind.mime)`; `fresh()`가 `width: size?.width ?? null, height: size?.height ?? null`. 크기를 못 읽어도 가져오기는 성공(J3). 다시 쓰는 자산(같은 sha)은 이미 크기가 있다.
- `insertImported`: `INSERT INTO assets (…, width, height) VALUES (…, @width, @height)`에 `{ ...a, width: a.width ?? null, height: a.height ?? null }`. `toAsset`이 두 열을 읽는다.
- `ITEM_FROM`에 `a.width, a.height`; `toItem`: `imageSize: r.type === 'image' && r.width !== null && r.height !== null ? { width: r.width, height: r.height } : null`.
- `startLocator('image')` = `{ kind: 'image' }`.
- `precisionOf`: `image`·`slides`는 `'region'`, `quote` 열은 `NULL`(지금 식이 이미 그렇다).
- `openable.ts` `EXTENSIONS`: `'image/png': ['png']`, `'image/jpeg': ['jpg', 'jpeg']`, `'image/webp': ['webp']`, `'image/gif': ['gif']`, `'image/avif': ['avif']`.
- `IMPORT_FILTERS[0].extensions`에 `'png', 'jpg', 'jpeg', 'webp', 'gif', 'avif'`; `importFilters.media = 'PDF\u00a0·\u00a0동영상\u00a0·\u00a0이미지'`; `exportCopy.filterName.image = '이미지'`; 렌더러 `t.library.type.image = '이미지'`; `TYPE_ORDER = { pdf: 0, video: 1, image: 2 }`. 아이콘·통계·드롭·미리보기 같은 화면은 Task 13이다 — 이 작업은 타입이 요구하는 것만.
- ADR-0009 "M7c 결과": `image` 좌표 필드(`rect` 회전 전 0–1, region만, `text` 없음), `'slide'` → `'slides'`를 004가 했다(판정 표 줄 정정), 새 kind는 `image`만.

시험:
- `reading.test.ts`: image locator 왕복(`{ kind: 'image' }`, `{ kind: 'image', zoom: 2.5, cx: 0.25, cy: 1, rotation: 270 }`, `zoom: 'width'`), 거부(`zoom: 0.04`, `zoom: 9`, `cx: 1.01`, `rotation: 45`).
- `domain.test.ts`(앵커): `imageAnchor` 받음 `[0, 0, 1, 1]`·`[0.25, 0.5, 0.75, 0.5]`·`[0.1 + 0.2, 0, 0.7, 1]`(소수 오차 1e-9 안), 거부 `w = 0`, `x + w = 1.01`, `precision: 'span'`, `text` 있음(엄격하지 않으면 버려지는지가 아니라 — `imageAnchor`는 `text` 필드가 없으므로 `sourceAnchor.parse`의 결과에 `text`가 없음을 본다).
- `anchors-repository.test.ts`: 이미지 앵커 `create` → `get` → `listByRevision`, 저장 행의 `precision` `'region'`·`quote` `NULL`.
- `reading-repository.test.ts`: 이미지 자료의 `markOpened`가 `{ kind: 'image' }` 행을 만든다(지금은 `VALIDATION_FAILED`).
- `library-repository.test.ts`: `width/height`를 가진 자산 → `listItems()`의 `imageSize`, 한쪽이 `NULL`이면 `null`, PDF는 `null`.
- `importer.test.ts`: `F/static/images`의 다섯과 확장자가 틀린 PNG(`.jpg` 이름) → `type: 'image'`, mime, 저장된 `width/height`(위 Task 3의 값), 머리만 맞고 몸이 잘린 PNG(`png(10, 10)`만 쓴 파일) → 가져와짐 + 크기 10×10, HEIC 머리 파일 → `UNSUPPORTED_TYPE` + 위 문구 그대로.
- `primitives.test.ts`: `'an AVIF image'` 줄을 이미지 받음 표로 옮겨 `{ type: 'image', mime: 'image/avif' }`, HEIC·HEIF 줄은 그대로 null.
- `openable.test.ts`: `openExtension('image/jpeg', 'photo.JPEG')` → `'jpeg'`, `openExtension('image/png', 'x.jpg')` → `'png'`.
- `R/library/sort.test.ts`: 종류 열 오름차순이 PDF · 동영상 · 이미지.
- E2E `images.spec.ts` "five raster formats import by their header — a PNG named .jpg too — with their pixel size": `importPaths(page, [...다섯, png-named.jpg])`의 결과가 `type: 'image'`, mime, `imageSize`(EXIF 방향 6 JPEG는 40×60).

- [ ] **Step 1**: 단위 시험을 쓰고 실패를 본다.
- [ ] **Step 2**: 도메인·저장소·가져오기·문구를 구현해 통과시킨다(`pnpm typecheck`가 렌더러까지 녹색).
- [ ] **Step 3**: 생성기·E2E를 더하고 통과시킨다(`taskset -c 0-1 xvfb-run -a pnpm exec playwright test tests/e2e/images.spec.ts`).
- [ ] **Step 4**: ADR-0009 절, 전체 녹색.
- [ ] **Step 5**: 커밋 `feat(library): images are items — the five raster formats import by their header (a wrong extension does not matter), their size is read from the first MiB and stored with the asset, an image opens at { kind: 'image' }, and the image anchor (one region in the unrotated image's 0–1 space) is part of the anchor union`.

---

### Task 5: 쪽 글 저장소 — 추출 작업·쪽 글·본문 상태·본문 질의 (DB)

**Files:**
- Create: `D/body-search.ts`, `packages/domain/test/body-search.test.ts`, `DB/text-repository.ts`, `DB/body-search.ts`, `packages/db/test/text-repository.test.ts`, `packages/db/test/body-search.test.ts`
- Modify: `D/index.ts`, `D/library.ts`(`ItemDetail.text`), `DB/index.ts`, `DB/library-repository.ts`(`getItemDetail`이 `text`), `DB/trash.ts`(`removeUnusedAssets`가 작업과 함께 `page_texts`), `L/importer.ts`(`EXTRACTOR_VERSION = PDF_TEXT_EXTRACTOR`, PDF만 작업, payload — P-8), `packages/library/test/importer.test.ts:62`, `packages/db/test/trash.test.ts`, `packages/db/test/library-repository.test.ts`(상세 기대값에 `text`)

**Interfaces:**
- Produces:
  ```ts
  // D/body-search.ts
  export const PDF_TEXT_EXTRACTOR = 'pdf-text-1';
  export const extractKey = (sha256: string): string => `extract:${sha256}:${PDF_TEXT_EXTRACTOR}`;
  export const TEXT_LIMITS = {
    maxFileBytes: 512 * 1024 * 1024, maxPages: 5000, maxPageChars: 100_000, maxDocChars: 10_000_000,
    batchPages: 20, batchChars: 500_000, messageGapMs: 30_000, jobMs: 15 * 60_000, attempts: 3,
    emptyPerPage: 10, restartEvery: 50, idleMs: 30_000, startDelayMs: 5_000, likeChunk: 2000, pagesShown: 20,
  } as const;
  export type BodyTextFailure = 'locked' | 'damaged' | 'too-large' | 'gave-up';
  export type BodyTextState =
    | { state: 'pending' }
    | { state: 'done'; pages: number; truncated: boolean }
    | { state: 'empty'; pages: number }
    | { state: 'failed'; reason: BodyTextFailure };
  export interface ExtractPayload { sha256: string; type: 'pdf'; nextPage: number; pages: number | null; chars: number; truncated: boolean }
  export const MARK_START = '\ue000';
  export const MARK_END = '\ue001';
  export interface BodyWords { fts: string[]; like: string[] }   // ≥ 3 / = 2 code points
  export function bodyQueryWords(query: string): BodyWords;
  export const hasBodyWords = (w: BodyWords): boolean => w.fts.length + w.like.length > 0;
  export function ftsMatch(words: readonly string[]): string;   // '"a" AND "b"', 안의 " 는 둘로
  export function likePattern(word: string): string;            // `%…%`, \ % _ 는 \ 로
  /** 2글자 낱말만일 때의 조각(명세 5.6): 첫 일치 앞 20자·뒤 28자를 낱말 경계에서 자르고 자른 끝에 '…', 창 안의 모든 일치를 MARK로 감쌈. ASCII만 대소문자 무시. */
  export function likeSnippet(text: string, words: readonly string[]): string;
  // D/library.ts
  export interface ItemDetail { /* … */ text: BodyTextState | null }   // PDF가 아니면 null
  // DB/text-repository.ts
  export interface ExtractJob { id: string; sha256: string; payload: ExtractPayload; attempts: number }
  export class TextRepository {
    constructor(db: Db);
    backfill(now: string): number;                         // P-8, 한 트랜잭션, 더한 수
    requeueInterrupted(now: string): number;               // interrupted → queued (이 버전의 extract만)
    next(skip?: ReadonlySet<string>): ExtractJob | undefined;  // queued, created_at DESC·rowid DESC, 휴지통 아닌 PDF가 있는 sha만, skip은 sha
    start(jobId: string, now: string): { job: ExtractJob } | { gaveUp: true } | undefined;  // attempts ≥ 3이면 failed 'gave-up'
    opened(jobId: string, pages: number, now: string): boolean;
    writePages(jobId: string, from: number, texts: readonly string[], now: string): boolean;  // P-10
    finish(jobId: string, r: { pages: number; truncated: boolean }, now: string): void;
    fail(jobId: string, reason: BodyTextFailure, now: string): void;
    release(jobId: string, now: string): void;             // running → queued (시도는 이미 셈)
    hasLiveItem(sha256: string): boolean;
    stateOf(sha256: string): BodyTextState;                // P-9
    progress(): { done: number; total: number };           // P-9
    pageCount(sha256: string): number;
    itemIdsOfSha(sha256: string): string[];                // 휴지통 포함, 원본 자산으로 쓰는 자료
    jobs(): Array<{ sha256: string; state: string; attempts: number; nextPage: number; error: string | null }>;  // E2E 훅용
  }
  // DB/body-search.ts
  export function bodyItemIds(db: Db, words: BodyWords): string[];                          // words.fts가 하나 이상
  export function* bodyLikeChunks(db: Db, like: readonly string[], chunk?: number): Generator<string[], void, void>;  // 2글자만
  export function bodyPages(db: Db, sha256: string, words: BodyWords): { pages: Array<{ pageIndex: number; snippet: string }>; total: number };
  ```

요구 사항(명세 5.1·5.3 상태·5.5·5.6·5.7, P-8·P-9·P-10):
- `bodyQueryWords`: `query.normalize('NFC')` → `/\s+/u`로 나눔 → 빈 것 버림 → 같은 낱말 하나로 → 앞 8개 → 코드 포인트 길이(`[...w].length`)로 3 이상은 `fts`, 2는 `like`, 1은 버림.
- 공통 조인(휴지통 아닌 PDF 자료): `JOIN assets a ON a.sha256 = p.sha256 JOIN item_assets ia ON ia.asset_id = a.id AND ia.role = 'original' JOIN items i ON i.id = ia.item_id AND i.deleted_at IS NULL AND i.type = 'pdf'`.
- `bodyItemIds`: 명세 5.6의 `SELECT DISTINCT i.id FROM page_texts_fts f JOIN page_texts p ON p.id = f.rowid … WHERE page_texts_fts MATCH ? [AND p.text LIKE ? ESCAPE '\' …]`(`like` 낱말마다 하나).
- `bodyLikeChunks`: `MAX(id)`까지 `p.id > lo AND p.id <= lo + chunk` 범위마다 `SELECT DISTINCT i.id FROM page_texts p <공통 조인> WHERE … AND p.text LIKE ? ESCAPE '\' …`를 한 번씩 내준다.
- `bodyPages`: `fts`가 있으면 `snippet(page_texts_fts, 0, char(57344), char(57345), '…', 48)`와 `p.sha256 = ?`로 `ORDER BY p.page_index LIMIT 20` + 같은 조건의 `COUNT(*)`, 없으면 `page_texts`에서 `sha256 = ? AND text LIKE …` + `likeSnippet`.
- `writePages`: 한 트랜잭션 — 작업 행이 없거나 `running`이 아니면 `false`(아무것도 쓰지 않음). `payload.nextPage !== from`이면 던짐(버그). `from === 0`이면 그 sha의 옛 `page_texts`를 먼저 지움. `INSERT INTO page_texts (sha256, page_index, text)`(중복은 UNIQUE가 던짐 — 명세 5.7). `nextPage = from + texts.length`, `chars += Σ length`, `progress = pages ? nextPage / pages : NULL`.
- `trash.ts` `removeUnusedAssets`: `shas.length > 0`일 때 작업 지우기 바로 다음에 `DELETE FROM page_texts WHERE sha256 IN (SELECT value FROM json_each(?))`(트리거가 색인 행을 지운다).
- `getItemDetail`: `text: row.type === 'pdf' ? new TextRepository(this.db).stateOf(row.sha256) : null`.
- 가져오기: `job: kind.type === 'pdf' ? { id: newId(), kind: 'extract', dedupeKey: extractKey(sha256), payload: { sha256, type: 'pdf', nextPage: 0, pages: null, chars: 0, truncated: false } } : null`.

시험(핵심 코드):
```ts
// packages/domain/test/body-search.test.ts
it('splits a query into body words: NFC, one of each, the first eight, by code points; one letter is metadata only', () => {
  expect(bodyQueryWords('형 형광  현미경 형광 transduction')).toEqual({ fts: ['현미경', 'transduction'], like: ['형광'] });
  expect(bodyQueryWords('형광'.normalize('NFD'))).toEqual({ fts: [], like: ['형광'] });
  expect(bodyQueryWords('𝒜𝒜')).toEqual({ fts: [], like: ['𝒜𝒜'] });
  expect(bodyQueryWords('a b')).toEqual({ fts: [], like: [] });
  expect(bodyQueryWords('aaa bbb ccc ddd eee fff ggg hhh iii').fts).toHaveLength(8);
});
it('quotes an FTS phrase and escapes a LIKE pattern', () => {
  expect(ftsMatch(['say "hi"', 'cell'])).toBe('"say ""hi""" AND "cell"');
  expect(likePattern('5%_\\')).toBe('%5\\%\\_\\\\%');
});
it('cuts a two-letter snippet at word bounds around the first match and marks every match in it', () => {
  expect(likeSnippet('오늘 형광 현미경으로 세포를 봤다. 형광 신호.', ['형광'])).toBe('오늘 \ue000형광\ue001 현미경으로 세포를 봤다. \ue000형광\ue001 신호.');
  const long = `${'lorem ipsum '.repeat(10)}the Cy marker and cy again ${'dolor sit '.repeat(10)}`;
  const s = likeSnippet(long, ['cy']);
  expect(s.startsWith('…') && s.endsWith('…')).toBe(true);
  expect(s).toContain('\ue000Cy\ue001 marker and \ue000cy\ue001 again');
  expect(s.replace(/[…\ue000\ue001]/g, '').length).toBeLessThanOrEqual(20 + 2 + 28);
});
```
`text-repository.test.ts`(`freshDb`·`seedItem` from `./fixtures`):
- 중복 방지: 같은 sha의 관리 사본·외부 연결·중복 자료(`reuseAsset`) → `backfill` 두 번 → 그 sha의 작업 하나. 동영상·이미지 sha에는 없음.
- 순서: 세 sha를 `created_at` 다르게 → `next()`가 최신부터; 그 sha의 자료를 모두 휴지통으로 → 건너뜀; `skip`에 넣은 sha도.
- 시도: `start` → `running`·attempts 1 → `release` → 두 번 더 → 넷째 `start`가 `{ gaveUp: true }`이고 `stateOf`가 `{ state: 'failed', reason: 'gave-up' }`.
- 다시 실행: `running`을 `interrupted`로 바꾼 뒤 `requeueInterrupted` → `queued`, `next()`의 `payload.nextPage` 그대로.
- `writePages`: `from` 0이 옛 행을 지움, 이어 쓰기(`from` 20), 같은 쪽 다시 → 던짐, 작업을 지운 뒤 → `false`이고 행 그대로, `queued`인 작업 → `false`.
- `stateOf`: 작업 없음 → pending, `done`(nextPage 12, chars 500) → `{ done, pages: 12, truncated: false }`, chars 50 → `{ empty, pages: 12 }`, truncated → done, `failed`+`locked`.
- `progress`: PDF 자료 넷 — 살아 있는 셋(작업 done 하나·failed 하나·queued 하나)과 휴지통 하나(done) → `{ done: 2, total: 3 }`; 동영상·이미지는 세지 않음; 같은 sha의 중복 자료 둘은 둘로 셈(자료 기준).
`body-search.test.ts`(쪽 글은 시험이 `page_texts`에 직접 넣음, NFC):
- `"형광"`(2글자, `bodyLikeChunks` 합)과 `"현미경"`(FTS)이 쪽 0의 자료를 찾는다. `"trans"`가 `TRANSDUCTION`을, `"cafe"`가 `Café`를, `"école"`이 `ÉCOLE`을 찾는다(대소문자·발음 부호 — SQLite가 한다). NFD로 적은 질의도 `bodyQueryWords`를 거쳐 찾는다.
- 쪽 단위 AND: `형광 transduction`이 다른 쪽에 나뉜 문서는 없음, 한 쪽에 있는 문서는 있음.
- 휴지통 자료는 빠진다. 영구 삭제(`purgeTrash`) 뒤 `page_texts` 0행이고 `SELECT count(*) FROM page_texts_fts WHERE page_texts_fts MATCH '"현미경"'` 0.
- `bodyPages`: 30쪽 모두 일치 → `pages.length` 20, `total` 30, 쪽 순서, 조각에 `\ue000현미경\ue001`; 2글자만이면 `likeSnippet` 조각.
- `bodyLikeChunks(db, ['형광'], 2)`가 `ceil(행 수 / 2)`개를 내고 합이 한 번에 찾은 것과 같다.
- `trash.test.ts`: 마지막 자산이 떠날 때 그 sha의 `page_texts`가 지워지고 다른 자산이 남으면 그대로.

- [ ] **Step 1**: 시험을 쓰고 실패를 본다.
- [ ] **Step 2**: `D/body-search.ts`, `TextRepository`, `DB/body-search.ts`, 상세의 `text`, 영구 삭제, 가져오기의 작업을 구현해 통과시킨다.
- [ ] **Step 3**: 전체 녹색.
- [ ] **Step 4**: 커밋 `feat(db): page texts and their jobs — one pdf-text-1 extract job per file content (PDFs only, backfilled for older ones), newest first, three attempts, resumable batches that write only while their job still runs; the body state an item panel reads; body queries by FTS phrase or two-letter scan, page by page, trashed items out; a purge takes the page texts with the jobs`.

---

### Task 6: 추출 일꾼 — `utilityProcess` + pdf.js, 쪽 글 정리, 메시지, 프로세스 관리

**Files:**
- Create: `M/text/page-text.ts`(+ `page-text.test.ts`), `M/text/messages.ts`(+ `messages.test.ts`), `M/text/data-factory.ts`(+ `data-factory.test.ts`), `M/text/extract-document.ts`, `M/text/pdfjs-worker.d.ts`, `M/text/worker.ts`, `M/text/extractor.ts`(+ `extractor.test.ts`), `M/text/fork.ts`, `E/text-worker.spec.ts`
- Modify: `apps/desktop/electron.vite.config.ts`(`main.build.rollupOptions.input = { index: 'src/main/index.ts', 'text-worker': 'src/main/text/worker.ts' }` → `out/main/text-worker.js`), `M/index.ts`(추출기 만들기·`will-quit`에서 `dispose`, 훅에 넘김), `M/test-hooks.ts`(`extractFile`), `E/helpers.ts`(`extractFile`)

**Interfaces:**
- Consumes: Task 5 `TEXT_LIMITS`, `MARK_START/END`.
- Produces:
  ```ts
  // messages.ts
  export interface ExtractLimits { maxPages: number; maxPageChars: number; maxDocChars: number; maxFileBytes: number }
  export interface ExtractRequest { type: 'extract'; jobId: string; file: string; startPage: number; limits: ExtractLimits; assetsDir: string }
  export const workerMessage: z.ZodType<WorkerMessage>;   // 명세 5.2 표의 넷, 모두 .strict(), jobId z.uuid(), texts 1–20개·각 ≤ 100,000
  export type WorkerMessage =
    | { type: 'opened'; jobId: string; pages: number }
    | { type: 'pages'; jobId: string; from: number; texts: string[] }
    | { type: 'done'; jobId: string; pages: number; truncated: boolean }
    | { type: 'failed'; jobId: string; reason: 'locked' | 'damaged' | 'too-large' };
  /** zod + 순서 검사: 그 작업의 id, 'opened'가 한 번 먼저, from === 기대한 다음 쪽, from + texts.length ≤ pages, 묶음 글자 합 ≤ batchChars + maxPageChars. 틀리면 null. */
  export function checkWorkerMessage(raw: unknown, at: { jobId: string; nextPage: number; pages: number | null }): WorkerMessage | null;
  // page-text.ts
  export interface TextItemLike { str?: string; hasEOL?: boolean }
  export function cleanPageText(raw: string): string;                 // 명세 5.4
  export function guardStoredText(text: string, maxChars: number): string;  // main의 방어: MARK 지움 + 길이 자름
  // data-factory.ts — pdf.js BinaryDataFactory 자리(일꾼의 fs)
  export class FsDataFactory { constructor(o: { cMapUrl: string | null; standardFontDataUrl: string | null; wasmUrl?: string | null }); fetch(o: { kind: string; filename: string }): Promise<Uint8Array> }
  // extractor.ts
  export interface WorkerPort { readonly pid: number | undefined; postMessage(m: ExtractRequest): void; kill(): boolean; onMessage(fn: (m: unknown) => void): void; onExit(fn: (code: number) => void): void }
  export interface ExtractEvents { opened(pages: number): void; pages(from: number, texts: string[]): boolean | Promise<boolean> }  // false = 멈춤
  export type ExtractOutcome =
    | { kind: 'done'; pages: number; truncated: boolean }
    | { kind: 'failed'; reason: 'locked' | 'damaged' | 'too-large' }
    | { kind: 'crashed' } | { kind: 'timeout' } | { kind: 'bad-message' } | { kind: 'stopped' };
  export interface TextExtractor {
    run(req: Omit<ExtractRequest, 'type'>, events: ExtractEvents): Promise<ExtractOutcome>;  // 한 번에 하나
    stop(): void;      // 일꾼을 지금 죽임 → 도는 run은 'stopped'
    dispose(): void;   // 종료·라이브러리 전환
  }
  export function createTextExtractor(o: { fork: () => WorkerPort; timing?: Partial<{ messageGapMs: number; jobMs: number; restartEvery: number; idleMs: number }>; setTimer?: (fn: () => void, ms: number) => unknown; clearTimer?: (id: unknown) => void }): TextExtractor;
  // fork.ts (electron)
  export function forkTextWorker(entry: string): WorkerPort;   // utilityProcess.fork(entry, [], { serviceName: 'Learn 본문 색인', execArgv: ['--max-old-space-size=1024'], stdio: 'pipe' }), spawn 때 os.setPriority(pid, os.constants.priority.PRIORITY_BELOW_NORMAL), stdout·stderr는 resume()으로 버림
  export function pdfjsAssetsDir(mainDir: string): string;     // P-12: path.join(mainDir, '../renderer/pdfjs'), 없으면 개발 실행의 src/renderer/public/pdfjs
  // test hook
  extractFile(input: { file: string; startPage?: number; limits?: Partial<ExtractLimits> }): Promise<{ outcome: ExtractOutcome; opened: number | null; batches: Array<{ from: number; texts: string[] }> }>;
  ```

요구 사항(명세 5.2–5.4, P-11):
- `worker.ts`: `process.parentPort.on('message', (e) => void extractDocument(e.data as ExtractRequest, (m) => process.parentPort.postMessage(m)))`. 한 번에 한 요청(main이 그렇게 보낸다).
- `extract-document.ts`: 명세 5.2의 가짜 일꾼 방식 — `import * as pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs'`와 `import { getDocument, PasswordException, VerbosityLevel } from 'pdfjs-dist'`(패키지 진입점이 `build/pdf.mjs`), 그리고 `getDocument`를 처음 부르기 전에 `(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = pdfjsWorker`. ES 모듈의 `import`는 끌어올려지므로 할당은 import 사이가 아니라 함수 안에서 한다 — pdf.js는 일꾼을 만들 때 `globalThis.pdfjsWorker`를 읽는다(`pdf.mjs` 16367줄). 워커 경로에는 타입이 없으니 `M/text/pdfjs-worker.d.ts`(Create)에 `declare module 'pdfjs-dist/build/pdf.worker.mjs' { export const WorkerMessageHandler: unknown }`. pdf.js를 가져오는 것은 `extract-document.ts`와 `worker.ts`뿐이다 — `index.ts`·`extractor.ts`·`fork.ts`·`scheduler.ts`는 가져오지 않는다(main 번들과 냉시작). 단계: `fs.stat` 크기 > `maxFileBytes` → `failed: too-large` · 파일을 `Uint8Array`로 읽음 · `getDocument({ data, BinaryDataFactory: FsDataFactory, cMapUrl: `${assetsDir}/cmaps/`, cMapPacked: true, standardFontDataUrl: `${assetsDir}/standard_fonts/`, useWorkerFetch: false, isOffscreenCanvasSupported: false, isImageDecoderSupported: false, useWasm: false, disableFontFace: true, useSystemFonts: false, enableXfa: false, verbosity: VerbosityLevel.ERRORS })` · `PasswordException` → `locked`, 그 밖의 열기 실패 → `damaged` · `opened(numPages)` · `startPage`부터 `min(numPages, maxPages)`까지: `page.streamTextContent()`를 읽으며 `str`을 잇고 `hasEOL`은 `\n`, 날글자가 `maxPageChars`를 넘으면 리더를 `cancel()`하고 자름 → `cleanPageText` → 묶음(20쪽 또는 50만 자에 닿으면 `pages`로 보냄) · 문서 글자 합이 `maxDocChars`에 닿으면 멈추고 `truncated` · `page.cleanup()` · 끝에 남은 묶음과 `done({ pages: 색인한 쪽 수, truncated: numPages > maxPages || 글자 한도 })` · `finally`에서 `loadingTask.destroy()`. 계획 작성 중 Node 22 스크래치에서 이 옵션으로 `locked.pdf`가 `PasswordException`으로 거절됨을 확인했다(Node 24에서의 글 뽑기는 명세 5.2의 스파이크).
- `FsDataFactory.fetch`: `kind`가 `cMapUrl`·`standardFontDataUrl`이 아니거나 그 URL이 없거나 `filename`이 `/^[A-Za-z0-9._-]+$/`가 아니면 거절. 경로는 `path.join(base, filename)`이고 `path.relative(base, full)`이 `..`로 시작하면 거절. 읽은 것을 `Uint8Array`로.
- `cleanPageText(raw)`: (1) `[\ue000\ue001]` 지움, 공백이 아닌 제어 문자(`\p{Cc}` 가운데 `\t\n\v\f\r` 빼고)는 공백으로 (2) `/(\p{L})-\n(\p{L})/gu` → `$1$2` (3) `/\s+/gu` → `' '` (4) `trim()` (5) `normalize('NFC')`. 명세 5.4의 순서에서 표시·제어 문자 지우기를 앞으로 당겼다(끝에서 지우면 그 자리에 공백 둘이 남을 수 있다) — 결과 집합은 같다.
- 추출기(`extractor.ts`): 일꾼 하나를 살려 두고 `run`마다 요청 하나. 메시지는 들어온 순서대로 처리(비동기 `pages` 처리기는 앞의 것이 끝난 뒤 다음). `checkWorkerMessage`가 null → 일꾼 죽임, `bad-message`. `pages` 처리기가 `false` → 죽임, `stopped`. 메시지 사이 `messageGapMs`(30초), 작업 하나 `jobMs`(15분) 넘으면 죽임, `timeout`. 간격 시계는 처리할 메시지가 쌓여 있지 않고 끝 메시지(`done`·`failed`)를 아직 받지 않았을 때만 돈다 — main이 묶음을 붙들고 있는 동안(쓰기, E2E의 `textHold`)은 일꾼 탓이 아니다. 일꾼 종료 코드 ≠ 0(또는 `done`/`failed` 전 종료) → `crashed`. 실패·시간 초과·`stopped` 뒤와 `restartEvery`(50) 작업마다 다음 `run`은 새 일꾼. 일이 없는 `idleMs`(30초) 뒤 내림. `stop()`·`dispose()`는 죽임.
- `extractFile` 훅: 앱의 추출기로 `run`(jobId `newId()`, `assetsDir`는 `pdfjsAssetsDir(here)` — Task 7도 같은 값), 결과를 모아 돌려준다. DB에는 쓰지 않는다. 일꾼 진입점은 `path.join(here, 'text-worker.js')`.

시험:
- `page-text.test.ts`:
  ```ts
  it('joins a word broken at a line end, collapses whitespace, composes, and drops controls and the snippet marks', () => {
    expect(cleanPageText('The dominant sequence transduc-\ntion models')).toBe('The dominant sequence transduction models');
    expect(cleanPageText('state-of-the-art  1990-\n2000')).toBe('state-of-the-art 1990- 2000');
    expect(cleanPageText('  주의\n\n메커니즘은\t중요합니다.  ')).toBe('주의 메커니즘은 중요합니다.');
    expect(cleanPageText('한글'.normalize('NFD'))).toBe('한글');
    expect(cleanPageText('a\u0007b \ue000c\ue001')).toBe('a b c');
  });
  it('guards what is stored: marks gone, cut at the limit', () => {
    expect(guardStoredText('ab\ue000cd\ue001ef', 4)).toBe('abcd');
  });
  ```
- `messages.test.ts`: 받음(opened → pages from 0 → pages from 20 → done), 거부(다른 jobId, 'opened' 전 'pages', from 건너뜀, 21개 묶음, 100,001자 쪽, 묶음 합 600,001자, from + 개수 > pages, 모르는 키, `reason: 'bogus'`).
- `data-factory.test.ts`: 임시 폴더의 `cmaps/a.bcmap`을 읽음, `../x`·`a/b`·빈 이름·`wasmUrl`은 거절.
- `extractor.test.ts`(가짜 `WorkerPort`, `setTimer`/`clearTimer` 주입): 일꾼 하나로 작업 둘, 50번째 뒤 새로 fork, 메시지 간격 초과 → `timeout` + kill + 다음 run이 새 fork, 처리기가 붙들고 있는 동안은 간격이 지나도 죽이지 않음(양성 대조: 붙들지 않으면 죽임), 작업 시간 초과, 종료 코드 1 → `crashed`, 나쁜 메시지 → `bad-message`, `pages`가 `false` → `stopped`, 처리기가 Promise일 때 순서 유지, `stop()` → `stopped`, 30초 유휴 → kill.
- E2E `text-worker.spec.ts`(`extractFile` 도우미, Electron의 Node 24):
  - "korean.pdf in the utility process: three pages, NFC, page 2's decomposed text stored composed": `opened` 3, `texts[0]`에 `주의 메커니즘은 중요합니다.`, `texts[1] === texts[0]`, `texts[1] === texts[1].normalize('NFC')`, 셋째 쪽에 `왼쪽 단 주의 메커니즘은 중요합니다.`.
  - "paper-100: a word broken at a line end is one word; batches of at most 20 pages from startPage": `startPage` 0 → 쪽 1(인덱스 1)에 `sequence transduction models`, 묶음 `from` 0·20·40·60·80, `done` 100; `startPage` 60 → 첫 묶음 `from` 60.
  - "locked.pdf is locked; a text file named .pdf is damaged; a file over maxFileBytes is too-large": `limits: { maxFileBytes: 10 }`.
  - "limits stop early": `maxPages: 3` → `done { pages: 3, truncated: true }`, `maxDocChars: 100` → `truncated: true`.
  - "the worker is a utility process named Learn 본문 색인": `extractFile`을 기다리는 동안이 아니라 끝난 직후(유휴 30초 안) `app.evaluate(({ app }) => app.getAppMetrics())`에 `type: 'Utility'`, `serviceName: 'Learn 본문 색인'`인 항목이 있다.

- [ ] **Step 1**: 단위 시험을 쓰고 실패를 본다.
- [ ] **Step 2**: `page-text`, `messages`, `data-factory`, `extractor`를 구현해 통과시킨다.
- [ ] **Step 3**: `extract-document`, `worker`, `fork`, vite 입력, 훅을 구현하고 `pnpm build` 뒤 `out/main/text-worker.js`가 있는지, 그 번들이 `better-sqlite3`를 가져오지 않는지, `out/main/index.js`와 그것이 가져오는 조각에 pdf.js(`pdfjsVersion`)가 없는지 `grep`으로 보고 보고서에 적는다.
- [ ] **Step 4**: E2E를 쓰고 통과시킨다(`taskset -c 0-1`). 전체 녹색. `node scripts/check-licenses.mjs`가 일꾼 번들의 pdf.js 고지를 받는지 본다(명세 15절).
- [ ] **Step 5**: 커밋 `feat(text): the body-text worker — a utility process (Learn 본문 색인, below-normal priority) that opens one PDF with pdf.js in-process, reads each page's text within the page and document limits, joins line-end hyphens, composes to NFC and sends batches; main checks every message with zod and owns the process (one kept, renewed after failures, timeouts and fifty jobs, gone after thirty idle seconds)`.

---

### Task 7: 추출 일정 — main 연결·한도·다시 실행·휴지통·알림·시험 훅

**Files:**
- Create: `M/text/scheduler.ts`(+ `scheduler.test.ts`), `M/text/seed-body-text.ts`(+ `seed-body-text.test.ts`), `E/body-search.spec.ts`
- Modify: `M/library-context.ts`(`text: TextRepository`), `M/library-check.ts`(`StartCheckDeps.onChecked?(): void` — 첫 `runCheck` 뒤, 던져도 `finally`에서; + `library-check.test.ts`, P-29), `M/index.ts`(일정기·첫 유휴·시작 점검·가져오기 끝·작업 줄·`onBroadcast`·종료), `D/events.ts`(`LibraryChangeReason`에 `'text'`, `LearnEventMap['search:progress']`), `D/event-channels.ts`(`'search:progress': 'evt:search-progress'`), `P/main.ts`(`events`에 `'search:progress'`), `R/data/libraryChange.ts`(+ `libraryChange.test.ts`), `R/data/queries.ts`(새 무효화 둘), `M/test-hooks.ts`, `E/helpers.ts`, `F/generate.mjs`(`no-text.pdf`, `search-30.pdf`), `F/README.md`

**Interfaces:**
- Consumes: Task 5 `TextRepository`, `TEXT_LIMITS`, `extractKey`; Task 6 `TextExtractor`, `guardStoredText`, `pdfjsAssetsDir`.
- Produces:
  ```ts
  // scheduler.ts
  export interface TextScheduler {
    firstIdle(): void;                 // ui:reportIdle 첫 번째
    startupChecked(): void;            // 시작 점검의 첫 runCheck가 끝남(P-29) — 둘 다 온 뒤 startDelayMs 지나 시작
    wake(): void;                      // 가져오기 끝, 복원, 작업 줄이 빔
    libraryChanged(reason: LibraryChangeReason): void;  // trash·restore·purge
    control(mode: 'pause' | 'resume' | 'now'): void;     // E2E ('now'는 지연을 건너뛰지만 시작 점검은 기다린다)
    hold(afterPages: number | null): void;               // E2E: 쓴 쪽 수가 afterPages 이상이 된 묶음 뒤 다음 묶음 쓰기를 붙듦; null은 붙든 것을 풀고 지움
    held(): boolean;
    idle(): Promise<void>;             // 살아 있는 PDF의 queued 작업이 없고 도는 것이 없을 때
    stats(): { batchMs: number[]; pagesWritten: number; activeMs: number };
    dispose(): void;                   // 일꾼 죽임; running 행은 다음 시작 점검에서 interrupted
  }
  export function createTextScheduler(d: {
    repo(): TextRepository | null;
    extractor: TextExtractor;
    laneBusy(): boolean;
    laneIdle(): Promise<void>;
    file(sha256: string): string | null;     // P-14
    assetsDir: string;
    announce(itemIds: string[]): void;       // libraryChanged{text}
    progress(p: { done: number; total: number }): void;   // 부르는 쪽이 createThrottle(…, 1000)
    paused: boolean;                         // P-13
    now?(): string;
    delay?(ms: number): Promise<void>;
  }): TextScheduler;
  // seed-body-text.ts
  export interface SeedBodyTextInput { docs: number; pages: number; chars: number; seed: number }
  export function bodyTextPage(seed: number, doc: number, page: number, chars: number): string;   // 결정적 합성 글
  export function seedBodyText(deps: SeedAssetsDeps, input: SeedBodyTextInput): { itemIds: string[]; sha256: string[] };
  // D/events.ts
  export type LibraryChangeReason = /* 지금 것 */ | 'text';
  // LearnEventMap
  'search:progress': { done: number; total: number };
  // 훅 (LearnTestHooks) — E/helpers.ts에 같은 이름의 도우미
  seedBodyText(input: SeedBodyTextInput): { itemIds: string[]; sha256: string[] };
  textExtraction(mode: 'pause' | 'resume' | 'now'): void;
  textIdle(): Promise<void>;
  pageTextCount(input: { itemId: string } | { sha256: string }): number;
  textJobs(): ReturnType<TextRepository['jobs']>;
  textHold(input: { afterPages: number | null }): void;
  textHeld(): boolean;
  textStats(): ReturnType<TextScheduler['stats']>;
  ```

요구 사항(명세 5.1–5.3·5.7, P-10·P-12·P-13·P-14):
- 깨어날 때마다(첫 번째 포함) `requeueInterrupted` + `backfill`, 그다음 루프: 멈춤이거나 `laneBusy()`면 `laneIdle()`/`wake`를 기다림 → `repo.next(skip)` → 없으면 `progress` 한 번 + `idle` 풀어 줌 → `file(sha)`가 null이면 skip에 넣고 다음(P-14) → `start` → `gaveUp`이면 `announce(itemIdsOfSha)` → `extractor.run({ jobId, file, startPage: payload.nextPage, limits, assetsDir }, events)`:
  - `opened(pages)` → `repo.opened`.
  - `pages(from, texts)` → 시간을 재며 `repo.writePages(jobId, from, texts.map((t) => guardStoredText(t, maxPageChars)), now)`; `false`면 멈춤(P-10). 쓴 뒤 `progress` 요청. `hold`의 쪽 수를 넘겼으면 풀릴 때까지 `await`.
  - 결과: `done` → `finish`; `failed` → `fail(reason)`; `crashed`·`timeout`·`bad-message`·`stopped` → `release`. 끝난 작업마다 `announce(repo.itemIdsOfSha(sha))`(`stopped`·`release`는 상태가 그대로라 알리지 않음).
- `libraryChanged('trash')`: 도는 작업의 sha가 `!repo.hasLiveItem(sha)`면 `extractor.stop()`(작업은 `queued`로 남음). `'restore'` → `wake()`. `'purge'` → 도는 작업이면 `extractor.stop()`(행이 지워졌으면 `release`는 아무것도 하지 않음 — `WHERE state = 'running'`).
- 일꾼을 처음 깨우는 때: `firstIdle()`과 `startupChecked()`가 모두 온 뒤 `startDelayMs`(5초, `'now'`는 지연만 건너뜀 — P-29). 가져오기 실행이 끝나면 `wake()`. `M/index.ts`는 `startLibraryCheck(ctx, { …, onChecked: () => text.startupChecked() })`; 라이브러리가 열리지 않아 점검이 없으면 일정기도 없다.
- `M/index.ts`: `ctx`가 열린 뒤 `const text = createTextScheduler({ repo: () => ctx?.text ?? null, extractor, laneBusy: () => jobs.busy() !== null, laneIdle: () => jobs.idle(), file, assetsDir: pdfjsAssetsDir(here), announce: (itemIds) => broadcast('libraryChanged', { reason: 'text', itemIds }), progress: throttled, paused: e2e && process.env['LEARN_TEXT_EXTRACTION'] !== 'run' })`. `file(sha)`: `ctx.repo.findAssetsBySha(sha)`(관리 사본 먼저)에서 `availability === 'available'`인 첫 자산의 `resolveAssetPath(ctx.layout, asset)`이고 `fs.existsSync`. `deps.prepareSettings`에서 `text.firstIdle()`, `imports.onFinished`에서 `text.wake()`, `onBroadcast`의 `libraryChanged` trash·restore·purge → `text.libraryChanged`, `will-quit`에서 `text.dispose()`를 `ctx.db.close()` 앞에. 진행 밀어 넣기: `createThrottle(() => broadcast('search:progress', ctx.text.progress()), 1000)`, 루프가 쉴 때 `flush()`.
- 렌더러 `createChangeHandler`(데이터 층, 화면 없음): `reason === 'text'` → `for (id) d.invalidateDetail(id)`; `d.invalidateBody()`; 끝(목록을 다시 읽지 않음). `import`·`trash`·`restore`·`purge`에서도 `d.invalidateBody()`. `queries.ts`: `invalidateDetail: (id) => invalidateQueries({ queryKey: keys.detail(id) })`, `invalidateBody: () => invalidateQueries({ queryKey: ['search'] })`.
- `seedBodyText`(명세 13절, J31): `seedAssets(deps, { rows })`(제목 `본문 ${i + 1}`, `createdAt` 내림차순)로 PDF 자료 `docs`개와 가짜 파일을 만들고, 한 트랜잭션 묶음(1,000쪽마다 커밋)으로 `page_texts`(`bodyTextPage(seed, doc, page, chars)`)와 `done` 작업(`payload.nextPage = pages`, `chars = pages × chars`)을 넣는다. `bodyTextPage`: LCG `x = (1103515245 * x + 12345) % 2 ** 31`(시드 `seed * 1_000_003 + doc * 1009 + page`), 낱말을 공백으로 이어 `chars`자에서 자름, 다섯 번에 한 번 한국어 표에서:
  ```ts
  const EN = ['signal', 'transduction', 'protein', 'receptor', 'membrane', 'kinase', 'pathway', 'expression', 'cellular', 'molecular',
    'analysis', 'method', 'result', 'sample', 'structure', 'function', 'binding', 'activity', 'response', 'control', 'model', 'network',
    'sequence', 'genome', 'enzyme', 'inhibitor', 'phosphorylation', 'regulation', 'microscopy', 'fluorescence', 'imaging', 'tissue',
    'neuron', 'synapse', 'channel', 'ligand', 'assay', 'culture', 'antibody', 'dynamics'];
  const KO = ['형광', '세포', '현미경', '단백질', '신호', '관찰', '기록', '분석', '실험', '결과', '조직', '신경', '수용체', '효소', '유전자', '발현', '구조', '기능', '반응', '표본'];
  ```
  ("zq"·"xylophone"은 어디에도 없다.)
- 생성기: `no-text.pdf`(pdf-lib, 2쪽, 도형만 — `drawRectangle`·`drawCircle`, 글 없음), `search-30.pdf`(pdf-lib Helvetica 30쪽, 쪽마다 `Page N: fluorescence signal transduction`; 한국어 줄 "형광 현미경 관찰 기록 N"은 `korean.pdf`처럼 Pretendard를 통째로 넣는다).

시험:
- `scheduler.test.ts`(진짜 `TextRepository`(`:memory:` + `migrate`) + 가짜 `TextExtractor`가 정해진 결과·묶음을 냄 + 가짜 `delay`): 첫 유휴 전에는 시작하지 않음 · 첫 유휴가 와도 시작 점검 전에는 시작하지 않음(`'now'`여도) · 둘 다 온 뒤 5초 뒤 시작, `'now'`는 바로 · `hold(40)` → 40쪽 뒤 `held()` 참 → `hold(null)` → 이어서 끝남 · 작업 줄이 바쁘면 새로 시작하지 않고(양성 대조: 비면 시작) 도는 것은 끝까지 · 최근 작업 먼저 · `done`/`failed(locked)`/`crashed`(→ queued, 시도 1) · 세 번 crash 뒤 `gave-up`과 `announce` · `writePages`가 `false`면 `stop` · 휴지통 → stop → queued, 복원 → 이어서 `nextPage`부터 · 영구 삭제 → stop · `interrupted` → 깨울 때 queued · 파일 없는 sha는 건너뛰고 다른 작업은 돎 · `paused`면 `control('resume')` 전까지 아무것도 · `idle()`이 마지막 작업 뒤 풀림.
- `seed-body-text.test.ts`: `bodyTextPage(42, 0, 0, 4000)`의 길이 4000, 같은 인자 같은 글, 한국어 낱말 비율 0.15–0.25(공백으로 나눈 낱말 기준), `zq`·`xylophone` 없음.
- `libraryChange.test.ts`: `text` → `invalidateDetail`(각 id)·`invalidateBody`만, `invalidateAll` 0회 · `import` → `invalidateBody` 1회.
- E2E `body-search.spec.ts`(이 작업은 백엔드 다섯):
  - "E2E starts paused; resumed, korean.pdf is indexed and its detail says done": 양성 대조 순서 — 가져온 뒤 `textJobs()`에 그 sha의 `queued` 작업 하나(PDF만: 같이 가져온 동영상·이미지에는 작업 없음) → `textExtraction('now')` → `textIdle()` → `pageTextCount({ itemId })` 3, `window.learn.library.detail({ itemId })`의 `text`가 `{ state: 'done', pages: 3, truncated: false }`. "멈춘 채로 머문다"는 시간에 걸린 부정 확인이라 E2E에 두지 않고 `scheduler.test.ts`(가짜 `delay`)가 지킨다.
  - "locked.pdf fails as locked, no-text.pdf is empty": `{ state: 'failed', reason: 'locked' }`, `{ state: 'empty', pages: 2 }`.
  - "a SIGKILL mid-extraction resumes on relaunch with exact page counts": `paper-100.pdf` → `textHold({ afterPages: 40 })` → `now` → `expect.poll(textHeld)` true → `hardKill` → 다시 `launch`(같은 라이브러리·userData) → `textExtraction('now')` → `textIdle` → `pageTextCount` 100, 시도 2.
  - "trash stops the running job and restore resumes it; purge removes the page text": `paper-100.pdf` → `textHold({ afterPages: 40 })` → `now` → `textHeld` 참 → 휴지통(`trashItems`) → `textJobs`의 그 작업 `queued`, 상세 `pending` → `textHold({ afterPages: null })`(풀고 지움 — 그대로 두면 이어서 다시 붙든다) → 복원 → `textIdle` → `done`·`pageTextCount` 100 → 휴지통 → 영구 삭제 → `pageTextCount({ sha256 })` 0.
  - "progress notices": `page.evaluate`에서 `window.learn.on('search:progress', (p) => …)`로 모으고(helpers.ts:443의 `learn.on` 방식) 색인하는 동안 받은 값마다 `done ≤ total`, 마지막 값이 `done === total`.

- [ ] **Step 1**: 단위 시험을 쓰고 실패를 본다.
- [ ] **Step 2**: 일정기·`seedBodyText`·변경 처리기를 구현해 통과시킨다.
- [ ] **Step 3**: `index.ts` 연결, 이벤트·preload, 훅·도우미, 생성기.
- [ ] **Step 4**: E2E를 쓰고 통과시킨다(`taskset -c 0-1`). 전체 녹색(멈춤 기본이라 기존 시험의 시간이 그대로인지 증거 실행 값을 앞 실행과 비교해 보고서에).
- [ ] **Step 5**: 커밋 `feat(text): body text extraction runs in the background — after the window's first idle, one file at a time while the work line is free, newest imports first, resumed from the next page after a crash or a kill, stopped when its PDF goes to the trash and removed with a purge; the item's body state and the index progress are announced`.

---

### Task 8: 본문 검색 IPC (`search:*`)와 `search-perf` 측정

**Files:**
- Create: `M/text/search.ts`(+ `search.test.ts`), `M/ipc/search.ts`(+ `search.test.ts`), `V/search-perf.evidence.ts`
- Modify: `D/ipc-channels.ts`(`search: { body: 'search:body', pages: 'search:pages', progress: 'search:progress' }`), `D/ipc.ts`(입력 스키마, `LearnApi.search`), `M/ipc/channel-kinds.ts`(셋 다 `MAIN`), `M/ipc/all.ts`(`registerSearchIpc`), `P/main.ts`(`search: ['body', 'pages', 'progress']`), `E/helpers.ts`(`distinctCopies`), `V/perf.evidence.ts:33`(냉시작 실행에 `env: { LEARN_TEXT_EXTRACTION: 'run' }`)

**Interfaces:**
- Consumes: Task 5 `bodyQueryWords`, `bodyItemIds`, `bodyLikeChunks`, `bodyPages`, `TextRepository.progress`; Task 7 `seedBodyText`, `textExtraction`, `textIdle`, `textStats`.
- Produces:
  ```ts
  // D/ipc.ts
  export const bodySearchInput = z.object({ query: z.string().normalize('NFC').max(200) }).strict();
  export const bodyPagesInput = z.object({ itemId: z.uuid(), query: z.string().normalize('NFC').min(1).max(200) }).strict();
  // LearnApi
  search: {
    body(input: z.input<typeof bodySearchInput>): Promise<Result<{ itemIds: string[]; searched: boolean }>>;  // 앞 요청은 CANCELLED
    pages(input: z.input<typeof bodyPagesInput>): Promise<Result<{ pages: Array<{ pageIndex: number; snippet: string }>; total: number }>>;
    progress(): Promise<Result<{ done: number; total: number }>>;
  };
  // M/text/search.ts
  export async function searchBody(db: Db, query: string, signal: AbortSignal, chunk?: number): Promise<{ itemIds: string[]; searched: boolean }>;
  export function searchPages(db: Db, repo: LibraryRepository, itemId: string, query: string): { pages: Array<{ pageIndex: number; snippet: string }>; total: number };
  // M/ipc/search.ts
  export function registerSearchIpc(handle: Handle, deps: IpcDeps, impl?: { searchBody: typeof searchBody; searchPages: typeof searchPages }): void;
  // E/helpers.ts
  export function distinctCopies(dir: string, source: string, count: number): string[];   // distinctPdfs의 일반형(끝에 주석 한 줄)
  ```

요구 사항(명세 5.6, 10절 IPC 표, P-15):
- `searchBody`: `bodyQueryWords` → 본문 낱말이 없으면 `{ itemIds: [], searched: false }`. `fts`가 있으면 `bodyItemIds` 한 문장 뒤 `signal.aborted`면 `LearnError('CANCELLED', …)`. 2글자만이면 `bodyLikeChunks`의 덩어리 사이마다 `await new Promise((r) => setImmediate(r))`, 그 뒤 `signal`을 보고 취소면 `CANCELLED`. 결과는 `Set`으로 합쳐 배열.
- `ipc/search.ts`: `search:body`는 창(`event.sender.id`)마다 `AbortController` 하나 — 새 요청이 오면 앞의 것을 `abort()`, 끝나면 자기 것만 지움. `search:pages`: `repo.getItemDetail(itemId)`(휴지통 자료도 읽힘) → PDF가 아니면 `{ pages: [], total: 0 }`, 아니면 `bodyPages(db, file.sha256, words)`. `search:progress`: `ctx.text.progress()`.
- `CANCELLED`의 문구는 `mainStrings`에 있는 취소 문구를 쓴다(렌더러는 버린다 — 화면에 나오지 않음).
- `search-perf.evidence.ts`(`@perf`, 명세 13절): `launch` → `seedBodyText({ docs: 1000, pages: 12, chars: 4000, seed: 42 })`(걸린 시간을 기록) → 렌더러에서 `window.learn.search.body({ query })`의 왕복을 `performance.now()`로: 질의 7종(`형광`·`세포`·`zq`·`현미경`·`transduction`·`단백질 신호`·`xylophone`) × 20 = 140표본, 각 질의의 첫 번째(캐시 없는 첫 질의)를 따로 → p95 ≤ 300(`limitFailures`, CI는 2배). `search.pages`는 질의 7종 × 무작위(LCG 시드 7) 자료 20개 → p95 ≤ 100. DB 크기(`library.sqlite` + `-wal`의 `fs.statSync`), 같은 시험에서 `distinctCopies(dir, paper-100.pdf, 20)`을 가져와 `textExtraction('now')` → 색인하는 동안 표를 스크롤(`perf.evidence.ts`의 1만 항목 스크롤과 같은 rAF 간격 방식) → p95 ≤ 16.7 → `textIdle` → `textStats()`로 처리량(쪽/초)과 묶음 트랜잭션 중앙값·최대. `writeJson('search-perf.json', { budgetMs: { body: 300, pages: 100, scrollP95: 16.7 }, values, firstQueryMs, dbBytes, seedMs, throughput, batchMs, overBudget, platform }, …)`. 
- 냉시작 줄: 기존 시험이 `LEARN_TEXT_EXTRACTION=run`으로 띄워 일정기가 살아 있는 채 app-ready ≤ 1.5초(그대로)를 본다.

시험:
- `search.test.ts`(`:memory:` + `migrate` + 쪽 글 직접): 1글자뿐 → `searched: false`; 3글자·2글자·섞임; 2글자만에서 `chunk: 2`로 덩어리를 여럿 만든 뒤, 첫 덩어리 뒤에 `abort()` → `CANCELLED`; 끝까지 가면 한 번에 찾은 것과 같음.
- `M/ipc/search.ts`는 `M/ipc/register.test.ts`·`all.test.ts`가 채널 집합을 지킨다(`all.test.ts`의 기대에 셋이 들어감). `preload/surfaces.test.ts`가 preload와 `CHANNEL_KINDS`를 맞춘다.
- `M/ipc/search.test.ts`(`reader.test.ts`와 같은 틀: `vi.mock('electron')`, `createHandle(null)`, `fakeSender`): `registerSearchIpc(handle, deps, impl)`의 셋째 인자로 가짜 `searchBody`(받은 `signal`을 기록하고 시험이 푸는 Promise를 기다리다가 `signal.aborted`면 `LearnError('CANCELLED')`)를 넣어 — 같은 창의 둘째 요청이 첫째의 `signal`을 멈추고 첫째 답이 `{ ok: false, code: 'CANCELLED' }`, 둘째는 `ok`; 다른 창(`fakeSender(2, 'main')`)의 요청은 첫째를 멈추지 않음(양성 대조 먼저); 끝난 요청은 표에서 빠짐. 입력 검사: 201자 질의·`itemId`가 UUID 아님·모르는 키 → `VALIDATION_FAILED`.
- E2E `body-search.spec.ts`에 더함 "the page's search API answers from the index": `seedBodyText({ docs: 20, pages: 12, chars: 400, seed: 1 })` → `learn.search.body({ query: '형광' })`의 `searched: true`·`itemIds`가 시드 자료의 부분집합이고 비지 않음, `{ query: '형' }` → `searched: false`, `learn.search.pages({ itemId: 그 itemIds의 첫 것, query: '형광' })`의 `pages`가 쪽 순서이고 조각에 `\ue000`, `learn.search.progress()`가 `{ done: 20, total: 20 }`.

- [ ] **Step 1**: 단위 시험을 쓰고 실패를 본다.
- [ ] **Step 2**: `searchBody`·`searchPages`, 채널·스키마·preload를 구현해 통과시킨다.
- [ ] **Step 3**: E2E 줄과 `search-perf.evidence.ts`를 쓰고 Linux에서 돌려 값을 보고서에(`taskset -c 0-1 xvfb-run -a -s "-screen 0 1440x900x24" pnpm exec playwright test -c playwright.evidence.config.ts search-perf`).
- [ ] **Step 4**: 전체 녹색.
- [ ] **Step 5**: 커밋 `feat(search): body search over IPC — search:body (one per window, the older answered CANCELLED, two-letter scans yielding between chunks), search:pages with marked snippets and the total, search:progress; search-perf measures 1,000 PDFs (body p95 against 300 ms, pages against 100 ms), the table's scroll while twenty papers index, throughput and the DB size`.

---

### Task 9: 성능 P1–P5 · P7 · P8 · P10 (명세 6절)

**Files:**
- Create: `R/organize/patch.ts`(+ `patch.test.ts`), `R/library/ScopeViewContext.tsx`
- Create(시험): `packages/domain/test/organize-wire.test.ts`
- Modify: `D/organize.ts`, `D/ipc.ts`(`library.organize`의 답 타입, `tags.togglePosition`의 답), `M/ipc/library.ts:80`, `M/ipc/organize.ts:63`, `R/organize/useOrganize.ts:13`, `E/helpers.ts:1317`(`organizeSnapshot`이 풂), `V/organize-perf.evidence.ts:182-192`(바이트), `DB/organize-query.ts`(+ `packages/db/test/organize-query.test.ts`), `M/index.ts`(메뉴 읽기·건너뛰기·`__learnMenuBuilds`·시트 준비), `M/sheets.ts`(+ `sheets.test.ts`), `R/tags/tagActions.ts`, `R/data/libraryChange.ts`(+ 시험), `R/data/queries.ts`, `R/library/search.ts`(+ `search.test.ts`), `R/library/useSearch.ts`, `R/library/tagField.ts`(+ `tagField.test.ts`), `R/library/useScopeView.ts`, `R/library/useLibraryRows.ts:24`, `R/app/MainWindow.tsx:318`, `R/inspector/InfoPane.tsx:60`, `R/tags/TagSelector.tsx:39`, `R/tags/TagFilterEmpty.tsx:27`, `R/library/LibraryTable.tsx`(행 메모·스크롤 처리기), `E/menus.spec.ts`, `E/tags.spec.ts`, `V/perf.evidence.ts`(스크롤 중 행 렌더 수)

**Interfaces:**
- Produces:
  ```ts
  // D/organize.ts (P1, P-18)
  export interface OrganizeWire {
    collections: OrganizeCollection[]; tags: OrganizeTag[];
    itemIds: string[];                          // members·tagged가 가리키는 항목, 한 번씩
    members: Record<string, Uint32Array>;       // itemIds의 번호, 저장 순서
    tagged: Record<string, Uint32Array>;
    duplicates: string[][]; trashCount: number;
  }
  export function packOrganize(s: OrganizeSnapshot): OrganizeWire;
  export function unpackOrganize(w: OrganizeWire): OrganizeSnapshot;
  export function organizeWireBytes(w: OrganizeWire): number;
  // DB/organize-query.ts (P2, P-17)
  export function readMenuOrganize(db: Db): OrganizeSnapshot;
  // tags:togglePosition 답 (P3, P-16)
  { tagId: string; assigned: boolean; itemIds: string[] } | null
  // R/organize/patch.ts (P3)
  export function withTagged(s: OrganizeSnapshot, tagId: string, itemIds: readonly string[], assigned: boolean): OrganizeSnapshot;
  // R/data/libraryChange.ts (P3, P10) — ChangeDeps에 더함(Task 7의 invalidateDetail·invalidateBody 다음)
  whenIdle(fn: () => void, ms: number): () => void;     // 실제는 R/ui/whenIdle.ts
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(id: unknown): void;
  now(): number;
  // 답의 모양이 바뀜(queries.ts의 onLibraryChanged가 .onChange를 쓴다)
  export function createChangeHandler(d: ChangeDeps): {
    onChange(change: LearnEventMap['libraryChanged']): void;
    /** import:finished: 미뤄 둔 전체 다시 읽기를 지금 유휴로. */
    flushImports(): void;
    /** 렌더러가 스스로 고친 변경: 같은 이유·같은 itemIds 집합의 다음 알림 하나를 다시 읽지 않는다. */
    expectEcho(reason: 'tags', itemIds: readonly string[]): void;
  };
  // R/library/search.ts (P3)
  export function retagIndex(index: SearchIndex, prev: TagNames, next: TagNames): SearchIndex | null;   // 바뀐 항목이 50개 넘으면 null(전체 다시)
  // R/library/ScopeViewContext.tsx (P5)
  export function ScopeViewProvider(props: { view: ScopeView; children: ReactNode }): JSX.Element;
  export function useScopeViewContext(): ScopeView;
  // M/sheets.ts (P7, P-19)
  SheetHost.prepare(parent: BrowserWindow): void;
  SheetHost.payloadFor(contents: WebContents): Promise<SheetPayload>;   // 미리 만든 창은 open까지 붙듦
  ```

요구 사항(명세 6절의 각 줄):
- **P1**: `ipc/library.ts:80`이 `packOrganize(readOrganizeSnapshot(db))`, `useOrganize`가 `unpackOrganize`. `organize-perf`의 바이트(P-18):
  ```ts
  const w = r.data;
  const arrays = [...Object.values(w.members), ...Object.values(w.tagged)];
  const bytes = new TextEncoder().encode(JSON.stringify({ ...w, members: Object.keys(w.members), tagged: Object.keys(w.tagged) })).length + arrays.reduce((n, a) => n + a.byteLength, 0);
  ```
  목표 ≤ 50ms, ≤ 800,000 B.
- **P2**: `menuOrganize()`가 `readMenuOrganize(ctx.db)`; `onBroadcast`의 다시 만들기는 `collections`·`tags` 알림 가운데 `itemIds`가 없는 것만. E2E 전용 `globalThis.__learnMenuBuilds`(isE2E일 때만 `installAppMenu`에서 하나씩).
- **P3**: `tagActions.togglePosition` → 답의 `itemIds`로 `queryClient.setQueryData(keys.organize, (s) => s && withTagged(s, tagId, itemIds, assigned))` + `changes.expectEcho('tags', itemIds)`(`queries.ts`가 처리기를 내보낸다); 처리기는 `tags` 알림의 `itemIds`가 기다리던 것과 같은 집합이면 한 번 소비하고 `invalidateOrganize`를 하지 않는다(기다림은 5초 뒤 버린다 — 알림이 오지 않은 경우). 검색 색인: `searchIndexFor`가 같은 목록·텍스트이고 태그 맵만 바뀌었으면 `retagIndex`로 짧은 부분의 바뀐 항목 태그 필드만 갈아 끼운다(뒤 항목의 `starts`·`titleEnds`를 차이만큼 옮기고 `short`·`initials`를 그 자리에서 이어 붙임). 목표 `1` 키 하나 붙임 ≤ 100ms.
- **P4**: `tagNamesFor`가 항목별 이름을 이름순(`a < b`)으로 정렬해 잇는다 — 색만 바뀌어 모델의 태그 순서가 바뀌어도 같은 맵이 돌아온다.
- **P5**: `MainWindow`가 지금처럼 `useScopeView(viewList)`를 한 번 부르고 `ScopeViewProvider`로 내린다. `useLibraryRows`·`InfoPane`·`TagSelector`·`TagFilterEmpty`는 `useScopeViewContext()`(트래시 보기의 목록이 다르게 들어가는 곳이 있으면 그 목록이 `viewList`와 같은지 확인하고 보고서에). `useScopeView` 안에 `countRender('useScopeView')`.
- **P7**: 첫 유휴(`prepareSettings`)에서 `sheets.prepare(mainWindow)`. `show()`는 `payload.kind === 'shortcuts'`이고 그 부모의 준비된 창이 살아 있고 로드를 마쳤으면 그 창을 쓴다: `pending`에 넣고 붙든 `payloadFor`를 풀어 주고, 높이는 지금처럼(키가 있으면 기억한 높이, 없으면 `contentHeight` → `fontsReady` → 다시 잼) 잰 뒤 보인다. 준비된 창은 `dom-ready`를 이미 지났으므로 측정은 `payloadFor`를 푼 직후에 시작한다. 닫히면 1,000ms 뒤 다시 `prepare`. 메인 창이 닫히면 준비된 창도 닫는다(`settingsWindow.discardPrepared()`와 같은 자리). 목표 ⌘/ 시트 열기 중앙값 ≤ 250ms(`perf.evidence.ts:84` 시험이 잰다).
- **P8**: 표의 행 컴포넌트를 `memo`로(항목 객체·선택 여부·표시 열·밀도·제목 일치가 같으면 다시 그리지 않음 — 비교 함수), 스크롤 처리기에서 `getBoundingClientRect`·`offsetHeight` 같은 레이아웃 읽기를 없애고(가상화기의 값 사용) 행 렌더에 `countRender('LibraryRow')`. 그 밖의 일은 CDP 성능 추적(`page.context().newCDPSession(page)` → `Tracing.start`/`Tracing.end`, 1만 항목 표를 스크롤하는 동안)으로 찾고, 찾은 것과 고친 것을 보고서에. 목표 p95 ≤ 16.7ms(Linux CI 판정).
- **P10**: `createChangeHandler`의 `import` 이유: 전체 다시 읽기를 1,000ms에 최대 한 번(첫 것은 바로 유휴로 미룸) + 끝에 한 번, 실행은 `d.whenIdle(everything, 1000)`. `import:finished`에서 `flushImports()`. 다른 이유는 그대로.

시험:
- 도메인: `unpackOrganize(packOrganize(s))`가 `s`와 같다(빈 맵·중복 없는 `itemIds`); 1만 항목·컬렉션 200 × 150·태그 50 × 400의 합성 스냅샷에서 `organizeWireBytes` ≤ 800,000이고 `JSON.stringify(s).length`의 절반 아래.
- `organize-query.test.ts`: `readMenuOrganize`의 컬렉션·태그가 `readOrganizeSnapshot`의 것과 같고 나머지는 비었다.
- `patch.test.ts`: 붙임은 합집합(이미 있던 것 중복 없음), 뗌은 빼고 비면 키가 없다, 다른 태그는 같은 배열(참조 그대로).
- `libraryChange.test.ts`(주입한 `setTimer`·`whenIdle`·`now`): 300ms 안에 `import` 다섯 → `invalidateAll` 0회 → 유휴 콜백에서 1회 → 1,100ms 뒤 여섯째 → 1회 더 → `flushImports()`가 기다리는 것을 바로; 양성 대조 먼저 — `expectEcho` 없이 `tags{itemIds:[a,b]}` → `invalidateOrganize` 1회, 그다음 `expectEcho('tags', [b, a])` 뒤 같은 알림 → 0회, 한 번 더 → 1회(한 번만 소비), 다른 집합 → 1회.
- `search.test.ts`: `retagIndex(buildSearchIndex(items, texts, a), a, b)`의 `short`·`initials`·`starts`·`titleEnds`·`plainTitle`이 `buildSearchIndex(items, texts, b)`와 같다(한 항목, 첫 항목, 마지막 항목, 태그가 없던 항목), 51개 바뀜 → null.
- `tagField.test.ts`: 두 태그의 색(자리)만 바꾼 모델 → 같은 `TagNames` 참조.
- `sheets.test.ts`(기존 `FakeWindow`): `prepare` 뒤 ⌘/ `open`이 새 창을 만들지 않고 준비된 창을 보인다, 그 창의 `payloadFor`는 `open` 전까지 풀리지 않는다, 닫힌 뒤 1,000ms에 다시 준비, `duplicate` 종류는 준비된 창을 쓰지 않는다.
- E2E `menus.spec.ts` "the menu bar is rebuilt for a new tag, not for tagging items (m-1)": 양성 대조 — 태그 만들기 → `__learnMenuBuilds` +1 → `quietLibraryCalls` → 항목에 태그 붙이기 → 그대로.
- E2E `tags.spec.ts` "key 1 patches the snapshot: no library:organize read follows": `ipcCalls` 비교 — 붙인 뒤 `quietLibraryCalls`까지 `library:organize` 0회(양성 대조: 태그 이름 바꾸기는 1회).
- E2E `library.spec.ts` 또는 `table.spec.ts` "the scope view is computed once per window render": `watchRenders` 뒤 보기 전환 → `renderCounts().useScopeView`가 `MainWindow`의 증가와 같다.
- 증거: `organize-perf`(P1·P3·P4 줄), `perf.evidence.ts`(⌘/ 시트, 검색 입력, 스크롤, 토스트 그리기 — P6·P7·P8·P9), `p1-perf`(토스트 p95, P10). Linux 값을 이전 값(`acceptance.md` AC16 줄)과 나란히 보고서에.

- [ ] **Step 1**: 단위 시험을 쓰고 실패를 본다.
- [ ] **Step 2**: P1·P2를 구현해 통과시키고 `organize-perf`를 돌려 값을 본다.
- [ ] **Step 3**: P3·P4·P5·P10을 구현해 통과시킨다.
- [ ] **Step 4**: P7·P8을 구현하고 E2E·증거를 돌린다.
- [ ] **Step 5**: 전체 녹색, 커밋 `perf: the organise snapshot travels as one id table and index arrays, the menu bar reads only collections and tags and is not rebuilt for memberships, key 1 patches the snapshot and swaps one tag field in the search index, a colour change keeps the tag names, the scope view is computed once, the ⌘/ sheet window waits prepared, table rows are memoised, and import notices re-read the list at most once a second when idle`.

---

### Task 10: M7b 입력 — 목차 현재 항목 스크롤 · 탭 패널 연결 · 시험 대기 정리 (명세 7절)

**Files:**
- Modify: `R/viewers/pdf/outline.ts`(+ `outline.test.ts`), `R/viewers/pdf/OutlineTree.tsx`, `R/shell/TabBar.tsx`, `R/viewers/ReaderTabs.tsx:67-73`, `R/library/LibraryView.tsx`(라이브러리 내용 감싸개의 `role="tabpanel"`), `E/reader-pdf.spec.ts`, `E/tabs.spec.ts`, `E/history.spec.ts`, `E/view-modes.spec.ts`
- Test: 위 E2E, `outline.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // outline.ts
  /** 가상 목록에서 행 `index`를 nearest로 보이게 하는 scrollTop, 이미 보이면 null. */
  export function outlineScrollTarget(o: { index: number; rowHeight: number; scrollTop: number; viewport: number }): number | null;
  export const OUTLINE_FOLLOW_PAUSE_MS = 2000;
  ```
- 속성: 탭 `id="tab-<itemId>"`(라이브러리 `tab-library`), 마운트된 패널이 있는 탭만 `aria-controls="tabpanel-<itemId>"`; 패널 `id="tabpanel-<itemId>"` + `aria-labelledby="tab-<itemId>"`(지금의 `aria-label`을 바꿈); 라이브러리 내용 `role="tabpanel"` + `id="tabpanel-library"` + `aria-labelledby="tab-library"`(탭 줄이 있을 때만 — 리더 탭이 없으면 탭 줄이 없다).

요구 사항(명세 7절, P-26):
- 목차: 보일 때(썸네일 → 목차 전환, 리더를 열 때)와 `current`가 바뀔 때 현재 행의 펼친 목록 안 번호로 `outlineScrollTarget`을 계산해 트리의 스크롤 요소(`[data-testid="pdf-outline"]`)의 `scrollTop`을 맞춘다. 사용자의 휠·스크롤 막대·키 스크롤(`wheel`·`pointerdown` 뒤 `scroll`) 뒤 2초 동안은 따라가지 않는다. 행을 누른 뒤에는 현재 항목이 그 행이 아니어도(같은 쪽의 하위 항목) 현재 행을 보인다.
- 대기 정리: `waitForTimeout`을 조건 기다림으로 — `tabs.spec.ts` 10곳(214, 271, 278, 486, 596, 688, 929, 987, 992, 1257), `history.spec.ts` 4곳(178, 180, 201, 221), `view-modes.spec.ts` 7곳(158, 173, 229, 236, 262, 290, 397), `reader-pdf.spec.ts:713`(M7b가 더한 것 — `git diff a45a141 4e57fad`로 확인한 목록; `position.spec.ts`에는 M7b가 더한 대기가 없다). 저장 디바운스를 기다리던 것은 `reader:getPosition` 폴링, 화면 변화는 속성·`__learnReader` 상태 폴링. "없음"을 확인하던 대기는 같은 경로의 "있음"을 먼저 확인한 뒤에만 남기고 이유를 주석으로. 줄 번호는 `mac-flakes` 병합 뒤 다시 센다.

시험:
- `outline.test.ts`: 위에 있음 → 그 행 위끝, 아래에 있음 → 행 아래끝이 창 아래끝, 보임 → null, 0 아래로 내려가지 않음.
- E2E `reader-pdf.spec.ts`(`long-outline.pdf`, 1024로도): "the outline scrolls its current entry into view": 목차 보기 → 쪽 필드 6 ↩ → 현재 행(`[aria-current="location"]`)의 상자가 트리 상자 안 → 목차를 맨 위로 휠 → 2초 안에 쪽 필드 5 ↩ → 현재 행이 바뀌었는데(속성으로 확인) 스크롤은 맨 위 그대로(같은 경로가 따라가는 것을 앞에서 봤다) → `expect.poll`로 2초 뒤 다음 쪽 이동에서는 다시 따라감.
- E2E `tabs.spec.ts` "tabs and panels are linked": 리더 탭 둘 → 각 탭의 `aria-controls`가 있는 패널의 `id`, 패널의 `aria-labelledby`가 탭의 `id`, 라이브러리 내용의 `role="tabpanel"`, 다섯째 탭으로 내려간 탭에는 `aria-controls`가 없음, `expectNoSeriousA11y(page, 'tab strip with panels')`. 키보드 여정의 탭 줄 구간이 그대로 통과.

- [ ] **Step 1**: `outline.test.ts`와 E2E 둘을 쓰고 실패를 본다.
- [ ] **Step 2**: 목차 스크롤과 탭 패널 연결을 구현해 통과시킨다. 투어 기준 PNG가 바뀌지 않는지 `tour.spec`을 돌려 본다(바뀌면 P-1대로 멈추고 보고).
- [ ] **Step 3**: (`mac-flakes` 병합·main 병합 뒤) 대기 정리. 고친 spec을 각각 `taskset -c 0-1`로 세 번씩 돌려 흔들림이 없는지 본다.
- [ ] **Step 4**: 전체 녹색, 커밋 둘 — `fix(reader): the outline keeps its current entry in view (not while the user scrolls it, for two seconds); tabs and their panels are linked (ids, aria-controls on mounted panels, aria-labelledby, the library content a tab panel)` · `test(e2e): the M7b specs wait on state, not on time — saves by the stored position, scenes by their attributes; a check that something is absent comes after the same path showed it present`.

---

### Task 11: 이미지 리더 — 무대·맞춤·확대 ▾·이동·회전·자리·진행·끝 상태 (목업 승인 뒤)

**Files:**
- Create: `R/viewers/image/imageFit.ts`(+ `imageFit.test.ts`), `R/viewers/image/imageView.ts`(+ `imageView.test.ts`), `R/viewers/image/ImageReader.tsx`, `R/viewers/image/ImageToolbar.tsx`, `R/viewers/image/ImageZoomField.tsx`, `R/viewers/image/ImageZoomMenu.tsx`, `R/styles/screens/image-viewer.css`
- Modify: `R/viewers/ViewerHost.tsx:90,125,133`(이미지 리더·`ReaderFrame`의 이미지 틀; `noPages`는 이미 PDF가 아니면 `'none'`), `R/viewers/ReaderTabs.tsx:59`(포커스 대상에 `.image-stage`), `R/viewers/pdf/readerStore.ts`(P-21), `R/viewers/pdf/readerActions.ts`, `R/viewers/readerScope.tsx`(`__learnImage`), `R/app/MainWindow.tsx:374-436`(`imageOpen` 보고), `R/commands/registry.ts`(`contextOf`의 `imageOpen`), `D/commands.ts`(`CommandContextState.imageOpen`, 규칙, `stateLabels.reader`, `LabelState`, `commandLabel`), `D/ipc.ts`(`commandContextInput.imageOpen`), `M/menu/app-menu.ts:72-84`(+ `app-menu.test.ts`), `packages/domain/test/commands.test.ts`, `R/strings/reader.ts`, `R/styles/index.ts`(새 CSS를 잇는 곳), `F/generate.mjs`(`broken.png` = PNG 머리 33바이트 + 0 바이트 몸, `photo-4032.jpg` = ffmpeg `testsrc2=size=4032x3024` 한 프레임 `-q:v 3`), `F/README.md`, `E/images.spec.ts`, `E/helpers.ts`(`imageState`), `V/reader-perf.evidence.ts`

**Interfaces:**
- Consumes: Task 4 locator `image`, `LibraryItem.imageSize`; Task 2·M7b `usePosition`, `ReaderScope`.
- Produces:
  ```ts
  // imageFit.ts
  export type Rotation = 0 | 90 | 180 | 270;
  export type ImageZoom = 'fit' | 'width' | number;
  export interface Size { width: number; height: number }
  export interface Point { x: number; y: number }
  export const IMAGE_MARGIN = 24;
  export const IMAGE_ZOOM_MIN = 0.05;
  export const IMAGE_ZOOM_MAX = 8;
  export const IMAGE_ZOOM_STEPS: readonly number[] = [0.05, 0.1, 0.17, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8];
  export const clampImageZoom: (scale: number) => number;
  export function rotatedSize(natural: Size, rotation: Rotation): Size;
  export function fitScale(natural: Size, rotation: Rotation, stage: Size, mode: 'fit' | 'width'): number;  // fit은 min(1, …), width는 키움, 사방 24, 5–800%
  export function nextImageZoom(current: number, dir: 1 | -1): number;
  export function imagePinchFactor(current: number, deltaY: number): number | null;  // exp(-deltaY/100), 5–800%
  export function parseImageZoomInput(text: string): number | null;                 // 퍼센트, 5–800으로 자름
  export interface ImageLayout { scale: number; box: Size; content: Size; offset: Point }  // box = 회전·배율 뒤 그림, content = max(stage, box + 2×24)
  export function imageLayout(natural: Size, rotation: Rotation, stage: Size, scale: number): ImageLayout;
  /** 무대 점 `at`(무대 px) 아래의 회전 전 이미지 점(0–1로 자름). */
  export function pointAt(l: ImageLayout, rotation: Rotation, scroll: Point, at: Point): Point;
  /** 회전 전 이미지 점 `p`가 무대 점 `at`에 오는 스크롤(0–최대로 자름). */
  export function scrollFor(l: ImageLayout, rotation: Rotation, stage: Size, p: Point, at: Point): Point;
  // imageView.ts
  export interface ImageView { zoom: ImageZoom; cx: number; cy: number; rotation: Rotation }
  export const DEFAULT_IMAGE_VIEW: ImageView;   // { zoom: 'fit', cx: 0.5, cy: 0.5, rotation: 0 }
  export function imageViewFrom(locator: ReadingLocator | undefined): ImageView;
  export function imageLocator(v: ImageView): Extract<ReadingLocator, { kind: 'image' }>;   // 기본값 필드는 뺌, fit이면 cx/cy 뺌
  // readerStore.ts (P-21)
  export interface ImageState { status: 'loading' | 'shown' | 'error'; zoom: ImageZoom; scale: number; rotation: Rotation; natural: Size | null }
  export interface ImageViewHandle { zoomIn(): void; zoomOut(): void; setZoom(z: ImageZoom): void; rotate(delta: 90 | -90): void }
  // ReaderStore에 더함
  image: ImageState | null; imageHandle: ImageViewHandle | null; setImage(p: Partial<ImageState> | null): void; setImageHandle(h: ImageViewHandle | null): void;
  // D/commands.ts
  CommandContextState.imageOpen?: boolean;        // 이미지가 그려진 리더 탭이 보일 때만
  CommandSpec.stateLabels.reader?: { image: string };
  export type LabelState = Partial<Pick<CommandContextState, 'sidebar' | 'inspector' | 'scope' | 'duplicateGroups' | 'view' | 'selectionCount' | 'imageOpen'>>;
  // window.__learnImage (e2e=1) / E/helpers.ts
  window.__learnImage = { getState(): (ImageState & { itemId: string; cx: number; cy: number }) | null };
  export const imageState = (page: Page) => page.evaluate(() => window.__learnImage!.getState());
  ```

요구 사항(명세 4.1–4.4, 9절):
- 화면: 리더 도구 막대 44(`aria-label` "이미지 도구", 가운데 `ImageZoomField` + 확대 ▾; 오른쪽 보기 ▾는 Task 12가 더한다 — 이 작업에서는 그리지 않는다, 가짜 금지) 위에 무대 `<div className="image-stage" role="region" aria-label="이미지" tabIndex={0} data-testid="image-stage">`(스크롤 영역) 안에 `<img decoding="async" alt={item.title} style="image-orientation: from-image">`. 승인 목업의 모양.
- 왼쪽 사이드바(목업 ⑦의 답): '쪽 없음' 안내면 고칠 것이 없다(`ViewerHost`의 `noPages`가 PDF가 아니면 이미 `'none'`, `ViewerHost.tsx:90`). 소유자가 '자동 접기'를 골랐으면 이미지 탭이 보이는 동안 사이드바를 접고(저장하지 않는 보기 상태 — `useShell`의 사이드바 설정을 바꾸지 않음) 다른 탭으로 가면 원래대로, E2E 한 줄을 더한다.
- 상태: 여는 중 = 무대 바탕만, 컨트롤 비활성, 확대 필드 "…", 툴팁 "이미지를 여는 중입니다", 저장된 자리를 적용하기 전에는 `img`를 `visibility: hidden`. 그림 = `img.decode()` 뒤 `naturalWidth/Height`(EXIF 적용 값이 정본)로 배치하고 보임. 그릴 수 없음 = `decode()` 거절 또는 `error` → `ImageErrorNotice`(`ReaderNotices.tsx`의 `PdfErrorNotice`·`FileButtons` 모양, 아이콘 `ImageOff`, 명세 11절 문구, 도구 막대 없음). 원본 없음·휴지통은 지금 `ViewerHost`가 그린다.
- 맞춤·확대(명세 4.2): 모드 셋, ⌘+/⌘−는 무대 가운데의 이미지 점을 지킴(`pointAt` → 새 배율 → `scrollFor`), 핀치(`wheel` + `ctrlKey`, `preventDefault`)는 포인터 아래 점을 지킴, 맞춤 모드에서 확대하면 숫자 배율. 창·패널 크기가 바뀌면 맞춤 모드만 다시 맞춤(`ResizeObserver`, 프레임당 한 번), 숫자 배율은 그대로. 가린 탭(`useReaderShown() === false`)은 관찰에 반응하지 않고, 다시 보일 때 무대 크기가 다르면 맞춤 모드만 한 번(M7a N-1).
- 확대 ▾(`ImageZoomMenu`, 웹 팝업 메뉴, 레지스트리에서만): 창에 맞춤(`reader.zoomPageFit`) · 너비에 맞춤(`reader.zoomPageWidth`) · 실제 크기 ⌘0(`view.textReset`) · — · 확대 ⌘+(`view.textBigger`) · 축소 ⌘−(`view.textSmaller`), 지금 모드 체크. 이름은 `commandLabel(c, platform, { view: 'viewer', imageOpen: true })`.
- 이동·회전(명세 4.3): 무대는 보통의 스크롤 영역(화살표 40px·PageUp/Down·스페이스·Home/End·휠은 브라우저 기본). 그림이 무대보다 클 때만 왼쪽 단추 끌기(포인터 캡처, `cursor: grab`/`grabbing` — `data-pannable`), 다 들어오면 끌기·커서 없음. 맞춤 모드는 가운데. ⌘R/⌘L은 90° 단위, 회전 뒤에도 같은 이미지 점이 가운데.
- 자리와 진행(명세 4.4, P-22): `usePosition(item, { kind: 'debounce', ms: 300 }, () => latest)`; 확대·스크롤·회전이 바뀔 때 `update(imageLocator(view), null)`. 복원은 `imageViewFrom(pos.saved?.locator)`를 그림을 보이기 전에 적용. 첫 그림에서 마운트마다 한 번 `api().reader.savePosition({ itemId, revisionId, locator: imageLocator(view), progress: 1 })`. 그릴 수 없으면 저장하지 않는다.
- 명령(명세 9절, J29): `imageOpen` 규칙 `pdfOrImage = (c) => c.pdfOpen === true || c.imageOpen === true`를 `view.textBigger`·`view.textSmaller`·`view.textReset`(리더일 때), `reader.zoomPageWidth`, `reader.zoomPageFit`, `reader.rotateCw`·`reader.rotateCcw`에. `reader.zoomAuto`·쪽 색·스크롤·펼침·찾기·쪽 이동·뒤로/앞으로·`view.toggleInspector`는 PDF만 그대로. `reader.zoomPageFit`에 `stateLabels: { reader: { image: '창에 맞춤' } }`, `commandLabel`이 `state.imageOpen`이면 그 이름(`view` 앞). `menuLabelState`가 `imageOpen`을 싣고 `menuLabelsChanged`가 그것을 비교한다. `MainWindow`: `imageOpen = useReader((s) => s.image?.status === 'shown')`를 리더 탭이 보일 때 보고.
- `readerActions`(P-21): `zoom`·`setZoom`·`rotate`가 `imageHandle`이 있으면 그리로.
- 문구(`R/strings/reader.ts`, 명세 11절): 도구 막대 "이미지 도구", 무대 "이미지", 여는 중 "이미지를 여는 중입니다", 확대 ▾ 다섯, 끝 상태 제목·본문.

시험:
- `imageFit.test.ts`:
  ```ts
  const stage = { width: 1000, height: 700 };
  test('fit never enlarges a small image; width does; both keep 24 on every side and follow the rotation', () => {
    expect(fitScale({ width: 4032, height: 3024 }, 0, stage, 'fit')).toBeCloseTo(652 / 3024, 6);
    expect(fitScale({ width: 4032, height: 3024 }, 90, stage, 'fit')).toBeCloseTo(652 / 4032, 6);
    expect(fitScale({ width: 200, height: 100 }, 0, stage, 'fit')).toBe(1);
    expect(fitScale({ width: 200, height: 100 }, 0, stage, 'width')).toBeCloseTo(952 / 200, 6);
    expect(fitScale({ width: 100, height: 100 }, 0, stage, 'width')).toBe(8);
    expect(fitScale({ width: 400_000, height: 10 }, 0, stage, 'fit')).toBe(0.05);
  });
  test('a smaller picture sits in the middle; a larger one gets 24 around it', () => {
    expect(imageLayout({ width: 200, height: 100 }, 0, stage, 1)).toEqual({ scale: 1, box: { width: 200, height: 100 }, content: stage, offset: { x: 400, y: 300 } });
    expect(imageLayout({ width: 2000, height: 1000 }, 90, stage, 1).content).toEqual({ width: 1048, height: 2048 });
  });
  test.each([0, 90, 180, 270] as const)('the point under the stage centre survives scrollFor → pointAt at %i°', (r) => {
    const l = imageLayout({ width: 4000, height: 3000 }, r, stage, 0.5);
    const at = { x: 500, y: 350 };
    const p = { x: 0.3, y: 0.6 };
    const back = pointAt(l, r, scrollFor(l, r, stage, p, at), at);
    expect(back.x).toBeCloseTo(0.3, 6);
    expect(back.y).toBeCloseTo(0.6, 6);
  });
  test('a quarter turn clockwise puts the top-left corner top-right', () => {
    const l = imageLayout({ width: 100, height: 100 }, 90, { width: 148, height: 148 }, 1);
    expect(pointAt(l, 90, { x: 0, y: 0 }, { x: 124 - 1e-9, y: 24 })).toEqual({ x: expect.closeTo(0, 6), y: expect.closeTo(0, 6) });
  });
  test('steps, pinch and the field stay within 5–800 %', () => {
    expect(nextImageZoom(0.2156, 1)).toBe(0.25);
    expect(nextImageZoom(0.05, -1)).toBe(0.05);
    expect(nextImageZoom(8, 1)).toBe(8);
    expect(imagePinchFactor(8, -50)).toBeNull();
    expect(parseImageZoomInput('1000%')).toBe(8);
    expect(parseImageZoomInput('3')).toBe(0.05);
    expect(parseImageZoomInput('abc')).toBeNull();
  });
  ```
  더해서: 스크롤이 0 아래·최대 위로 가지 않음(`scrollFor`가 자름).
- `imageView.test.ts`: `imageLocator(DEFAULT_IMAGE_VIEW)` = `{ kind: 'image' }`, fit이면 cx/cy 빠짐, 숫자 배율은 cx/cy/rotation 실림, `imageViewFrom(undefined)`·PDF locator → 기본, 왕복.
- `commands.test.ts`: `imageOpen`이면 확대·맞춤·회전 가용, `reader.zoomAuto`·쪽 색·찾기 꺼짐; `commandLabel(zoomPageFit, 'darwin', { view: 'viewer', imageOpen: true })` = "창에 맞춤", PDF는 "한 쪽 전체 보기". `app-menu.test.ts`: `menuLabelsChanged`가 `imageOpen`만 바뀌어도 참.
- E2E `images.spec.ts`(1024로도, 명세 14절 목록 가운데 배경·패널 밖 전부): 열기(맞춤 기본, `imageState().zoom === 'fit'`, 큰 사진 배율 < 1) · ⌘+/⌘−/⌘0(`runMenuCommand`, 배율 계단·가운데 점 유지 ±0.01) · 확대 ▾(너비에 맞춤 → 세로 스크롤 생김) · 작은 이미지(GIF 24×16)의 창에 맞춤은 배율 1 · 핀치(합성 `wheel` `ctrlKey` `deltaY: -100` → 배율 × e, 포인터 아래 점 유지) · 끌기(배율 4에서 `page.mouse` 끌기 → `scrollLeft` 바뀜; 맞춤에서는 `data-pannable` 없음 — 양성 대조 뒤) · 화살표 → 스크롤 40 · ⌘R/⌘L(회전과 가운데 점) · 탭을 닫고 ⇧⌘T · `app.close()` 뒤 다시 실행 · `hardKill` 뒤 다시 실행 → 같은 확대·중심·회전(±0.01) · 진행 열 "✓ 완료"(그림이 보인 뒤) · `broken.png`의 끝 상태(`data-testid="image-error"`, 제목, Finder에서 보기, 진행 열이 100%가 아님) · 원본 없음(관리 사본 지우고 열기)·휴지통 탭 · EXIF 방향 6 JPEG의 `natural`이 40×60 · 키보드(탭을 열면 무대에 포커스, F6로 무대 → 탭 줄) · 가린 탭은 창 크기가 바뀌어도 맞추지 않고 보이면 한 번(배율이 다시 맞춘 값).
- `reader-perf.evidence.ts`에 줄 "image tab open → first frame with the picture": `photo-4032.jpg`를 열고 탭 누름 → `imageState().status === 'shown'` 다음 rAF까지(5회 중앙값·최대) ≤ 500(J30, CI 2배).

- [ ] **Step 1**: `imageFit`·`imageView`·`commands` 단위 시험 → 실패 → 구현 → 통과.
- [ ] **Step 2**: E2E를 쓰고 실패를 본다.
- [ ] **Step 3**: 리더·도구 막대·확대 ▾·store·actions·맥락·`__learnImage`를 구현해 통과시킨다.
- [ ] **Step 4**: 성능 줄, 전체 녹색 + `images.spec` 1024. 투어 기준 PNG는 Task 16.
- [ ] **Step 5**: 커밋 `feat(reader): the image reader — fit to the window (never enlarged), fit the width or a zoom of 5–800 % from the field, the zoom menu, ⌘+ ⌘− ⌘0 and a pinch; scroll, arrow keys and dragging when the picture is larger than the stage; ⌘R and ⌘L keep the centre; the zoom, centre and rotation return with the tab, and a first picture marks it read; a picture that cannot be drawn says so`.
- 컨트롤러: 디자인 비평(목업 ②·③ 대 투어 PNG).

---

### Task 12: 이미지 보기 ▾와 배경 (목업 승인 뒤)

**Files:**
- Create: `R/viewers/image/ImageViewMenu.tsx`
- Modify: `D/commands.ts`(`IMAGE_BACKGROUNDS`, 명령 셋), `D/submenus.ts`(`SubmenuSpec.id`에 `'imageBackground'`, 묶음), `M/menu/submenus.ts:154,189`(`case 'imageBackground':`), `D/settings.ts`(`reader.imageBackground`), `packages/domain/test/settings.test.ts`, `packages/domain/test/submenus.test.ts`, `packages/domain/test/commands.test.ts`, `R/commands/registry.ts`(핸들러, `CommandEnv.setImageBackground`), `R/commands/icons.ts`, `R/viewers/image/ImageReader.tsx`·`ImageToolbar.tsx`(보기 ▾, `data-bg`), `R/viewers/image/imageView.ts`(`effectiveBackground` + 시험), `R/design/tokens.ts`(토큰 넷 → `pnpm tokens`), `R/styles/screens/image-viewer.css`, `R/strings/reader.ts`, `E/images.spec.ts`, `E/commands-coverage.spec.ts`(`M7C_COMMANDS`, 줄 740의 비교), `docs/decisions/0007-settings-and-preferences.md`(`reader.imageBackground`)

**Interfaces:**
- Produces:
  ```ts
  // D/commands.ts
  export const IMAGE_BACKGROUNDS = ['light', 'dark', 'checker'] as const;
  export type ImageBackground = (typeof IMAGE_BACKGROUNDS)[number];
  // 명령: reader.imageBackgroundLight '밝게' · reader.imageBackgroundDark '어둡게' · reader.imageBackgroundChecker '체크무늬'
  //   paletteLabel '배경: 밝게' 등, contexts ['viewer'], 규칙 imageOpen, 메뉴 자리 없음(묶음이 가짐)
  // D/submenus.ts
  { id: 'imageBackground', label: '배경', commands: ['reader.imageBackgroundLight', 'reader.imageBackgroundDark', 'reader.imageBackgroundChecker'], menu: { menu: 'view', group: 5, order: 6 } }
  // D/settings.ts
  'reader.imageBackground': z.enum(IMAGE_BACKGROUNDS)   // 없으면 테마
  // imageView.ts
  export function effectiveBackground(stored: ImageBackground | undefined, theme: 'light' | 'dark'): ImageBackground;
  // E/commands-coverage.spec.ts
  const M7C_COMMANDS: readonly CommandId[] = ['reader.imageBackgroundLight', 'reader.imageBackgroundDark', 'reader.imageBackgroundChecker'];
  // CommandEnv
  setImageBackground(bg: ImageBackground): void;   // saveSetting('reader.imageBackground', bg)
  ```

요구 사항(명세 4.3·9절·12절 토큰, J8·J28):
- 보기 ▾(`ImageViewMenu`, 승인 목업): 배경 ▸(밝게 · 어둡게 · 체크무늬, 쓰이는 값 체크 — 저장값이 없으면 테마의 것) · — · 시계 방향으로 회전 ⌘R · 반시계 방향으로 회전 ⌘L. 메뉴 막대 보기 메뉴에는 "배경 ▸" 하위 메뉴(체크 없음 — 쪽 색 ▸와 같은 규칙).
- 무대 `data-bg="light|dark|checker"` → 배경 `--image-bg-light`/`--image-bg-dark`/체크무늬(`--image-checker-a`/`-b` 8px). 토큰 값은 승인 목업의 값(테마와 무관).
- `commands-coverage.spec.ts`: `M7C_COMMANDS`를 만들고 이미지를 연 탭에서 메뉴로 모두 실행(실행 기록), 줄 740의 기대를 `[...M7A_COMMANDS, ...M7B_COMMANDS.filter((id) => id.startsWith('reader.')), ...M7C_COMMANDS].sort()`로, `M7C_COMMANDS`의 "레지스트리에 있음·여기서 실행함·다른 시험에 넘기지 않음" 세 줄(M7B 줄과 같은 모양).
- ADR-0007: `reader.imageBackground`(라이브러리마다, 없으면 테마).

시험:
- 단위: `effectiveBackground(undefined, 'dark')` = `'dark'`, 저장값이 이김; `submenuProblems(COMMANDS, SUBMENUS)` = `[]`; 설정 스키마(모르는 값 거부); 명령 가용성(`imageOpen`일 때만).
- E2E `images.spec.ts`: 배경 셋(보기 ▾ → 배경 ▸ → 체크무늬 → `data-bg`와 다시 실행 뒤에도), 저장값 없을 때 테마 따라(라이트 → `light`, 다크 → `dark` — `launch(..., { colorScheme: 'dark' })`), 메뉴 막대의 `reader.imageBackgroundDark`(`runMenuCommand`).
- `commands-coverage.spec.ts` 통과.

- [ ] **Step 1**: 단위 시험 → 실패 → 명령·묶음·설정·토큰 → 통과.
- [ ] **Step 2**: E2E → 실패 → 보기 ▾·무대 배경 → 통과.
- [ ] **Step 3**: 명령 전수, ADR-0007, 전체 녹색 + 1024.
- [ ] **Step 4**: 커밋 `feat(reader): the image view menu — 배경 ▸ light, dark or a checkerboard (the app theme's until one is chosen, one setting per library), the two rotations; 배경 ▸ in the menu bar's 보기; the M7c command ledger`.
- 컨트롤러: 디자인 비평(목업 ①·② `menu=view*` 대 투어 PNG).

---

### Task 13: 라이브러리의 이미지 (목업 승인 뒤)

**Files:**
- Create: `R/library/itemIcon.ts`(+ `itemIcon.test.ts`), `R/inspector/ImagePreview.tsx`
- Modify: `R/library/LibraryTable.tsx:146`, `R/palette/Palette.tsx:283`, `R/shell/TabBar.tsx:183`, `R/dnd/DragPreview.tsx:14`, `R/inspector/InfoPane.tsx:131`, `R/inspector/InfoHead.tsx:30-38`(종류 줄 + 미리보기), `R/inspector/TrashInfo.tsx:65`, `R/sheets/DuplicateSheet.tsx:53`, `R/inspector/summary.ts`(+ `summary.test.ts`), `R/shell/drop.ts`(+ `drop.test.ts`), `R/strings/drop.ts`(`image: '이미지'`), `R/strings/library.ts:25,29`(`emptyBody1`, `formats`), `R/strings/inspector.ts`(`imageKind`, `reading.viewed`, `kindCount`의 이미지), `R/inspector/fileFacts.ts:70`(이미지는 탐침하지 않음), `R/inspector/readingLine.ts`(+ `readingLine.test.ts`), `R/styles/screens/inspector.css`, `E/images.spec.ts`, `E/drop.spec.ts`, `E/library.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export function itemIcon(type: ItemType): LucideIcon;   // pdf FileText, video Clapperboard, image Image
  export const PREVIEW_MAX_PIXELS = 50_000_000;
  export function ImagePreview(props: { item: LibraryItem }): JSX.Element;
  // DropSummary에 image: number
  ```

요구 사항(명세 3.5·4.6·11절, P-24):
- 아이콘 여덟 곳 → `itemIcon(item.type)`. 종류 이름 `t.library.type.image`(Task 4). 정렬 `TYPE_ORDER`(Task 4).
- 통계 줄(`summary.ts`): `{ pdf, video, image, bytes }`, "자료 48개(PDF 35 · 동영상 10 · 이미지 3)"와 "PDF 2개 · 이미지 1개 · 합계 9.8 MB".
- 드롭 요약(`drop.ts`): `image/png|jpeg|webp|gif|avif`만 이미지, 나머지 `image/*`는 기타. "파일 3개(PDF 1 · 이미지 2)".
- 빈 라이브러리(명세 11절): `emptyBody1` "PDF\u2060·동영상\u2060·이미지를 이\u00a0창에 끌어다 놓거나 가져올 파일을 선택하세요.", `formats` "PDF, ${VIDEO_FORMATS} 동영상, ${IMAGE_FORMATS} 이미지를 지원합니다."
- 항목 패널(명세 4.6, J12): 이미지 자료 하나를 고르면 머리 맨 위 `ImagePreview` — `<img src={assetUrl(item.assetId)} loading="lazy" decoding="async" alt={item.title}>`, 폭 = 패널 내용 폭, 높이 ≤ 160, 비율 유지, `--bg-sunken` 바탕, 체크무늬 없음. `imageSize`가 없거나 `width × height > PREVIEW_MAX_PIXELS`면 아이콘 칸(`Image`), `img`의 `error`면 아이콘 칸(`ImageOff`). 원본 없음이면 아이콘 칸. 종류 줄 `t.inspector.imageKind(w, h)` = "이미지\u00a0· {w}\u00a0×\u00a0{h}"(크기를 모르면 "이미지"). 여러 개 선택·휴지통 보기·리더에는 없음. `fileFacts.ts`: 이미지는 탐침하지 않는다(`startProbe`를 부르지 않음).
- 읽기 절의 이미지 줄: `readingLine`이 `locator.kind === 'image'`면 `t.inspector.reading.viewed(date)` = "열어 봄\u00a0· {날짜}", 진행은 `readingProgressView(1)` → "✓ 완료".

시험:
- 단위: `itemIcon` 셋; `libraryStats`·`multiSummary`(이미지 있음/없음); `summarizeDrop`(PNG·HEIC(`image/heic` → 기타)·SVG(기타)); `readingLine`(이미지, 오늘/어제).
- E2E `images.spec.ts`: 다섯 형식과 확장자가 틀린 PNG를 창에 끌어 놓기(`dropSource` + `drag`, helpers.ts:620·650)로 가져옴(완료 토스트 "자료 6개를 가져왔습니다"), 표의 종류 열 '이미지'와 아이콘, 패널 미리보기(`img`의 `naturalWidth > 0`, 높이 ≤ 160)와 "이미지 · 64 × 48", 크기를 모르는 이미지(머리만 맞고 크기를 못 읽는 AVIF를 시험이 만듦) → "이미지"만, 여러 개 선택에 미리보기 없음, 읽기 절 "✓ 완료"와 "열어 봄 · 오늘 …". `drop.spec.ts`: 드롭 오버레이 "파일 3개(PDF 1 · 이미지 2)". `library.spec.ts`: 빈 라이브러리 문구(1024에서 줄바꿈이 낱말 가운데가 아님 — 기존 줄바꿈 시험 방식).

- [ ] **Step 1**: 단위 → 실패 → 구현 → 통과.
- [ ] **Step 2**: E2E → 실패 → 패널·표·드롭·문구 → 통과.
- [ ] **Step 3**: 전체 녹색 + 1024.
- [ ] **Step 4**: 커밋 `feat(library): images in the library — their icon wherever an item is listed, the image count in the stats and the drop summary, the empty library's formats, and the item panel's preview (none past fifty megapixels) with "이미지 · W × H"; an image read once shows ✓ 완료 and when it was viewed`.
- 컨트롤러: 디자인 비평(목업 ⑥·⑧ 대 투어 PNG).

---

### Task 14: 검색 범위 ▾ · 합집합 · 결과 없음 덧붙임 · 진행 줄 · P6 · P11 (목업 승인 뒤)

**Files:**
- Create: `R/library/SearchScopeMenu.tsx`, `R/library/useBodySearch.ts`, `R/library/bodySearch.ts`(+ `bodySearch.test.ts`)
- Modify: `D/settings.ts`(`library.searchScope`), `packages/domain/test/settings.test.ts`, `R/ui/SearchField.tsx`(`leading?: ReactNode` — 있으면 돋보기 대신), `R/library/LibrarySearch.tsx`(범위 단추, 자리표시), `R/library/useSearch.ts`(합집합), `R/library/SearchEmpty.tsx`, `R/strings/library.ts`(`searchPlaceholderFull`, `scope*`, `searchEmptyBody`의 "·PDF 본문", 덧붙임 둘, `bodyProgress`), `R/data/queries.ts`(`keys.bodySearch(query)`, `keys.bodyProgress`, `search:progress` 이벤트로 캐시 갱신), `R/styles/screens/library.css:75`(P11 머리 띠, 범위 단추), `E/body-search.spec.ts`, `E/keyboard.spec.ts`(검색 범위 구간), `V/perf.evidence.ts`(검색 입력 줄을 범위 둘로), `docs/decisions/0007-settings-and-preferences.md`(`library.searchScope`)

**Interfaces:**
- Consumes: Task 8 `window.learn.search.*`; Task 5 `bodyQueryWords`, `hasBodyWords`.
- Produces:
  ```ts
  // D/settings.ts
  'library.searchScope': z.enum(['metadata', 'fulltext'])   // 없으면 metadata
  export type SearchScope = 'metadata' | 'fulltext';
  // R/library/bodySearch.ts
  export function mergeBodyResult(meta: SearchResult | null, body: readonly string[] | undefined, query: string): SearchResult | null;  // ids = meta ∪ body, titleMatches는 meta 것만
  export function emptyNote(o: { scope: SearchScope; query: string; progress: { done: number; total: number } | undefined }): string[];  // 결과 없음 덧붙임 문장들
  // R/library/useBodySearch.ts
  export function useSearchScope(): [SearchScope, (s: SearchScope) => void];
  export function useBodyProgress(): { done: number; total: number } | undefined;
  export function useBodySearch(query: string, enabled: boolean): string[] | undefined;   // useDeferredValue + 200ms, ['search','body',q], CANCELLED는 버림
  ```

요구 사항(명세 5.6 렌더러·5.8, 6절 P6·P11, 11절, J22–J24):
- 범위 단추: 검색 필드 안 맨 앞(돋보기 자리), RAC `MenuTrigger` + `Menu selectionMode="single"`, 이름·툴팁 "검색 범위", 행 "정보"(설명 = `SEARCHED_FIELDS`) · "정보와 본문"(설명 "PDF 본문 포함"), 색인이 끝나지 않았으면(`progress.done < total`) 구분선 뒤 비활성 "본문 색인 37\u00a0/\u00a0120". 고르면 `library.searchScope`에 저장. 탭 순서 범위 단추 → 입력란. 자리표시 "제목, 저자, 태그 검색" / "제목, 저자, 태그, 본문 검색". 승인 목업의 모양.
- 합집합: 범위가 `fulltext`이고 휴지통 보기가 아니고 `hasBodyWords(bodyQueryWords(query))`면 `useBodySearch`; `useSearch`의 결과를 `mergeBodyResult`로. 보기·태그 거름이 자르는 구조(`useLibraryRows.ts`)는 그대로. 개수와 `aria-live`("일치하는 자료 N개")는 본문 결과가 오면 다시 센다. 정보 결과는 지금처럼 즉시(P6: 본문은 입력 경로 밖).
- 결과 없음(`SearchEmpty`): 범위 `fulltext`면 필드 목록 끝에 "·PDF 본문", 본문 낱말이 없으면(1글자뿐) "본문은 두 글자 이상인 낱말로 찾습니다.", 색인 중이면 "본문 색인이 끝나면 더 찾을 수 있습니다(37\u00a0/\u00a0120)."
- 무효화: `['search','body']`는 Task 7의 처리기가 `text`·`import`·`trash`·`restore`·`purge`에서. `['search','progress']`는 `evt:search-progress`가 `setQueryData`.
- P11: 빈 상태에서 머리 띠만 가로로 옮길 수 있게(`.table-scroller[data-empty]`는 그대로 `overflow: hidden`, 머리 띠가 자기 가로 스크롤을 가짐 — 키보드 정지점이 생기지 않게 `tabIndex` 없이).
- ADR-0007: `library.searchScope`.

시험:
- 단위 `bodySearch.test.ts`: 합집합과 `titleMatches`(본문만 일치한 항목에는 표시 없음), `meta`가 null(빈 질의)이면 null, `emptyNote`의 셋(1글자, 색인 중, 둘 다).
- 설정 스키마.
- E2E `body-search.spec.ts`에 더함(`seedBodyText` 작은 수 또는 `search-30.pdf`·`korean.pdf` 색인):
  - 범위 메뉴(마우스와 키보드: 범위 단추에 Tab → ↓ → ↩)와 기억(다시 실행 뒤 `fulltext`, 자리표시).
  - '정보와 본문'에서 표 = 정보 ∪ 본문(제목에 없는 "형광"으로 `search-30.pdf` 행이 나옴, 제목 `<mark>`는 정보 일치에만), 범위 '정보'로 돌리면 빠짐(양성 대조 뒤).
  - 2글자 한국어("형광"), 1글자("형") → 본문 결과 없음과 "본문은 두 글자 이상인 낱말로 찾습니다.", `korean.pdf` 2쪽(NFD 원문)을 NFC 질의 "변환기는"으로 찾음.
  - 진행 줄: `textExtraction('pause')`인 PDF가 남은 동안 메뉴에 "본문 색인 n / m", 끝나면 없음(양성 대조 순서).
  - 휴지통으로 옮기면 본문 일치에서 빠지고 복원하면 돌아옴. 휴지통 보기에서는 본문 일치 없음.
  - P11: 1024 창에서 빈 결과일 때 머리 띠를 가로로 옮길 수 있음(`scrollLeft` > 0 이 됨).
  - `expectNoSeriousA11y`(범위 메뉴 열림, 결과 없음).
- 키보드 여정(`keyboard.spec.ts`): 검색 범위 → 입력 → 표의 구간(항목 패널 행까지는 Task 15).
- 증거 `perf.evidence.ts`: 검색 입력 → 정보 결과 그리기 p95를 범위 둘로(≤ 50, P6).

- [ ] **Step 1**: 단위 → 실패 → 구현 → 통과.
- [ ] **Step 2**: E2E → 실패 → 범위 단추·합집합·결과 없음·P11 → 통과.
- [ ] **Step 3**: 증거 줄, ADR-0007, 전체 녹색 + 1024.
- [ ] **Step 4**: 커밋 `feat(search): the quick search's scope — 정보 or 정보와 본문 from a button at the field's start, remembered per library; in 정보와 본문 the table is metadata matches and PDF body matches together, no-results says what it could not search yet, the menu shows the index progress; an empty result's column header strip scrolls sideways`.
- 컨트롤러: 디자인 비평(목업 ④·⑥ `noresults` 대 투어 PNG).

---

### Task 15: '본문 일치' 절 · 그 쪽에서 열기 · 본문 상태 줄 (목업 승인 뒤)

**Files:**
- Create: `R/inspector/BodyMatchesSection.tsx`, `R/inspector/bodyText.ts`(+ `bodyText.test.ts`)
- Modify: `R/inspector/InfoPane.tsx`(머리 아래 · 읽기 위, `ItemInfo`), `R/inspector/sections.ts`(`'matches'`), `R/inspector/FileSection.tsx`("본문 검색" 줄), `R/strings/inspector.ts`, `R/viewers/pdf/readerStore.ts`(P-23), `R/viewers/pdf/PdfDocumentView.tsx`(`restore`가 `pendingJump`의 쪽), `R/viewers/pdf/PdfReader.tsx`(놓인 뒤 점프·찾기), `R/commands/registry.ts`(`CommandEnv.openAtPage`), `R/app/MainWindow.tsx`(`openAtPage`), `R/styles/screens/inspector.css`, `E/body-search.spec.ts`, `E/keyboard.spec.ts`

**Interfaces:**
- Consumes: Task 8 `search.pages`; Task 14 `useSearchScope`, `useBodyProgress`; Task 5 `BodyTextState`, `MARK_START/END`.
- Produces:
  ```ts
  // bodyText.ts
  export function bodyStateLine(s: BodyTextState): string | null;     // 완료 → null, 잘린 완료 → "앞 5,000쪽까지 색인했습니다."
  export function snippetParts(snippet: string): Array<{ text: string; mark: boolean }>;   // U+E000/E001 → 조각(HTML로 넣지 않음)
  // readerStore.ts
  pendingJump: { pageIndex: number; query: string } | null;
  setPendingJump(j: { pageIndex: number; query: string } | null): void;
  // CommandEnv
  openAtPage(itemId: string, at: { pageIndex: number; query: string }): void;
  ```

요구 사항(명세 5.8, J25·J26, P-23, 11절):
- 절이 보이는 조건: 라이브러리 항목 패널, 자료 하나, 범위 `fulltext`, `hasBodyWords`, PDF. 자리: 머리 바로 아래, '읽기' 위. 머리 "본문 일치" + 3차색 "{total}쪽". 행은 쪽마다(최대 20): "{n}쪽" + 두 줄로 자른 조각(`<mark>`는 `snippetParts`로 만든 요소). 20쪽을 넘으면 끝에 "외 {total − 20}쪽". 행은 RAC `ListBox`(`onAction` — ↩·클릭), 행 이름 "{n}쪽, {조각 글}". 불러오기 300ms 규칙(`useShownAfter`, 그 전에는 아무것도 없고 넘으면 "찾는 중…"). 일치 없음 + 색인 끝(`ItemDetail.text`가 pending이 아님) → 절 없음. 색인이 끝나지 않았거나 글자 없음·실패면 행 대신 상태 줄 하나(`bodyStateLine`).
- 질의: `useQuery(['search','pages', itemId, deferredQuery], () => unwrap(api().search.pages({ itemId, query })))`.
- 행을 누르면 `env.openAtPage(itemId, { pageIndex, query })`: `afterEditing(() => { readerScopes.get(itemId).reader.getState().setPendingJump(at); openTab(itemId) })`. 리더: (a) 아직 놓이지 않았으면 `restore`가 저장된 확대·회전·보기 모드로 그 쪽 위에 놓고(`place({ pageNumber: pageIndex + 1 })`), (b) 이미 놓였으면 `jumpToPage(pageIndex + 1)`(뒤로/앞으로에 기록). 그다음 찾기 막대를 그 질의로 열고(`find.getState().openBar(query)`) `dispatchFind(bus, query, '')`. 쓴 뒤 `setPendingJump(null)`.
- 파일 절의 줄 "본문 검색": PDF 자료 하나이고 `bodyStateLine(detail.text)`이 null이 아닐 때만 — 색인 중 · 글자 없음 · 실패(이유별 문구) · 잘린 완료(명세 11절 문구 그대로).

시험:
- 단위 `bodyText.test.ts`: 상태 여섯의 문구(명세 11절 그대로), `snippetParts('a\ue000b\ue001c')` = `[{a}, {b, mark}, {c}]`, 표시가 짝이 맞지 않으면 표시 없이 글만.
- E2E `body-search.spec.ts`에 더함(1024로도):
  - '본문 일치' 절: `search-30.pdf`를 "fluorescence"로 → 20행 + "외 10쪽", 머리 "30쪽", 행 이름 "1쪽, …"; `korean.pdf`를 "메커니즘은"으로 → 쪽 1·2·3.
  - 행 ↩(키보드)와 클릭 → 리더가 그 쪽(`__learnReader` 쪽 번호)에서 열리고 찾기 막대 입력이 질의, 첫 강조(`.highlight.selected`)가 그 쪽 안 → 이미 열린 탭이면 다른 쪽 행 → `jumpToPage` → ⌘[(`runMenuCommand(app, 'nav.historyBack')`)로 앞 쪽.
  - 편집 중 확인을 취소하면 탭이 열리지 않고, 그 뒤 그 자료를 보통으로 열어도 점프하지 않는다(양성 대조: 확인하면 점프).
  - 상태: `textExtraction('pause')`로 색인 중("본문을 색인하는 중입니다." — 절과 파일 절), `no-text.pdf` 글자 없음, `locked.pdf` 실패(암호).
  - `expectNoSeriousA11y`(절이 있는 패널).
- 키보드 여정(`keyboard.spec.ts`): 검색 범위 → 입력 → 표 → F6로 항목 패널 → '본문 일치' 행 → ↩ → 리더 그 쪽.

- [ ] **Step 1**: 단위 → 실패 → 구현 → 통과.
- [ ] **Step 2**: E2E → 실패 → 절·열기 길·상태 줄 → 통과.
- [ ] **Step 3**: 전체 녹색 + 1024.
- [ ] **Step 4**: 커밋 `feat(search): the item panel's 본문 일치 — the pages that match with a marked snippet each (twenty, then 외 N쪽), opening the reader at that page with the find bar on the query; the body index state in the section and the file section when it is not done`.
- 컨트롤러: 디자인 비평(목업 ⑤ 대 투어 PNG), 그다음 **Mac 중간 `e2e`**(P-27).

---

### Task 16: 마무리 — 투어·axe·키보드 여정·데모·문서·Mac `all` (목업 승인 뒤)

**Files:**
- Create: `docs/decisions/0008-body-search.md`(P-28)
- Modify: `E/visual/tour.spec.ts`(+ 기준 PNG), axe 정거장이 있는 spec, `E/keyboard.spec.ts`(여정 마무리), `V/demo.evidence.ts`(M7c 장, 녹화 이름 `m7c-demo`), `scripts/record-demo-linux.sh`·`scripts/finish-demo.sh`(`m7b-demo` → `m7c-demo`), `scripts/evidence.sh:13`(주석의 이름), `docs/design/design-spec.md`(명세 16절 1–10), `docs/spec-amendments.md`(새 14절 + 1절 이미지 형식 줄, 8절 본문 검색 줄), `docs/acceptance.md`(AC16 본문 검색 줄, "M7c 완료 조건" 절), `docs/next-session.md`("M7c 결과", 소유자 할 일의 번역 확인 명령, M8 입력, PR 남은 것, 로드맵 표 M7c 줄), `docs/mac-verification.md`("M7c"), `docs/decisions/0012-translation.md`(새 절 "M7c 재확인", "결과와 위험"의 비공식 주소 줄), `docs/superpowers/specs/2026-11-08-m7c-images-search-perf-design.md`(0절 목업 줄, 11절 바뀐 문구)

요구 사항:
- 투어 장면(라이트·다크): 이미지 리더 × 배경 셋 · 회전 · 끝 상태, 확대 ▾·보기 ▾·배경 ▸ 열림, 검색 범위 메뉴(진행 줄 있음), '정보와 본문'의 표, 결과 없음 덧붙임, '본문 일치' 절과 상태(색인 중·실패), 이미지 항목 패널. 바뀐 장면만 `--update-snapshots=changed -g '<title>'`.
- axe(심각 이상 0건): 이미지 리더(그림·끝 상태), 범위 메뉴, '본문 일치' 절이 있는 패널.
- 키보드 여정: Task 14·15 구간을 잇고 이미지 무대(F6, 화살표 스크롤, ⌘R)를 더함, 마우스 없이.
- 데모(명세 14절 장 목록, 3–4분, 자막 합니다체): 사진·도판 다섯 장 끌어 놓기 → 이미지 열기·창에 맞춤·핀치·끌기·회전·배경 → 탭을 닫고 다시 열어도 같은 자리 → 검색 범위 '정보와 본문' → 한국어 2글자 검색과 표 → 항목 패널 '본문 일치' → 쪽 열기와 찾기 막대 → 색인 진행 줄 → 휴지통으로 옮기면 일치에서 빠짐. 앱은 `LEARN_TEXT_EXTRACTION=run`으로(P-13). Linux에서 `scripts/record-demo-linux.sh`로 한 번.
- ADR-0008(명세 16절): 쪽 글 표(sha + 쪽, J35), FTS5 trigram 외부 내용 표(J34), 2글자 훑기·1글자 정보만(J19·J20), 추출 작업과 일꾼(5.1–5.3, J13–J18), 인용 단위(`extracted_chunks`)는 T1, 알려진 한계(ASCII 밖 라틴 2글자 대소문자, DB 크기).
- ADR-0012 "M7c 재확인 (2026-11-…)"(명세 8절): 조사할 공개 문서 여덟을 **웹 페이지 읽기로만** 확인해 (1) 지금 주소가 약관상 어디에 해당하는지(인용, 해석은 '불분명'까지) (2) 대안 엔진 표(엔진 · 키/계정 · 무료 한도 · 기기 안 여부 · 라이선스 · 붙이는 비용 · 출처 URL·확인 날짜) (3) M14 전 결정에 필요한 것. LibreTranslate는 문서만(코드 읽지 않음). `translate.googleapis.com`을 부르지 않는다.
- `next-session.md` 소유자 할 일: 명세 8절의 명령 그대로
  ```
  LEARN_TRANSLATION_LIVE=1 pnpm vitest run apps/desktop/src/main/translation/google-web.live.test.ts
  ```
  와 앱에서 영어 문장 하나 번역 켜기 → 나옴 → 같은 문장 다시 → 바로(캐시). 구현자·컨트롤러는 이 명령을 돌리지 않는다.
- `next-session.md`의 실기·M14 목록(명세 17절): 포장한 앱(asar)에서 일꾼이 `out/renderer/pdfjs`의 cMap·글꼴을 `fs`로 읽는지, 실제 논문 1,000편의 DB 크기, 트랙패드 핀치의 실제 손맛, 5,000만 화소 근처 사진의 디코드 메모리.
- 디자인 명세(명세 16절 1–10)와 `spec-amendments.md` 14절(M7c 범위·소유자 결정·J 판정 가운데 소유자가 뒤집을 수 있는 것·이 계획의 P-11·P-13·P-22·P-23).
- 컨트롤러: 전체 녹색 → push → CI → Mac `all`(최종 코드에서 두 번까지, 간헐 실패는 줄마다 — P-27) → Mac PNG 비평(라이트·다크 데모 프레임) → 데모 영상 → opus 브랜치 전체 검토 → 고침 한 번 → PR(본문 끝 Global Constraints의 두 줄). 병합은 소유자가 "병합해"라고 할 때만. `acceptance.md`의 근거 실행 줄은 컨트롤러가 채운다.

- [ ] **Step 1**: 투어·axe·키보드 여정을 더하고 통과시킨다.
- [ ] **Step 2**: 데모 장을 만들고 Linux에서 한 번 돌려 본다.
- [ ] **Step 3**: ADR-0008·0012, 디자인 명세, 개정 14절, acceptance, next-session, mac-verification을 고친다.
- [ ] **Step 4**: 커밋 `docs(m7c): ADR-0008 body search, the translation address re-check in ADR-0012 (documents only), design-spec and amendments §14, acceptance, next-session M7c results and the owner's live check, the roadmap's M7c row; tour, axe and keyboard journey for the image reader and body search; the M7c demo`.
