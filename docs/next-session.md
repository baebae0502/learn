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

- Apple Silicon에서 `pnpm install && pnpm e2e`(fixture 생성에 ffmpeg 필요). seek 오차·첫 PDF/영상 표시 시간 기록(AC16 기준 장비).
- HEVC 재생 여부 기록(`fixtures/generated/sample-hevc.mp4`).
- 기본 라이브러리 위치 `~/Library/Application Support/Learn/Library` 확인.
- `pnpm dev`(Vite dev server, CSP 없음 + dev 전용 CORS 경로)를 수동으로 한 번 실행해 기록 — 자동 테스트는 빌드본만 검증한다.
- PPTX 변환(LibreOffice) 경로와 라이선스 확인(P5 준비).
- 패키징(P6): electron-builder, 서명, Electron fuses, hardened runtime JIT 권한.
