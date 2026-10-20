# 다음 세션 인계 (2026-10-20 첫 세션 종료 시점)

첫 세션(P0 + 자료 기반 최소 수직선)의 리뷰에서 나왔지만 이번 범위 밖으로 미룬 항목과, Mac에서 확인할 목록이다. 진행 상태는 [`acceptance.md`](acceptance.md), 실측은 [`p0-verification.md`](p0-verification.md).

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

- 마이그레이션 v2 추가 시: 다단계 실패 문구 정정, `LATEST_SCHEMA_VERSION`을 `MIGRATIONS`에서 유도, FK 자식 컬럼 인덱스.
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
- 데모용 커서·키 입력 오버레이(`LEARN_DEMO_OVERLAY`)는 아직 없다.
