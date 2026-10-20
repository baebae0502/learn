# macOS 검증 기록 (M0 증거 레인)

- 갱신: 2026-10-20(수정 1회차 반영) · 브랜치 `m0-evidence` · 계획: [`superpowers/plans/2026-10-20-m0-macos-evidence.md`](superpowers/plans/2026-10-20-m0-macos-evidence.md)
- 이 문서의 수치는 모두 아래 실행 기록의 artifact(`env.json`, `baseline.json`, `spikes.json`, Playwright 리포트)에서 옮겼다. GitHub 러너는 M1 **가상 머신**이므로 성능·코덱 값은 참고값이고, AC16 판정은 기준 장비(Apple Silicon 16 GB 실기)에서 한다.

## 목적

Mac이 없는 헤드리스 Linux 서버(Intel Xeon)에서 실제 macOS(Apple Silicon)로 앱을 빌드·실행하고, 네이티브 창·메뉴바가 찍힌 스크린샷과 녹화, 측정값을 받아 오는 증거 레인을 만든다. 쓰는 법은 [README의 "macOS 증거 레인"](../README.md#macos-증거-레인), 구성은 다음과 같다.

| 구성 요소 | 역할 |
|---|---|
| `.github/workflows/macos-evidence.yml` | 수동 실행만. `fixtures` 잡(ubuntu, ffmpeg로 fixture 생성 → artifact) → `mac` 잡(설치·빌드·선택적 패키지·증거 suite·기능 E2E → `evidence-<label>-<run_id>`, `demo-<label>-<run_id>` artifact, 보관 14일) |
| `.github/workflows/ci.yml` | Linux push(main)/PR/수동: typecheck, vitest, build, Xvfb E2E, **증거 하네스(Linux)** |
| `scripts/evidence.sh` | 서버에서 dispatch → 새 run id 식별 → 대기 → 다운로드(`evidence/<label>/<run_id>/`) → 잡별 분·다운로드 속도·테스트 수를 `run.json`으로 |
| `tests/evidence/` | `capture.ts`(page/window/full-screen 샷, `screencapture -v` 녹화, CDP 화면 녹화 대체, CDP 실제 글꼴), `env.ts`, `baseline.evidence.ts`(`@baseline`), `spikes.evidence.ts`(`@evidence`) |
| `apps/desktop/electron-builder.yml` | 서명 없는 `--dir` 패키지(appId `app.learn.desktop`, productName `Learn`) — 증거용 |

## 러너 사양 (env.json)

| 항목 | macos-15 (run 39443464837) | macos-26 (run 39444862608) |
|---|---|---|
| 이미지 | `macos15` 20260907.0337.1 | `macos26` 20261013.0424.1 |
| macOS | 15.7.9 (24G830), Darwin 24.6.0 | 26.6.2 (25G83), Darwin 25.6.0 |
| 하드웨어 | Apple M1 (Virtual), `VirtualMac2,1`, 3 vCPU, 7 GiB | 같음 |
| 디스플레이 | 1024×768, scaleFactor 1(Retina 아님), workArea 1024×684 | 1024×768 @1x, workArea 1024×677 |
| 앱 창 | 요청 1440×900 → 화면에 맞춰 1024×684(콘텐츠 1024×656) | 1024×677(콘텐츠 1024×645) |
| Electron / Chromium / Node | 44.9.1 / 152.0.7977.167 / 24.22.0 | 같음 |
| GPU 기능 상태 | gpu_compositing·rasterization·video_decode·webgpu `enabled`, skia_graphite·opengl `enabled_on` | 같음 |
| 로캘 | en-US | en-US |

- `system_profiler SPDisplaysDataType`은 두 이미지 모두 **빈 출력**이었다(가상 디스플레이). 해상도는 Electron `screen` 값이 근거다.
- 비교용 Linux: 이 서버 Xvfb 1440×900(Xeon), GitHub ubuntu-24.04(Xeon Platinum 8573C, 2 vCPU, 7.8 GiB, Xvfb 1440×900).

## 실행 기록

macOS 분은 잡마다 분 단위로 올림되고, 비공개 저장소는 macOS 1분이 포함 분 10분으로 차감된다. fixture 잡(ubuntu)은 run마다 1분(×1).

| # | run id | suite / 러너 / 패키지 | mac 잡 (초 → 과금 분) | 결과 | 비고 |
|---|---|---|---|---|---|
| 1 | [39442173392](https://github.com/baebae0502/learn/actions/runs/39442173392) | baseline / macos-15 / 아니오 | 214초 → 4분 | 실패 | 증거 suite 6/6 통과. 당시 baseline에 넣었던 기능 E2E가 5/6(아래 "전체 화면 해제 멈춤"). 이후 기능 E2E는 `e2e`/`all` suite로만 돌린다 |
| 2 | [39443464837](https://github.com/baebae0502/learn/actions/runs/39443464837) | baseline / macos-15 / 아니오 | 76초 → 2분 | **성공** | Task 4 완료 조건 실행: PNG 18장(전체 화면 6), `env.json`, `baseline.json` |
| 3 | [39443865113](https://github.com/baebae0502/learn/actions/runs/39443865113) | evidence / macos-15 / 예 | 114초 → 2분 | 성공 | 스파이크 4개 테스트 통과, 패키지 앱 실행 |
| 4 | [39444862608](https://github.com/baebae0502/learn/actions/runs/39444862608) | all / macos-26 / 예 | 297초 → 5분 | 실패 | 증거 10/10 통과, 기능 E2E 5/6(같은 전체 화면 멈춤). 메뉴 열기 수정 확인 |
| 5 | [39451895620](https://github.com/baebae0502/learn/actions/runs/39451895620) | all / macos-15 / 아니오 (label `m0-fix1`) | 164초 → 3분 | **성공** | 수정 1회차 확인: 증거 9 통과 + 1 skip(패키지 스파이크, packaged=false), 기능 E2E 6/6 통과 + darwin 특성 테스트 1개 예상 실패(`test.fail`). 메뉴 열기 ①·② macOS 15에서도 성공 |

**합계: macOS 5회, 16분(포함 분 160분 차감) / 예산 8회.** Linux CI(ci.yml): [39438095006](https://github.com/baebae0502/learn/actions/runs/39438095006)(main push), [39441722726](https://github.com/baebae0502/learn/actions/runs/39441722726), [39443445899](https://github.com/baebae0502/learn/actions/runs/39443445899), [39444840391](https://github.com/baebae0502/learn/actions/runs/39444840391), [39446596760](https://github.com/baebae0502/learn/actions/runs/39446596760), [39451860358](https://github.com/baebae0502/learn/actions/runs/39451860358) 모두 성공.

## 기준선 실측

측정 방법: 렌더러 안에서 `performance.now()`로 "열기" 클릭부터 준비 상태까지 2ms 간격 확인. PDF = 캔버스 `data-rendered ≥ 1`, MP4 = `<video>.readyState ≥ 2`. 각 5회(매번 뷰어를 닫고 다시 열기), 첫 값이 앱 실행 후 첫 열기(콜드). seek는 0초에서 재생 중 7.3초로 이동해 `seeked` 시점의 `currentTime` 오차.

| 항목 (ms) | macos-15 run 2 | macos-15 run 1 | macos-26 run 4 | Linux CI (Xvfb) | 이 서버 (Xvfb) | 목표 |
|---|---|---|---|---|---|---|
| 첫 PDF 쪽: 콜드 / 웜 중앙값 | 553 / 122 | 1,589 / 220 | 1,389 / 175 | 140 / 129 | 353 / 185 | ≤ 2,000 (AC16) |
| 한글 경로 PDF(웜) | 103 | 189 | 291 | 122 | 195 | — |
| 첫 MP4 프레임: 콜드 / 웜 중앙값 | 134 / 57 | 984 / 39 | 1,571 / 50 | 16 / 10 | 47 / 16 | ≤ 3,000 (AC16) |
| seek 오차: 중앙값 / 최대 | 0.3 / 0.5 | 1.0 / 1.7 | 0.3 / 0.8 | 0.4 / 0.6 | 0.7 / 4.5 | ≤ 500 (AC05) |
| seek 소요: 중앙값 / 최대 | 71 / 139 | 169 / 362 | 142 / 182 | 104 / 126 | 102 / 131 | — |
| 실행 → `app-ready` (Playwright 포함) | 4,334 | 3,627 | 4,484 | 842 | 972 | (냉시작 ≤ 1,500은 실기에서) |
| 미지원 코덱 안내까지 | 30 | 19 | 38 | 12 | 14 | — |

- 같은 러너에서도 콜드 값이 run마다 크게 다르다(PDF 553 vs 1,589ms). VM이라 결정적이지 않다. 웜 값과 seek 오차는 안정적이다.
- run 5(macOS 15, `all`)의 같은 측정: 첫 PDF 콜드 1,648 / 웜 중앙값 174, 첫 MP4 콜드 882 / 웜 27, seek 오차 중앙값 0.4 / 최대 1.9, 실행 → app-ready 4,754.
- **HEVC (`sample-hevc.mp4`, hvc1 640×360)**: macOS 15·26 모두 재생된다 — `readyState 4`, 640×360, 오류 없음, `canPlayType('video/mp4; codecs="hvc1.1.6.L93.B0"')` = `probably`, `mediaCapabilities.decodingInfo` = supported·smooth·powerEfficient 모두 true. 창 스크린샷에 첫 프레임이 보인다(`05-hevc.window.png`). 다만 열자마자 캔버스로 읽은 프레임은 run 1·4에서 **검은색**(mean RGB 0,0,0), run 2·5에서는 정상이었고, 0.7초 재생 후 다시 읽은 값은 측정한 run 2·4·5 모두 정상(약 123,130,127)이었다(run 1 이후 추가한 측정) → 하드웨어 디코딩 직후 `drawImage` 읽기가 비결정적. Linux(Chromium)는 HEVC 미지원(`MEDIA_ERR_SRC_NOT_SUPPORTED`, `DEMUXER_ERROR_NO_SUPPORTED_STREAMS`). 판정 기준 아님, 실기에서 확정.
- **미지원 코덱(MPEG-4 Part 2)**: macOS도 Linux와 같이 `MediaError.code=4`, `DEMUXER_ERROR_NO_SUPPORTED_STREAMS: FFmpegDemuxer: no supported streams`, 한국어 안내 표시(`06-unsupported.*.png`).
- **H.264 디코딩 확인**: 7.3초 정지 프레임을 캔버스로 읽어 mean RGB 130,125,132, 밝은 픽셀 100%(검은/초록 프레임 아님).
- **기본 라이브러리 경로**: `LEARN_LIBRARY_DIR`/`LEARN_USER_DATA_DIR` 없이 실행 → `libraryRoot` = `/Users/runner/Library/Application Support/Learn/Library`(기대값과 일치, 폴더 생성됨, schemaVersion 1, libraryError 없음), userData `/Users/runner/Library/Application Support/Learn`. macOS 15·26 같음. (실제 홈을 건드리므로 darwin + CI에서만 실행)
- **실제 사용 글꼴** (CDP `CSS.getPlatformFontsForNode`, CSS는 `system-ui, -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`):

  | 요소 | macOS 15·26 | Linux |
  |---|---|---|
  | `LEARN`(굵게) | `.SF NS` (.SFNS-Bold) | DejaVu Sans Bold |
  | 사이드바 제목 "라이브러리" | Apple SD Gothic Neo Bold | WenQuanYi Zen Hei |
  | 버튼 "자료 가져오기 (복사)" | .SF NS Regular 4글리프 + Apple SD Gothic Neo Regular 8글리프 | DejaVu Sans + WenQuanYi Zen Hei |
  | 항목 "한글 경로 (테스트) #1"(굵게) | .SF NS Bold + Apple SD Gothic Neo SemiBold | WenQuanYi Zen Hei + DejaVu Sans Bold |

## 스파이크 결과

| # | 스파이크 | 결과 | 근거 |
|---|---|---|---|
| 1 | Node 자식 프로세스(Playwright 워커)에서 `screencapture` 창/전체/녹화 | **통과** — 권한 프롬프트·멈춤 없음, 내용이 찍힌다(배경화면만 찍히는 TCC 거부 증상 없음) | run 3·4 `spike1-window.window.png`(1024×684 / 1024×677, CGWindowID 28), `spike1-screen.screen.png`(1024×768). 기준선 18장도 모두 같은 경로로 찍음 |
| 2 | `screencapture -v -V 10` 녹화 재생 가능 여부 | **통과** — 서버에서 ffprobe/ffmpeg 전체 디코드 오류 없음, H.264 1024×768. 프레임을 타일로 뽑아 보니 PDF 1·2쪽 → 라이브러리 → 영상 재생 순서가 정상(초록·깨짐 없음) | run 3: 9.57초, 490프레임(약 51fps), 1.50 MB. run 4(macOS 26): 10.0초, 114프레임(약 11fps), 0.78 MB. `demo-*/spike2-screen-recording.mov` |
| 2b | 대체: Playwright `recordVideo` | **사용 불가** — Playwright 1.64.1 + Electron 44.9.1에서 `recordVideo`를 주면 첫 창이 탐색 전(`url ''`, `isLoading`)에 멈춘다. 최소 앱(`show:true`/`false` 모두)으로 이 서버에서 재현, `recordVideo`를 빼면 정상 | 대신 CDP `Page.startScreencast` 프레임 저장(`*.frames/`) → `evidence.sh`가 ffmpeg로 mp4 조립. run 3: 62프레임/9.0초, run 4: 88프레임/7.7초 |
| 3 | 열린 네이티브 컨텍스트 메뉴 캡처 | **통과** — main에서 `Menu.buildFromTemplate(...).popup()` 뒤 전체 화면 샷에 한국어 메뉴(열기, Finder에서 보기, 태그 ›, 휴지통으로 이동)가 찍힘. 메뉴가 열린 동안에도 `app.evaluate`가 응답해 `closePopup()`으로 29–55ms에 닫힘 | `spike3-context-menu.screen.png` (run 3·4) |
| 4 | 메뉴바 메뉴 열기 → 전체 화면 샷 | **통과(방식 교체 후)**. run 3(macOS 15): `ignoring application responses` 안의 `click`은 즉시 0으로 끝났지만 열린 메뉴가 찍히지 않음. 교체한 ① 막히는 `click`을 백그라운드로 돌리며 캡처, ② ⌃F2 → → → ↓ 키보드 경로가 run 4(macOS 26)·run 5(macOS 15) 모두 **File 메뉴(Close Window ⌘W)가 열린 상태로 찍힘**. System Events로 메뉴 이름 읽기는 두 OS 모두 성공. 대체 수단 `Menu.getApplicationMenu()` JSON 덤프도 항상 저장 | `spike4-menubar-click.screen.png`, `spike4-menubar-keyboard.screen.png`(run 4·5), `menu.json`. System Events 재시작(`killall`)은 CI에서만 |
| 5 | 패키지 빌드(`electron-builder --dir --mac`) + Playwright `executablePath` | **통과** — electron-builder 26.17.0으로 `Learn.app` 생성(CFBundleName `Learn`, id `app.learn.desktop`), 첫 시도에 실행(#43247 재시도 불필요, 2회 모두). `isPackaged: true`, PDF 열기 정상, **메뉴바 앱 이름 "Learn"**(System Events: `Apple, Learn, File, Edit, View, Window`), 앱 메뉴 About/Hide/Quit Learn | `spike5-packaged.screen.png`, `spike5-packaged-appmenu-click.screen.png`(run 4). 주의: `identity: null`이면 원래 Electron 서명이 깨진 채로 남아 `codesign --verify`가 "code has no resources but signature indicates they must be present"로 실패 → 워크플로가 ad-hoc 서명(`codesign --force --deep --sign -`) 후 실행. 서명 없는 원본 그대로 실행되는지는 시험하지 않음 |
| 6 | 서버로의 artifact 다운로드 속도 | **문제 없음** — 6.56 MB를 4.90초/5.06초(1.34 / 1.30 MB/s). 작은 artifact는 고정 지연(약 2–3초)이 지배: 1.77 MB 3.24초, 1.41 MB 3.37초, 2.92 MB 3.37초, 3.56 MB 3.59초, 3.02 MB 3.60초 | `evidence/<label>/<run_id>/run.json`. 릴리스 다운로드에서 보던 연결당 20–60 KB/s 제한은 artifact(blob)에는 없다. 참고로 오늘은 GitHub 릴리스 자산(actionlint 2.4 MB)도 1초 안에 받아져 그 제한이 재현되지 않았다 |

### 추가 발견: HTML 전체 화면 해제 멈춤 (macOS 전용)

- 기존 기능 E2E `first-session.spec.ts`가 macOS 15·26 모두에서 `video.requestFullscreen()` 직후 `document.exitFullscreen()`의 Promise가 끝나지 않아 120초 시간 초과로 실패했다(run 1·4, trace: 마지막 Evaluate에 끝 이벤트 없음). 나머지 5개 E2E는 macOS에서 통과. Linux에서는 6/6 통과.
- 스파이크(`x-html-fullscreen`, run 3·4)로 특성 확인:
  - 진입 후 **2.5초 기다렸다가** 해제: 정상(해제 90–139ms, 창 `isFullScreen` false, `document.fullscreenElement` null).
  - **진입 직후 바로** 해제(네이티브 전체 화면 전환 애니메이션 중): 해제 Promise가 15초 넘게 끝나지 않고, 창은 전체 화면에서 빠졌는데 문서는 여전히 전체 화면 상태로 남는다. `BrowserWindow.setFullScreen(false)`로도 문서 상태가 풀리지 않음 — `spikeX-fullscreen-after.screen.png`에서 창은 일반 크기(메뉴바·제목줄 보임)인데 영상이 창을 가득 채운 채 "전체 화면 종료" 아이콘이 보인다.
- 사용자가 전체 화면을 빠르게 켰다 끄면 같은 상태에 빠질 수 있다. 앱 동작은 이번 범위에서 바꾸지 않았고, M8(영상 리더 v2, 컨테이너 전체 화면) 입력으로 넘긴다.
- **수정 1회차(테스트)**: 사용자 여정 테스트는 목적(우리 페이지에 전체 화면 허용)대로 진입 → main의 `isFullScreen()`이 true가 될 때까지 대기 → macOS에서는 `enter-full-screen` 이벤트(최대 5초, 없으면 1.5초 고정 대기)까지 기다린 뒤 해제 → 창 `isFullScreen()` false와 `document.fullscreenElement === null`을 확인한다. 빠른 토글 경합은 별도 darwin 전용 특성 테스트 `macOS: exiting fullscreen during the enter transition settles`(`test.fail()`)로 남겨, Electron이 고치면 "예상 밖 통과"로 드러나게 했다. run 5(macOS 15): 여정 테스트 통과(8.2초), 특성 테스트는 예상대로 실패("unsettled after 10 s"), 기능 E2E 실패 0.

## Linux와 다른 점

- **화면**: 러너 화면이 1024×768 @1x라 1440×900 창이 1024×684로 줄어든다. 표 열이 좁아져 "보관", "복사본", "동영상", "사용 가능"이 **글자 단위로 줄바꿈**되고(`word-break: keep-all` 없음), 날짜가 3줄로 접힌다(`01-library.*.png`). Linux 1440×900에서는 한 줄. M1 타입 규칙(`keep-all`)과 M4 표 열 폭에 반영할 것.
- **스크롤바**: macOS에서는 가운데 영역 오른쪽에 항상 보이는 스크롤바가 생긴다(마우스 연결 기본값의 레거시 스크롤바, `01-library.window.png`).
- **글꼴**: macOS는 SF + Apple SD Gothic Neo, Linux는 DejaVu Sans + WenQuanYi Zen Hei. 같은 문구라도 폭이 달라 줄바꿈 위치가 다르다.
- **메뉴바**: 비패키지 실행은 메뉴바 앱 이름이 "Electron"(`app.setName('Learn')`으로 바뀌지 않음), 패키지 앱은 "Learn". 기본 메뉴는 Electron 기본값(`menu.json`: Learn/File/Edit/View/Window, View에 Reload·Force Reload·Toggle Developer Tools 포함, 모두 영어) — M2에서 교체.
- **창 크롬**: 신호등 3색과 제목 "Learn"이 찍힌다. macOS 26은 제목이 왼쪽 정렬이고 모서리가 더 둥글다.
- **HEVC**: macOS는 재생, Linux는 미지원.
- **전체 화면**: macOS에서는 HTML 전체 화면이 네이티브 전체 화면 공간으로 전환되고, 전환 중 해제 시 위의 멈춤이 생긴다. Linux(Xvfb)에서는 즉시 전환.
- **오류 문구 넘침**: 미지원 코덱 안내의 기술 문자열 `PipelineStatus::DEMUXER_ERROR_NO_SUPPORTED_STREAMS:`가 상자 밖으로 넘친다(macOS 좁은 창에서 확인, `06-unsupported.page.png`).

## 알려진 한계

- 러너는 M1 가상 머신(3 vCPU, 가상 GPU, 1024×768 @1x)이다. 콜드 시간은 run마다 2–3배 차이가 나고, Retina(@2x) 렌더링·실제 GPU·트랙패드는 확인할 수 없다.
- 해상도는 러너가 정한다. 비교용 스크린샷은 Playwright page 샷을 쓰고, 창/전체 화면 샷은 OS 크롬 확인용이다.
- `screencapture -v` 녹화 프레임률이 이미지마다 다르다(macOS 15 약 51fps, 26 약 11fps).
- 패키지 앱은 ad-hoc 서명 상태로만 실행했다. 실제 서명·공증·hardened runtime은 P6.
- `pnpm dev`(Vite dev server) 경로는 러너에서 돌리지 않았다.
- 데모용 커서·키 입력 오버레이(`LEARN_DEMO_OVERLAY`)는 아직 없다(설계 M0 4항, 이번 계획 범위 밖).

## 남은 실기 확인 항목

- VoiceOver로 라이브러리·뷰어 탐색(AC18).
- 트랙패드 스크롤·핀치 확대, 관성 스크롤.
- Finder에서 드래그 & 드롭 가져오기.
- HEVC 재생 확정(실제 하드웨어 디코더, 캔버스 읽기 포함).
- AC16 기준 장비(Apple Silicon 16 GB)에서 첫 PDF·첫 MP4·냉시작 시간.
- Retina @2x에서 PDF 캔버스 선명도와 글꼴 렌더링.
- 전체 화면 빠른 토글 시 멈춤이 실기에서도 나는지.
- 서명·공증된 패키지(P6)에서 PDF·영상(AC20).
