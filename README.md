# Learn

자료를 소유하고, 마음껏 필기하며, 나를 이해하는 튜터와 공부하는 로컬 우선 데스크톱 학습 앱. 제품 명세는 [`docs/spec.html`](docs/spec.html).

> 현재 상태: 첫 세션(P0 + 자료 기반 최소 수직선). PDF·동영상 가져오기/열기까지 동작한다. 필기(P2), 튜터(P3), 기억·복습(P4)은 아직 없다. 진행 상황은 [`docs/acceptance.md`](docs/acceptance.md).

## 요구 사항
- Node 22.12+, pnpm 10.15 (`corepack enable`)
- macOS: Xcode Command Line Tools(better-sqlite3 소스 빌드)
- Linux 헤드리스 검증: `xvfb-run`, fixture 생성: `ffmpeg`(libx264)

## 실행
    pnpm install
    pnpm dev            # 개발 실행 (Vite HMR)
    pnpm build && pnpm --filter @learn/desktop start   # 빌드본 실행

라이브러리 위치는 기본적으로 macOS `~/Library/Application Support/Learn/Library`, Linux `~/.config/Learn/Library`이다. 다른 폴더를 쓰려면 `LEARN_LIBRARY_DIR=/path/to/Library pnpm dev`.

## 검증
    pnpm typecheck
    pnpm test           # 단위·통합 (vitest)
    pnpm fixtures       # 테스트용 PDF·동영상 생성 (이미 있으면 건너뜀, 없는 동영상을 만들 때만 ffmpeg 필요)
    pnpm e2e            # Electron E2E (macOS/데스크톱)
    pnpm e2e:xvfb       # Electron E2E (헤드리스 Linux)
    pnpm tokens         # 디자인 토큰 생성 (tokens.ts → tokens.css, tokens.generated.ts)
    pnpm mockups:render # 디자인 목업 렌더 (docs/design/renders, 대조표 docs/design/contact-sheet-*.jpg)

E2E 스크립트는 빌드 후 `pnpm fixtures`를 자동으로 실행한다. fixture를 다시 만들려면 `node fixtures/generate.mjs --force`. E2E 스크린샷과 trace는 `test-results/`에 남는다.

## macOS 증거 레인

Mac이 없는 헤드리스 서버에서 GitHub의 Apple Silicon 러너(`macos-15`, M1 VM 3 vCPU / 7 GB)로 앱을 빌드·실행하고 스크린샷·녹화·측정값을 내려받는다. 결과와 실행 기록은 [`docs/mac-verification.md`](docs/mac-verification.md).

    scripts/evidence.sh <branch> <suite> <label> [runner] [packaged]
    scripts/evidence.sh m0-evidence baseline m0-baseline            # 예
    scripts/evidence.sh m0-evidence evidence m0-spikes macos-15 true

- 워크플로 `.github/workflows/macos-evidence.yml`은 수동 실행(`workflow_dispatch`)만 받는다. suite는 Playwright 태그(`@baseline`, `@evidence` …, `all`은 전체)이고, `e2e`와 `all`은 기능 E2E(`tests/e2e`)도 돌린다. 증거 테스트가 하나도 선택되지 않는 suite(`all`, `e2e` 제외)는 바로 실패한다. 각 단계에는 시간 제한(증거 12분, 기능 E2E 8분)이 있어 멈추면 그 단계만 실패하고 artifact는 항상 올라간다. `packaged=true`면 `electron-builder --dir` 앱(인증서 서명 없음, 워크플로가 ad-hoc 서명)도 만들어 실행한다.
- 내려받은 결과는 `evidence/<label>/<run_id>/`(gitignore): `evidence/`(PNG, `env.json`, `baseline.json`, `spikes.json`, 리포트), `demo/`(녹화), `run.json`(잡별 소요 분, 다운로드 속도). `EVIDENCE_RUN_ID=<id>`를 주면 새로 실행하지 않고 기존 실행을 다시 내려받는다.
- **분 예산 주의**: 비공개 저장소의 macOS 분은 10배로 차감된다. 디버깅은 이 서버의 xvfb(`pnpm e2e:evidence`를 `xvfb-run`으로)와 Linux CI(`ci.yml`, 증거 하네스도 실행)에서 먼저 끝내고, 실행할 때마다 `docs/mac-verification.md` 실행 기록 표에 run id·분·결과를 남긴다.
- 증거 하네스: `playwright.evidence.config.ts`, `tests/evidence/`(`capture.ts` 페이지·창·전체 화면 캡처, 녹화, 실제 글꼴 조회 / `env.ts` 환경 보고). macOS 전용 캡처는 다른 OS에서 `skipped`로 기록된다.

## 구조
- `packages/domain` 타입·스키마·Result · `packages/db` SQLite·마이그레이션 · `packages/library` 가져오기·복구·백업
- `apps/desktop` Electron(main/preload/renderer) · `docs/decisions` ADR · `docs/p0-verification.md` P0 기록
- `docs/design` 디자인 명세·목업·비평 기준 · `apps/desktop/src/renderer/src/design` 토큰·글꼴(Pretendard, OFL)

## 문제 해결
- Electron 44 npm 패키지에는 postinstall이 없다. `pnpm install`은 바이너리를 받지 않고, 첫 `require('electron')` 또는 첫 실행(`pnpm dev`, E2E) 때 지연 다운로드한다. GitHub 릴리스 연결이 느려 이 단계에서 멈추면 해당 버전 zip을 따로 받아 `electron` 패키지의 `checksums.json` sha256과 대조한 뒤 `@electron/get` 캐시(`~/.cache/electron/<sha256(릴리스 URL 디렉터리)>/`, macOS는 `~/Library/Caches/electron/…`)에 두고 다시 실행한다. 자세한 내용은 `docs/p0-verification.md` #10.
