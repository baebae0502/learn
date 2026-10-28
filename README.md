# Learn

자료를 소유하고, 마음껏 필기하며, 나를 이해하는 튜터와 공부하는 로컬 우선 데스크톱 학습 앱. 제품 명세는 [`docs/spec.html`](docs/spec.html).

> 현재 상태: M5(컬렉션·태그·끌어 놓기·컨텍스트 메뉴)까지. PDF·동영상 가져오기/열기, 중첩 컬렉션과 색 태그로 자료를 정리하고(사이드바 트리·태그 선택기, 표의 색 점, 항목 패널의 태그·컬렉션, 끌어 놓기, 1–8 키, 네이티브 컨텍스트 메뉴), 정렬·열 구성·다중 선택이 되는 자료 표, 빠른 검색(⌘F, 초성), 정보를 보고 고치는 항목 패널, 사본 내보내기, 레이아웃 B 셸, ⌘K 명령 팔레트(자료·컬렉션 결과 포함), 설정 창(⌘,), 단축키 시트(⌘/)가 동작한다. 필기, 튜터, 기억·복습, 휴지통은 아직 없다. 진행 상황은 [`docs/acceptance.md`](docs/acceptance.md), 다음 할 일과 로드맵은 [`docs/next-session.md`](docs/next-session.md).

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
    pnpm tokens:check   # 생성된 토큰 파일이 tokens.ts와 같은지
    xvfb-run -a -s "-screen 0 1440x900x24" pnpm exec playwright test -c playwright.evidence.config.ts   # 증거 하네스 (Linux)

E2E 스크립트는 빌드 후 `pnpm fixtures`를 자동으로 실행한다. fixture를 다시 만들려면 `node fixtures/generate.mjs --force`. E2E 스크린샷과 trace는 `test-results/`에 남는다.

### 시각 투어 기준 PNG
`tests/e2e/visual/tour.spec.ts`는 셸의 모든 상태를 라이트·다크로 찍어 Linux 기준 PNG(`tests/e2e/visual/tour.spec.ts-snapshots/*-linux.png`)와 비교한다. 화면이 바뀌는 수정 뒤에는 1x 기준을 다시 찍고, 바뀐 PNG를 하나씩 눈으로 확인한 뒤, 갱신 없이 한 번 더 돌려 결정적인지 확인한다. 기준 PNG는 127장이다(M4: 라이브러리 기본·선택 없음·다중 선택·검색 결과 없음·불러오는 중·편집 중·팔레트 자료 결과, M5: 사이드바 트리·특수 보기·빈 컬렉션·태그 선택기·항목 패널의 태그와 컬렉션·다중 선택의 공통 절·표의 스크롤 막대와 머리 끌기·컬렉션 안의 검색 결과 없음·팔레트 컬렉션·끌기 상태, 라이트·다크).

    pnpm e2e:xvfb tests/e2e/visual/tour.spec.ts --update-snapshots=all   # 1x 기준 PNG를 모두 다시 찍는다
    git status --short tests/e2e/visual/tour.spec.ts-snapshots           # 바뀐 파일을 하나씩 확인한다
    pnpm e2e:xvfb tests/e2e/visual/tour.spec.ts                          # 갱신 없이 한 번 더(결정성)

- 화면이 바뀌지 않아도 1x 갱신은 `fatal-light`, `focus-sidebar-light`, `settings-focus-light` 세 파일의 바이트를 다시 쓴다(글자 래스터 차이, 허용 오차 안). 실제 변화가 없는 파일은 `git checkout -- <파일>`로 되돌리고, 확인한 실제 변화만 커밋한다.
- 시각에 따라 바뀌는 칸(표의 `[data-col="createdAt"]`·`[data-col="updatedAt"]`, 항목 패널의 추가일·수정일)은 마스크하고 찍는다. 새 상태의 짝 렌더는 계획 M4 Task 13 Step 5와 M5 Task 12 Step 5의 표다.
- 디자인 비평용 @2x 캡처(`LEARN_TOUR_2X=1`)는 비평 입력 전용이고 기준 PNG를 건드리지 않는다. 기준을 맞춘 뒤 갱신 없이 돌린다: `LEARN_TOUR_2X=1 pnpm e2e:xvfb tests/e2e/visual/tour.spec.ts` → `test-results/tour/`. `--update-snapshots`와 함께 쓰지 않는다.

