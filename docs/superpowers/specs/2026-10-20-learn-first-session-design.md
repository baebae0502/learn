# Learn — 첫 세션 설계 (P0 + 자료 기반 최소 수직선)

- 날짜: 2026-10-20
- 상위 문서: [`docs/spec.html`](../../spec.html) (Learn 개발 인계 명세 v1.0). 이 문서는 상위 명세를 반복하지 않고, 첫 세션에서 만드는 범위와 새로 확정한 결정만 기록한다. 충돌 시 상위 명세가 우선하며, 상위 명세를 바꿔야 하면 ADR로 남긴다.

## 1. 확정된 결정

| 항목 | 결정 | 근거 |
|---|---|---|
| 사용 플랫폼 | macOS 우선 (명세 기본값). 개발·자동 검증은 headless Linux 서버(g01)에서 xvfb로 수행 | 사용자 선택. macOS 패키징·서명·실사용 검증은 Mac에서 별도 수행 |
| 세션 범위 | 명세 15절 "첫 세션 산출물"까지 후 보고 | 사용자 선택 |
| 툴체인 | electron-vite + React + TypeScript, pnpm workspace, better-sqlite3, vitest, Playwright(`_electron`), electron-builder | 사용자 선택(안 A) |

## 2. 첫 세션 산출물 (완료 정의)

1. runnable 앱: `pnpm dev`로 실행, 3단 레이아웃, 한국어 UI
2. P0 검증 기록 `docs/p0-verification.md` (실측값 포함) + ADR 3개
3. 초기 schema/migration (v1) + 마이그레이션 실행기 + 일관 백업/복원
4. 파일 가져오기(managed/linked), 중복 감지, missing 표시, 복구 스캔
5. PDF·영상 열기 smoke (Playwright E2E, xvfb)
6. `docs/acceptance.md` AC01–AC20 추적표

**범위 밖 (다음 세션):** 필기/앵커 저장 UI, 재개 위치, 튜터, 기억, 검색 UI, 추출 job 실행기, EPUB/PPTX/웹 뷰어, macOS 패키징 검증.

## 3. 저장소 구조

```
apps/desktop/
  src/main/        # 앱 수명주기, 창, IPC 핸들러, learn-asset 프로토콜, 서비스 조립
  src/preload/     # contextBridge로 capability API만 노출
  src/renderer/    # React UI (Library, PdfViewer, VideoViewer, TutorPanel 자리)
packages/
  domain/          # ID(UUID), Result/에러 코드, Anchor discriminated union(zod), IPC 계약 스키마
  db/              # better-sqlite3 연결, migration runner, repositories, backup
  library/         # import 파이프라인, 중복/missing 판정, recovery scan (Electron 비의존)
fixtures/          # 생성 스크립트 + 생성물(gitignore), 출처 기록
tests/e2e/         # Playwright Electron 테스트
docs/              # spec.html, decisions/, acceptance.md, p0-verification.md
```

패키지 의존 방향: `domain` ← `db` ← `library` ← `apps/desktop/main`. renderer는 `domain`의 타입·스키마만 import한다.

## 4. 라이브러리 디렉터리

- 기본 위치 `<app.getPath('userData')>/Library/`, 환경변수 `LEARN_LIBRARY_DIR`로 재정의(테스트·다중 프로필).
- 구성: `library.sqlite`, `assets/<sha256 앞 2자>/<sha256>`, `staging/`, `derived/`, `exports/`.
- 관리형 파일 이름은 해시만 사용한다. 표시 이름은 DB(`items.title`, `assets.original_name`)에 둔다.

## 5. 스키마 v1 (migration 001)

명세 8절의 테이블 중 P0–P2에 필요한 것만 v1에 넣는다. 튜터(conversations/messages/message_sources), 기억(concepts/memory_claims/memory_evidence), 이벤트(sessions/events), 복습(reviews/review_attempts), FTS5 테이블은 해당 단계에서 별도 migration으로 추가한다.

