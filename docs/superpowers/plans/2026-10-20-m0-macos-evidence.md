# M0 — macOS 증거 레인 + 기준선 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. 이 마일스톤은 실제 GitHub 러너 동작에 따라 결과가 달라지는 스파이크가 섞여 있어, 작업마다 **완료 조건(acceptance)**을 명확히 하고 세부 코드는 구현자가 작성한다. 각 스파이크 결과는 통과/실패와 근거(로그·스크린샷 경로)로 기록한다.

**Goal:** 이 서버(헤드리스 Linux)에서 실제 macOS(Apple Silicon) GitHub 러너로 앱을 빌드·실행·E2E·스크린샷·녹화하고 결과를 내려받는 증거 레인을 만들고, 현재 앱의 macOS 기준선을 측정한다.

**Spec:** `docs/superpowers/specs/2026-10-20-quality-phase-design.md` (M0 절). 상위: `docs/spec.html`.

**저장소:** `https://github.com/baebae0502/learn` (비공개, 기본 브랜치 `main`). `gh`는 이 서버에서 소유자 계정으로 인증되어 있다.

## Global Constraints

- 의존성·액션 버전은 정확히 고정한다(npm은 `^`/`~` 금지, GitHub Actions는 커밋 SHA 고정 + 주석으로 버전 표기).
- macOS 분 예산: **M0 전체에서 macOS 실행 최대 8회(약 100분)**. 디버깅은 먼저 Linux CI(`ci.yml`)나 이 서버의 xvfb에서 끝내고 macOS로 넘어간다. 실행할 때마다 run id·소요 분·결과를 `docs/mac-verification.md`의 실행 기록 표에 남긴다.
- macOS 워크플로는 `workflow_dispatch`(+ 선택적 `evidence-*` 태그)로만 시작한다. push/PR 트리거 금지.
- 비밀값을 워크플로·로그·artifact에 넣지 않는다. 증거 artifact에는 이 저장소가 생성한 fixture와 스크린샷만 넣는다.
- 기존 동작 보존: `pnpm typecheck`, `pnpm test`(72개), `pnpm e2e:xvfb`(6개)가 계속 통과해야 한다.
- 원본 자료 수정·삭제 금지, 한국어 사용자 문구, renderer 권한 제한 등 기존 전역 제약은 그대로다.
- 커밋 메시지 끝:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01LH2FDh4QwsGUFR3V2KewHi
  ```

## 조사로 확인된 사실 (2026-10-20)

- `macos-15`/`macos-26`/`macos-latest` = arm64 **M1 VM, 3 vCPU / 7 GB**. `macos-14`는 2026-11-02 폐기(10월 brownout) → 쓰지 않는다.
- 러너 이미지의 TCC 설정이 `/bin/bash` 등에 **화면 기록(kTCCServiceScreenCapture)·손쉬운 사용·AppleEvents를 미리 허용**한다(`actions/runner-images` `configure-tccdb-macos.sh`). `screencapture -x`, `screencapture -v -V <초>`가 `run:` 단계에서 동작한다. Node 자식 프로세스에서도 되는지는 스파이크로 확인한다.
- Playwright 자체 CI가 macOS에서 `_electron` 테스트를 돌린다. 창 복원 대화상자 방지: `defaults write com.github.Electron ApplePersistenceIgnoreState YES`(패키지 앱은 그 appId로도).
- Playwright #43247: 1.64.0 + **패키지된** Electron 44에서 `firstWindow()`가 간헐적으로 창을 못 봄. 기능 E2E는 비패키지 앱으로, 패키지는 증거용으로만 쓰고 재시도로 감싼다.
- 화면 해상도는 러너가 제어하지 못한다(작업마다 다를 수 있음). 비교용 스크린샷은 Playwright 페이지 스크린샷을 우선한다.
- artifact: `actions/upload-artifact@v7`, 서버에서는 `gh run watch --exit-status` 후 `gh run download <id> -n <name> -D <dir>`.
- `workflow_dispatch`는 워크플로 파일이 **기본 브랜치에 있어야** 목록에 나타난다. 이후 실행은 `--ref <branch>`로 브랜치 버전을 돌린다.
- Electron 44 npm 패키지는 postinstall이 없고 첫 `require('electron')` 때 바이너리를 받는다. GitHub 러너에서는 다운로드가 빠르지만 캐시(`~/Library/Caches/electron`, Linux `~/.cache/electron`)를 둔다.
- Electron `BrowserWindow.getMediaSourceId()`는 macOS에서 `window:<CGWindowID>:0` → `screencapture -l<CGWindowID>`로 창만 찍을 수 있다(창이 앞에 있어야 신호등이 활성 색으로 나온다: `app.focus({steal:true})`).
- 이 서버에서 GitHub **릴리스** 다운로드는 연결당 20–60KB/s로 제한됐다. artifact 다운로드(Azure blob) 속도는 미확인 → 측정한다.

## 작업

### Task 1 — 워크플로 골격을 main에 올리기
- `.github/workflows/ci.yml`: ubuntu-24.04, push(main)·pull_request. 순서: checkout → pnpm 10.15.1(`pnpm/action-setup`) → Node 22(`actions/setup-node`, `cache: pnpm`) → Electron 캐시 → `pnpm install --frozen-lockfile` → `pnpm typecheck` → `pnpm test` → fixture 캐시(`hashFiles('fixtures/generate.mjs')`, 미스 시 `sudo apt-get install -y ffmpeg` 후 `pnpm fixtures`) → `pnpm build` → `xvfb-run -a -s "-screen 0 1440x900x24" pnpm exec playwright test` → 실패 시 `test-results` 업로드.
- `.github/workflows/macos-evidence.yml`(최소 동작 버전): `workflow_dispatch` 입력 `suite`(baseline/e2e/evidence/perf/demo/mockups/all, 기본 baseline), `runner`(macos-15/macos-26, 기본 macos-15), `packaged`(boolean, 기본 false), `label`(문자열, 기본 adhoc). `concurrency: mac-${{ github.ref }}`, `cancel-in-progress: true`, `timeout-minutes: 30`. 잡 `fixtures`(ubuntu: ffmpeg 설치 → `pnpm fixtures` → artifact 업로드)와 `mac`(needs fixtures).
- 이 두 파일을 **main에 직접 커밋·push**한다(dispatch 목록 노출용). 이후 작업은 브랜치 `m0-evidence`에서.
- **완료 조건:** `ci.yml`이 main push에서 녹색. `gh workflow list`에 macos-evidence가 보인다.

### Task 2 — fixture·helpers 정비
- `fixtures/generate.mjs`: ffmpeg 인코더 조회를 **동영상 fixture가 실제로 필요할 때만** 수행(모두 있으면 ffmpeg 없이 성공). `--force` 유지.
- `tests/e2e/helpers.ts`: `launch(libraryDir, userDataDir, opts?)` — `opts.env`(추가 env), `opts.recordVideo`(Playwright recordVideo 전달), `opts.args`(Electron 스위치), `opts.executablePath`(패키지 앱 실행 파일). 기존 호출부는 변경 없이 동작.
- **완료 조건:** 이 서버에서 `pnpm test` 72개, `pnpm e2e:xvfb` 6개 통과. ffmpeg를 PATH에서 숨기고 fixture가 이미 있을 때 `pnpm fixtures`가 성공함을 보여준다.

### Task 3 — 증거 하네스와 기준선 suite
- `playwright.evidence.config.ts`: `testDir: tests/evidence`, workers 1, timeout 180s, `outputDir: evidence-results`, reporter list+json(`evidence-results/report.json`).
- `tests/evidence/capture.ts`:
  - `pageShot(page, name)` — Playwright 스크린샷.
  - `nativeWindowShot(app, name)` — main에서 `BrowserWindow.getAllWindows()[0].getMediaSourceId()` 파싱 → `app.focus({steal:true})` → `execFile('screencapture', ['-x','-o',`-l${id}`, file])`. darwin이 아니면 건너뛰고 기록.
  - `fullScreenShot(name)` — `screencapture -x file`(darwin만).
  - `startRecording(seconds, file)` / 종료 대기 — `screencapture -v -V <초> -x file.mov` 백그라운드(darwin만). 대체: Playwright `recordVideo`.
  - `platformFonts(page, selector)` — CDP `DOM.getDocument`/`DOM.querySelector`/`CSS.getPlatformFontsForNode`로 실제 사용 글꼴 이름.
  - 모든 산출물을 `evidence-results/<label>/`에 저장하고 `manifest.json`(파일, 설명, 플랫폼)에 추가.
- `tests/evidence/env.ts` — `evidence-results/env.json`: `process.platform/arch`, `os.release()`, darwin이면 `sw_vers`, `sysctl -n machdep.cpu.brand_string`, `system_profiler SPDisplaysDataType`(요약), Electron/Chromium/Node 버전(`app.evaluate`), `app.getGPUFeatureStatus()`.
- `tests/evidence/baseline.evidence.ts` (`@baseline`, 현재 앱 대상):
  1. 빈 라이브러리 → 가져오기(stub dialog)로 `sample.pdf`, `한글 경로 (테스트) #1.pdf`, `sample-h264-aac.mp4`, `sample-mpeg4part2.mp4`, `sample-hevc.mp4` → 라이브러리 page/window/full-screen 샷.
  2. PDF 열기 시간(앱 실행 후 열기 클릭 → `data-rendered`≥1까지) 5회 반복 측정(매번 뷰어 닫고 다시 열기) → 중앙값/최대. PDF 화면 샷 3종.
  3. MP4 첫 프레임 시간(열기 → `readyState>=2`) 5회, seek 오차(7.3초) 5회 → 중앙값/최대. 영상 화면 샷.
  4. HEVC: 열기 → `readyState`, `videoWidth`, `error.code/message` 기록(판정 아님) + 샷.
  5. 미지원 코덱 화면 샷.
  6. 기본 라이브러리 경로: `LEARN_LIBRARY_DIR`/`LEARN_USER_DATA_DIR` **없이** 실행(러너는 일회용) → `appInfo().libraryRoot` 기록, darwin에서 `~/Library/Application Support/Learn/Library` 기대. **이 서버에서는 실제 홈을 건드리지 않도록 darwin+CI에서만** 실행(`process.env.CI` 확인).
  7. 결과를 `evidence-results/baseline.json`에 기록.
