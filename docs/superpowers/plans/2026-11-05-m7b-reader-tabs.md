# M7b — 탭 · 뒤로/앞으로 · 보기 모드 · 리더 마무리 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 작업마다 아래 "검토 절차"를 따른다.

**Goal:** 논문 여러 편을 탭으로 오가며 읽고(자료 하나에 탭 하나, 최근 4개는 살려 둠, 다시 실행해도 그대로), 링크·목차로 뛰었다가 뒤로 돌아오며, 스크롤·펼침 보기를 고를 수 있게 하고, 모든 쪽 이동이 한 자리 규칙을 따르게 한다.

**Architecture:** 셸 저장소(`useShell`)가 탭 목록·활성 탭·최근 순서·닫은 탭을 갖고 지금의 `view`를 활성 탭에서 유지한다. 리더 상태(리더·찾기·선택·번역 store와 쪽 필드)는 탭마다 "리더 범위" 하나(`createReaderScope`)이고 리더 하위 트리에는 컨텍스트로, 셸이 그리는 도구 막대·사이드바·항목 패널에는 "활성 탭의 범위"로 준다. 쪽 이동은 모두 핸들의 `place`(여백 계산은 순수 함수 `roomAfterJump`)를 거치고, 뒤로/앞으로 기록은 탭 store의 한 조각이며 pdf.js 링크 서비스의 history 자리에 우리 어댑터를 꽂아 링크 이동도 잡는다.

**Tech Stack:** Electron 44.9.1, React 19.3.1, TypeScript 7.0.2, electron-vite 6.0.0, react-aria-components 1.22.1 (+ react-aria 3.53.1), lucide-react 1.60.0, @tanstack/react-query 5.104.5, @tanstack/react-virtual 3.14.22, zustand 5.0.15, zod 4.6.7, better-sqlite3 13.0.3, pdfjs-dist 6.4.299, Playwright 1.64.1, vitest, pnpm 10.15.1.

**Spec:** `docs/superpowers/specs/2026-11-05-m7b-reader-tabs-design.md`(아래 "명세", 소유자 승인 2026-11-05) + `docs/design/design-spec.md`(아래 "디자인 명세") + Task 1에서 소유자가 승인하는 M7b 목업. 코드 사실은 SDD 작업 공간의 `m7b-context.md`(계획 작성 때의 조사, HEAD 07f9450 기준)에 있다 — 구현자는 자기 작업에 해당하는 절만 읽는다.

## 사전 판정 (2026-11-05, 계획 작성 전)

한 줄 = 판정 하나 → 반영한 작업. 조사는 `W/m7b-context.md`(아래 "조사") 절 번호로 가리킨다.

- **P-0 계획의 모양(토큰 예산)**: M7a와 같이 작업마다 파일, 인터페이스(정확한 이름·타입), 정확한 값, 시험 목록(순수 모듈은 핵심 시험 코드), 단계를 적고 구현 코드를 다 옮겨 적지 않는다. 구현자는 sonnet, 작업 검토는 sonnet, 디자인 비평과 최종 검토는 opus.
- **P-1 리팩터링 먼저**(명세 16절 첫 위험): 리더 상태를 탭마다 나누는 일은 **Task 2**가 동작을 바꾸지 않고 한다. 조사 2.1: 앱 전체 싱글턴은 `useReader`만이 아니다 — `useFind`(찾기 막대), `useSelection`·`useTranslation`(선택 팝업·번역 절), `pageField.ts`의 모듈 변수(쪽 필드 포커스)도 리더마다 하나여야 한다. 이 넷을 "리더 범위"(`ReaderScope`) 하나로 묶는다. 번역 동의·설정(prefs)은 앱 전체 그대로다. `useSections`(패널 절 접힘)도 앱 전체 그대로다.
- **P-2 탭 id**: 리더 탭의 id는 자료 id다(자료 하나에 탭 하나 — 명세 3.1의 `{ id, itemId }`를 하나로 줄인다). 라이브러리 탭 id는 `'library'`.
- **P-3 `view`는 남긴다**: 30곳 넘게 `useShell((s) => s.view)`를 읽는다. 탭 동작(`openTab` 등)이 `view`를 함께 쓰는 유일한 작성자가 되고, `setView`는 없앤다(조사 1.1의 호출 셋을 탭 동작으로 바꾼다).
- **P-4 목업 게이트**: Task 1(목업)을 먼저 하고 소유자 승인을 받는다. 승인을 기다리는 동안 새 크롬이 없는 Task 2·3·4를 한다. 탭 줄·‹ ›·보기 메뉴 같은 화면 작업(Task 5 이후)은 승인 뒤에.
- **P-5 가린 탭의 모양**: `hidden`(display: none) + `inert`. 크기 0이 되므로 가린 탭의 관찰자(맞춤 `ResizeObserver`, 찾기 막대 스크롤 막대 관찰자, 무대 안정 판정)는 `active=false` 동안 아무것도 하지 않는다. 다시 보일 때 `viewer.update()` 한 번, 무대 테두리 상자가 가리기 전과 다르면 `refit` 한 번(조사 3.3의 `lastWidth/lastHeight` 비교를 그대로 쓴다). 영상은 가릴 때 `pause()`(조사 2.6).
- **P-6 ⌘W**(조사 5.4): 새 명령 `tab.close`가 `CmdOrCtrl+W`를 갖고 파일 메뉴에 선다. 네이티브 `role: 'close'` 항목은 `Shift+CmdOrCtrl+W`로 옮긴다(이름 그대로). 라이브러리 탭에서 `tab.close`는 `window.close()` — main의 `close` 이벤트(`editFlush.onClose`)를 그대로 지난다. `app-menu.test.ts:72, 277, 512-557`을 함께 고친다.
- **P-7 ⌘1…⌘9**: ⌘1은 지금의 `nav.back`(이름 "라이브러리", 이동 메뉴 그대로). ⌘2…⌘8·⌘9는 명령 `tab.goTo2`…`tab.goTo8`·`tab.last`이고 윈도우 메뉴의 **숨은 항목**(`visible: false`, 가속기는 동작 — 기존 TWINS와 같은 방식)이다. 메뉴 배치에 `hidden?: true`를 더한다. **명세 3.4 정정**: 윈도우 메뉴의 "열린 탭 목록"은 두지 않는다(macOS Finder·Safari도 탭 목록을 윈도우 메뉴에 두지 않는다, 동적 메뉴 재구성 비용) — 윈도우 메뉴는 다음 탭 · 이전 탭. `spec-amendments.md` 13절에 적는다.
- **P-8 ⌘[ / ⌘] 금지 시험**: `packages/domain/test/commands.test.ts:64-68`은 M7을 위해 ⌘[·⌘]를 비워 두는 시험이다. Task 7이 이것을 "두 키는 `nav.historyBack`/`nav.historyForward`의 것"으로 바꾼다.
- **P-9 뒤로/앞으로 잡기**(조사 3.4): pdf.js `PDFLinkService.setHistory(adapter)`에 우리 어댑터를 꽂는다. 링크와 목차(`goToDestination`)는 링크 서비스가 `pushCurrentPosition()`·`push(…)`를 부르므로 거기서 기록한다. 썸네일·쪽 필드는 핸들의 새 `jumpToPage(n)`(기록 + 쪽 놓기), 이전·다음은 `goToPage`/`next`/`previous`(기록 없음). 어댑터는 pdf.js 6.4.299 `pdf_viewer.mjs`의 링크 서비스가 실제로 부르는 메서드(`pushCurrentPosition`, `push`, `pushPage`, 이름 붙은 동작의 `back`·`forward`)만 갖는다 — 구현자는 `:1496-1600`, `:1752`를 읽고 맞춘다.
- **P-10 쪽 놓기 한 곳**(명세 6절): 순수 함수 `roomAfterJump`(`R/viewers/pdf/placement.ts`)와 핸들의 `place(target)`. 링크 서비스는 뷰어의 `scrollPageIntoView`를 부르므로, `PdfDocumentView`가 뷰어 인스턴스의 `scrollPageIntoView`를 감싸 그 뒤에 여백을 적용한다 — 링크·목차·우리 이동이 모두 지난다. pdf.js의 `nextPage()`·`currentPageNumber =`는 이 길을 지나지 않으므로 이전·다음과 쪽 이동은 대상 쪽 번호를 계산해 `place`를 부른다(펼침이면 두 쪽씩, 펼침 시작 쪽에 맞춤).
- **P-11 locator 필드**(조사 7.3 — 엄격하지 않은 zod는 모르는 키를 버린다): `D/reading.ts` pdf 형태에 `scroll?: 'vertical' | 'horizontal' | 'page'`, `spread?: 'none' | 'odd' | 'even'`, `pages?: number`(정수 ≥ 1)를 더한다 → Task 8(모드, `pages` 쓰기), Task 9(`pages` 읽기).
- **P-12 세션 저장**: 설정 `ui.tabs = z.object({ items: z.array(z.uuid()).max(50), active: z.uuid().nullable() }).strict()`. 쓰기는 `usePanePersistence`(조사 7.2)처럼 300ms 묶음 + 같은 JSON 건너뛰기 + `beforeunload`에서 바로 쓰기. 읽기는 `Boot.tsx`의 PanesGate처럼 MainWindow 전에 한 번(조사 7.2의 패턴). 영구 삭제된 자료는 첫 `useItem` 읽기가 "없음"이면 탭에서 뺀다(`removeTab`). `ui.lastOpenItemId`는 쓰는 곳이 없으므로(조사 1.2) 건드리지 않는다 — 명세 3.6의 "지금 쓰임"은 정정해 적는다.
- **P-13 탭 컨텍스트 메뉴**: 컨텍스트 메뉴 종류 `'tab'`을 더한다(조사 5.5의 손댈 곳 목록 전부). 입력 `{ kind: 'tab', itemId, x, y }`, main은 그 자료의 항목 대상(`itemTarget`)을 만들어 Finder 가능 여부를 판정한다. 명령 `tab.close`·`tab.closeOthers`·`tab.revealInLibrary`·`item.showInFolder`가 `contextMenu.kinds`에 `'tab'`을 갖는다. 대상은 `itemIds: [itemId]` — `tab.close`는 그 탭(활성 탭이 아닐 수 있다)을 닫는다.
- **P-14 탭 끌기**: `R/library/columnDrag.ts`의 순수 함수(`dropSlot`, `edgeScroll`, `DRAG_THRESHOLD`)를 가져다 쓴다(옮기지 않는다). 포인터 사건 방식은 `useColumnReorder.ts`를 본뜬다(Esc 취소, 4px 문턱, 끝 자동 스크롤, 놓은 뒤 클릭 삼키기).
- **P-15 마우스 옆 단추**: 리더 무대의 `mousedown`에서 `button` 3·4면 `preventDefault()`(Chromium의 기본 뒤로 가기를 막는다), `mouseup`에서 3 = 뒤로, 4 = 앞으로. E2E는 합성 사건으로 본다. 실제 마우스는 실기 항목.
- **P-16 여러 개 열기의 이름**: 항목 컨텍스트 메뉴에서 여러 개를 고르면 `item.open`은 "탭 N개로 열기", `item.openInBackground`는 "새 탭 N개로 열기"(기존 `countLabel` 방식에 `selection` 키를 더한다). 11개 이상은 `ui.confirm`(명세 3.3).
- **P-17 명령 전수**: `commands-coverage.spec.ts:620`은 `reader.`·`translation.` 접두어의 명령을 모두 `M7A_COMMANDS`와 비교한다(Task 12a Minor 3). 새 `reader.*` 명령을 처음 더하는 Task 8이 이 비교를 정확한 목록 비교로 바꾸고 `M7B_COMMANDS`를 만든다. Task 6·7의 새 명령(`tab.*`, `item.openInBackground`, `nav.history*`)은 그 접두어가 아니어서 깨지지 않지만, 각 작업이 자기 명령을 `M7B_COMMANDS`에 더하도록 Task 6이 목록을 먼저 만든다.
- **P-18 Task 9 Minor 4**: 탭 하나는 자료 하나만 보이고 리더는 자료마다 새로 마운트되므로 `restoredRef`/`latestRef`는 다시 마운트될 때 새것이다. 고칠 코드는 없고, "내려갔다 다시 마운트된 탭이 저장된 자리로 온다" E2E(Task 5)가 지킨다. 명세 3.7의 그 줄은 이렇게 닫는다.
- **P-19 Mac 실행**: 중간 `e2e`는 Task 7 뒤(탭과 뒤로/앞으로가 들어간 때), 끝 `all`은 Task 13. 모두 컨트롤러가 `workflow_dispatch`로. 러너가 잡히지 않으면 몇 시간 뒤 부하가 적은 때 다시.