- `schema_migrations(version, applied_at)`
- `items(id, type, title, metadata_json, created_at, updated_at, deleted_at)`
- `assets(id, sha256, storage_mode['managed'|'linked'], relative_path, external_path, original_name, mime, size, availability['available'|'missing'], created_at, checked_at)` — `storage_mode`와 경로 필드 일치를 CHECK로 강제
- `item_assets(item_id, asset_id, role['original'|'subtitle'|'derived'])`
- `source_revisions(id, asset_id, hash, parent_revision_id, renderer_version, created_at)`
- `collections(id, name, parent_id, created_at)`, `collection_items(collection_id, item_id)` — 순환 금지는 repository에서 검사
- `tags(id, name UNIQUE)`, `item_tags(item_id, tag_id)`
- `anchors(id, revision_id, kind, locator_json, quote, status['ok'|'review'|'orphan'], schema_version)`
- `annotations(id, anchor_id, type, body_json, color, version, operation_id UNIQUE, created_at, updated_at, deleted_at)`
- `jobs(id, kind, dedupe_key UNIQUE, state['queued'|'running'|'done'|'failed'|'interrupted'|'cancelled'], attempts, progress, error, payload_json, created_at, updated_at)`
- `settings(key, value)` — 비밀키 저장 금지

연결 설정: `foreign_keys=ON`, `journal_mode=WAL`, `synchronous=NORMAL`, `busy_timeout`. 모든 쓰기는 main 프로세스의 단일 연결에서 짧은 트랜잭션으로 수행한다(better-sqlite3는 동기식이므로 단일 연결이 곧 단일 쓰기 큐다). ID는 UUID v4, 시각은 UTC ISO-8601.

마이그레이션 실행기: 버전 순서 적용, 각 migration은 트랜잭션, 적용 전 기존 DB가 있으면 `library.sqlite.pre-v<N>.bak`로 백업 API 스냅샷. 실패 시 롤백하고 오류를 반환한다(앱은 열리지 않고 복구 안내를 표시).

## 6. 가져오기 파이프라인

`library.import({paths, mode, collectionId?})`:

1. **검사**: 존재·일반 파일·읽기 권한·크기. MIME은 확장자+매직 바이트로 판정(PDF `%PDF-`, MP4 `ftyp`). 지원 외 형식은 `UNSUPPORTED_TYPE`.
2. **해시**: 스트리밍 sha256.
3. **중복**: 같은 sha256 asset이 있으면 `{status:'duplicate', existingItemId}`를 반환하고 아무것도 쓰지 않는다. UI가 "새 자료로 / 기존 항목 열기"를 묻는다(`allowDuplicate:true`로 재요청 시 기존 asset을 공유하는 새 item 생성).
4. **managed**: `staging/<uuid>.part`로 복사 → 복사본 해시 재검증 → `assets/<p>/<hash>`로 `rename`(같은 파일시스템, 원자적). 대상이 이미 있으면(같은 해시) rename 대신 staging 삭제.
   **linked**: 복사하지 않고 `external_path` 기록.
5. **커밋**: 하나의 트랜잭션에 item + asset + item_asset(original) + source_revision(+collection_item) + job(`extract:<hash>:<extractorVersion>`, queued) 기록.
6. 원본 파일은 절대 수정·삭제하지 않는다.

**복구 스캔(앱 시작 시)**: `staging/` 잔여 파일, DB에 참조 없는 `assets/` 파일, DB에는 있으나 파일이 없는 managed asset을 수집해 리포트로 반환한다. 자동 삭제하지 않는다. `running` job은 `interrupted`로 바꾼다.

**missing 판정**: linked asset은 열기/목록 조회 시 `stat`으로 존재 확인 → `availability` 갱신. 재연결 `library.relink({assetId, path})`는 해시가 일치할 때만 경로를 바꾸고, 불일치면 `HASH_MISMATCH`(새 revision 처리는 P1 후반).

## 7. IPC·보안