- 루트 `package.json`: `"e2e:evidence": "pnpm build && pnpm fixtures && playwright test -c playwright.evidence.config.ts"`. `.gitignore`: `evidence/`, `evidence-results/`.
- `tests/tsconfig.json`에 `evidence` 포함.
- **완료 조건:** 이 서버에서 `xvfb-run … playwright test -c playwright.evidence.config.ts --grep @baseline` 통과(darwin 전용 캡처는 '건너뜀'으로 기록). typecheck 통과.

### Task 4 — macOS 잡 완성 + 서버 구동 스크립트
- `macos-evidence.yml`의 `mac` 잡: checkout → `defaults write com.github.Electron ApplePersistenceIgnoreState YES` → pnpm/Node 설정(캐시) → Electron 캐시(`~/Library/Caches/electron`, 키 `electron-44.9.1-darwin-arm64`) → `pnpm install --frozen-lockfile` → fixtures artifact를 `fixtures/generated/`로 내려받기 → `pnpm build` → (packaged면 Task 5) → `pnpm exec playwright test -c playwright.evidence.config.ts --grep "@${suite}"`(all이면 grep 없이) → `if: always()`로 `evidence-results`를 `evidence-<label>-<run_id>` artifact로 업로드(retention 14일). 녹화 파일(.mov/.mp4/.webm)은 별도 `demo-<label>-<run_id>` artifact.
- `scripts/evidence.sh <branch> <suite> <label> [runner] [packaged]`: `gh workflow run macos-evidence.yml --ref` → 방금 만든 run id 확보(생성 시각 기준 필터) → `gh run watch --exit-status` → 실패 시 `gh run view --log-failed` 일부 출력 → `gh run download`로 `evidence/<label>/<run_id>/`에 내려받기 → 소요 시간·다운로드 바이트/초를 출력. `set -euo pipefail`, 인자 검증.
- **완료 조건:** `scripts/evidence.sh m0-evidence baseline m0-baseline` 1회가 녹색이고, 내려받은 artifact에 PNG 8장 이상(전체 화면 샷 1장 이상 포함), `env.json`, `baseline.json`이 있다.