허용 오차는 300픽셀이라 몇 글자가 밀린 것도 숨길 수 있다. 문구·줄바꿈이 바뀌는 수정 뒤에는 `=all`로 다시 찍고 차이를 직접 본다.

## 환경 변수
| 변수 | 뜻 |
|---|---|
| `LEARN_LIBRARY_DIR` | 라이브러리 폴더(설정의 위치보다 우선). 패키지 빌드에서도 따른다. |
| `LEARN_USER_DATA_DIR` | 사용자 데이터 폴더(환경설정 파일). 테스트가 프로필마다 따로 쓴다. 패키지 빌드에서도 따른다. |
| `LEARN_DETERMINISTIC=1` | 스크린샷을 반복 가능하게 한다. Chromium 스위치(sRGB 색 프로필, LCD 글꼴과 GPU 합성 끔, 힌팅 없음)를 켜고, 페이지에 `data-deterministic`을 달아 움직임과 캐럿을 없앤다. 시각 투어와 증거 페이지 샷이 쓴다. 패키지 빌드에서는 무시한다. |
| `LEARN_VIBRANCY=0` | macOS 사이드바 비브런시를 끄고 불투명 토큰으로 그린다. 기본은 켬이고, 증거 하네스가 비교 캡처에 쓴다. |
| `LEARN_DEMO_OVERLAY=1` | 화면 녹화용 오버레이: 커서 고리, 단축키 알약, 장 자막. 패키지 빌드에서는 무시한다. |
| `LEARN_TOUR_2X=1` | 시각 투어가 기준 비교와 함께 @2x(2880×1800) 캡처를 `test-results/tour/`에 남긴다(디자인 비평 입력). |
| `LEARN_E2E=1` | 배포 메뉴로 실행하고(개발자 도구 없음), 라이브러리 위치를 바꾼 뒤의 재시작은 요청만 기록한다(Playwright가 재시작한 프로세스를 따라가지 못한다). E2E가 켠다. 이때만 main에 테스트 훅 `globalThis.__learnTest.seedItems`(한 자산을 쓰는 항목을 한 트랜잭션에 많이 넣는다 — 1만 항목 측정과 표 테스트용)와 `seedOrganize`(컬렉션·태그·소속·붙임·중복 묶음을 한 트랜잭션에 넣는다 — 정리 측정용)가 생긴다. 페이지가 `window.__learnIpcCalls`·`__learnRenders`·`__learnProbes`를 스스로 만들 때만 IPC 채널 계수기와 다시 그리기 계수기가 돈다. 패키지 빌드에서는 무시한다(재시작이 실제로 일어난다). |
| `LEARN_DEMO_PACE`, `LEARN_DEMO_SCALE`, `LEARN_DEMO_GRAB` | 데모 녹화(`@demo`)의 속도(1 = 실제 속도), 배율, Linux x11grab 영역. `scripts/record-demo-linux.sh`가 정한다. |
| `LEARN_PACKAGED_APP`, `LEARN_DISPLAYPLACER`, `LEARN_DISPLAYPLACER_LIST` | macOS 증거 워크플로가 정한다: 패키지 앱 실행 파일, 화면 모드 전환 도구와 그 목록. |

## macOS 증거 레인

Mac이 없는 헤드리스 서버에서 GitHub의 Apple Silicon 러너(`macos-15`, M1 VM 3 vCPU / 7 GB)로 앱을 빌드·실행하고 스크린샷·녹화·측정값을 내려받는다. 결과와 실행 기록은 [`docs/mac-verification.md`](docs/mac-verification.md).

    scripts/evidence.sh <branch> <suite> <label> [runner] [packaged]
    scripts/evidence.sh m0-evidence baseline m0-baseline            # 예
    scripts/evidence.sh m0-evidence evidence m0-spikes macos-15 true