- BrowserWindow: `sandbox:true`, `contextIsolation:true`, `nodeIntegration:false`, `webSecurity:true`. `will-navigate` 차단, `setWindowOpenHandler`는 deny(안전한 http(s)만 `shell.openExternal`).
- CSP: `default-src 'self'; script-src 'self'; img-src 'self' data: blob: learn-asset:; media-src learn-asset:; connect-src 'self' learn-asset:; worker-src 'self' blob:; object-src 'none'` (dev 서버용 완화는 dev 빌드에서만).
- preload는 `window.learn`에 명령별 함수만 노출. 각 명령은 main에서 zod로 검증하고 `{ok:true,data} | {ok:false,code,message,retryable}`를 반환. 예외는 핸들러 경계에서 오류 코드로 변환.
- 첫 세션 명령: `library.pickAndImport`, `library.import`, `library.list`, `library.get`, `library.relink`, `library.recoveryReport`, `app.info`.
- 파일 선택은 main의 `dialog.showOpenDialog`. 드래그&드롭은 preload의 `webUtils.getPathForFile`로 경로를 얻어 `library.import`에 전달(경로는 main에서 재검증).
- `learn-asset://asset/<assetId>`: main이 assetId로 DB 조회 → 경로 해석(관리형은 라이브러리 루트 하위인지 검증) → `Range` 헤더 지원(206/416), `Content-Type`은 DB의 mime. 렌더러는 파일 경로를 모른다.

## 8. 화면

- 상단 바: "Learn", 저장 상태 표시(실제 DB 쓰기 결과 기반).
- 좌측: 전체 자료(개수), 컬렉션 목록(생성 UI는 P1).
- 중앙(라이브러리 모드): 제목·종류·크기·가용 상태·추가일 테이블, "자료 가져오기" 버튼(관리형/외부 연결 선택), 드롭 영역. 중복 시 확인 대화상자. missing 항목은 배지와 "재연결".
- 중앙(뷰어 모드): PdfViewer — pdf.js(`pdfjs-dist`) canvas 렌더, 이전/다음 쪽, 쪽 번호, 배율(50/100/200%), 워커는 번들된 로컬 파일. VideoViewer — `<video src="learn-asset://...">`, 기본 컨트롤, 재생 오류 시 `MediaError` 코드와 원인 안내("이 코덱은 지원되지 않습니다…").
- 우측: 튜터 패널 자리. 비활성 상태로 "튜터는 P3에서 구현됩니다" 표기. 닫기 가능.
- 라이브러리 열기 실패(마이그레이션 실패 등)는 전체 화면 오류와 복구 안내.

## 9. P0 검증 항목 (`docs/p0-verification.md`)

각 항목에 방법·기대값·실측값·환경(서버/xvfb/Electron 버전)·판정을 기록한다.

1. Electron이 xvfb에서 실행되고 sandbox 렌더러가 로드된다.
2. better-sqlite3가 Electron ABI로 로드되고 WAL·FTS5(`CREATE VIRTUAL TABLE ... USING fts5`)·`backup()`이 동작한다. 같은 바이너리로 `ELECTRON_RUN_AS_NODE=1` vitest가 동작한다.
3. pdf.js가 sandbox 렌더러 + CSP 하에서 워커로 렌더한다(캔버스 비어 있지 않음).
4. H.264/AAC MP4가 `learn-asset://`로 재생되고 Range 요청이 발생한다. seek 목표 대비 `currentTime` 오차를 기록(AC05 목표 500ms).
5. 미지원 코덱 파일(예: HEVC)에서 오류가 사용자에게 원인과 함께 표시된다. 결과는 "Linux Electron 기준"으로 명시하고 Mac에서 재확인 항목으로 남긴다.
6. EPUB 렌더러 후보 비교표(라이선스, 유지보수, CFI 지원, 스크립트 차단 가능성): foliate-js, epub.js, Readium ts-toolkit. 구현 없음.
7. PPTX: 서버에 LibreOffice 없음 → 변환 경로는 "미검증(Mac에서 확인)"으로 기록하고, 부재 시 "사용자 PDF 병행 가져오기" 대체 경로를 명시. 라이선스(MPL-2.0) 메모.
8. 코덱·변환기·주요 의존성 라이선스 표.

