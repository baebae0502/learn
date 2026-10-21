# Acceptance 추적표 (AC01–AC20)

- 갱신: 2026-10-21(M2 Linux 증거 반영, M2 Mac 증거는 실행 대기) · 기준: `docs/spec.html` 14절 · 최종 완료 판정은 P6에서 한다. R1 완료를 전체 완료로 보고하지 않는다.
- 상태 범례: `통과`(이번 세션 자동 검증) · `부분`(일부만 자동 검증) · `미착수`. 근거 열의 테스트는 모두 현재 저장소에 존재한다. 상태 판정은 Linux/Xvfb 자동 검증 기준이다.
- 검증(M0 시점): vitest 9개 파일 72개 테스트, Playwright E2E 6개(Linux) 통과. M2 시점: vitest 26개 파일 240개 테스트 통과(`pnpm test`). E2E는 `tests/e2e/`에 20개가 정의돼 있고 그중 ⌘O 1개는 macOS 전용이다.
- **Mac 증거** 열: GitHub macOS 러너(M1 VM, `macos-15`/`macos-26`)에서 얻은 근거. 실행·수치는 [`mac-verification.md`](mac-verification.md). VM 값은 참고값이며 AC16 등 성능 판정은 기준 장비에서 한다. 기능 E2E는 run 39442173392(macOS 15)·39444862608(macOS 26)에서 6개 중 5개 통과(`first-session.spec.ts`가 전체 화면 해제 멈춤으로 시간 초과), 테스트 수정 후 run 39451895620(macOS 15)에서 6/6 통과 + darwin 전용 특성 테스트 1개 예상 실패.