## Global Constraints

모든 작업의 요구 사항에 아래가 암묵적으로 포함된다. 따옴표 안은 명세 원문이다.

- **버전**: 저장소에 고정된 그대로 쓴다(위 Tech Stack). "런타임 의존성은 정확히 고정하고 새로 더하지 않는다(필요하면 계획에서 근거와 라이선스를 적는다)." `^`·`~` 금지. 이 계획은 새 의존성을 더하지 않는다.
- **라이선스**: 저장소는 AGPL-3.0-or-later다(ADR-0011). `LICENSE`와 `package.json`의 `license` 필드는 건드리지 않는다. "AGPL 코드(Zotero reader, zotero-pdf-translate)는 보지도 가져오지도 않는다. pdf.js(Apache-2.0)의 CSS를 옮기면 고지를 단다."
- **앵커 원칙**: "새 데이터 객체는 모두 앵커로 주소를 가질 수 있다(제품 방향 합의). 탭·기록은 화면 상태라 앵커 대상이 아니다."
- **네트워크**: "원격 요청은 main만, 허용 호스트 하나, 동의 전·끈 상태에서는 0회, 자동 재전송 없음(M7a 그대로). 실제 번역 주소는 시험에서 부르지 않는다." `google-web.live.test.ts`를 돌리지 않고 `LEARN_TRANSLATION_LIVE`를 두지 않는다.
- **IPC**: 모든 새·바뀐 채널은 기존 `handle()` 래퍼(발신자 검사 + zod + Result)와 채널 종류 허용 목록을 쓴다. preload는 이름공간 API만 노출한다.
- **가짜 금지**: "메뉴·팔레트·도구 막대·탭 메뉴는 레지스트리에서만, 핸들러 없는 항목은 그리지 않는다." M7c 항목(이미지, 본문 검색)은 자리도 남기지 않는다.
- **문체**: "문체는 합니다체, 화면 문구는 `strings/` 영역 파일에. 한국어 조사는 `josa.ts`." 버튼은 동사형, 관형사 + 명사는 U+00A0으로 묶는다(디자인 명세 9).
- **토큰만**: 화면 코드에서 색·간격·반경·글자 크기를 직접 쓰지 않는다. 토큰이 아닌 값은 같은 줄에 `/* local: 이유 */`. 한글 UI에 700을 쓰지 않는다. `css-lint.test.ts`가 막는다.
- **macOS 시트**: "시트 뒤 클릭은 `sheetReleased()` 뒤에(macOS 250ms)."
- **가린 탭**: "가린 탭은 크기 관찰에 반응하지 않는다(M7a N-1)."
- **역할**: "구현자는 push·CI 실행·하위 에이전트 실행을 하지 않는다(컨트롤러가 한다)."
- **주석**: 새 코드의 주석에는 이유만 쓴다. 판정 번호·실행 id·비평 id는 커밋 메시지에.
- **작업마다 녹색**: 작업을 끝낼 때 `pnpm typecheck`, `pnpm test`, `pnpm tokens:check`, `pnpm e2e:xvfb`, `xvfb-run -a -s "-screen 0 1440x900x24" pnpm exec playwright test -c playwright.evidence.config.ts`가 모두 통과한다. 리더 화면을 바꾼 작업은 리더·탭 spec을 `xvfb-run -a -s "-screen 0 1024x768x24"`로도 한 번 돈다(Mac 러너 화면 크기).
- **시험 출력은 tmpfs에**: Playwright는 `--output=/tmp/<고유 이름>`으로 돌린다. 프로세스는 `ps`로 보고 정확한 PID만 끝낸다(`pkill -f` 금지).
- **긴 실행**: `pnpm e2e:xvfb`와 증거 전체는 포그라운드에서 나눠 돌리거나 백그라운드로 돌리고 끝날 때까지 직접 기다린다(포그라운드 `sleep` 금지). 실패하면 실패한 spec만 다시 돌려 고친 뒤 전체를 한 번 더.
- **git**: `git stash`를 그냥 쓰지 않는다. 임시로 치울 것은 WIP 커밋으로. push한 기록을 고쳐 쓰지 않는다(amend·force-push 금지).
- **커밋 메시지 끝**(모든 커밋):
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01LH2FDh4QwsGUFR3V2KewHi
  ```
- **PR 본문 끝**:
  ```
  🤖 Generated with [Claude Code](https://claude.com/claude-code)

  https://claude.ai/code/session_01LH2FDh4QwsGUFR3V2KewHi
  ```

## 검토 절차 (모든 작업)

1. **구현자**: 단계를 순서대로(시험 먼저 → 실패 확인 → 구현 → 통과 → 커밋). 하위 에이전트를 부르지 않는다. 보고서는 컨트롤러가 정한 파일에 쓰고, 답에는 상태·커밋·시험 한 줄·우려만.
2. **작업 검토(sonnet)**: 명세 준수(작업 요구, Global Constraints, 사전 판정)와 품질(시험이 실패할 수 있는 단언인지, 접근성 속성, 명세 12절 예산에 닿는 복잡도)을 한 번에. 계획과 다르게 구현했다면 이유가 커밋 본문에 있어야 한다.
3. **디자인 비평(UI 작업, opus)**: 목업 렌더와 Linux 투어 PNG를 나란히 놓고 디자인 명세·루브릭으로 blocker/major/minor 판정, blocker·major 0건까지 반복.
4. **macOS 증거**(P-19의 두 지점): 컨트롤러가 CI 녹색 뒤 `scripts/evidence.sh m7b-reader <suite> <label>`.

## 경로 줄임말

`D` = `packages/domain/src`, `DB` = `packages/db/src`, `M` = `apps/desktop/src/main`, `P` = `apps/desktop/src/preload`, `R` = `apps/desktop/src/renderer/src`, `E` = `tests/e2e`, `V` = `tests/evidence`, `W` = `.superpowers/sdd/2026-11-05-m7b-reader-tabs`.

## 작업 목록

| # | 작업 | 화면 | 구현 모델 | 앞선 조건 |
|---|---|---|---|---|
| 1 | M7b 목업(탭 줄 상태·‹ ›·보기 ▾의 스크롤·펼침·보기 장면·탭 메뉴·'읽기' 절) | 목업 | sonnet + opus 비평 | — |
| 2 | 리더 범위(`ReaderScope`) 분리 — 동작 그대로, 탐침을 제품 번들에서 뺌 | 없음 | sonnet | — |
| 3 | 쪽 놓기와 맞춤: `roomAfterJump`·`place`, 이전·다음·쪽 이동의 여백(R-25·위), 가장 넓은 쪽 맞춤(R-21) | 리더(여백만) | sonnet | 2 |
| 4 | 탭 모델과 세션: 순수 탭 상태, `useShell` 탭, `ui.tabs` 저장·복원 — 화면은 지금처럼 리더 하나 | 없음 | sonnet | 2 |
| — | **소유자 목업 승인** (P-4) | | | 1 |
| 5 | 탭 줄과 살려 두기: `TabBar`, 창 도구 막대 제거, 리더 탭 4개 마운트·가림·다시 맞춤, 영상 멈춤, 세션 복원 화면 | 셸·리더 | sonnet | 승인, 3, 4 |
| 6 | 탭 명령·메뉴: ↩/⌘↩/여러 개, ⌘W·⇧⌘W·⇧⌘T·⌃⇥·⌘2…⌘9, 탭 컨텍스트 메뉴, 끌기·⌥⇧←→, 휴지통·영구 삭제 | 셸 | sonnet | 5 |
| 7 | 뒤로/앞으로: 기록 모듈, 링크 서비스 어댑터, ⌘[ ⌘], ‹ › 단추, 마우스 옆 단추 | 리더 | sonnet | 6 |
| — | **Mac 중간 `e2e`** (P-19, 컨트롤러) | | | 7 |
| 8 | 보기 모드: 스크롤·펼침 하위 메뉴, pdf.js 모드, CSS, 모드별 키와 여백, locator `scroll`·`spread`·`pages`, 명령 전수의 정확한 비교 | 리더 | sonnet | 7 |
| 9 | 라이브러리 항목 패널의 '읽기' 절 | 패널 | sonnet | 8 |
| 10 | 사이드바 고침: 썸네일 DPR·다시 시도·실패 모양·`aria-activedescendant`, 목차 가상화·묶음 풀기·옛 내용, 쪽 다시 그리기 | 리더 | sonnet | 8 |
| 11 | 나머지 고침: 깜빡임 둘, 찾기 막대 관찰자, 낡은 핸들, ⌘/ 시트 키, 저장 타이머, 번역 설정 전 누름, pagesinit 전 실패 시험 | 리더 | sonnet | 10 |
| 12 | 성능 측정(명세 12절, `tabs-perf`) | 없음 | sonnet | 11 |
| 13 | 마무리: 투어·axe·키보드 여정·`M7B_COMMANDS`·데모·문서·Mac `all`·브랜치 검토·PR | 전부 | sonnet(+컨트롤러) | 12 |

## 작업 사이의 계약 (요약 — 작업 본문의 Interfaces가 정본)

- Task 2 → 3·5·7·8·10·11: `ReaderScope`, `createReaderScope()`, `ReaderScopeProvider`, `useReader`/`useFind`/`useSelection`/`useTranslation`(범위 안이면 그 범위, 밖이면 활성 범위), `activeReaderScope()`, `setActiveReaderScope(scope | null)`.
- Task 3 → 5·7·8: `PdfViewHandle.place(target: PlaceTarget)`, `roomAfterJump(...)`, `widestPage(sizes, rotation)`.
- Task 4 → 5·6·7: `useShell`의 `tabs: string[]`, `activeTab: TabId`, `recent: string[]`, `closed: string[]`와 동작 `openTab`·`openTabs`·`selectTab`·`selectTabAt`·`selectRelativeTab`·`closeTab`·`closeOtherTabs`·`reopenClosedTab`·`moveTab`·`removeTab`·`restoreTabs`; 순수 `mountedTabs(state, limit)`; 설정 `ui.tabs`.
- Task 5 → 6·7·12·13: `TabBar`(`data-testid="tab-bar"`, 탭 `data-testid="tab"` + `data-item-id`), 리더 탭 컨테이너 `data-testid="tab-panel"` + `data-item-id` + `data-active`.
- Task 7 → 8·12: 범위의 `history` 조각, 핸들 `jumpToPage(n)`, 명령 `nav.historyBack`/`nav.historyForward`.
- Task 8 → 9: locator `pages`.

## 시작 전

- 워크트리 `.worktrees/m7b`, 브랜치 `m7b-reader`(upstream 없음 — 컨트롤러가 `git push origin HEAD:refs/heads/m7b-reader`로 올린다). `pnpm install --frozen-lockfile` 완료.
- 기준선: Task 1 전에 컨트롤러가 `pnpm typecheck && pnpm test`를 한 번 돌려 녹색을 확인한다.

---

### Task 1: M7b 목업

**Files:**
- Modify: `docs/design/mockups/assets/views.js`(`pdfWindow`의 `m` 분기, `readerV2`, `toolbarV2`, `viewMenuV2`, `inspectorItem`의 읽기 절), `docs/design/mockups/assets/mockup.js`(필요하면 `windowShell`·`tab`), `docs/design/mockups/assets/mockup.css`, `docs/design/mockups/assets/data.js`(탭 제목·읽기 값), `scripts/mockups/manifest.mjs`(`group: 'm7b'`와 변형), `docs/design/design-spec.md` 10.3(쿼리 목록)

**Interfaces:**
- Produces: 렌더 이름(아래 변형), `data-ms="M7b …"` 꼬리표. 이후 화면 작업(Task 5–10)의 비평 짝.

요구 사항(명세 11절, 조사 15):
- `reader-pdf.html`에 `m=7b`를 더한다: M1의 탭 줄 렌더러(`mockup.js` `tab`·`windowShell`, 레이아웃 B)를 쓰고, 탭 = 라이브러리(home) + 리더 탭들, 활성 리더 탭 아래는 M7a의 44px 리더 도구 막대에 **맨 왼쪽 ‹ ›**(아이콘 단추 28, 툴팁 "뒤로 ⌘[" / "앞으로 ⌘]")를 더한 것. M7a의 창 도구 막대(뒤로 · 제목 · 종류와 크기)는 없다.
- 쿼리(모두 `m=7b`와 함께): `tabs=2|many|drag`(리더 탭 하나 / 탭 12개로 최소 폭 120에 닿아 넘침 — 활성 탭이 보이게 스크롤된 모양 / 끌기 중 탭 `.is-dragging`과 자리를 비킨 이웃), `history=none|back|both`(‹ › 꺼짐 / 뒤로만 / 둘 다), `view=menu`(보기 ▾ 열림: 쪽 색 묶음 · — · "스크롤 ▸" · "펼침 ▸" · — · 회전 둘; 하위 메뉴 하나를 펼친 모양 `view=menu-scroll`·`view=menu-spread`, 체크는 지금 값), `scroll=horizontal|page`, `spread=odd`(펼침 보기 장면: 두 쪽 나란히, 가운데 간격 12), `menu=tab`(탭 컨텍스트 메뉴: 탭 닫기 ⌘W · 다른 탭 닫기 · — · 라이브러리에서 보기 · Finder에서 보기 ⇧⌘R), `sidebar=hidden`(사이드바 접힘 — 신호등 인셋·사이드바 토글이 탭 줄 왼쪽, ⌘K 실행기가 탭 줄 오른쪽 끝 232×28).
- 가로 스크롤에서 보기 ▾의 "펼침 ▸"는 꺼진 모양(`scroll=horizontal&view=menu`).
- `library.html` 항목 패널의 '읽기' 절(조사 8 마지막 두 줄): PDF "42 / 68쪽에서 멈춤 · 오늘 오전 9:24", 영상 "12:34에서 멈춤 · 어제", 쪽 수를 모르는 옛 값 "42쪽에서 멈춤"(`reading=pdf|video|legacy`). 절 순서: 머리, 읽기, 정보, 태그, 컬렉션, 파일. 리더의 항목 패널에는 읽기 절이 없다.
- `w=1024` 변형 하나(`m=7b&tabs=many&w=1024`)로 1024 창에서 탭 줄과 리더 도구 막대를 본다.
- 라이브러리 탭이 활성이고 리더 탭이 있는 모양(`library.html?m=7b&tabs=2`): 탭 줄 아래 내용 열의 패널 머리에 제목 · 개수 · 가져오기 · 검색(디자인 명세 2.2 — 탭이 둘 이상일 때, M1 `standardTabs` 목업과 같은 자리).
- `manifest.mjs`: `Render.group`에 `'m7b'`를 더하고, M7a 블록과 같은 방식으로 위 변형을 라이트·다크 × 레이아웃 B로 만든다(`--only m7b`). 새 요소에 `data-ms="M7b …"`. 문구는 합니다체, U+00A0 규칙.

- [ ] **Step 1**: 위 쿼리를 구현하고 `pnpm mockups:render --only m7b`와 `--only library`로 PNG를 만든다.
- [ ] **Step 2**: 디자인 명세 10.3의 쿼리 목록에 새 쿼리를 적는다.
- [ ] **Step 3**: 커밋 `docs(m7b): mockups — tab strip states (two, overflow, dragging), back and forward in the reader toolbar, scroll and spread in the view menu, horizontal / page / spread scenes, the tab menu, the library panel's reading section`.
- 컨트롤러: opus 디자인 비평(디자인 명세 2.2·7.3·10.3, 루브릭, M1 승인 목업의 탭 줄과 대조) → blocker/major 0건까지 수정 → Artifact로 소유자에게 보이고 승인받는다. 승인은 명세 0절 표의 "목업(11절)" 줄에 적는다.

---

### Task 2: 리더 범위(`ReaderScope`) 분리 — 동작 그대로

**Files:**
- Create: `R/viewers/readerScope.tsx`(범위 만들기·컨텍스트·활성 범위), `R/viewers/readerScope.test.ts`
- Modify: `R/viewers/pdf/readerStore.ts`, `R/viewers/pdf/findStore.ts`, `R/viewers/pdf/pageField.ts`, `R/translation/store.ts`(와 선택 store가 있는 파일), 조사 2.2의 `useReader` 사용처 13곳, `useFind`·`useSelection`·`useTranslation`·`focusPageField` 사용처, `R/viewers/ViewerHost.tsx`(범위 제공), `R/viewers/pdf/PdfDocumentView.tsx`(탐침 동적 import), `E/helpers.ts`(바뀌면)

**Interfaces:**
- Produces:
  ```ts
  export interface ReaderScope {
    readonly id: string;                       // 자료 id (P-2)
    readonly reader: StoreApi<ReaderStore>;    // readerStore.ts의 store 모양 그대로
    readonly find: StoreApi<FindStore>;
    readonly selection: StoreApi<SelectionStore>;
    readonly translation: StoreApi<TranslationStore>;
    readonly pageField: { current: HTMLInputElement | null };
  }
  export function createReaderScope(id: string): ReaderScope;
  export function ReaderScopeProvider(props: { scope: ReaderScope; children: ReactNode }): JSX.Element;
  export function activeReaderScope(): ReaderScope | null;
  export function setActiveReaderScope(scope: ReaderScope | null): void;
  export function useActiveReaderScope(): ReaderScope | null;   // 바뀌면 다시 그린다
  // 훅 이름과 선택자 모양은 그대로: useReader(sel), useFind(sel), useSelection(sel), useTranslation(sel).
  // 범위 안(컨텍스트)이면 그 범위의 store, 밖이면 활성 범위의 store. 활성 범위가 없으면 빈 기본 store(지금의 초기값).
  // getState()도 그대로 쓸 수 있게 각 훅에 `getState()`를 둔다 — 범위 밖의 getState()는 활성 범위의 것.
  ```
- `focusPageField()`는 활성 범위의 `pageField`를 쓴다.

요구 사항:
- 동작은 하나도 바뀌지 않는다. 지금은 리더가 하나뿐이므로 `ViewerHost`가 자료마다 범위를 하나 만들어 `ReaderScopeProvider`로 감싸고 활성 범위로 정한다(언마운트 때 활성 범위를 지운다). 범위 목록·탭과의 연결은 Task 5.
- 범위 밖에서 store를 읽는 곳(셸의 도구 막대·사이드바·항목 패널·`MainWindow`·`readerActions`·`usePinchZoom`의 핸들러)은 활성 범위의 store를 구독한다 — 활성 범위가 바뀌면 다시 그려진다(`useActiveReaderScope` + `useStore(scope.reader, sel)`).
- 번역 동의·설정은 앱 전체 그대로다(`prefs`). `useTranslation`에서 자료와 상관없는 부분(동의 흐름이 prefs를 읽는 곳)이 있으면 범위의 store가 prefs를 읽게만 하고 상태를 둘로 나누지 않는다.
- E2E 훅: `window.__learnReader`는 `{ getState: () => activeReaderScope()?.reader.getState() ?? 빈 상태, subscribe: (fn) => … }`로 활성 범위에 위임한다. 시험이 쓰는 모양(`getState().handle`, `getState().pdf`)은 그대로.
- 탐침(조사 11): `PdfDocumentView.tsx:10`의 정적 import를 `e2e`일 때만 `await import('./anchorProbe')`로 바꾼다. 제품 빌드(`pnpm build`)의 렌더러 번들에 `installAnchorProbe`·`anchorFromQuote` 같은 탐침 이름이 없어야 한다(시험: 빌드 산출물 grep — 아래).

시험:
- 단위 `readerScope.test.ts`: 두 범위의 store가 서로 독립(한쪽 `setPdf`가 다른 쪽에 안 보임), 범위 밖 `useReader.getState()`가 활성 범위를 따름, 활성 범위가 없을 때 빈 기본값, `setActiveReaderScope` 뒤 구독자가 한 번 다시 그려짐.
- 빌드 시험: `pnpm build` 뒤 `apps/desktop/out/renderer` 아래 js에 `installAnchorProbe`가 별도 청크로만 있고 진입 청크에는 없다(스크립트로 확인해 보고서에 적는다).
- 기존 E2E 전체가 그대로 통과(이 작업의 녹색 기준).

- [ ] **Step 1**: `readerScope.test.ts`를 쓰고 실패를 본다.
- [ ] **Step 2**: `readerScope.tsx`와 네 store의 범위화, 훅 위임을 구현한다.
- [ ] **Step 3**: 사용처를 옮기고 단위 시험을 통과시킨다.
- [ ] **Step 4**: 탐침 동적 import, 빌드 확인.
- [ ] **Step 5**: 전체 녹색(Global Constraints) 확인.
- [ ] **Step 6**: 커밋 `refactor(reader): one reader scope per document — the reader, find, selection and translation stores and the page field live in a scope a provider hands down; outside a reader the active scope answers; the anchor probe loads only in an e2e window`.

---

### Task 3: 쪽 놓기와 맞춤 (R-25 쪽 이동 · 위 여백 · R-21)

**Files:**
- Create: `R/viewers/pdf/placement.ts`, `R/viewers/pdf/placement.test.ts`
- Modify: `R/viewers/pdf/PdfDocumentView.tsx`(핸들 `place`, `scrollPageIntoView` 감싸기, `goToPage`·`next`·`previous`, `restore`, `pagesloaded`), `R/viewers/pdf/fit.ts`(+ `fit.test.ts`), `R/viewers/pdf/readerStore.ts`(`PdfViewHandle`), `E/position.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  // placement.ts
  export interface Box { top: number; left: number; width: number; height: number }   // 쪽 div의 스크롤 상자 안 자리(offset + client 테두리)
  export interface StageBox { scrollTop: number; scrollLeft: number; width: number; height: number }
  export type Flow = 'vertical' | 'horizontal';                                        // 'page' 모드는 'vertical'로 다룬다
  export const ROOM = { first: 24, between: 12, side: 24 } as const;
  export function roomAfterJump(o: { flow: Flow; page: Box; firstRow: boolean; stage: StageBox; keepTop: boolean; keepLeft: boolean }): { scrollTop: number; scrollLeft: number };
  // fit.ts
  export function widestPage(sizes: readonly { width: number; height: number }[], rotation: 0 | 90 | 180 | 270): { width: number; height: number };
  // PdfViewHandle에 더함
  place(target: { pageNumber: number; destArray?: unknown[] | null }): void;
  ```
- `goToPage(n)`, `next()`, `previous()`는 이름 그대로이고 이제 `place`를 거친다(기록 없음 — 기록은 Task 7).

규칙(명세 6절):
- `roomAfterJump` 세로: `keepTop`이 아니고 `|stage.scrollTop - page.top| <= 1`이면 `scrollTop = max(0, page.top - (firstRow ? 24 : 12))`. `keepLeft`가 아니고 `page.width > stage.width`이고 `|stage.scrollLeft - page.left| <= 1`이면 `scrollLeft = max(0, page.left - 24)`. 가로(Task 8에서 씀): 축을 바꾼 같은 규칙 — `|scrollLeft - page.left| <= 1`이면 `scrollLeft = max(0, page.left - (firstRow ? 24 : 12))`, 쪽이 무대보다 높고 위끝에 붙으면 위 24.
- `firstRow`: 그 쪽의 위끝이 1쪽의 위끝과 1px 안(펼침의 첫 줄 두 쪽 모두 참).
- `keepTop`/`keepLeft`: `destArray`가 XYZ이고 top/left 값이 null이 아니면 참(링크가 쪽 안 한 점을 가리킴). 다시 열기(`restore`)는 저장된 top/left가 있으면 참이다 — 그러면 M7a의 "붙었을 때만 여백" 규칙과 같은 결과가 나온다(붙지 않은 자리는 그대로).
- `PdfDocumentView`: 뷰어 인스턴스의 `scrollPageIntoView`를 감싼다 — 원래 것을 `allowNegativeOffset: true`로 부르고, 이어서 대상 쪽 div로 `roomAfterJump`를 계산해 적용한다. 링크·목차(링크 서비스가 부름)와 `place`가 모두 이 길을 지난다. `restore`의 줄 128·132(조사 3.2)는 이 감싸기로 대신한다.
- `next`/`previous`: 지금 쪽에서 한 쪽(펼침이면 Task 8에서 두 쪽) 옮긴 쪽 번호로 `place`. 범위 밖이면 아무것도 하지 않는다.
- R-21: `pagesloaded`에서 `zoom`이 `'auto'`·`'page-width'`면 한 번 다시 맞춘다. 맞춤의 기준 크기는 `widestPage(모든 쪽 크기, rotation)`(가장 넓은 쪽, 90·270이면 가로세로를 바꿔 비교). `'page-fit'`은 지금 쪽 기준 그대로. `pagesloaded` 전에는 지금처럼 지금 쪽 기준.

시험:
- 단위 `placement.test.ts`(핵심):
  ```ts
  const stage = { scrollTop: 900, scrollLeft: 0, width: 800, height: 600 };
  test('a page landing flush at the top keeps 12 above it, the first row 24', () => {
    const page = { top: 900, left: 100, width: 600, height: 840 };
    expect(roomAfterJump({ flow: 'vertical', page, firstRow: false, stage, keepTop: false, keepLeft: false }).scrollTop).toBe(888);
    expect(roomAfterJump({ flow: 'vertical', page: { ...page, top: 24 }, firstRow: true, stage: { ...stage, scrollTop: 24 }, keepTop: false, keepLeft: false }).scrollTop).toBe(0);
  });
  test('a point inside the page is kept', () => {
    const page = { top: 900, left: 100, width: 600, height: 840 };
    expect(roomAfterJump({ flow: 'vertical', page, firstRow: false, stage, keepTop: true, keepLeft: false }).scrollTop).toBe(900);
  });
  test('a page wider than the stage keeps 24 on its left when the jump lands at its edge', () => {
    const page = { top: 900, left: 24, width: 1200, height: 840 };
    expect(roomAfterJump({ flow: 'vertical', page, firstRow: false, stage: { ...stage, scrollLeft: 24 }, keepTop: false, keepLeft: false }).scrollLeft).toBe(0);
  });
  ```
  더해서: 쪽이 무대보다 좁으면 왼쪽을 건드리지 않음, 1px 넘게 떨어진 자리는 그대로, 가로 흐름의 대응 둘.
- 단위 `fit.test.ts`: `widestPage`(세로 A4 + 가로 A4 → 가로 쪽, 회전 90이면 세로 쪽이 넓음).
- E2E `position.spec.ts` 추가(1024×768로도 돈다):
  - "a page jump keeps 12 above the page (24 for the first)": `paper-100`에서 쪽 필드 7 ↩ → 무대 맨 위와 7쪽 위끝 사이 12(±1), 썸네일 1 → 24, 목차 장 하나 → 12, 1쪽의 링크 "See page 50." → 12.
  - "a page wider than the stage keeps its 24 on the left after a page jump (R-25)": `sample.pdf` 확대 2 → 쪽 필드 2 ↩ → 왼쪽 여백 24(±1).
  - "a mixed-size document fits its widest page (R-21)": `sample.pdf`(2쪽 가로)를 자동 맞춤으로 열고 `data-rendered` 뒤 `pagesloaded`를 기다려 `.pdf-scroll`의 `scrollWidth <= clientWidth`.
- 기존 M7a 위치 시험(R-25 다시 열기 포함)이 그대로 통과.

- [ ] **Step 1**: 단위 시험을 쓰고 실패를 본다.
- [ ] **Step 2**: `placement.ts`, `widestPage`를 구현해 단위 시험을 통과시킨다.
- [ ] **Step 3**: E2E 셋을 쓰고 실패를 본다.
- [ ] **Step 4**: `PdfDocumentView`의 감싸기·`place`·이전·다음·`pagesloaded`를 구현해 통과시킨다.
- [ ] **Step 5**: 전체 녹색 + 리더 spec 1024.
- [ ] **Step 6**: 커밋 `feat(reader): one page-placement rule for every jump — 24 above the first row and 12 above others, 24 left of a page wider than the stage, a point inside the page kept; auto and page-width fit the widest page once all sizes are known`.

---

### Task 4: 탭 모델과 세션

**Files:**
- Create: `R/state/tabs.ts`(순수 함수), `R/state/tabs.test.ts`, `R/app/useTabsPersistence.ts`
- Modify: `R/state/shell-store.ts`, `D/settings.ts`(+ `packages/domain/test/settings.test.ts`), `R/app/Boot.tsx`(탭 읽기 관문), `R/app/MainWindow.tsx`(`back`·`open` → 탭 동작), `R/library/useImportQueue.ts:85`

**Interfaces:**
- Produces:
  ```ts
  // tabs.ts — 순수
  export type TabId = 'library' | string;           // 리더 탭 = 자료 id (P-2)
  export interface TabsState { tabs: string[]; active: TabId; recent: string[]; closed: string[] }   // tabs: 리더 탭만, 순서대로
  export const NO_TABS: TabsState = { tabs: [], active: 'library', recent: [], closed: [] };
  export const CLOSED_MAX = 10, SAVED_MAX = 50, MOUNTED_MAX = 4;
  export function openTab(s: TabsState, itemId: string, o?: { background?: boolean }): TabsState;   // 있으면 그 탭(배경이면 그대로), 없으면 활성 탭 오른쪽(배경이면 맨 끝)
  export function openTabs(s: TabsState, itemIds: readonly string[], o?: { background?: boolean }): TabsState;  // 순서대로, 배경 아니면 첫 자료로
  export function selectTab(s: TabsState, id: TabId): TabsState;
  export function selectTabAt(s: TabsState, index: number): TabsState;    // 0 = 라이브러리, 범위 밖이면 그대로
  export function selectLastTab(s: TabsState): TabsState;
  export function selectRelativeTab(s: TabsState, delta: 1 | -1): TabsState;   // 라이브러리 포함, 끝에서 돈다
  export function closeTab(s: TabsState, id: string): TabsState;          // closed에 넣고, 활성이었으면 recent의 앞 탭(없으면 라이브러리)
  export function closeOtherTabs(s: TabsState, id: string): TabsState;
  export function reopenClosedTab(s: TabsState, isOpenable: (id: string) => boolean): TabsState;
  export function moveTab(s: TabsState, id: string, toIndex: number): TabsState;   // 리더 탭 사이의 자리
  export function removeTab(s: TabsState, id: string): TabsState;         // 영구 삭제: closed에도 넣지 않음
  export function mountedTabs(s: TabsState, limit?: number): string[];    // 활성 리더 탭 + recent의 리더 탭, 최대 limit
  export function toSaved(s: TabsState): { items: string[]; active: string | null };
  export function fromSaved(v: { items: string[]; active: string | null } | undefined): TabsState;
  // shell-store.ts — ShellState에 더함 (P-3: view는 이 동작들이 함께 쓴다, setView는 없앤다)
  tabs: TabsState;
  openTab(itemId: string, o?: { background?: boolean }): void; openTabs(ids: readonly string[], o?: { background?: boolean }): void;
  selectTab(id: TabId): void; selectTabAt(index: number): void; selectLastTab(): void; selectRelativeTab(delta: 1 | -1): void;
  closeTab(id: string): void; closeOtherTabs(id: string): void; reopenClosedTab(isOpenable: (id: string) => boolean): void;
  moveTab(id: string, toIndex: number): void; removeTab(id: string): void; restoreTabs(saved: TabsState): void;
  // settings.ts
  'ui.tabs': z.object({ items: z.array(z.uuid()).max(50), active: z.uuid().nullable() }).strict()
  ```
- `recent`은 활성 탭이 바뀔 때마다 그 탭을 맨 앞에 둔다(라이브러리는 넣지 않는다).

요구 사항:
- `useShell`의 `view`는 탭 동작이 `active`에서 유도해 함께 쓴다: 라이브러리 → `{ kind: 'library' }`, 리더 탭 → `{ kind: 'reader', itemId }`. `setView`를 없애고 호출 셋(조사 1.1)을 `selectTab('library')`·`openTab(itemId)`로 바꾼다.
- 화면은 아직 지금 그대로다: 활성 탭의 리더 하나만 그린다(`ViewerHost key=itemId`), 창 도구 막대의 뒤로(`nav.back`)는 `selectTab('library')`. 다른 리더 탭은 상태에만 있다.
- 세션(P-12): `useTabsPersistence()`가 `toSaved(tabs)`를 300ms 묶어 `api().settings.set({ key: 'ui.tabs', value })`(같은 JSON은 건너뜀, `beforeunload`에서 바로 씀, 언마운트에서 타이머 정리). `Boot.tsx`가 MainWindow 전에 `ui.tabs`를 한 번 읽어 `restoreTabs(fromSaved(v))`. 읽기 실패·없음은 `NO_TABS`.
- 영구 삭제된 자료: 탭의 첫 자료 읽기(`useItem`)가 "없음"이면 `removeTab`. 휴지통 자료는 그대로 둔다(리더의 '휴지통에 있음').

시험:
- 단위 `tabs.test.ts`(핵심):
  ```ts
  test('↩ on an open item goes to its tab; ⌘↩ never switches', () => {
    const s = openTab(openTab(NO_TABS, 'a'), 'b', { background: true });
    expect(s.active).toBe('a');
    expect(s.tabs).toEqual(['a', 'b']);
    expect(openTab(s, 'b').active).toBe('b');
    expect(openTab(s, 'b').tabs).toEqual(['a', 'b']);
  });
  test('a new tab opens right of the active one', () => {
    const s = selectTab(openTabs(NO_TABS, ['a', 'b', 'c']), 'a');
    expect(openTab(s, 'd').tabs).toEqual(['a', 'd', 'b', 'c']);
  });
  test('closing the active tab goes to the one seen before it', () => {
    let s = openTab(openTab(openTab(NO_TABS, 'a'), 'b'), 'c');
    s = selectTab(s, 'a');
    expect(closeTab(s, 'a').active).toBe('c');
    expect(closeTab(s, 'a').closed).toEqual(['a']);
  });
  test('the four most recent reader tabs stay mounted', () => {
    let s = openTabs(NO_TABS, ['a', 'b', 'c', 'd', 'e']);
    for (const id of ['a', 'b', 'c', 'd', 'e']) s = selectTab(s, id);
    expect(mountedTabs(s)).toEqual(['e', 'd', 'c', 'b']);
  });
  ```
  더해서: `closed`가 10개를 넘으면 오래된 것부터 버림, `reopenClosedTab`이 열 수 없는 자료를 건너뜀, `removeTab`은 `closed`에 넣지 않음, `selectRelativeTab`이 끝에서 돎, `moveTab`, `selectTabAt(0)`이 라이브러리, `toSaved`가 50개로 자름, `fromSaved(undefined)`가 `NO_TABS`, `fromSaved`가 `active`가 목록에 없으면 라이브러리.
- 단위 `settings.test.ts`: `ui.tabs` 스키마(51개 거부, 모르는 키 거부, `active: null`).
- E2E(`E/tabs.spec.ts`, 새 파일 — 이 작업은 둘만): "a reader open at quit reopens on launch, at its place" — 자료를 열고 쪽 7로 간 뒤 `app.close()` → `launch` → 리더가 그 자료로, 7쪽에 열림. 같은 것을 `hardKill` 뒤에도.

- [ ] **Step 1**: 단위 시험을 쓰고 실패를 본다.
- [ ] **Step 2**: `tabs.ts`, 설정 키를 구현해 통과시킨다.
- [ ] **Step 3**: `useShell` 탭 동작과 `view` 유도, 호출 셋 바꾸기.
- [ ] **Step 4**: 세션 저장·복원과 E2E 둘.
- [ ] **Step 5**: 전체 녹색.
- [ ] **Step 6**: 커밋 `feat(shell): the tab model — one tab per item, the library tab first, the order seen for keeping tabs mounted, closed tabs to reopen; the shell's view follows the active tab; ui.tabs saves the session and the window reopens it`.

---

### Task 5: 탭 줄과 살려 두기

**Files:**
- Create: `R/shell/TabBar.tsx`, `R/styles/components/tabs.css`(또는 `screens/shell.css`의 절), `R/viewers/ReaderTabs.tsx`(마운트·가림)
- Modify: `R/app/MainWindow.tsx`(toolbar 슬롯·내용), `R/shell/Shell.tsx`·`R/shell/Toolbar.tsx`(탭 줄과 실행기 자리), `R/viewers/ReaderToolbar.tsx`(없앰 — 쓰던 곳 정리), `R/viewers/ViewerHost.tsx`(`active` 전달), `R/viewers/pdf/PdfReader.tsx`·`PdfDocumentView.tsx`(가린 동안 관찰 멈춤·보일 때 한 번), `R/viewers/VideoViewer.tsx`(가리면 멈춤), `R/viewers/readerScope.tsx`(범위 목록), `R/strings/*`, `E/tabs.spec.ts`, `E/helpers.ts`(`backFromReader` → 라이브러리 탭, `openItem` 그대로)

**Interfaces:**
- Consumes: Task 2 범위, Task 4 `useShell` 탭 동작·`mountedTabs`.
- Produces: `TabBar`(`data-testid="tab-bar"`, 탭 `data-testid="tab"` + `data-item-id`(라이브러리는 `library`) + `aria-selected`), 리더 탭 컨테이너 `data-testid="tab-panel"` + `data-item-id` + `data-active="true|false"`. 범위 목록 `readerScopes: { get(id): ReaderScope; drop(id): void }`(`readerScope.tsx`) — 탭이 닫히거나 영구 삭제될 때 `drop`.

요구 사항(명세 3.2·3.7, 디자인 명세 2.2, 승인 목업):
- 탭 줄: 리더 탭이 하나라도 있으면 Shell의 toolbar 슬롯(내용 열 위 52px, 조사 1.5)이 `TabBar`다. 라이브러리 탭만이면 지금의 `LibraryToolbar`(통합 도구 막대) 그대로. 리더 탭이 활성일 때 라이브러리 탭으로 가면 라이브러리 도구 막대가 아니라 탭 줄이 보이고, 라이브러리의 제목·개수·가져오기는 내용 열 머리(디자인 명세 2.2 "탭 하나" 규칙의 반대 — 탭이 둘 이상이면 내용 열의 패널 머리)로 내려간다. 승인 목업의 모양을 따른다.
- 탭 모양·상태·치수: 명세 3.2(높이 28, 기준 240, 최소 120, 간격 4, 활성 `--bg-control` + `--shadow-e0`, 비활성 사이 16px 구분선, 닫기 18은 활성·호버만, 툴팁 = 전체 제목). 제목은 자료 목록·상세 질의의 캐시에서(제목을 고치면 `metadata` 알림으로 바로 바뀐다).
- 넘침: 최소 폭에서도 넘치면 탭 줄이 가로로 스크롤되고(스크롤 막대 숨김), 활성 탭이 바뀌면 보이게 스크롤한다.
- 사이드바 접힘: 신호등 인셋·사이드바 토글·⌘K 실행기(232×28, 오른쪽 끝)가 탭 줄로 온다(지금 `Toolbar`가 하는 일과 같은 규칙).
- 접근성: RAC `Tabs`/`TabList`/`Tab`(가로, 화살표로 포커스 이동, ↩·스페이스로 고름), 탭 닫기 단추는 탭 안의 단추(`aria-label` "‘제목’ 탭 닫기"). 탭 패널은 `TabPanel` 하나(활성 탭의 내용)이고 가린 리더 탭은 그 밖의 형제로 둔다(`hidden` + `inert`).
- M7a의 창 도구 막대(`ReaderToolbar`: 뒤로 · 제목 · 종류와 크기)는 없앤다. 창 제목(`document.title`)은 활성 탭의 제목(지금 `readerWindowTitle` 규칙)으로.
- 살려 두기(P-5): `mountedTabs(tabs)`의 탭마다 `ViewerHost`를 마운트하고 활성 탭만 보인다. 가린 탭: 맞춤 관찰자·찾기 막대 관찰자·무대 안정 판정이 멈춘다, 선택 팝업이 닫힌다(번역 절의 원문·번역은 남는다), 영상은 멈춘다. 다시 보일 때 `viewer.update()` 한 번, 무대 크기가 바뀌었으면 맞춤 한 번. 마운트 밖으로 밀린 탭은 언마운트(위치는 언마운트 flush로 저장됨) — 범위는 남긴다(Task 7의 기록이 산다). 다시 고르면 저장된 자리로 연다.
- 활성 범위: 활성 탭이 바뀌면 `setActiveReaderScope(readerScopes.get(id))`, 라이브러리면 `null`. 탐침(`__learnPdf`)은 활성 탭의 문서 것으로 다시 건다.
- 라이브러리로 돌아오면 지금처럼 라이브러리를 다시 그리고 마지막에 연 행을 보인다(`lastOpenedId`).
- 메모리(명세 3.7): 리더 탭 4개를 살려 둔 상태의 렌더러 메모리(`process.getProcessMemoryInfo().private`)를 재서 보고서에 적는다(정식 측정은 Task 12). 1 GB를 넘으면 가린 보기의 보이지 않는 쪽 캔버스를 놓는다(pdf.js의 쪽 보기 `reset`/버퍼 줄이기) — 판정과 값을 커밋 본문에.

시험(`E/tabs.spec.ts`에 더함, 1024로도 돈다):
- "opening items makes tabs; the library tab switches back and forth": 자료 둘을 열면 탭 셋(라이브러리 + 둘), 라이브러리 탭 클릭 → 표, 두 번째 탭 클릭 → 그 자료.
- "a kept tab comes back at once, with its find bar and place": 자료 A에서 ⌘F로 찾기 막대를 열고 쪽 30으로 → B 열기 → A 탭: 찾기 막대가 열려 있고 같은 쪽, 그 사이 A의 `pdf-viewer`가 다시 만들어지지 않았다(`data-*` 표식이나 렌더 횟수 `watchRenders`로).
- "a fifth reader tab unmounts the oldest, which reopens at its saved place": 자료 다섯 → 처음 것은 `tab-panel`이 없음 → 그 탭을 고르면 저장된 쪽으로 다시 열림(P-18).
- "a hidden tab does not refit while the window changes size": 탭 둘, A를 자동 맞춤으로 둔 채 B로 → 창 크기를 1024 → 1280으로 → A의 `scalechanging` 횟수 0(가린 동안) → A로 돌아오면 정확히 한 번 다시 맞춤(관찰 횟수는 `__learnReader` 버스 이벤트로 센다).
- "a hidden video stops": 영상을 재생 중에 다른 탭으로 → `paused === true`.
- "the tab strip scrolls to keep the active tab in view": 자료 12개를 탭으로 → 마지막 탭이 탭 줄 상자 안.
- "the window's title is the active tab's".
- 기존 E2E에서 창 도구 막대의 `viewer-back`을 쓰던 곳은 `backFromReader`(라이브러리 탭 클릭)로 옮긴다.

- [ ] **Step 1**: E2E를 쓰고 실패를 본다.
- [ ] **Step 2**: `TabBar`와 Shell 슬롯, 창 도구 막대 제거.
- [ ] **Step 3**: `ReaderTabs`의 마운트·가림, 관찰 멈춤, 영상 멈춤, 활성 범위.
- [ ] **Step 4**: 기존 시험 옮기기, 전체 녹색 + 1024.
- [ ] **Step 5**: 투어 기준 PNG 중 바뀐 장면(리더 장면의 창 도구 막대가 탭 줄로)만 `--update-snapshots=changed`로 고치고 바뀐 이유를 커밋 본문에.
- [ ] **Step 6**: 커밋 `feat(shell): the tab strip — the library tab and one tab per open item in the content column's top bar, the window toolbar's back, title and meta folded into it; the four most recent reader tabs stay mounted and hidden, without refitting while hidden, and a hidden video pauses`.
- 컨트롤러: 디자인 비평(승인 목업 `m=7b&tabs=*` 대 투어 PNG).

---

### Task 6: 탭 명령 · 메뉴 · 컨텍스트 메뉴 · 끌기

**Files:**
- Modify: `D/commands.ts`(새 명령·`contextMenu` 종류 `'tab'`·메뉴 배치 `hidden`·`countLabel.selection`·규칙), `packages/domain/test/commands.test.ts`, `D/ipc.ts`(`showContextMenuInput`에 `tab`), `M/ipc/ui.ts`, `M/menu/context-entries.ts`, `M/menu/app-menu.ts`(+ `app-menu.test.ts` — ⌘W·⇧⌘W·숨은 항목), `R/commands/registry.ts`(핸들러), `R/commands/icons.ts`, `R/commands/targets.ts`, `R/shell/TabBar.tsx`(컨텍스트 메뉴·끌기·⌥⇧←→), `R/app/MainWindow.tsx`(`open`·`openInBackground`, 확인 시트), `R/strings/*`, `M/strings.ts`, `E/tabs.spec.ts`, `E/commands-coverage.spec.ts`(`M7B_COMMANDS` 시작)

**Interfaces:**
- Consumes: Task 4·5.
- Produces: 명령 id(정확히): `item.openInBackground`, `tab.close`, `tab.reopenClosed`, `tab.next`, `tab.previous`, `tab.goTo2`, `tab.goTo3`, `tab.goTo4`, `tab.goTo5`, `tab.goTo6`, `tab.goTo7`, `tab.goTo8`, `tab.last`, `tab.moveLeft`, `tab.moveRight`, `tab.closeOthers`, `tab.revealInLibrary`. `E/commands-coverage.spec.ts`의 `M7B_COMMANDS`(이 작업의 id들로 시작).

명령 표(명세 3.4·9, P-6·P-7·P-13·P-16):

| id | 이름 | 가속기 | 메뉴 | 맥락 · 규칙 |
|---|---|---|---|---|
| `item.open` (있음) | 열기 / 여럿: 탭 N개로 열기 | (↩ 지금 그대로) | 지금 그대로 | 여러 개 선택 허용(지금 하나만이면 규칙 바꿈) |
| `item.openInBackground` | 새 탭에서 열기 / 여럿: 새 탭 N개로 열기 | `CmdOrCtrl+Enter` | 파일 g1 (열기 다음) · 항목 컨텍스트 메뉴(열기 다음) | `library`, 선택 1개 이상, 휴지통 보기 아님 |
| `tab.close` | 탭 닫기 | `CmdOrCtrl+W` | 파일 마지막 묶음(창 닫기 위) · 탭 메뉴 g1 | `app` (라이브러리 탭이면 `window.close()`) |
| (role close) | 창 닫기(이름 그대로) | `Shift+CmdOrCtrl+W` | 파일 끝 | — |
| `tab.reopenClosed` | 닫은 탭 다시 열기 | `Shift+CmdOrCtrl+T` | 파일(탭 닫기 다음) | `app`, `closed`에 열 수 있는 자료가 있을 때 |
| `tab.next` / `tab.previous` | 다음 탭 / 이전 탭 | `Ctrl+Tab` / `Ctrl+Shift+Tab` | 윈도우 g2 | `app`, 리더 탭이 있을 때 |
| `tab.goTo2`…`tab.goTo8` | 2…8번째 탭 | `CmdOrCtrl+2`…`8` | 윈도우, 숨은 항목 | `app`, 그 탭이 있을 때 |
| `tab.last` | 마지막 탭 | `CmdOrCtrl+9` | 윈도우, 숨은 항목 | `app`, 리더 탭이 있을 때 |
| `nav.back` (있음) | 라이브러리 | `CmdOrCtrl+1` | 이동 g1 그대로 | 그대로 |
| `tab.moveLeft` / `tab.moveRight` | 탭을 왼쪽으로 / 오른쪽으로 | `Alt+Shift+Left` / `Alt+Shift+Right` | 메뉴 없음 — 탭 줄 키(렌더러, `key` 아님: 탭에 포커스가 있을 때만) | 탭 포커스 |
| `tab.closeOthers` | 다른 탭 닫기 | — | 탭 메뉴 g1 | 리더 탭이 둘 이상 |
| `tab.revealInLibrary` | 라이브러리에서 보기 | — | 탭 메뉴 g2 | 그 자료가 휴지통이 아님 |
| `item.showInFolder` (있음) | Finder에서 보기 | 그대로 | 탭 메뉴 g2에도 | 그대로 |

- `tab.moveLeft`·`tab.moveRight`는 메뉴가 없으므로 레지스트리 명령으로 두되 실행은 `TabBar`의 키 처리기가 한다(팔레트에는 보인다). 명령 전수는 팔레트로 돌린다.
- 맥락 상태: 탭 규칙을 판정하려면 `CommandContextState`에 `tabCount?: number`(리더 탭 수)와 `closedOpenable?: boolean`을 더한다(조사 16 — `CommandContextState`, `commandContextInput`, `contextOf` 세 곳).
- 숨은 항목: `menu: { menu: 'window', group, order, hidden: true }` → app-menu가 `visible: false`로 만든다. ⌘/ 단축키 시트에는 "⌘2…⌘9 · 2…8번째 탭 / 마지막 탭" 한 줄로 묶는다(시트 목록 만드는 곳에서).
- 탭 컨텍스트 메뉴(P-13): 탭에서 오른쪽 클릭 → `api().ui.showContextMenu({ kind: 'tab', itemId, x, y })` → `runPicked(…, { itemIds: [itemId] })`. 라이브러리 탭에는 메뉴가 없다. 조사 5.5의 손댈 곳 모두.
- `tab.revealInLibrary`: 라이브러리 탭으로 가서 그 행을 고르고 보이게 스크롤(컬렉션 필터가 가리면 "내 라이브러리"로 바꿈 — `restoreScope`/범위 바꾸기 함수가 있으면 그것으로).
- 끌기(P-14): 리더 탭만, 라이브러리 탭 앞으로는 안 됨, 이웃이 160ms 비켜섬(reduced-motion이면 즉시), Esc 취소, 놓은 뒤 클릭 삼킴.
- 여러 개 열기: 11개 이상이면 `ui.confirm`("자료 N개를 탭으로 열겠습니까?", 확인 동사 "열기"), 취소면 아무것도 하지 않음.
- 휴지통·영구 삭제(명세 3.8): 휴지통으로 옮겨도 탭은 남음, `purge` 알림의 자료 탭은 `removeTab` + `readerScopes.drop`.

시험:
- 단위 `commands.test.ts`: 새 가속기 중복 없음(플랫폼 셋), 숨은 배치는 `window` 메뉴만, `tab` 종류 명령은 `app` 맥락.
- 단위 `app-menu.test.ts`: 파일 메뉴 끝이 탭 닫기 ⌘W · 닫은 탭 다시 열기 ⇧⌘T · 창 닫기(role, ⇧⌘W), 윈도우 메뉴의 숨은 항목 `visible: false`, 가속기 충돌 시험에 ⇧⌘W 반영.
- E2E `tabs.spec.ts`에 더함: ⌘↩(배경) · 여럿 ↩(첫 자료로) · 11개 확인 시트(`stubConfirm`로 취소 → 탭 그대로, 확인 → 11개) · `runMenuCommand`로 ⌘W(리더 탭 닫힘, 앞 탭으로) · 라이브러리 탭에서 ⌘W(창 닫힘 — `app.windows()` 수) · ⇧⌘T · ⌃⇥/⌃⇧⇥(돎) · ⌘2/⌘9 · 탭 컨텍스트 메뉴(`stubContextMenu`로 "다른 탭 닫기", "라이브러리에서 보기" — 행이 선택되고 보임) · 끌기(포인터로 셋째 탭을 첫 리더 자리로 → 순서, 라이브러리 앞으로는 안 됨) · ⌥⇧← · 휴지통으로 옮긴 자료의 탭(남고 '휴지통에 있음') · 영구 삭제(탭 사라짐) · 제목 고침(탭 이름 바뀜) · 다시 실행하면 순서와 활성 탭이 그대로.
- `commands-coverage.spec.ts`: `M7B_COMMANDS` 목록을 만들고 이 작업의 명령이 모두 실행 기록에 있다(`tab.moveLeft/Right`는 팔레트, 나머지는 메뉴·컨텍스트 메뉴).

- [ ] **Step 1**: 단위 시험을 쓰고 실패를 본다.
- [ ] **Step 2**: 명령·메뉴·맥락 상태·컨텍스트 메뉴 종류를 구현해 단위 시험을 통과시킨다.
- [ ] **Step 3**: E2E를 쓰고 실패를 본다.
- [ ] **Step 4**: 핸들러·탭 메뉴·끌기·확인 시트·휴지통 처리를 구현해 통과시킨다.
- [ ] **Step 5**: 전체 녹색 + 1024.
- [ ] **Step 6**: 커밋 `feat(shell): tab commands — ⌘↩ opens in the background, several items open as tabs (asking past ten), ⌘W closes the tab (the library tab closes the window, ⇧⌘W always), ⇧⌘T reopens, ⌃⇥ and ⌘2…⌘9 switch; the tab menu, dragging tabs and ⌥⇧←→; a purged item's tab closes`.
- 컨트롤러: 디자인 비평(탭 메뉴·끌기 중 모양 대 목업).

---

### Task 7: 뒤로 / 앞으로

**Files:**
- Create: `R/viewers/pdf/history.ts`, `R/viewers/pdf/history.test.ts`, `R/viewers/pdf/historyAdapter.ts`
- Modify: `R/viewers/readerScope.tsx`(범위에 기록 조각), `R/viewers/pdf/PdfDocumentView.tsx`(`linkService.setHistory`, 핸들 `jumpToPage`·`historyBack`·`historyForward`), `R/viewers/pdf/readerStore.ts`(`PdfViewHandle`), `R/viewers/pdf/ThumbnailList.tsx`·`PdfReader.tsx`(쪽 필드)·`OutlineTree.tsx`(이동을 기록하는 길로), `R/viewers/pdf/PdfReader.tsx`(도구 막대 ‹ ›, 무대의 마우스 옆 단추), `D/commands.ts`(+ `commands.test.ts` — P-8), `R/commands/registry.ts`·`icons.ts`, `R/strings/*`, `E/history.spec.ts`(새), `E/commands-coverage.spec.ts`(`M7B_COMMANDS`에 둘)

**Interfaces:**
- Consumes: Task 2 범위, Task 3 `place`.
- Produces:
  ```ts
  // history.ts — 순수
  export interface History<T> { readonly entries: readonly (T | null)[]; readonly index: number }
  export const HISTORY_MAX = 50;
  export function emptyHistory<T>(): History<T>;                      // { entries: [null], index: 0 }
  export function recordJump<T>(h: History<T>, here: T): History<T>;   // entries[index] = here, 앞쪽 지움, null을 더해 index+1, 넘치면 앞에서 버림
  export function goBack<T>(h: History<T>, here: T): { history: History<T>; target: T } | null;
  export function goForward<T>(h: History<T>, here: T): { history: History<T>; target: T } | null;
  export const canGoBack: (h: History<unknown>) => boolean;
  export const canGoForward: (h: History<unknown>) => boolean;
  // PdfViewHandle에 더함
  jumpToPage(pageNumber: number): void;      // 기록 + place
  historyBack(): void; historyForward(): void;
  // 범위의 reader store에 더함
  history: History<PdfPlace>;               // PdfPlace = Extract<ReadingLocator, { kind: 'pdf' }>의 pageIndex·top·left
  ```
- 명령: `nav.historyBack`(뒤로, `CmdOrCtrl+[`, 이동 g2 o1, `viewer`, 규칙 `canGoBack`), `nav.historyForward`(앞으로, `CmdOrCtrl+]`, 이동 g2 o2, `viewer`, 규칙 `canGoForward`). 맥락 상태에 `historyBack?: boolean`, `historyForward?: boolean`(세 곳).

요구 사항(명세 4절, P-9):
- 기록 대상: 링크·목차(링크 서비스 → 어댑터), 썸네일 클릭·↩와 쪽 필드 ↩(`jumpToPage`). 기록하지 않음: 스크롤, 이전·다음(셰브런·키), 찾기 결과, 확대·회전·보기 모드, 다시 열기.
- "지금 자리" = 지금 `updateviewarea`의 locator(쪽·top·left). 뒤로/앞으로의 대상으로 갈 때는 `place({ pageNumber, destArray: [null, { name: 'XYZ' }, left, top, null] })`(점을 지킨다).
- 어댑터(`historyAdapter.ts`): 링크 서비스가 부르는 메서드만 — `pushCurrentPosition()`은 아무것도 하지 않고(우리 `recordJump`가 지금 자리를 함께 쓴다), `push(...)`·`pushPage(n)`은 `recordJump(지금 자리)`, `back()`·`forward()`(PDF의 이름 붙은 동작 GoBack/GoForward)는 `historyBack/Forward`. pdf.js 6.4.299 링크 서비스가 그 밖에 읽는 속성(`initialized` 등)이 있으면 맞춘다.
- 도구 막대: 쪽 필드 앞에 ‹ ›(`IconButton`, `ChevronLeft`/`ChevronRight`, 툴팁 "뒤로 ⌘[" / "앞으로 ⌘]", `data-testid="pdf-history-back|forward"`, 기록이 없으면 `isDisabled`). 영상 탭에는 그리지 않는다.
- 마우스 옆 단추(P-15): 무대 `mousedown` 3·4 `preventDefault`, `mouseup` 3 = 뒤로, 4 = 앞으로.
- 기록은 범위에 있으므로 탭이 언마운트되어도 남는다(Task 5). 다시 실행하면 비어 있다.

시험:
- 단위 `history.test.ts`(핵심):
  ```ts
  test('forward returns to the last place, not the jump target', () => {
    const h = recordJump(emptyHistory<string>(), 'p1');
    const b = goBack(h, 'p50, read on to p52')!;
    expect(b.target).toBe('p1');
    const f = goForward(b.history, 'p1')!;
    expect(f.target).toBe('p50, read on to p52');
  });
  test('a new jump after going back drops what was ahead', () => {
    let h = recordJump(recordJump(emptyHistory<string>(), 'a'), 'b');
    h = goBack(h, 'c')!.history;
    h = recordJump(h, 'b2');
    expect(canGoForward(h)).toBe(false);
    expect(h.entries).toEqual(['a', 'b2', null]);
  });
  test('fifty entries at most', () => {
    let h = emptyHistory<number>();
    for (let i = 0; i < 60; i++) h = recordJump(h, i);
    expect(h.entries.length).toBe(HISTORY_MAX);
    expect(h.entries[0]).toBe(11);
  });
  ```
  더해서: 빈 기록에서 `goBack`은 null, 맨 끝에서 `goForward`는 null.
- 단위 `commands.test.ts`: P-8 — ⌘[·⌘]는 `nav.historyBack`/`nav.historyForward`의 것.
- E2E `history.spec.ts`(1024로도): 링크 "See page 50." → ⌘[(`runMenuCommand`) → 1쪽의 같은 자리 → ⌘] → 50쪽; 50쪽에서 52쪽까지 스크롤한 뒤 뒤로·앞으로 → 52쪽의 그 자리(±1쪽 높이의 2%); 목차 장 → 뒤로; 썸네일 → 뒤로; 쪽 필드 ↩ → 뒤로; 이전·다음과 스크롤은 기록되지 않음(뒤로 꺼짐); 뒤로 뒤 새 이동이 앞쪽을 지움; 도구 막대 ‹ › 단추와 꺼짐 상태; 합성 `mouseup` button 3/4; 탭 둘의 기록이 따로; 다섯째 탭으로 내려간 탭의 기록이 다시 마운트 뒤에도 남음.
- `commands-coverage.spec.ts`: 두 명령을 `M7B_COMMANDS`에.

- [ ] **Step 1**: 단위 시험을 쓰고 실패를 본다.
- [ ] **Step 2**: `history.ts`를 구현해 통과시킨다.
- [ ] **Step 3**: E2E를 쓰고 실패를 본다.
- [ ] **Step 4**: 어댑터·핸들·명령·도구 막대·마우스를 구현해 통과시킨다.
- [ ] **Step 5**: 전체 녹색 + 1024.
- [ ] **Step 6**: 커밋 `feat(reader): back and forward per tab — links, the outline, thumbnails and the page field are jumps; ⌘[ and ⌘], the toolbar's ‹ › and the mouse's side buttons go through them, and forward returns to where you last were`.
- 컨트롤러: 디자인 비평(‹ › 대 목업 `history=*`), 그다음 **Mac 중간 `e2e`**(P-19).

---

### Task 8: 보기 모드 (스크롤 · 펼침)

**Files:**
- Modify: `D/reading.ts`(+ 시험 — P-11), `D/commands.ts`(명령 여섯), `D/submenus.ts`(묶음 `scrollMode`·`spreadMode`), `M/menu/submenus.ts`(묶음 만들기·`menuNeedsOrganize`), `R/commands/registry.ts`·`icons.ts`, `R/viewers/pdf/ViewMenu.tsx`, `R/viewers/pdf/PdfDocumentView.tsx`(모드 적용·`restore`), `R/viewers/pdf/PdfReader.tsx`(locator에 모드와 `pages`), `R/viewers/pdf/stageKeys.ts`(+ 시험), `R/viewers/pdf/placement.ts`(가로 흐름 사용), `R/styles/screens/pdf-viewer.css`(가로·펼침 규칙, pdf.js 고지), `R/strings/*`, `E/view-modes.spec.ts`(새), `E/commands-coverage.spec.ts`(정확한 비교 — P-17)

**Interfaces:**
- Consumes: Task 3 `place`·`roomAfterJump`(가로), Task 7 `jumpToPage`.
- Produces: locator `scroll`·`spread`·`pages`(P-11); 명령 `reader.scrollVertical`(세로), `reader.scrollHorizontal`(가로), `reader.scrollPage`(한 쪽씩), `reader.spreadNone`(없음), `reader.spreadOdd`(홀수 쪽부터), `reader.spreadEven`(짝수 쪽부터) — 모두 `viewer` 맥락, `pdfOpen` 규칙, 펼침 셋은 가로 스크롤이면 꺼짐(맥락 상태 `pdfScroll?: 'vertical' | 'horizontal' | 'page'`). `SUBMENUS`의 `scrollMode`(이름 "스크롤", 보기 g5 o4)·`spreadMode`(이름 "펼침", 보기 g5 o5).

요구 사항(명세 5절):
- 보기 ▾(`ViewMenu.tsx`): 쪽 색 묶음 · — · "스크롤" 하위 메뉴(셋, 지금 값 체크) · "펼침" 하위 메뉴(셋, 지금 값 체크, 가로면 묶음 전체 꺼짐) · — · 회전 둘. 승인 목업의 모양. 메뉴 막대 보기 메뉴에는 하위 메뉴 둘(체크 없음 — 쪽 색과 같은 규칙, 조사 5.3).
- pdf.js: `viewer.scrollMode = ScrollMode.VERTICAL|HORIZONTAL|PAGE`, `viewer.spreadMode = SpreadMode.NONE|ODD|EVEN`. 가로로 바꾸면 펼침은 `NONE`으로 두고 저장값도 `'none'`(명세 5절: 가로는 펼침 꺼짐 — pdf.js가 받더라도).
- CSS: pdf.js `pdf_viewer.css`(Apache-2.0)의 `.scrollHorizontal`·`.spread` 규칙 가운데 필요한 것만 옮기고 고지 주석을 단다. 쪽 사이 간격은 가로에서 12(세로의 쪽 아래 12에 대응), 펼침의 두 쪽 사이도 12. 여백 규칙은 Task 3의 `roomAfterJump`(가로 흐름은 `flow: 'horizontal'`).
- 키(`stageKeys.ts`): 가로 — 스페이스·⇧스페이스·PageDown·PageUp은 무대 폭만큼 가로로, ←·→는 지금처럼 쪽 넘김. 한 쪽씩 — ↓·스페이스·PageDown이 쪽 아래끝에서 다음 쪽으로, ↑·⇧스페이스·PageUp이 쪽 위끝에서 이전 쪽으로(끝이 아니면 스크롤). 이전·다음(Task 3)은 펼침이면 두 쪽씩, 펼침의 첫 쪽에 맞춤.
- 한 쪽씩의 트랙패드·휠: pdf.js 6.4.299의 `PAGE` 모드에서 휠이 쪽을 넘기는지 먼저 확인한다. 넘기지 않으면 그대로 둔다(키·셰브런으로 넘김). 결과를 보고서와 명세 5절의 판정 자리에 한 줄로 적는다.
- 기억(P-11): `onArea`가 locator에 `scroll`·`spread`(기본값이면 빼도 된다)와 `pages`(= `pagesCount`)를 넣는다. `restore`는 모드를 먼저 적용하고 확대·쪽을 놓는다. 옛 값(필드 없음)은 세로·없음.
- 명령 전수(P-17): `commands-coverage.spec.ts:620`의 접두어 비교를 `M7A_COMMANDS`·`M7B_COMMANDS`의 정확한 id 비교로 바꾸고, 이 작업의 여섯 명령을 `M7B_COMMANDS`에 더한다.

시험:
- 단위: `reading.test`(새 필드 왕복, 모르는 값 거부, 옛 값), `stageKeys.test`(모드별 키 동작), `commands.test`(하위 메뉴 묶음의 멤버가 메뉴 자리 없이 묶음이 자리를 가짐 — `pageColor`와 같은 규칙).
- E2E `view-modes.spec.ts`(1024로도): 가로로 바꾸면 `.pdfViewer.scrollHorizontal`이고 →가 다음 쪽 · 가로에서 펼침 메뉴 꺼짐 · 펼침 홀수면 1쪽 혼자, 2·3쪽 나란히(쪽 div의 top이 같음) · 한 쪽씩에서 PageDown이 쪽 끝에서 다음 쪽 · 모드를 바꾸고 다시 실행하면 같은 모드와 같은 쪽(자료마다 — 다른 자료는 세로) · 가로에서 쪽 필드 이동의 왼쪽 여백(첫 쪽 24, 나머지 12).
- `commands-coverage`: 여섯 명령이 메뉴로 실행됨.

- [ ] **Step 1**: 단위 시험을 쓰고 실패를 본다.
- [ ] **Step 2**: locator·명령·묶음을 구현해 단위 시험을 통과시킨다.
- [ ] **Step 3**: E2E를 쓰고 실패를 본다.
- [ ] **Step 4**: 모드 적용·CSS·키·기억을 구현해 통과시킨다. 한 쪽씩 휠 동작을 확인해 적는다.
- [ ] **Step 5**: 명령 전수 정확 비교, 전체 녹색 + 1024.
- [ ] **Step 6**: 커밋 `feat(reader): scroll and spread modes — vertical, horizontal or a page at a time, no spreads, odd or even, from the view menu and the menu bar, remembered per item with the page count; the command ledger compares exact ids`.
- 컨트롤러: 디자인 비평(목업 `view=menu*`·`scroll=*`·`spread=odd` 대 투어 PNG).

---

### Task 9: 라이브러리 항목 패널의 '읽기' 절

**Files:**
- Create: `R/inspector/ReadingSection.tsx`, `R/inspector/readingLine.ts`(+ 시험)
- Modify: `R/inspector/InfoPane.tsx`(`ItemInfo`에 라이브러리일 때만), `R/inspector/sections.ts`(`SectionId`에 `'reading'`), `R/strings/*`, `E/inspector.spec.ts`

**Interfaces:**
- Consumes: Task 8 locator `pages`, `reader:getPosition`(조사 7.5), `formatDate`(조사 8), `ProgressBar`(`wide`).
- Produces: `readingLine(position: ReadingPosition, now: Date): string`.

요구 사항(명세 7절, 승인 목업):
- 자리: 라이브러리 항목 패널의 머리 아래, 정보 절 위. 리더의 항목 패널(`ReaderInfo`)에는 없다.
- 내용: `ProgressBar wide`(두꺼운 변형이 목업에 있으면 그 모양 — 토큰으로) + 퍼센트(`tabular-nums`), 아래 한 줄(footnote 2차색): PDF `"{page} / {pages}쪽에서 멈춤 · {날짜}"`, `pages` 없으면 `"{page}쪽에서 멈춤 · {날짜}"`, 영상 `"{m:ss 또는 h:mm:ss}에서 멈춤 · {날짜}"`. `page = locator.pageIndex + 1`. 날짜는 `formatDate(openedAt ?? updatedAt, now)`. 퍼센트는 진행 열과 같은 계산(`progressShown` — 100%면 "✓ 완료" 모양을 진행 열과 같게).
- 없을 때: 위치가 없으면(한 번도 연 적 없음) 절이 없다. 여러 개 선택·휴지통 보기에서도 없다. `progress === null`(열었지만 읽기 전)이면 막대 없이 줄만.
- 읽기: `useQuery(['reading', itemId], () => api().reader.getPosition({ itemId }))`, `libraryChanged`의 `position`·`opened`(그 자료)가 오면 무효화.
- 절 접힘은 다른 절처럼 `useSections`(`reading` 기본 열림).

시험:
- 단위 `readingLine.test.ts`: PDF(쪽 수 있음/없음), 영상(59초, 1:02:03), 오늘/어제/날짜.
- E2E: `paper-100`을 열어 쪽 12로 가고 라이브러리로 → 그 행을 고르면 '읽기' 절 "12 / 100쪽에서 멈춤 · 오늘 …"과 막대 · 연 적 없는 자료는 절이 없음 · 두 개 고르면 없음 · 리더의 항목 패널에는 없음.

- [ ] **Step 1**: 단위 시험 → 실패 → `readingLine` 구현 → 통과.
- [ ] **Step 2**: E2E → 실패 → 절 구현 → 통과.
- [ ] **Step 3**: 전체 녹색.
- [ ] **Step 4**: 커밋 `feat(library): the item panel's reading section — the progress bar and where reading stopped ("12 / 30쪽에서 멈춤 · 어제"), in the library only`.
- 컨트롤러: 디자인 비평(목업 `reading=*` 대 투어 PNG).

---

### Task 10: 사이드바 고침 (썸네일 · 목차 · 쪽 다시 그리기)

**Files:**
- Modify: `R/viewers/pdf/ThumbnailList.tsx`, `R/viewers/pdf/OutlineTree.tsx`, `R/viewers/pdf/outline.ts`(+ 시험), `R/viewers/pdf/PdfDocumentView.tsx`(쪽 실패 다시 그리기), `R/viewers/pdf/displayChange.ts`(재사용), CSS, `R/strings/*`, `E/reader-pdf.spec.ts`

요구 사항(명세 8절, 조사 4):
- 썸네일 DPR: `watchDevicePixelRatio`로 배율이 바뀌면 캐시를 비우고 다시 그린다(그리기 효과의 의존에 DPR 값을 넣는다).
- 썸네일 실패: 실패한 쪽은 한 번(그 쪽이 다시 보이게 될 때) 다시 시도하고, 두 번째도 실패하면 실패 모양(회색 칸 `--fill-secondary`류 토큰 + 가운데 경고 아이콘 16 + 쪽 번호는 그대로, `data-failed="true"`, `aria-label` "{n}쪽 — 미리 보기를 만들 수 없습니다").
- `aria-activedescendant`(m-9): 행마다 `id="pdf-thumb-{n}"`, 목록에 `aria-activedescendant="pdf-thumb-{current}"`(가상화로 행이 DOM에 없을 때는 지금 쪽이 늘 보이게 스크롤되므로 있다 — 없으면 속성을 뺀다).
- 목차: 항목이 200개 넘으면 펼친 행만 평평하게 만들어 `@tanstack/react-virtual`로 가상화한다(RAC `Tree`의 키보드·aria를 지키는 방법이 있으면 그것을, 없으면 `role="tree"`/`treeitem` + `aria-level`·`aria-expanded`·`aria-setsize`·`aria-posinset`을 직접 — 판단을 보고서에). 200개 이하는 지금 그대로.
- `outlinePages`: 순차 `await` 대신 32개씩 `Promise.all`로 풀고, 묶음마다 상태를 한 번 갱신한다(쪽 번호가 차례로 나타남).
- `useOutline`이 처음에 옛 문서의 내용을 한 번 그리던 것: 문서가 바뀌면 상태를 `loading`으로 먼저 돌린다(같은 렌더 안에서 — 키로 리셋하거나 문서 비교).
- 쪽 그리기 실패(조사 3.3): 실패한 쪽은 다음에 보이게 될 때 한 번 다시 그린다(`pageView.reset()` 뒤 렌더 큐에 다시). 두 번째 실패면 지금의 실패 표시.

시험:
- 단위 `outline.test.ts`: 묶음 풀기가 순서를 지키고 취소되면 멈춤.
- E2E `reader-pdf.spec.ts`에 더함: DPR 바꾸기(`page.emulateMedia`가 안 되면 CDP `Emulation.setDeviceMetricsOverride`의 `deviceScaleFactor`) 뒤 썸네일 캔버스 폭이 배율을 따라감 · 썸네일 그리기를 E2E 훅으로 한 번 실패시키면 다시 시도로 그려짐, 두 번 실패시키면 `data-failed` · 목록의 `aria-activedescendant`가 지금 쪽을 가리킴 · 큰 목차 fixture가 없으면 단위 수준(가상 목록 컴포넌트)으로 300항목 렌더 시험.

- [ ] **Step 1**: 시험 → 실패.
- [ ] **Step 2**: 구현 → 통과.
- [ ] **Step 3**: 전체 녹색 + 1024.
- [ ] **Step 4**: 커밋 `fix(reader): thumbnails redraw at a new pixel ratio, retry a failed drawing once and then show it failed, and name the current row to assistive tech; a long outline is virtualised and its page numbers resolve in batches; a page that failed to draw is drawn again once`.

---

### Task 11: 나머지 고침

**Files:**
- Modify: `R/viewers/pdf/usePageColor.ts`(+ `PdfDocumentView`), `R/app/MainWindow.tsx` 또는 `R/shell/useInspector.ts`(오른쪽 패널 폭 0 한 프레임), `R/viewers/pdf/PdfReader.tsx`(찾기 막대 관찰자), `R/viewers/pdf/PdfDocumentView.tsx`(낡은 핸들), `M/sheets.ts`·`M/index.ts`(⌘/ 시트 키), `R/viewers/usePosition.ts`·`R/viewers/positionSaver.ts`·`M/ipc/reader.ts`(타이머), `R/translation/prefs.ts`·`store.ts`(설정 전 누름), `E/reader-pdf.spec.ts`(pagesinit 전 실패)

요구 사항(명세 8절, 조사 5.2·9·3.1·12·7.4·10):
- 쪽 색 깜빡임: 설정을 읽기 전에는 쪽 색 속성을 쓰지 않는다(`data-page-color`를 읽은 뒤에만 — 첫 프레임에 'auto'로 칠했다가 바꾸지 않게). Boot에서 `reader.pageColor`를 미리 읽어 두는 방법도 된다(조사 7.2의 관문 패턴).
- 오른쪽 패널 폭 0 한 프레임(PDF를 열 때): 원인을 찾아 첫 프레임부터 저장된 폭으로 그린다. 원인을 고친 근거를 커밋 본문에.
- 찾기 막대 관찰자(조사 9): 효과가 `.pdf-scroll` 노드 자체를 의존으로 갖게 한다(`PdfDocumentView`가 콜백 ref나 상태로 노드를 알림) — 보기가 다시 붙으면 새 노드를 본다.
- 낡은 핸들(조사 3.1): `setHandle(handle)`을 `viewer.setDocument` 이후 성공 경로의 끝으로 옮기거나, 예외 때 `setHandle(null)`·`teardown`을 보장한다.
- ⌘/ 시트 키(조사 12): `sheetHeightKey`에 `view`를 넣는다.
- 저장 타이머: `beforeunload`에서 `flush()` 뒤 `dispose()`. main `announcePosition`의 타이머는 창이 닫힐 때 정리한다(`windows` 맵의 타이머를 지움).
- 번역 설정 전 누름(Task 10 Minor 6, 조사 10): `saveTranslationPrefs`가 질의가 풀리지 않았으면 먼저 `queryClient.fetchQuery(keys.prefs)`로 읽고 합친다(기본값으로 덮어쓰지 않는다).
- pagesinit 전 뷰어 실패(Task 5 minor): 시험 훅으로 `viewer.setDocument` 전 실패를 일으켜 실패 화면이 나오는 E2E.

시험:
- 단위: `sheetHeightKey`가 보기마다 다름, `saveTranslationPrefs`가 풀리지 않은 질의에서 저장된 언어를 지킴(가짜 api), 위치 저장기의 `dispose` 뒤 타이머 없음.
- E2E: 쪽 색 세피아로 두고 다시 실행해 PDF를 열 때 `data-page-color`가 처음부터 `sepia`(첫 값 기록) · 찾기 막대 관찰자(보기를 다시 붙인 뒤 `--stage-scrollbar`가 새 노드 값) · pagesinit 전 실패 화면 · 오른쪽 패널 첫 프레임 폭(열자마자 `inspector` 폭 > 0).

- [ ] **Step 1**: 시험 → 실패.
- [ ] **Step 2**: 구현 → 통과.
- [ ] **Step 3**: 전체 녹색.
- [ ] **Step 4**: 커밋 `fix(reader): no first frame in the wrong page colour or with a zero-width panel, the find bar's scrollbar watch follows a re-attached view, no stale handle after a failed start, the shortcuts sheet's height is kept per view, position timers end with the window, and translation consent keeps the stored languages`.

---

### Task 12: 성능 측정 (명세 12절)

**Files:**
- Create: `V/tabs-perf.evidence.ts`, `V/tabs-perf-math.ts`(+ 시험)
- Modify: `V/budget.ts`(필요하면), `V/perf.evidence.ts`(냉시작 줄에 탭 5개 상태), `playwright.evidence.config.ts`(필요하면)

**Interfaces:**
- Produces: `tabs-perf.json` = `{ budgetMs: { switchKept: 100, switchUnmounted: 2000, historyJump: 250 }, values, runs, linuxCiLimitMs, memory: { rendererPrivateKB: { oneTab, fourTabs } }, overBudget, platform }`.

요구 사항:
- 살려 둔 탭으로 전환: 탭 클릭 → 그 탭의 쪽 캔버스가 보이는 첫 rAF까지(10회 중앙값·최대).
- 내려간 탭으로 전환: 탭 클릭 → 첫 쪽 그림(`pagerendered`)까지(5회, `paper-100`).
- 뒤로/앞으로 한 번: ⌘[ → 대상 쪽 `pagerendered`(또는 이미 그려져 있으면 다음 rAF)까지(10회).
- 냉시작: 저장된 탭 5개로 실행 → `app-ready`(기존 측정 정의 그대로, 5회). 예산 1.5초.
- 메모리: 리더 탭 1개와 4개일 때 렌더러 `process.getProcessMemoryInfo().private`(보고값).
- Linux CI는 예산의 2배를 넘을 때만 실패(`limitFailures`), 넘었지만 2배 안이면 `overBudget`에 적는다.

- [ ] **Step 1**: 계산 시험(`tabs-perf-math.test.ts`) → 실패 → 구현 → 통과.
- [ ] **Step 2**: 측정 spec을 쓰고 Linux에서 돌려 값을 보고서에 적는다.
- [ ] **Step 3**: 커밋 `test(perf): tabs — switching to a kept tab and to an unmounted one, one back jump, a cold start with five saved tabs, renderer memory with one and four reader tabs`.

---

### Task 13: 마무리

**Files:**
- Modify: `E/visual/tour.spec.ts`(+ 기준 PNG), axe 정거장이 있는 spec, `E/keyboard.spec.ts`, `E/commands-coverage.spec.ts`(`M7B_COMMANDS` 완성), `V/demo.evidence.ts`(M7b 장), `docs/design/design-spec.md`(명세 15절), `docs/spec-amendments.md`(13절), `docs/acceptance.md`, `docs/next-session.md`(M7b 결과·M7c 입력·PR 남은 것·로드맵 표의 M7b/M7c 줄), `docs/mac-verification.md`(실행 줄), `docs/superpowers/specs/2026-11-05-m7b-reader-tabs-design.md`(0절 목업 줄·5절 한 쪽씩 판정), `fixtures/generate.mjs`·`fixtures/README.md`(아래)

요구 사항:
- 시험 PDF(명세 13절): `paper-100.pdf` 1쪽에 쪽 안 한 점을 가리키는 링크 하나 — "See figure 2 on page 40."(Dest `[pages[39].ref, XYZ, 56, 600, null]`)를 더하고 `history.spec`에 "a link to a point keeps the point" 한 줄을 더한다(Task 7 시험 파일). fixture 캐시 키가 바뀌는지 확인.
- 투어 장면(라이트·다크): 탭 줄(탭 둘, 넘침), 탭 메뉴는 네이티브라 빼고, 리더 도구 막대 ‹ › 상태, 보기 ▾의 스크롤·펼침 하위 메뉴, 가로·펼침 보기(쪽 캔버스는 가림), 라이브러리 '읽기' 절, 사이드바 접힘 + 탭 줄. 바뀐 장면만 `--update-snapshots=changed -g '<title>'`.
- axe(심각 이상 0건): 탭 줄이 있는 리더, 보기 ▾ 열림, 라이브러리 '읽기' 절.
- 키보드 여정: 라이브러리에서 ↩로 연 뒤 ⌘↩로 하나 더 → 탭 줄로 Tab → ←→로 탭 포커스 → ↩로 고름 → ⌥⇧→ → 리더에서 쪽 필드 ↩ → ⌘[ → ⌘] → 보기 ▾에서 키로 펼침 홀수 → esc, 마우스 없이.
- 명령 전수: `M7B_COMMANDS`가 이 계획의 새 명령 전부(Task 6·7·8 = 17 + 2 + 6 = 25개)이고 모두 실행 기록에 있다.
- 데모(`demo.evidence.ts`, 장 목록, 3–4분): 논문 셋을 ↩·⌘↩로 탭에 열기 → ⌘숫자·⌃⇥로 오가기 → 인용 링크 따라가기 → ‹ 뒤로 · › 앞으로 → 목차로 장 이동 → 보기 ▾ 펼침 홀수 · 한 쪽씩 → 탭 끌기 → 종료 후 다시 열기(탭·순서·자리 그대로) → 라이브러리의 '읽기' 절. 자막은 합니다체.
- 문서: 디자인 명세(명세 15절의 일곱 줄, P-7의 윈도우 메뉴 정정), `spec-amendments.md` 13절(M7b·M7c 분할, 소유자 결정, 사전 판정 P-6·P-7·P-12·P-13·P-18), `acceptance.md`(M7b 완료 조건 절 — 근거 실행 줄은 컨트롤러가 채움), `next-session.md`("M7b 결과" 절, M7c 입력, PR 남은 것, 로드맵 표 M7b 줄 고침·M7c 줄 더함, 실기에서만 확인할 것: 마우스 옆 단추·트랙패드 쓸기·4탭 메모리), `mac-verification.md`(중간 실행 줄). `next-session.md`에는 명세 8절의 "그대로 두는 것"과 그 이유도 적는다.
- 컨트롤러: 전체 녹색 확인 → push → CI → Mac `all` → Mac PNG 비평(라이트·다크 데모 프레임) → 데모 영상(SendUserFile) → opus 브랜치 전체 검토 → 고침 한 번 → PR(본문 끝 Global Constraints의 두 줄). 병합은 소유자가 "병합해"라고 할 때만.

- [ ] **Step 1**: 시험 PDF 링크, 투어·axe·키보드·명령 전수 시험을 더하고 통과시킨다. 투어에 탭 줄 상태를 더한다(Task 5 비평 m2): `tabs-sidebar-hidden-*`(접힘 + 탭 줄), `tabs-overflow-*`(탭 12개), `library-tabs-*`(검색이 있는 머리), `tab-states-light`(호버·키보드 포커스·닫기 호버).
- [ ] **Step 2**: 데모 장을 만들고 Linux에서 한 번 돌려 본다(`scripts/record-demo-linux.sh`가 있으면).
- [ ] **Step 3**: 문서를 고친다.
- [ ] **Step 4**: 커밋 `docs(m7b): design-spec and amendments §13, acceptance, next-session M7b results and M7c inputs, the roadmap's M7b and M7c rows; tour, axe, keyboard journey, the M7b command ledger, a link to a point in the paper fixture, the M7b demo`.