## 10. ADR

- `0001-runtime.md`: Electron + electron-vite 채택, Tauri 미채택 근거(영상 코덱 일관성 — Electron은 Chromium 자체 미디어 스택 사용, OS 웹뷰 차이 없음), 재검토 조건.
- `0002-anchor-coordinates.md`: PDF는 회전 전 PDF user space quad + quote, 영상은 ms 구간 + letterbox 제외 정규화 rect(프레임 해상도 동반), 모든 앵커는 `revisionId`에 귀속, `schemaVersion` 필드.
- `0003-storage-layout.md`: 라이브러리 디렉터리, 해시 기반 관리형 저장, linked 이식성 한계, 백업 = SQLite backup API 스냅샷 + 자산 manifest + schema version.

## 11. 테스트

- **단위/통합(vitest, `ELECTRON_RUN_AS_NODE=1`)**
  - migration: 빈 DB → v1, 재실행 멱등, 실패 migration 롤백·백업 존재
  - import managed: 결과 파일 해시 일치, 원래 경로 이동 후에도 열림(AC01 일부)
  - import 중단: staging 단계/rename 직후/커밋 전 각각에서 실패 주입 → DB에 반쪽 레코드 없음, 복구 스캔이 잔여물을 보고
  - 중복: 같은 파일 두 번 → `duplicate`, 원본 보존(AC02)
  - linked: 원본 이동 → `missing`, 재연결 성공/해시 불일치 거부
  - 한글·공백·특수문자 경로
  - backup/restore: 빈 프로필에 복원 → 자산 해시·item 수 일치(AC15 일부)
  - `learn-asset` Range 파서: 정상/열린 범위/suffix/범위 초과(416)
- **E2E(Playwright `_electron`, xvfb)**
  - 앱 시작 → main에서 dialog stub → PDF·MP4 가져오기 → 목록 표시
  - PDF 열기 → 캔버스 픽셀이 비어 있지 않음, 다음 쪽 이동
  - 영상 열기 → `readyState>=2`, 재생, seek 오차 측정
  - 앱 강제 종료(`kill`) → 재실행 → 항목 유지
  - 각 단계 스크린샷을 `test-results/`에 저장
- 각 작업 종료 시 `pnpm typecheck`, `pnpm test`, 해당 시 `pnpm e2e`를 실행한다.

## 12. Fixture

`fixtures/generate.mjs`가 생성한다(생성물은 gitignore, 스크립트와 출처 기록은 커밋). 모두 자체 생성이라 저작권 문제가 없다.

- `sample-h264-aac.mp4`: ffmpeg testsrc2 + sine, 1280×720, 10초, H.264(High)/AAC, `+faststart`
- `sample-hevc.mp4`: 같은 소스 HEVC(libx265 가능 시) — 미지원 코덱 검증용. 인코더가 없으면 생략하고 기록
- `sample.pdf`: 3쪽(2쪽째 90° 회전), 텍스트 포함 — pdf-lib로 생성
- `한글 경로 (테스트) #1.pdf`: 경로 특수문자 검증용 복사본

## 13. 오류 처리 원칙

- 모든 서비스 오류는 `LearnError(code, message, retryable)`로 표준화. 코드 예: `NOT_FOUND`, `UNSUPPORTED_TYPE`, `PERMISSION_DENIED`, `DISK_FULL`, `HASH_MISMATCH`, `DUPLICATE`, `MIGRATION_FAILED`, `VALIDATION_FAILED`, `INTERNAL`.
- 사용자에게는 한국어 메시지와 다음 행동(재시도/재연결/로그 위치)을 표시한다. 조용히 삼키지 않는다.
- 로그는 요청 ID·코드·지연만 기록하고 자료 원문·경로 전체는 기본 제외(경로는 파일명만).

## 14. 남은 확인 사항 (이번 세션에서 결정하지 않음)

- GitHub 원격 저장소 생성 여부와 공개 범위 — 세션 마지막에 사용자에게 확인
- Mac에서의 실행·코덱·패키징 검증 일정
- AI 공급자 선택(P3)