- 워크플로 `.github/workflows/macos-evidence.yml`은 수동 실행(`workflow_dispatch`)만 받는다. suite는 Playwright 태그(`@baseline`, `@evidence`, `@library`, `@organize`, `@perf`, `@demo`, `@mockups`; `all`은 전체 — `scripts/evidence.sh`의 suite 목록도 같다)이고, `e2e`와 `all`은 기능 E2E(`tests/e2e`)도 돌린다. 증거 테스트가 하나도 선택되지 않는 suite(`all`, `e2e` 제외)는 바로 실패한다. 잡(63분)과 각 단계에는 시간 제한(증거 28분 — 그 안의 Playwright 전체 한도 27분(1620초), 기능 E2E 25분(Playwright 전체 한도 1406초))이 있어 멈추면 그 단계만 실패하고 artifact는 항상 올라간다. `packaged=true`면 `electron-builder --dir` 앱(인증서 서명 없음, 워크플로가 ad-hoc 서명)도 만들어 실행한다.
- 내려받은 결과는 `evidence/<label>/<run_id>/`(gitignore): `evidence/`(PNG, `env.json`, `baseline.json`, `spikes.json`, 리포트), `demo/`(녹화), `run.json`(잡별 소요 분, 다운로드 속도). `EVIDENCE_RUN_ID=<id>`를 주면 새로 실행하지 않고 기존 실행을 다시 내려받는다.
- **실행 규칙**: 저장소가 공개라(2026-10-23) macOS 러너는 무료지만, 같은 머리에 두 번 돌리지 않고 브랜치마다 한 번에 하나만 돌린다(워크플로가 진행 중인 실행을 취소한다). 디버깅은 이 서버의 xvfb(`pnpm e2e:evidence`를 `xvfb-run`으로)와 Linux CI(`ci.yml`, 증거 하네스도 실행)에서 먼저 끝내고, 실행할 때마다 `docs/mac-verification.md` 실행 기록 표에 run id·분·결과를 남긴다.
- 증거 하네스: `playwright.evidence.config.ts`, `tests/evidence/`(`capture.ts` 페이지·창·전체 화면 캡처, 녹화, 실제 글꼴 조회 / `env.ts` 환경 보고). macOS 전용 캡처는 다른 OS에서 `skipped`로 기록된다.
- 기기 설정을 바꾸는 단계는 CI 러너(`CI` 환경 변수)에서만 돈다. 데모(`@demo`)는 거기서만 화면 모드·Dock 자동 숨김·바탕화면 그림을 바꾸고 끝나면 되돌리며, 개발자 Mac에서는 그대로 둔 채 녹화한다(`m5-demo.chapters.json`의 notes에 남는다). 실제 홈 폴더를 쓰는 기준선 테스트도 CI에서만 돈다.

## 라이선스
Learn은 **AGPL-3.0-or-later**로 배포한다. 전문은 [`LICENSE`](LICENSE), 결정과 이유는 [ADR-0011](docs/decisions/0011-license-agpl.md). 배포물에 들어가는 코드와 글꼴은 아래 표의 MIT·ISC·Apache-2.0·OFL-1.1·0BSD만 쓴다.

## 런타임 의존성 라이선스 (main·렌더러 번들 포함)

`node scripts/check-licenses.mjs --table`이 만든 표다. 배포물에 들어가는 것은 `apps/desktop`의 `dependencies`(main이 실행 중에 읽는다)와, Vite가 main·렌더러에 묶는 `devDependencies`, 그리고 그것들이 의존하는 패키지 전부다. 빌드 도구(vite, electron-vite, @vitejs/plugin-react), 타입 패키지, pdf.js의 Node용 선택 의존성 `@napi-rs/canvas`(렌더러는 브라우저 캔버스를 쓴다)는 들어가지 않는다. Electron은 런타임 자체로 들어간다. Chromium과 그 구성 요소의 고지는 Electron 배포본의 `LICENSES.chromium.html`에 있다.