### Task 5 — 스파이크(결과 기록)
각각 통과/실패/부분과 근거를 `docs/mac-verification.md`에 기록한다. 실패해도 대체 수단이 있으면 작업은 완료다.
1. Node 자식 프로세스(Playwright 테스트 안)에서 `screencapture` 창/전체/녹화가 권한 프롬프트 없이 되는가.
2. `screencapture -v -V 10` 녹화 파일이 정상 재생 가능한가(초록/깨짐 여부). 안 되면 Playwright `recordVideo`로 대체.
3. 열린 네이티브 컨텍스트 메뉴 캡처: main에서 `Menu.buildFromTemplate([...]).popup()` 후 셸 `screencapture` → `closePopup`. (현재 앱엔 컨텍스트 메뉴가 없으므로 테스트 안에서 `app.evaluate`로 임시 메뉴를 띄워 확인.)
4. 메뉴바 열기: `osascript`(System Events)로 메뉴바 메뉴 클릭 → 전체 화면 샷. 실패 시 `Menu.getApplicationMenu()` JSON 덤프로 대체.
5. 패키지 빌드: `electron-builder`를 루트 devDependency로 정확히 고정, `apps/desktop/electron-builder.yml`(appId `app.learn.desktop`, productName `Learn`, mac target `dir`, 서명 없음 `identity: null`, `asarUnpack`에 better-sqlite3 네이티브 모듈) → `electron-builder --dir --mac`(macOS 잡, `packaged: true`일 때) → Playwright `executablePath`로 실행(재시도 3회) → 메뉴바 앱 이름이 "Learn"인지 전체 화면 샷. 실패 시 원인 기록 후 비패키지로 진행.
6. 서버로의 artifact 다운로드 속도(바이트/초) 측정.
- **완료 조건:** 6개 스파이크 모두 결과·근거가 기록되어 있다. macOS 실행 누적 8회 이하.

### Task 6 — 문서
- `docs/mac-verification.md`(한국어): 목적, 러너 사양(env.json에서), **실행 기록 표**(run id, suite, 소요 분, 결과), 기준선 실측(첫 PDF/MP4 시간, seek 오차, HEVC, 기본 경로, 글꼴), 스파이크 결과, Linux와 다른 점, 남은 실기 확인 항목(VoiceOver, 트랙패드, Finder 드래그, HEVC 확정, AC16 기준 장비).
- `docs/acceptance.md`: "Mac 증거" 열 추가(해당 AC에 run id/문서 링크).
- `docs/next-session.md`: Mac 확인 목록 중 해결된 항목 갱신.
- `README.md`: "macOS 증거 레인" 절(사용법: `scripts/evidence.sh`, 분 예산 주의).
- **완료 조건:** 문서에 실제 값만 있고 자리표시가 없다.

## 완료 보고

변경 파일, 실행한 명령과 결과(Linux 테스트 수, macOS run id·분), 내려받은 증거 위치, 스파이크 표, 알려진 한계.
