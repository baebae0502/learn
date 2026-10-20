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
    pnpm fixtures       # 테스트용 PDF·동영상 생성 (ffmpeg 필요, 이미 있으면 건너뜀)
    pnpm e2e            # Electron E2E (macOS/데스크톱)
    pnpm e2e:xvfb       # Electron E2E (헤드리스 Linux)

E2E 스크립트는 빌드 후 `pnpm fixtures`를 자동으로 실행한다. fixture를 다시 만들려면 `node fixtures/generate.mjs --force`. E2E 스크린샷과 trace는 `test-results/`에 남는다.

## 구조
- `packages/domain` 타입·스키마·Result · `packages/db` SQLite·마이그레이션 · `packages/library` 가져오기·복구·백업
- `apps/desktop` Electron(main/preload/renderer) · `docs/decisions` ADR · `docs/p0-verification.md` P0 기록

## 문제 해결
- Electron 44 npm 패키지에는 postinstall이 없다. `pnpm install`은 바이너리를 받지 않고, 첫 `require('electron')` 또는 첫 실행(`pnpm dev`, E2E) 때 지연 다운로드한다. GitHub 릴리스 연결이 느려 이 단계에서 멈추면 해당 버전 zip을 따로 받아 `electron` 패키지의 `checksums.json` sha256과 대조한 뒤 `@electron/get` 캐시(`~/.cache/electron/<sha256(릴리스 URL 디렉터리)>/`, macOS는 `~/Library/Caches/electron/…`)에 두고 다시 실행한다. 자세한 내용은 `docs/p0-verification.md` #10.