| 패키지 | 버전 | 라이선스 |
|---|---|---|
| aria-hidden | 1.2.6 | MIT |
| better-sqlite3 | 13.0.3 | MIT |
| client-only | 0.0.1 | MIT |
| clsx | 2.1.1 | MIT |
| electron | 44.9.1 | MIT |
| @internationalized/* (date, number, string) | 3.12.4, 3.6.9, 3.2.10 | Apache-2.0 |
| lucide-react | 1.60.0 | ISC |
| node-addon-api | 8.9.2 | MIT |
| pdfjs-dist | 6.4.299 | Apache-2.0 |
| pretendard (Pretendard Variable) | 1.3.9 | OFL-1.1 |
| react | 19.3.1 | MIT |
| react-aria | 3.53.1 | Apache-2.0 |
| react-aria-components | 1.22.1 | Apache-2.0 |
| react-dom | 19.3.1 | MIT |
| react-resizable-panels | 4.14.8 | MIT |
| react-stately | 3.51.0 | Apache-2.0 |
| @react-types/shared | 3.37.0 | Apache-2.0 |
| scheduler | 0.28.0 | MIT |
| @swc/helpers | 0.5.23 | Apache-2.0 |
| @tanstack/* (react-query, query-core, react-virtual, virtual-core) | 5.104.5, 5.104.5, 3.14.22, 3.19.7 | MIT |
| tslib | 2.8.1 | 0BSD |
| use-sync-external-store | 1.7.0 | MIT |
| zod | 4.6.7 | MIT |
| zustand | 5.0.15 | MIT |

CI(`ci.yml`)가 같은 스크립트로 검사한다. 허용 목록(MIT, ISC, Apache-2.0, BSD-2-Clause, BSD-3-Clause, 0BSD, OFL-1.1) 밖의 라이선스가 배포물에 들어오면 실패한다. 의존성을 바꾸면 `--table`로 이 표를 다시 만든다. `@axe-core/playwright`(MPL-2.0)는 테스트 전용이며 배포물에 들어가지 않는다.

## 구조
- `packages/domain` 타입·스키마·Result · `packages/db` SQLite·마이그레이션 · `packages/library` 가져오기·복구·백업
- `apps/desktop` Electron(main/preload/renderer) · `docs/decisions` ADR · `docs/p0-verification.md` P0 기록
- `docs/design` 디자인 명세·목업·비평 기준 · `apps/desktop/src/renderer/src/design` 토큰·글꼴(Pretendard, OFL)

라이브러리 위치는 설정(⌘,) › 라이브러리 › 다른 폴더 선택…에서 바꾸며 Learn을 다시 시작하면 적용됩니다.

## 문제 해결
- Electron 44 npm 패키지에는 postinstall이 없다. `pnpm install`은 바이너리를 받지 않고, 첫 `require('electron')` 또는 첫 실행(`pnpm dev`, E2E) 때 지연 다운로드한다. GitHub 릴리스 연결이 느려 이 단계에서 멈추면 해당 버전 zip을 따로 받아 `electron` 패키지의 `checksums.json` sha256과 대조한 뒤 `@electron/get` 캐시(`~/.cache/electron/<sha256(릴리스 URL 디렉터리)>/`, macOS는 `~/Library/Caches/electron/…`)에 두고 다시 실행한다. 자세한 내용은 `docs/p0-verification.md` #10.
- 로캘이 없는 머신(`LANG`이 비어 있고 `LC_CTYPE=POSIX`)에서는 Chromium이 `setInputFiles`에 준 한글 경로를 버린다(파일 0개). 그래서 데모의 창 드롭과 한글 경로를 쓰는 시험이 실패한다. `LANG=C.UTF-8`로 돌린다(M5 Task 12의 클라우드 VM에서 확인 — CI와 개발 서버는 UTF-8 로캘이다).