| ID | 요약 | 상태 | 근거 / 남은 일 | Mac 증거 |
|---|---|---|---|---|
| AC01 | 복사 가져오기 후 원래 경로 이동해도 열림, linked는 missing·재연결 | 부분 | `importer.test.ts` "keeps working after the original file is moved away (AC01)", `recovery.test.ts` "marks a moved linked file missing, then relinks only to identical content", `library.spec.ts` "import, duplicate prompt, missing linked file and relink" · 남은 일: MP4 linked E2E | `library.spec.ts` macOS 15·26 통과(run 39442173392, 39444862608, 39451895620) |
| AC02 | 중복 선택 UI, 원본 삭제 없음 | 통과 | `importer.test.ts` "duplicates (AC02)"(원본 유지·내용 기준 중복·`allowDuplicate`), `library.spec.ts` 중복 다이얼로그(취소·추가·열기) | `library.spec.ts` 중복 다이얼로그 macOS 15·26 통과(같은 run) |
| AC03 | PDF 회전·배율에서 필기 위치 유지(2pt) | 미착수 | P2 필기. 좌표 규칙은 ADR-0002, 배율·회전 렌더는 `first-session.spec.ts` "PDF zoom levels keep rendering"·"rapid page and zoom changes never surface a render error" | 배율·빠른 전환 렌더 E2E 2개 macOS 15·26 통과(같은 run). 필기는 P2 |
| AC04 | 영상 letterbox·창 크기 변경 후 정지 프레임 필기 위치(0.5%) | 미착수 | P2 | — |
| AC05 | 시간 메모 클릭 → seek 오차 ≤ 500ms | 부분 | `first-session.spec.ts` seek 측정: 오차 0.46ms, seek 195.7ms (p0-verification #4). 시간 메모는 P2 | seek 오차 중앙값 0.3ms·최대 0.5ms(macOS 15 run 39443464837), 최대 0.8ms(macOS 26 run 39444862608) — [mac-verification](mac-verification.md#기준선-실측) |
| AC06 | 저장 완료 필기·위치가 강제 종료 후 복원, undo/redo | 부분 | `first-session.spec.ts` "…survive SIGKILL"(강제 종료 후 라이브러리·PDF 열기 유지) · **읽기 위치(M2, Linux)**: `position.spec.ts` "PDF reopens on the page it was left on; progress reaches library.list"(PDF 마지막 쪽에서 다시 열림·진행률이 목록에 반영), "video resumes at the paused time after a SIGKILL and relaunch; progress reaches library.list"(영상은 SIGKILL 후 재실행해도 멈춘 시각에서 재개). 저장 주기는 PDF 300ms 디바운스·영상 2초 스로틀이며 일시정지·seek·닫기·`beforeunload`에서 즉시 저장한다(`positionSaver.ts` 단위 테스트). 위치는 `reading_positions` 테이블에 저장되고 백업·복원에 포함된다(`backup.test.ts` counts, ADR-0007). 남은 일: 필기 저장·undo/redo는 P2, 위치 복원의 macOS 실행 | `first-session.spec.ts`(SIGKILL 후 재실행·라이브러리 유지) macOS 15 통과(run 39451895620). 이전 run은 전체 화면 해제 멈춤으로 그 단계 전에 실패([mac-verification](mac-verification.md#추가-발견-html-전체-화면-해제-멈춤-macos-전용)). 읽기 위치 복원(M2): M2 macOS 실행 대기 |
| AC07 | EPUB 글꼴/폭 변경 후 하이라이트 유지 | 미착수 | P5 | — |
| AC08 | PPTX 변환·실패 안내·원본 보존 | 미착수 | P5 (LibreOffice 미설치 서버, Mac 확인) | — |
| AC09 | 웹 스냅샷 offline·스크립트 차단 | 미착수 | P5 | — |
| AC10 | 튜터 인용 클릭 → 같은 revision 위치 | 미착수 | P3 | — |
| AC11 | 선택 밖 자료·제외 기억이 provider 요청에 없음 | 미착수 | P3 | — |
| AC12 | 시청만으로 숙달 claim 없음 | 미착수 | P4 | — |
| AC13 | 근거 삭제 시 파생 claim·인덱스 정리 | 미착수 | P4 | — |
| AC14 | 인터넷 없이 자료·필기·검색·복습, 원격 요청 자동 재전송 없음 | 부분 | 현재 앱은 네트워크 기능이 없다(코드상 원격 호출 없음, 자동 테스트는 없음). 검색·복습·튜터는 이후 단계 | — |
| AC15 | 빈 프로필 복원 시 해시·필기 수·인용·기억 근거 일치 | 부분 | `backup.test.ts` "restores into an empty profile with matching hashes and counts", 손상 백업 감지, manifest 변조·형식 오류·상위 schema 거부, 실패 시 임시 폴더 정리, 관리형 파일 유실 시 `included:false`. 필기·인용·기억은 해당 단계에서 manifest 확장 | — |
| AC16 | 10,000 item 검색 p95 300ms, 첫 PDF 2초, MP4 3초 | 미착수 | P6 성능(기준 장비 Apple Silicon 16GB는 Mac에서). 검색 자체가 P1 | VM 참고값: 첫 PDF 콜드 553–1,589ms / 웜 중앙값 122–220ms, 첫 MP4 콜드 134–1,571ms / 웜 39–57ms(run 39442173392, 39443464837, 39444862608). 기준 장비 아님 |
| AC17 | 필기 입력 반응 p95 50ms | 미착수 | P2/P6 | — |
| AC18 | 키보드 조작·포커스·200% 확대 | 부분 | 모든 조작이 button/select이며 `:focus-visible` 표시. 자동 검증 없음, 수동 점검 체크리스트는 P6 · **메뉴·명령(M2, Linux)**: 명령 레지스트리 `commands.test.ts`(id 유일·같은 맥락 가속기 중복 없음·레이블 비어 있지 않음), `platform.spec.ts` "menu: Korean top-level menus built from the registry, no reload or developer tools"(한국어 최상위 메뉴, 새로 고침 없음, 개발자 도구 없음), "menu: an unpackaged run without LEARN_E2E=1 does show 개발자 도구", "menu command 자료 가져오기… opens the (stubbed) dialog once and adds the item", "menu command 라이브러리로 돌아가기 returns from the PDF viewer to the library", "menu: 편집 carries the native edit roles with Korean labels", "item context menu: right-click a row, pick 열기 → the viewer opens; 다시 연결… is listed disabled". ⌘O가 정확히 1회 처리되는지("⌘O (자료 가져오기…) opens the dialog exactly once")는 Linux/Xvfb에서 CDP 키가 네이티브 가속기에 닿지 않아 건너뛰며 macOS에서만 검증한다. 키보드 전체 점검·200% 확대는 P6 | M2 macOS 실행 대기 |
| AC19 | 악성 HTML·경로 탈출·프롬프트 주입 무해 | 부분 | `primitives.test.ts` "resolveAssetPath"(관리형 경로 탈출 거부), `backup.test.ts` "rejects tampered manifest with path traversal", `url-policy.test.ts`(`learn://app/asset/*` 거부 포함), IPC zod 검증, `protocol.spec.ts`(경로 탈출·잘못된 asset id·Range 206/416·CSP는 HTML에만), 자산 응답 `sandbox; default-src 'none'`. HTML·프롬프트 주입 fixture는 P3/P5 | `protocol.spec.ts` macOS 15·26 통과(run 39442173392, 39444862608) |
| AC20 | 키 없이 신규 설치·mock 구분·서명 배포본에서 PDF·영상 | 부분 | 키 없이 실행됨(`smoke.spec.ts`, `first-session.spec.ts`). 서명·패키징은 P6(Mac) | `smoke.spec.ts` macOS 통과. 서명 없는(ad-hoc) `electron-builder --dir` 앱이 실행되고 PDF 열림, 메뉴바 "Learn"(run 39443865113, 39444862608). 서명·공증 배포본은 P6 |
