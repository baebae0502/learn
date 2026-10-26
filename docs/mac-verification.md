# macOS 검증 기록 (M0 증거 레인)

- 갱신: 2026-10-26(M4 라이브러리, 최종 `all` run 40242680541이 전부 녹색 — 아래 "M4 라이브러리") · 2026-10-23(M3 셸 Task 14 반영, 5차 run 39920413383까지 — 아래 "M3 셸 (Task 14)") · 처음: 2026-10-20(수정 1회차 반영) · 브랜치 `m0-evidence` · 계획: [`superpowers/plans/2026-10-20-m0-macos-evidence.md`](superpowers/plans/2026-10-20-m0-macos-evidence.md)
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
| 6 | [39534378577](https://github.com/baebae0502/learn/actions/runs/39534378577) | all / macos-15 / 예 (M2) | → 7분 | **성공** | 아래 "M2 실행" |
| 7 | [39617644850](https://github.com/baebae0502/learn/actions/runs/39617644850) | evidence / macos-15 / 아니오 (label `m3-chrome`) | 212초 → 4분 | 실패 | M3 창 크롬 1회차: 증거 12 통과 · 1 skip(패키지 스파이크) · 판정 테스트 1 실패 — 하네스 원인 2건(비교 창 빈 캡처, 화면보다 넓은 복원 요청), 아래 "M3 창 크롬" |
| 8 | [39618864364](https://github.com/baebae0502/learn/actions/runs/39618864364) | evidence / macos-15 / 아니오 (label `m3-chrome`) | 144초 → 3분 | 실패 | 하네스 수정 후 2회차: 증거 12 통과 · 1 skip · 판정 테스트 1 실패 — 앱 판정 16개 모두 통과, 하네스 원인 1건(최소 폭보다 좁은 복원 요청)은 9b7a1a5에서 고침(확인은 Task 14 실행) |

| 9 | [39629607271](https://github.com/baebae0502/learn/actions/runs/39629607271) | evidence / macos-15 / 아니오 (label `m3-chrome-2`) | 176초 → 3분 | 실패 | Task 8 수정 1회차: 메뉴 테스트의 하드 단언(툴팁이 열려야 함)이 실패해 직렬 모드에서 뒤 테스트 7개가 건너뛰어짐(하네스). 그 앞 판정은 모두 통과 |
| 10 | [39631541294](https://github.com/baebae0502/learn/actions/runs/39631541294) | evidence / macos-15 / 아니오 (label `m3-chrome-2`) | 171초 → 3분 | 실패 | 하네스 수정 후: 테스트 전부 실행. 판정 29개 중 26개 통과, 3개는 앱 결함 하나(시트가 닫힌 뒤 창이 비활성으로 남음 — 38e3a9e에서 고침, 확인은 Task 14) 때문 — 아래 "M3 창 크롬 수정 1회차" |

| 11 | [39640208719](https://github.com/baebae0502/learn/actions/runs/39640208719) | evidence / macos-15 / 아니오 (label `m3-chrome-3`) | 264초 → 5분 | 실패 | Task 8 수정 2회차 1차: R2-1 실험(보기의 전체 화면 항목 세 변형). 기본(역할 항목)은 열린 메뉴에 2행. 변형 앱이 앞으로 오지 못해 실험의 행 수·⌃⌘F 판정은 하네스 결함으로 비었고, 클릭 캡처를 다시 세어 결정 — 아래 "M3 창 크롬 수정 2회차" |
| 12 | [39642950406](https://github.com/baebae0502/learn/actions/runs/39642950406) | evidence / macos-15 / 아니오 (label `m3-chrome-3`) | 198초 → 4분 | **성공** | 고른 변형(우리 항목, ⌃⌘F) 확인: 판정 35개 모두 통과 |

| 13 | [39652039788](https://github.com/baebae0502/learn/actions/runs/39652039788) | evidence / macos-15 / 아니오 (label `m3-chrome-4`) | 189초 → 4분 | 성공 | Task 8 수정 3회차: 판정 40개 모두 통과. 다만 m3-09h(전체 화면, 사이드바 가림)는 포인터가 화면 위에 남아 메뉴 막대와 제목 띠가 도구 막대를 덮은 채 찍혔다(하네스) — 아래 "M3 창 크롬 수정 3회차" |
| 14 | [39653189858](https://github.com/baebae0502/learn/actions/runs/39653189858) | evidence / macos-15 / 아니오 (label `m3-chrome-4`) | 210초 → 4분 | **성공** | 포인터를 실제로 옮기고 캡처의 신호등 픽셀을 판정에 넣은 뒤: 판정 41개 모두 통과 |

**합계: macOS 14회(M0 5 · M2 1 · M3 8), 53분(포함 분 530분 차감).** M0은 예산 8회 중 5회. M3은 Task 8이 2회, Task 8 수정 1·2·3회차가 각 2회(통제자 허용, 무료 한도 안 — C-9: 지출 한도 $0이라 과금 없음)를 썼다. Task 14의 1회가 남았다(그 뒤의 합계는 아래 "M3 셸 (Task 14)" 절). fixture 잡(ubuntu)은 run마다 1분(×1). Linux CI(ci.yml): [39438095006](https://github.com/baebae0502/learn/actions/runs/39438095006)(main push), [39441722726](https://github.com/baebae0502/learn/actions/runs/39441722726), [39443445899](https://github.com/baebae0502/learn/actions/runs/39443445899), [39444840391](https://github.com/baebae0502/learn/actions/runs/39444840391), [39446596760](https://github.com/baebae0502/learn/actions/runs/39446596760), [39451860358](https://github.com/baebae0502/learn/actions/runs/39451860358) 모두 성공.

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
- **메뉴바**: 비패키지 실행은 메뉴바 앱 이름이 "Electron"(`app.setName('Learn')`으로 바뀌지 않음), 패키지 앱은 "Learn". 기본 메뉴는 Electron 기본값(`menu.json`: Learn/File/Edit/View/Window, View에 Reload·Force Reload·Toggle Developer Tools 포함, 모두 영어) — M2에서 교체(아래 M2 실행).
- **창 크롬**: 신호등 3색과 제목 "Learn"이 찍힌다. macOS 26은 제목이 왼쪽 정렬이고 모서리가 더 둥글다.
- **HEVC**: macOS는 재생, Linux는 미지원.
- **전체 화면**: macOS에서는 HTML 전체 화면이 네이티브 전체 화면 공간으로 전환되고, 전환 중 해제 시 위의 멈춤이 생긴다. Linux(Xvfb)에서는 즉시 전환.
- **오류 문구 넘침**: 미지원 코덱 안내의 기술 문자열 `PipelineStatus::DEMUXER_ERROR_NO_SUPPORTED_STREAMS:`가 상자 밖으로 넘친다(macOS 좁은 창에서 확인, `06-unsupported.page.png`).

## M2 실행 (run 39534378577, 2026-10-21, macos-15 arm64, `suite=all`, 패키지 포함, 7분)

- 증거 테스트 11개, 기능 E2E 20개 모두 기대대로(실패 0, 건너뜀 0, 불안정 0). 전체 화면 빠른 전환 경합은 기존처럼 `test.fail()`로 기대 실패.
- **메뉴바**: 레지스트리 기반 한국어 메뉴로 교체됨. 비패키지 `Electron`/패키지 `Learn` · 파일 · 편집 · 보기 · 이동 · 윈도우. 파일 메뉴에 "파일 가져오기… ⌘O"(M2 당시 레이블 '자료 가져오기…', M3에서 '파일 가져오기…'로 바뀜), "외부 파일 연결… ⌥⌘O", "창 닫기 ⌘W". Reload·Force Reload·개발자 도구 없음(`spike4-menubar-click`, `spike5-packaged-appmenu-click`). 앱 메뉴는 "Learn 정보 · 서비스 · Learn 가리기 · 기타 가리기 · 모두 보기 · Learn 종료".
- **⌘O 정확히 1회**: Playwright의 CDP 키는 NSMenu 키 등가물에 닿지 않으므로, 앱을 맨 앞으로 가져온 뒤(System Events가 앱의 main pid를 frontmost로 보고할 때까지 대기) `osascript`로 `keystroke "o" using command down`을 보냈다. 러너 이미지는 `/usr/bin/osascript`에 손쉬운 사용·Apple Events 권한을 미리 준다(actions/runner-images `configure-tccdb-macos.sh`). 결과: 대화상자 1회, 항목 1개. 헬퍼 `nativeKeystroke`는 M3의 ⌘K·⌘, 검증에 재사용한다.
- **읽기 위치**: 영상 7.0005초에서 일시정지 → SIGKILL → 재실행 → 7.001초. PDF는 다시 열면 떠난 쪽.
- 이 실행 뒤 M2 최종 리뷰 수정에서 기능 E2E 2개(`position.spec.ts` "opening a PDF records openedAt even when the page never changes", `platform.spec.ts` "ui.windowState() answers the current fullscreen and focus state that main sees")가 추가돼 지금은 22개다. 추가분은 macOS에서 아직 돌리지 않았다(다음 macOS 실행에서 확인).

## M3 창 크롬 (run 39617644850 · 39618864364, 2026-10-21, macos-15 arm64, `suite=evidence`, 4분 + 3분)

`tests/evidence/shell.evidence.ts`가 한 세션(직렬)으로 재고, 값은 `m3-shell.json`(`checks`에 판정과 근거 값), 캡처는 `m3-chrome/m3-0*·m3-1*.window.png`·`.screen.png`. 아래 값은 2회차(39618864364), 1회차와 다르면 함께 적었다. 러너 화면 1024×768 @1x, 창 1024×684.

| Step 9 | 값 | 판정 · 보정 |
|---|---|---|
| 1 신호등 | 닫기 단추 중심 (24.5, 25.5)pt, 확대 단추 중심 x 64.5(오른쪽 끝 약 70.5 < 84), 1pt = 1px. 두 회 같음 | 기준 y 26 ± 1.5, x 24 안 → **보정 없음**(`trafficLightPosition` (18, 18) 유지). 토큰 y 18은 단추 프레임 원점이고 원은 그보다 약 1.5 아래에 그려져 명세의 "묶음 원점 (18, 20)"과 화면상 일치 |
| 2 비브런시 | 사이드바(120, 500) 비브런시 246,246,246 · 불투명(`LEARN_VIBRANCY=0`) 238,241,243(= `--bg-sidebar`) → sidebarDelta 8. 내용(700, 500) 255,255,255 · 255,255,255 → contentDelta 0 | 재질이 보이고 그 위 조상은 모두 투명, 내용 면은 불투명 → **기본값 켬 유지**. 1회차는 비교 창이 빈 캡처(창 배경과 신호등만)라 sidebarDelta 2로 잘못 나왔다(하네스: 같은 자리에 겹친 창은 Chromium이 그리지 않음 → 2회차는 메인 창을 숨기고 찍음) |
| 3 메뉴 막대 | `Learn`(System Events 이름은 비패키지라 `Electron`) · 파일 · 편집 · 보기 · 이동 · 윈도우 · 도움말. `m3-09-menu-view-*.screen.png`에 "사이드바 보기/숨기기 ⌃⌘S" | 통과. 단 보기 메뉴에 **"전체 화면"이 두 번**(`fn F`와 `⌃⌘F`) — macOS가 붙이는 전체 화면 항목과 우리 `togglefullscreen`이 겹친다(아래 발견) |
| 4 실제 단축키 | ⌃⌘S 두 번(숨김 → 보임), PDF에서 ⌘1 → 라이브러리: `ok` | 통과 |
| 5 창 상태 | 닫기 직전 (40, 65, 960×604) → 재시작 후 (40, 65, 960×604) | `windowStatePersistence`가 macOS에서 그대로 복원 → **Step 10 대체 구현 불필요**. 1회차는 1024pt 화면에 x 40·폭 1000을 요청해 복원이 x 24로 화면 안에 맞췄고(y·크기는 정확), 2회차는 요청 폭 944가 최소 폭 960보다 좁아 960이 됐다(둘 다 하네스, 9b7a1a5에서 최소 크기와 작업 영역에 맞춤) |

이어 받은 확인(Task 6·7):
- **비활성 단축키**: 라이브러리에서(라이브러리로 돌아가기 비활성) 실제 ⌘1 → 창 1개 그대로, 라이브러리 표 그대로, `[app]` 콘솔 오류 없음. 통과.
- **시트의 실제 ↩·esc**(System Events `key code` 36·53, 키 창은 시트): 중복 시트 ↩ → 83ms에 닫힘, 항목 3개 그대로(건너뛰기), 가져오기 메뉴 다시 켜짐. 단축키 시트 esc → 22ms에 닫힘. 통과.
- **이유 있는 비활성 컨트롤의 초점 고리**: PDF 1쪽의 이전 쪽(`첫 쪽입니다`)에 키보드 초점 → `data-focus-visible`, 고리 solid 2px `--focus`, 단추 불투명도 1(아이콘만 0.4). 창 캡처 뒤에도 같음. `m3-10-soft-disabled-focus.window.png`.
- **치명 화면**: 위 52px 띠(`.fatal-drag`)가 `drag`, 신호등 아래(24, 26)와 오른쪽 끝 모두 띠 안이고 `no-drag` 요소 없음(맨 위 요소는 `app-region`이 없는 가운데 정렬 상자라 끌기를 막지 않는다). `m3-11-fatal.window.png`. 임시 폴더가 홈 밖(`/var/folders/…`)이라 경로가 `~`로 줄지 않는 것은 예상대로.
- **Finder에서 보기**(행 컨텍스트 메뉴 → 레지스트리 → `shell.showItemInFolder` 1회): 210ms(1회차 168ms) 뒤 맨 앞 앱이 Finder. 통과.
- **리더 열기 지연**(페이지 안 `performance.now()`, 보고만): PDF는 클릭부터 캔버스 표시까지 14ms(1회차 29), 빈 내용 구간(ViewerHost의 IPC 1회 왕복)도 그 안. 재생할 수 없는 동영상은 내용이 다시 차기까지 86ms(48), 안내가 보이기까지 896ms(1,312) — 미디어 오류가 늦게 온다.
- **VoiceOver**는 러너에서 돌릴 수 없다: 실기에서 손으로 확인하는 항목이다(아래 "남은 실기 확인 항목").

보정: 없음(신호등 토큰, 비브런시 기본값, 창 상태 대체 구현 모두 측정값이 기준 안). 다음 macOS 실행(Task 14)에서 9b7a1a5의 창 상태 판정이 통과하는지 본다.

발견(디자인 비평·후속 작업 판단용):
- 시트(중복·단축키)가 도구 막대 아래에 붙지 않고 창의 세로 가운데에 뜬다(`m3-07`·`m3-08-*.screen.png`). `setSheetOffset(52)`가 이 macOS에서 시트 위치를 정하지 않는 것으로 보인다.
- 보기 메뉴의 "전체 화면" 중복(`fn F`, `⌃⌘F`).
- 같은 자리에 겹친 두 번째 앱의 창은 캡처가 늦게 갱신된다(2회차 비교 창 캡처에 첫 그림의 빈 목록이 찍힘. 표본 두 점은 빈 영역이라 판정에는 영향 없음).
- Linux E2E는 Xvfb 화면을 1920×1200으로 키웠다: 숨긴 제목 막대(프레임 없는 창)는 화면과 크기가 같으면 Chromium이 1px 줄여, 1440×900 화면에서는 투어의 1440×900 뷰포트를 만들 수 없다. 증거 하네스(Linux)는 1440×900 그대로.

## M3 창 크롬 수정 1회차 (run 39629607271 · 39631541294, 2026-10-21, macos-15 arm64, `suite=evidence`, 3분 + 3분)

디자인 비평(critic-t8 round1)의 M1(다크·비활성 캡처가 없었음) 이후 다시 잰 값. 아래는 run 39631541294, 증거는 `evidence/m3-chrome-2/39631541294/`.

- **정직한 다크**: 모든 실행이 `colorScheme: null`로 페이지가 테마 설정을 따른다. 다크 `.page.png`의 내용 면 = 다크 `--bg-content`(24,26,27). 이전 두 실행의 "다크"는 다크 재질 위의 라이트 페이지였다.
- **신호등(기하 중심, n3)**: 닫기 (25.0, 26.0), 확대 x 65.0 — 52px 막대 세로 가운데. 토큰 그대로.
- **비브런시 재질과 사이드바 글자(M2)**: 라이트 재질 246,246,246 · 다크 56,56,56(`#383838`). 다크에서 3차 글자 4.39:1(기본 토큰이면 2.74:1), 선택 행 개수 6.57:1, 1차 9.84:1. 라이트 3차 3.65:1, 선택 행 개수 5.08:1. 모두 8.3 기준 이상.
- **비활성 창**(Finder를 앞으로, 창에 포커스를 주지 않고 캡처): 닫기 단추 회색(라이트 219,219,219 · 다크 53,53,53), 사이드바 목록의 강조 선택이 중립 채움으로 바뀜. 다크 비활성에서는 재질이 거의 검정으로 어두워진다(`m3-03b`).
- **메뉴**: 보기에 전체 화면이 하나라고 판정했으나 이는 닫힌 메뉴의 System Events 목록으로 센 잘못된 판정이었다(열린 메뉴에는 둘 — 수정 2회차 R2-1에서 바로잡음). 이름은 상태에 따라 "사이드바 가리기"/"사이드바 보기"(m2, System Events와 Electron이 같은 값). 파일은 "윈도우 닫기"(n4). AppKit이 스스로 붙이는 항목은 비패키지 앱이라 영어: 파일 "Close All"(⌥ 대체 항목), 편집 "AutoFill", "Start Dictation…", "Emoji & Symbols" — 한국어 지역화를 선언한 패키지 앱(P6)에서 다시 본다.
- **툴팁(m1)**: 메뉴로 사이드바를 두 번 접고 펴도 툴팁 없음. 메뉴 막대 메뉴가 열리면 `nativeMenu` 신호가 오고 닫힘까지 짝이 맞는다(열기·닫기 3쌍).
- **실제 키**: 중복 시트 ↩ 133ms(건너뛰기, 키를 보낸 뒤에 닫힌 것만 인정), 단축키 시트 esc 76ms, 라이브러리의 비활성 ⌘1 무시, ⌃⌘S·⌘1 `ok`, Finder에서 보기 139ms.
- **창 상태**: 닫기 직전 (40, 65, 960×604) = 재시작 후. 9b7a1a5의 요청도 그대로 받아들여짐.
- **글꼴(n6)**: 600 Latin 제목("sample")이 `.SFNS-Bold`로 그려진다(한글은 Apple SD Gothic Neo SemiBold) — Chromium이 600을 SF Bold로 고른다. 디자인 판단 필요.
- **리더 열기 지연(보고만)**: PDF 23ms, 재생할 수 없는 동영상 안내 652ms.
- **찾은 앱 결함**: 시트가 닫힌 뒤 메인 창이 키 창(`isFocused()` true)인데 마지막 windowState 푸시는 "비활성" — macOS는 시트가 끝날 때 부모를 다시 키 창으로 만들면서 Electron 'focus'를 내지 않는다. 그 결과 선택이 중립색으로 남고 툴팁이 막혔다(판정 3개 실패의 원인). 38e3a9e: 시트 창이 닫히면 main이 부모 상태를 다시 읽어 보낸다. macOS 확인은 Task 14 실행.
- VoiceOver는 여전히 실기 수동 확인 항목이다.

## M3 창 크롬 수정 2회차 (run 39640208719 · 39642950406, 2026-10-21, macos-15 arm64, `suite=evidence`, 5분 + 4분)

비평 2회차(critic-t8 round2)의 R2-1(보기에 전체 화면이 여전히 둘, 닫힌 메뉴의 System Events 목록으로 센 판정은 하나라고 보고)과 R2-2–R2-6, n6. 증거: `evidence/m3-chrome-3/39642950406/`(확인), `evidence/m3-chrome-3/39640208719/`(실험).

- **열린 메뉴로 센다**: 판정은 이제 열린 보기 메뉴 캡처의 픽셀로 글자 행과 구분선을 센다(`tests/evidence/menu-rows.ts`, 단위 테스트는 run 39631541294 캡처 조각에서 전체 화면 행 2개). 열린 메뉴의 System Events 목록도 기록하는데, **열린 상태에서도 AppKit이 덧붙인 행을 보여 주지 않는다**(2행일 때도 이름은 하나).
- **R2-1 실험(run 39640208719, 클릭 캡처를 같은 계수기로 셈)**:
  - (b) Electron `togglefullscreen` 역할(단축키 지정 없음): **2행** — "전체 화면 시작 fn F", "전체 화면 시작 ⌃⌘F". 두 행 모두 우리 제목이고 상태 이름도 함께 바뀐다: AppKit이 `toggleFullScreenMode:` 항목의 사본을 보이게 띄운다(Electron #49074는 숨은 사본만 지운다). 이전 `registerDefaults`는 아무 효과가 없었다.
  - (a) 우리 항목 없음: **0행** — AppKit은 아무것도 넣지 않는다. 그러니 fn F 행은 AppKit 자신의 "Enter Full Screen"이 아니었다.
  - (c) 역할 없는 우리 항목(⌃⌘F, 메인 창 전체 화면 토글) + 앱 기본값 `NSFullScreenMenuItemEverywhere = false`: **1행**.
  - 이 실행에서 변형 앱이 앞으로 오지 못해(같은 "Electron" 앱이 이미 앞에 있음) 실제 ⌃⌘F 판정이 비었다 → (c)를 제품 경로로 두고 run 39642950406의 주 세션이 확인했다.
- **확인(run 39642950406, 판정 35/35)**:
  - 보기는 사이드바가 보일 때·가려졌을 때·전체 화면에서 모두 **1행**(패널 y 25–90). 이름은 "전체 화면 시작" → 실제 ⌃⌘F로 들어가면 "전체 화면 종료"(m3-09f) → 다시 ⌃⌘F로 나온다.
  - 38e3a9e: 시트가 닫히고 255·275ms 안에 활성으로 돌아오고 선택은 다시 강조색.
  - 툴팁: 메뉴로 접고 펴도 없음 [0, 0]. m3-10의 비활성 이유 툴팁 "이전 쪽 · 첫 쪽입니다" 다시 보임.
  - 비활성 창: 키보드 커서 없음, 도구 막대 제목·사이드바 행 아이콘이 `--text-secondary`.
- **하네스 남은 점(Task 14)**: 다크 재질 위 툴팁(m3-14)과 메뉴 아래 툴팁은 DOM으로는 열려 있었지만, 캡처 직전 `focusApp`이 창을 잠깐 비활성으로 만들어 툴팁이 닫혔다(푸시 기록에 "unfocused"가 메뉴 열림보다 먼저). 6847751에서 앞으로 가져온 뒤 다시 포커스하지 않게 고쳤다 — Task 14 실행에서 확인한다.
- **Finder 기준**(`ref-finder-*`, 같은 러너):

  | 상태 | 제목 막대 면 → 제목 글자 | 사이드바 면 → 글자 | 사이드바의 가장 짙은 색(아이콘) |
  |---|---|---|---|
  | 라이트 활성 | 254 → 77 | 248 → 73 | (10,122,255) 강조 파랑 |
  | 라이트 비활성 | 236 → **172** | 236 → 34 | (236,204,162) 회색에 가까움 |
  | 다크 활성 | 38 → 233 | 56 → 255 | 강조색 |
  | 다크 비활성 | 20 → **85** | 23 → 255 | (27,64,104) 흐림 |

  Finder는 비활성에서 제목을 크게 흐리고(라이트 172/236), 사이드바 아이콘의 강조색을 뺀다. 사이드바 글자는 그대로다. 우리 R2-3(제목 `--text-secondary`, 아이콘 회색)과 방향이 같고 Finder가 더 흐리다 — 비평이 판단한다.
- **n6(semibold)**: 15px에서 잉크 합은 라틴 500 166 · 590 264 · 600 209 · 700 235, 한글 500 209 · 590 237 · 600 236 · 700 265.
  - 라틴 600은 CDP 이름만 `.SFNS-Bold`이고 잉크는 500과 700 사이다(가변 글꼴의 중간 굵기).
  - 라틴 590은 `.SFNS-Regular`인데 잉크가 700보다 많아 합성 굵게로 보인다.
  - 한글 590은 600과 같다(Apple SD Gothic Neo SemiBold).
  - 결론: **600 유지**(spec 4에 기록).
- 그 밖(두 실행 같음):
  - 다크 시트(m3-07b)와 Finder 참고 캡처 4장.
  - 편집의 AppKit 항목은 여전히 영어(비패키지).
  - 열기 지연: PDF 40ms, 재생 불가 안내 657ms.

## M3 창 크롬 수정 3회차 (run 39652039788 · 39653189858, 2026-10-21, macos-15 arm64, `suite=evidence`, 4분 + 4분)

비평 3회차(critic-t8 round3)의 R3-1–R3-6과 재검토의 잔여 2건. 증거: `evidence/m3-chrome-4/39653189858/`(최종), `evidence/m3-chrome-4/39652039788/`(1차). 판정은 1차 40/40, 2차 41/41(m3-09h 픽셀 판정 추가).

- **R3-1 전체 화면 왕복**: ⌃⌘F 전 `getBounds()`와 나온 뒤가 같고 작업 영역 안이어야 한다. 두 실행 모두 전 = 후 = (0, 25, 1024×681), 작업 영역 (0, 25, 1024×684). 이전 run 39640208719·39642950406에서는 창이 1440×900을 요청해 보일 때 macOS가 화면에 맞췄다가, 전체 화면에서 나올 때 요청한 틀로 돌아가 x −416, 너비 1440이 됐다. 같은 판정이었다면 같지도 않고 안에도 없어 실패했다. 이제 기본 틀이 작업 영역에 맞춰지고(`defaultFrame`), 나온 뒤에는 들어가기 전 틀을 다시 적용한다(`frameAfterFullScreen`). 캡처는 m3-09g(창·화면).
- **R3-5 전체 화면 + 사이드바 가림**: 도구 막대 왼쪽 여백 12(신호등이 없으니 84가 아님). 1차의 m3-09h는 러너의 포인터가 (10, 10)에 있어 메뉴 막대와 제목 띠(신호등, 창 제목 "내 라이브러리")가 드러난 채였다. 2차는 포인터를 (512, 620)으로 옮긴 뒤 찍었고, 창 캡처 왼쪽 위에 닫기 버튼 빨강이 0픽셀(1차는 112)이다. 창 제목은 보기를 따른다: 윈도우 메뉴의 창 이름과 제목 띠가 "내 라이브러리".
- **R3-2/R3-4 키 창과 메인 창**:
  - 다른 앱이 앞에 있으면 키도 메인도 아니다. 도구 막대 제목·개수·아이콘·가져오기 버튼, 사이드바 섹션 이름·행 이름·개수가 `--text-inactive`(primary 30%)이고, 행 아이콘은 이 실행 당시 `--accent-text-inactive`(라이트·다크 모두 판정). 다듬기 라운드에서 그 토큰을 없앴다: 지금은 행 아이콘이 `--accent-text`를 `--opacity-inactive`로 통째로 옅게 하고, 선택 행 글자는 `--text-inactive-selected`(primary 35%)다(Task 14 실행에서 확인).
  - 그린 제목의 잉크: 라이트 180 on 246 = **1.90:1**(Finder 172 on 236 = 1.92), 다크 95 on 36 = **2.44:1**(Finder 85 on 20 = 2.47).
  - 중복 시트 아래에서는 키가 아니지만 메인이다: 링·커서 없음, 크롬은 흐리지 않음(제목 = `--text-primary`).
- **R3-3/R3-6 Finder 기준(다운로드 폴더, 사이드바에 선택 행)**: 요소별 측정값(면 → 잉크, 대비). 실색 = 극값 ±2 안에 20픽셀 이상.

  | 상태 | 도구 막대 면 | 제목 | 도구 막대 글리프 | 섹션 머리 | 행 글자 | 행 아이콘 | 선택 행(면 → 글자) |
  |---|---|---|---|---|---|---|---|
  | 라이트 활성 | 255 | 77, 8.45 | 115, 4.74 (실색 아님 16px) | 182 on 246, 1.88 | 73, 8.33 | (10,122,255), 3.71 | 221 → 66, 7.4 |
  | 라이트 비활성 | 236 | **172, 1.92** | 172, 1.92 (실색 아님 18px) | 172 on 235, 1.90 | **172, 1.92** | (167,200,240), 1.46 | 211 → **147, 2.05** |
  | 다크 활성 | 38 | 233, 12.46 | 166, 6.22 (실색 아님 16px) | 121 on 56, 2.69 | 235, 9.84 | (26,148,255), 3.75 | 81 → 238, 6.84 |
  | 다크 비활성 | 20 | **85, 2.47** | 84, 2.43 (실색 아님 17px) | 85 on 20, 2.47 | **85, 2.47** | (27,64,104), 1.74 | 46 → **111, 2.70** |

  Finder는 비활성에서 제목·글리프·섹션 머리·행 글자를 같은 회색(라이트 172, 다크 85)으로 흐리고, 아이콘은 색상을 남긴 채 흐린다. **선택 행의 글자도 흐린다**(라이트 147 on 211, 다크 111 on 46). 우리는 브리프대로 선택 행 글자를 primary로 두었다 — 비평 4회차가 정한다. 도구 막대 면도 비활성에서 255 → 236(라이트), 38 → 20(다크)으로 바뀌지만, 우리 도구 막대 면은 비활성에서도 바뀌지 않는다(비활성 라이트 246).
- **R3-6 메뉴와 툴팁**:
  - 윈도우(m3-17): 최소화, Minimize All, 확대/축소, Zoom All, Fill, Center, Move & Resize ▸, Full Screen Tile ▸(타일 배치 하위 메뉴), Remove Window from Set, 모두 앞으로 가져오기, Arrange in Front, ✓ 내 라이브러리. **전체 화면 명령은 없다.**
  - 다크 재질 위 툴팁(m3-14): 캡처의 툴팁 상자 안 70%가 툴팁 바탕색.
  - 열린 툴팁 위로 보기를 클릭해 연 캡처(m3-18, 다크): 0%. 메뉴가 열리기 전에 창이 비활성이 된 적 없음. 수정 2회차가 Task 14로 넘긴 확인이 여기서 끝났다.
- **n6 비교 띠**(m3-16, page 이미지): "sample", "라이브러리"를 500 / 590 / 600 / 700으로. 수치는 수정 2회차와 같다(라틴 590이 가장 굵어 보이고 600은 그보다 가늘다).

## M3 셸 (Task 14, 2026-10-22–23, macos-15 arm64)

Task 14의 macOS 실행. 마지막 `all` 실행(**run 39920413383, 18efa56 — PR의 최종 코드**)이 녹색이다: 증거 30/0, 셸 판정 65/65, 기능 E2E 129 통과 · 0 실패 · 10 건너뜀(Linux 전용과 시각 투어), 데모는 첫 시도에 녹화됐다(아래 "4·5차 실행"). 아래 셸 판정 값·데모 절은 3차(run 39892840988, b156e77)에서 옮긴 것이고, 4·5차에서 바뀐 값은 "4·5차 실행" 절에 있다. 러너: 이미지 macos-15-arm64 20260907.0337.1, Apple M1 (Virtual), macOS 15.7.9, 1024×768 @1x. 아래 값은 모두 `evidence/m3/39892840988/evidence/evidence-results/`의 JSON(`m3-shell.json`, `perf.json`, `open-latency.json`, `theme-switch.json`, `spikes.json`, `e2e-report.json`)과 데모 파일에서 옮겼다.

### 실행 기록 (이어서)

| # | run id | 날짜(UTC) | suite / 패키지 / head | mac 잡 (초 → 과금 분) | 결과 |
|---|---|---|---|---|---|
| 15 | [39729419115](https://github.com/baebae0502/learn/actions/runs/39729419115) | 10-22 05:41 | demo / 아니오 / e547c6b (Task 13) | 393초 → 7분 | **성공**: Mac 데모 분기 첫 확인(화면 1600×900 전환과 복원, CGEvent 커서, 이름 바꾼 Learn.app, Dock, 전체 화면, Finder) |
| 16 | [39779536146](https://github.com/baebae0502/learn/actions/runs/39779536146) | 10-22 12:35 | all / 예 / 2a7f918 | 957초 → 16분 | 실패: 데모 녹화 유실, 판정 5개, 기능 E2E 7개(아래 "1차 실행") |
| 17–22 | [39785581887](https://github.com/baebae0502/learn/actions/runs/39785581887) · [39788948612](https://github.com/baebae0502/learn/actions/runs/39788948612) · [39792501184](https://github.com/baebae0502/learn/actions/runs/39792501184) · [39795175858](https://github.com/baebae0502/learn/actions/runs/39795175858) · [39796931020](https://github.com/baebae0502/learn/actions/runs/39796931020) · [39799538851](https://github.com/baebae0502/learn/actions/runs/39799538851) | 10-22 13:17–14:52 | 진단 t14-diag1–6(demo 탐침 · e2e · evidence · demo · evidence+3 spec · evidence) | 460 · 394 · 251 · 354 · 318 · 279초 → 8 · 7 · 5 · 6 · 6 · 5분 | 진단(1차 실행 수정 라운드): 녹화 유실 원인 탐침, 기능 E2E와 판정 재확인 |
| 23 | [39884763777](https://github.com/baebae0502/learn/actions/runs/39884763777) | 10-23 01:34 | all / 예 / d119c0d | 936초 → 16분 | **성공**: 증거 29/0, 판정 64/64, E2E 124/0/10. 데모에 앱 결함 하나(성공 토스트가 닫히지 않음, b2f0e55에서 고침) |
| 24 | [39892840988](https://github.com/baebae0502/learn/actions/runs/39892840988) | 10-23 03:02 | all / 예 / b156e77 | 963초 → 17분 | **성공**: 증거 29/0, 판정 64/64, E2E 127/0/10, 데모 첫 시도 녹화 |
| 25 | [39913204254](https://github.com/baebae0502/learn/actions/runs/39913204254) | 10-23 06:43 | all / 예 / 7175385 (최종 리뷰 수정) | 981초 → 17분 | **성공**: 증거 30/0, 판정 65/65(기본 앱 조회 추가), E2E 128/0/10, 데모 첫 시도 녹화 |
| 26 | [39920413383](https://github.com/baebae0502/learn/actions/runs/39920413383) | 10-23 07:49 | all / 예 / 18efa56 (잔여 수정, 최종) | 935초 → 16분(공개 저장소: 무료) | **성공**: 증거 30/0, 판정 65/65, E2E 129/0/10, 데모 첫 시도 녹화 |

**합계: macOS 26회, 179분.** M0 5회 · M2 1회 · M3 20회. M3은 Task 8 창 크롬 8회(30분), Task 13 데모 1회(7분), Task 14 11회(119분: `all` 5회 82분, 진단 6회 37분). fixture 잡(ubuntu)은 run마다 1분(×1).
- **한도**: 비공개 저장소일 때는 macOS 1분이 포함 분 10분, Linux 1분이 1분으로 같은 월 2,000분에서 빠진다. 25차(run 39913204254)까지 macOS 166분(1,660) + Linux CI 약 373분으로 2026-10 한도를 다 썼다(이 문서의 이전 합계는 macOS만 셌다). 계정의 Actions 예산이 $0(사용 차단)이라 과금은 없었다.
- **2026-10-23 공개 전환**: 저장소를 공개한 뒤로 GitHub 호스트 러너(macOS 포함)는 무료다. 26차(run 39920413383)는 공개 뒤 실행이다.

### 1차 실행에서 2차까지 (run 39779536146 → 39884763777)
- **데모 녹화 유실**: `screencapture -v`가 1600×900 전환 뒤 8.1초 만에 종료 1("capture error")로 끝났다. 탐침 run 39785581887에서 같은 모드로 12초 녹화 5개(커서 이동 0·30·60·120 Hz)가 모두 성공했고, 성공한 녹화도 같은 `IOServiceMatchingfailed … AppleM2ScalerParavirtDriver` 줄을 남긴다. 그래서 그 줄은 원인이 아니며, 원인은 가상 디스플레이 캡처의 일시 실패다. 대응(b0f6d32, 68369e2):
  - 데모 시작 전 종료, 파일 없는 끝, 부분 파일, 프레임 없는 화면 캐스트를 모두 유실로 본다;
  - 유실되면 같은 모드로 한 번 더, 그다음 러너의 원래 모드로, 마지막으로 메인 창의 CDP 화면 캐스트로 다시 녹화한다(560초 예산, 한 번에 320초 이상 남을 때만). 마지막 계획까지 잃으면 테스트가 실패한다;
  - 화면 모드·Dock·바탕 화면 복원은 시험 시간 초과 뒤에도 `afterAll`이 돌린다;
  - 증거 단계 최악: 285 + 620 + 45 = 950초(제한 960초).
- **판정 5개**: 하네스 4개(툴팁 포커스 단계, 메뉴 행 세기 임계값, 남은 열기 대화상자 스텁)와 앱 결함 1개(⌃⌘S 뒤 툴팁이 남음, 9840eda·20a204d·152f05a).
- **기능 E2E 7개**: macOS 값으로 고친 테스트 5개(앱 홈은 macOS에서 실제 홈 — `HOME`을 따르지 않음, 비브런시 창 배경은 투명, 1024 화면, 비활성 재질), 실제 접근성 결함 1개(⌘/ 시트 본문이 스크롤되는데 키보드로 닿지 않음, 5dd1700), 예상 실패 1개(전체 화면 진입 중 해제 경합, `test.fail`).
- **1차 비평의 minor**: 남는 툴팁(m1), 설정 창 자기 시트 아래의 링(m2, 13e7645), 768 높이 ⌘/ 시트(m3), 앱 메뉴 "Learn 정보" → **"Learn에 관하여"**(m4, c28acc5 — 위 M2 절의 "Learn 정보"는 그때 기록이라 그대로 둔다).

### 셸 판정 값 (run 39892840988)
- **신호등과 84 여백**: 닫기 단추 중심 (25, 26), 초록 오른쪽 끝 71 < 84(`trafficLights`). 접은 도구 막대 왼쪽 여백 84, 오른쪽 12(오버레이 env 없음). 전체 화면에서 사이드바를 가리면 12(신호등 없음).
- **비브런시**: 사이드바 246(재질) 대 불투명 대체 238,241,243 → `sidebarDelta` 8, 내용은 255 그대로(`contentDelta` 0). 다크 재질 56 > 도구 막대 36 > 내용 24.
- **메인이 아닐 때**: 도구 막대 캡처 236(라이트) / 20(다크), 회색 신호등 219 / 53, 다크에서 사이드바 경계와 도구 막대 아래 선이 (0,0,0). 선택 행 글자 대비 2.02:1 / 2.70:1(Finder 2.05 / 2.70).
- **실제 단축키**(System Events 키 입력): ⌃⌘S와 ⌘1이 네이티브 메뉴에 닿는다. 라이브러리에서 비활성인 ⌘1은 아무것도 하지 않는다. 중복 시트의 실제 ↩은 건너뛰기(93ms), 단축키 시트의 실제 esc는 닫기(85ms). 기능 E2E `platform.spec.ts` "⌘O (파일 가져오기…) opens the dialog exactly once" 통과.
- **창 상태 복원**: (40, 65, 960×604)를 요청 → 닫기 전 같은 값 → 재시작 뒤 같은 값. 전체 화면 왕복은 기본 틀(0, 25, 1024×684)·사용자 틀·확대된 창 모두 원래 틀로 돌아온다.
- **SF 글꼴**: 도구 막대 제목 "내 라이브러리"는 `.SFNS-Bold`(라틴)와 `AppleSDGothicNeo-SemiBold`(한글). 굵기 탐침은 Task 8과 같다(라틴 600 잉크 209, 590 264, 한글 600 236).
- **나머지 판정(9.10)**: 파일 메뉴 "윈도우 닫기", 윈도우 메뉴에 전체 화면 항목 없음, 보기에 전체 화면 행 하나(사이드바 두 상태와 전체 화면에서), 전체 화면에서 포인터를 치우면 신호등·제목 띠가 도구 막대를 덮지 않음, 치명 화면 위 띠로 창 끌기, Finder에서 보기 → Finder가 앞으로(172ms), 비활성 시 링 없는 포커스와 이유 툴팁, 메뉴 토글 뒤 툴팁 0개(키보드 2회·포인터 2회), 시트 아래 창은 메인 유지, 다크 재질 위 툴팁이 캡처에 있음(첫 캡처, 70%), 메뉴가 열린 툴팁을 닫음(0%) — 모두 통과.
- **설정 창**: ⌘, 실제 키 입력으로 600폭 "설정" 창, 아래 메인 창은 키도 메인도 아님. 폴더 선택 패널과 재시작 확인이 설정 창의 시트로 뜨고 그 아래 설정 창은 메인이지만 키가 아니다(링 없음, `underSheet.notKey` true). 실제 esc로 취소하면 다시 키. 전체 화면 위에서 ⌘,도 같은 Space에 보인다.
- **패키지·메뉴 언어**(스파이크 5·6): 패키지 앱이 "Learn"으로 실행되고, `-AppleLanguages (ko)`에서 AppKit이 넣는 항목도 한국어다("Korean as built: no bundle change needed").

### 성능 (참고값, 판정은 기준 장비)
- **냉시작 중앙값**(`perf.json`, 실행 5회): app-ready 683ms, 창 표시 575, 첫 페인트 521, main 준비 193(이전 Mac 실행 611 / 520). 같은 head의 Linux CI(ubuntu, Xvfb)는 app-ready 555ms, 이 서버는 882ms. 1.5초 예산(AC16)은 기준 장비(Apple Silicon 16 GB)에서 판정한다.
- **번들**: JS 2,607,919 B, PDF.js 워커 1,264,342 B, CSS 84,428 B, 글꼴(Pretendard) 2,057,688 B.
- **시트·설정 창 열기**(`open-latency.json`, 메뉴 클릭 → 창 표시, main 시계; 목표 250ms):

  | 실행 | ⌘/ 시트 중앙값(5회) | 설정 창 중앙값(5회) | 새 세션 첫 열기(3세션 중앙값) |
  |---|---|---|---|
  | 1차 run 39779536146 | 274ms (439, 267, 274, 268, 309) | 224ms | — |
  | 2차 run 39884763777 | 292ms (311, 215, 257, 292, 308) | 197ms | — |
  | 3차 run 39892840988 | **311ms** (349, 275, 330, 311, 286) | **245ms** (289, 208, 245, 207, 270) | 시트 329ms, 설정 284ms |
  | Linux CI 39892159224 (b156e77) | 225ms | 222ms | 251 / 263ms |

  ⌘/ 시트 중앙값은 세 실행 모두 **목표 250ms를 넘는다**(2배 실패선 500ms 안). 체크리스트 7.1 규칙대로 **보고만 하고 고치지 않았다**. 데모 영상에서 본 첫 열기: 2차 ⌘/ 1.20초 · 설정 0.87초, 3차 ⌘/ 0.48초 · 설정 0.38초(키·메뉴 제목 깜박임부터 창의 첫 프레임까지). Linux에서 새 세션 첫 열기는 HEAD가 e547c6b보다 60–70ms 빠르다(회귀 아님). 줄이는 방법(시트·설정 렌더러 미리 띄우기)은 M4 입력이다.
- **테마 전환**(`theme-switch.json`, 다크 → 라이트 → 다크): 클릭부터 페이지 표시 16–27ms, 네이티브 테마 적용 37–42ms, `nativeTheme` updated 47–53ms, 세 번 모두 `nativeAppliedBecause: shown`. 2095fba부터 **크로스페이드는 어느 플랫폼에서도 쓰지 않는다**: 2차 영상에서 View Transition의 첫 프레임이 늦어 네이티브 제목 막대·사이드바가 웹 내용보다 183–283ms 먼저 어두워졌다. 3차 영상(60fps)에서는 웹 내용이 먼저 한 프레임에 바뀌고(120.717초) 네이티브 부분이 3프레임 뒤(120.767초) 따라온다 — 밝은 내용 위의 어두운 제목 막대 프레임은 없다.
- **리더 열기 빈 화면**(`openLatencyMs`): PDF 5ms(준비 20ms), 재생 불가 안내 9ms(준비 102ms) — 보이지 않는다.

### 데모 (run 39892840988)
- artifact `demo-m3-39892840988`, 파일 `m3-demo.final.mov`: 174.5초, 1600×900, H.264, 60fps, 장 17개 내장. 첫 시도(같은 화면 모드, `screencapture`), `notes` 없음, 커서 `system`, 네이티브 키 13회.
- 장 목록(`m3-demo.chapters.txt`, 영상 시각):

  | 시각 | 장 |
  |---|---|
  | 0:02 | Learn을 처음 열면 빈 라이브러리가 가져오는 방법을 안내합니다. |
  | 0:06 | 파일을 창으로 끌어 오면 창 전체가 놓을 곳이 됩니다. ⌥ 키를 누르고 있으면 연결로 바뀝니다. (끌기는 스크립트로 재현합니다) |
  | 0:16 | 놓으면 사본으로 가져오고, 결과를 알림으로 보여 줍니다. |
  | 0:21 | ⌘O 키로도 가져올 수 있습니다. (데모에서는 파일 선택 창을 건너뜁니다) |
  | 0:26 | F6 / ⇧F6 키로 사이드바, 표, 알림 패널 사이를 옮겨 다닙니다. |
  | 0:36 | PDF를 열어 다음 쪽으로 넘깁니다. |
  | 0:46 | ⌃⌘F 키로 전체 화면에 들어가도 위쪽 제목 띠에 지금 보는 화면의 이름이 나옵니다. |
  | 1:03 | 재생할 수 없는 동영상은 이유를 알리고 ‘Finder에서 보기’와 ‘기본 앱으로 열기’를 권합니다. |
  | 1:16 | ⌃⌘S 키로 사이드바를 접고, 경계를 끌어 폭을 바꿉니다. |
  | 1:33 | ⌘K 키로 여는 명령 팔레트는 초성으로도 찾습니다: ㅅㅈ → 설정. |
  | 1:42 | 설정은 따로 뜨는 창이고, 뒤의 메인 창은 흐려집니다. |
  | 1:46 | 밀도와 글자 크기는 메인 창에 바로 반영됩니다. |
  | 2:00 | 테마는 두 창이 함께 바뀝니다. |
  | 2:08 | 다크 모드에서도 같은 화면, 같은 정보입니다. |
  | 2:31 | 다른 앱이 앞에 오면 Learn 창은 비활성으로 흐려집니다. |
  | 2:38 | ⌘/ 키로 단축키 도움말을 엽니다. F6 / ⇧F6도 있습니다. |
  | 2:47 | Learn 둘러보기를 마칩니다. |
- 2차 실행 영상의 결함과 3차 영상에서 확인한 것(60fps 프레임):
  - 드롭의 성공 토스트("자료 8개를 가져왔습니다")가 2차에서는 끝까지 남았다(react-aria 토스트 타이머의 경합: 마감 직후, 타이머 작업보다 먼저 포인터가 토스트에 오면 남은 시간이 0 아래로 내려가 다시 시작하지 않는다). b2f0e55부터 우리 타이머가 센다. 3차에서는 16.82초에 나타나 21.45초에 닫힌다. 화면에 보인 시간은 4.6초다: 타이머가 첫 페인트가 아니라 마운트부터 셌다. eec201d부터 첫 페인트부터 센다(4차에서 다시 잰다);
  - ⌘W로 설정 창을 닫을 때 빈 본문 2프레임 → 3차는 제목 막대와 본문이 같은 프레임에 사라진다(aca0582);
  - 설정 창을 옆으로 옮기는 동작이 한 프레임 396px 점프 → 3차는 0.28초에 걸친 계단식 이동(da6be9c);
  - ⌘/ 시트: 도구 막대가 시트 첫 프레임보다 1프레임(17ms) 먼저 흐려진다(T13M-n4, 지각 불가);
  - Finder 창 680×380(목록 보기). 가로 스크롤 막대와 잘린 이름은 남았다;
  - 남은 것: PDF 다음 쪽 누름의 클릭 고리는 한 프레임(41.267)만 보였다. 첫 장 자막은 영상에 1.77초(불투명 1.42초) 있었다. 그 앞 3.42초 동안 영상에 움직이는 것이 없었다(페이지는 약 1.6초에 자막을 시작했다).
- 3차 실행(run 39892840988)의 Mac 비평(`critic-t14/mac3`, opus) 판정: **통과**. 차단 0, 주요 0, 부차 3, 사소 7.
  - 2차의 주요 결함 M1(드롭 토스트)은 Mac에서 닫혔다.
  - 부차 3은 다음과 같고, 모두 최종 수정 묶음에서 고쳤다(4차에서 확인):
    - m2: 첫 장 자막(행 7.9). Mac 사전 녹화를 4.5초로 늘리고, `finish-demo.sh`가 멈춘 머리를 0.5초로 자른다(a9766bf);
    - m4: 테마 전환 때 네이티브 사이드바·제목 막대가 페이지보다 3프레임(50ms) 늦다(행 7.3). 페이지가 바꾼 직후에 알린다(01d2312);
    - m5: ⌘O 토스트로 가는 포인터 이동(a9766bf).
  - 사소한 것도 같은 묶음에서 고쳤다:
    - n3: 클릭 고리(32b92c7);
    - n4: Finder 열 숨기기(a9766bf);
    - n5: 장 표시를 실제 파일 길이로 놓기(a9766bf);
    - n6: 드롭 뒤 0.55초 멈춤과 100ms 바쁨 문구. 표시를 더하고 고쳤다(36ad37d, eec201d). Mac 원인은 4차의 `drop-import.json`이 말한다;
    - n7: 불투명 비교 캡처(2a743b1).
  - 위 3차 영상 수치(테마, 토스트, 설정 창 이동·닫기, 시트)는 구현자가 60fps 프레임에서 잰 값이고, 비평의 값과 같다.

### 4·5차 실행 (run 39913204254 · 39920413383, 최종 리뷰 수정과 잔여 수정)
- **기본 앱으로 열기·Finder에서 보기**(최종 리뷰 I1): 관리형 사본의 저장 파일(`assets/<2>/<sha256>`, 확장자 없음)은 macOS에서 **TextEdit**로 열린다(LaunchServices 조회, 실행 없이). 이름 붙인 읽기 전용 사본(`derived/open/<assetId>/<제목>.<확장자>`)은 PDF → **Preview**, MP4 → **QuickTime Player**(5차, 종류마다 자기 경로로 확인). 4차는 PDF → Preview.
- **시트·설정 창 열기**(`open-latency.json`, 목표 250ms):

  | 실행 | ⌘/ 시트 중앙값(5회) | 설정 창 중앙값(5회) | 새 세션 첫 열기(3세션 중앙값) |
  |---|---|---|---|
  | 4차 run 39913204254 (7175385) | 518ms (585, 605, 518, 474, 402) | 282ms | 시트 521ms, 설정 357ms |
  | 5차 run 39920413383 (18efa56) | **300ms** (426, 300, 258, 275, 315) | **204ms** (204, 234, 197, 197, 215) | 시트 329ms, 설정 272ms |

  4차의 시트 값만 튀었다. 그 사이 시트 경로의 변경(`measure.ts`의 `executeJavaScript(…, false)`, ⌘/ 시트의 전체 화면 행)은 Linux에서 b156e77 · 7175385 · 7175385+`true`를 번갈아 10회씩 재도 차이가 없었고(시트 378.5–384ms, 첫 열기 444–450.5ms), 5차가 다시 300ms라 러너 편차로 본다. 5차도 ⌘/ 시트는 목표 250ms 위(보고만, M4 미리 띄우기 입력).
- **테마 전환**(5차, `theme-switch.json`): 네이티브 테마 적용 23–33ms, 세 번 모두 `shown`. 데모 60fps 프레임(다크 클릭, 탐침: 메인 사이드바·도구 막대·내용, 설정 제목 막대·본문·카드): 설정 페이지 119.517초 → 메인 페이지 119.550초(+2프레임) → 네이티브 부분(메인 사이드바 재질, 설정 제목 막대) 119.583초. **네이티브가 페이지보다 앞서는 프레임은 없다.** 메인 창은 자기 페이지 뒤 2프레임(허용 1–2) 안이고, 설정 창 제목 막대는 자기 페이지보다 4프레임(67ms) 늦다 — `nativeTheme`은 두 창에 한 번에 적용되므로 두 페이지가 같은 프레임에 바뀌어야 줄어든다(M4 입력).
- **드롭**(`drop-import.json`, 8개 파일): 4차 — 오버레이 지움 17ms, 응답 109ms, 토스트 363ms, 페이지 최장 프레임 간격 317ms, main 최장 정지 5ms. 5차 — 27 / 97 / 247ms, 프레임 간격 200ms, main 7ms, 바쁨 문구 없음. 3차 영상의 0.55초 멈춤은 main이 아니라 렌더러 쪽이다(M4에서 프로파일).
- **냉시작 중앙값**(`perf.json`): app-ready 4차 679ms, 5차 586ms.
- **데모**: 4차 175.7초, 5차 172.6초(artifact `demo-m3-39920413383`, `m3-demo.final.mov`, 1600×900, 60fps, 장 17개), 둘 다 첫 시도 녹화, `notes` 없음. 5차 장 목록은 3차와 같은 17장이고 시각만 몇 초 다르다(앞머리 자르기와 토스트 기다림).

## M4 표 스파이크 (Task 1, 2026-10-24, macos-15 arm64, `suite=perf`, 브랜치 `m4-spike`)

| # | run id | 날짜(UTC) | suite / 패키지 / head | mac 잡 (초 → 과금 분) | 결과 |
|---|---|---|---|---|---|
| 27(앞 기록의 마지막이 26) | [40034565009](https://github.com/baebae0502/learn/actions/runs/40034565009) | 10-23 22:35 | perf / 아니오 / 13e44c3 (Task 1 스파이크) | 213초 → 4분(공개 저장소: 무료) | **성공**: RAC 떨어짐(sort·select·keyboard·filter), TanStack 통과 → 결정 TanStack |

**합계: macOS 27회, 183분.** 값은 `evidence/m4-spike/40034565009/evidence/evidence-results/table-spike.json`·`table-spike-tanstack.json`, 결정과 표는 ADR-0004 "M4 표". 같은 실행의 `perf.json`·`open-latency.json`·`theme-switch.json`·`drop-import.json`은 M3 코드 그대로의 참고값이다.

## M4 작업별 실행 (브랜치 `m4-library`, macos-15 arm64)

| # | run id | 날짜(UTC) | suite / 패키지 / head | mac 잡 (초 → 과금 분) | 결과 |
|---|---|---|---|---|---|
| 28 | [40097296461](https://github.com/baebae0502/learn/actions/runs/40097296461) | 10-24 13:14 | library / 아니오 / 71bd6fc (Task 3 표) | 112초 → 2분(공개 저장소: 무료) | **성공**: 증거 테스트 4개, `m4-library.json` 확인 11개 모두 ok(실제 ⌘A, 비활성 창, 네이티브 열 메뉴 포함) |
| 29 | [40098108104](https://github.com/baebae0502/learn/actions/runs/40098108104) | 10-24 13:26 | library / 아니오 / a47d52e (Task 3 비활성 창 증거 수정 1) | 83초 → 2분(무료) | **실패**: 비활성 창 캡처는 맞게 찍혔으나(행 225,226,226, 도구 막대 236) 판정이 반투명 토큰 문자열과 비교 — 10/11 ok |
| 30 | [40098357693](https://github.com/baebae0502/learn/actions/runs/40098357693) | 10-24 13:29 | library / 아니오 / bf52a9e (수정 2) | 78초 → 2분(무료) | **실패**: 기준 PNG(포커스 없는 선택)를 라벨 폴더 밖에서 찾음 — 10/11 ok |
| 31 | [40098617639](https://github.com/baebae0502/learn/actions/runs/40098617639) | 10-24 13:33 | library / 아니오 / 1c9d1da (수정 3) | 70초 → 2분(무료) | **성공**: 증거 테스트 4개, 확인 11개 모두 ok — 비활성 창은 캡처 픽셀로 판정(행 = 포커스 없는 선택의 그려진 채움, 도구 막대 236) |
| 32 | [40100366921](https://github.com/baebae0502/learn/actions/runs/40100366921) | 10-24 13:57 | library / 아니오 / 0d8733b (Task 4 선택 → 명령) | 103초 → 2분(무료) | **실패**: 16/18 ok — 메뉴 캡처가 메뉴를 닫으려 보낸 여분의 Esc가 표의 선택을 지워(표의 Esc = 선택 해제) 실제 ⇧⌘R에 대상이 없었고, 다음 ⌘-클릭이 선택을 켰다 |
| 33 | [40100757864](https://github.com/baebae0502/learn/actions/runs/40100757864) | 10-24 14:02 | library / 아니오 / 3c9c9f4 (검사가 자기 행을 고른다) | 73초 → 2분(무료) | **성공**: 증거 테스트 5개, 확인 18개 모두 ok — 실제 ⇧⌘R이 네이티브로 고른 행을 보였다(이름 붙은 사본), 파일 메뉴 둘 다 켜짐/꺼짐, ⌘/ 시트 두 열·자연 높이 562 |
| 34 | [40105921816](https://github.com/baebae0502/learn/actions/runs/40105921816) | 10-24 15:12 | library / 아니오 / 3ee388f (Task 5 빠른 검색) | 104초 → 2분(무료) | **성공**: 증거 테스트 6개, 확인 23개 모두 ok — 실제 ⌘F 네이티브, 편집 메뉴의 빠른 검색은 역할 항목 뒤(그 뒤의 AutoFill·받아쓰기·이모티콘은 macOS가 붙인다), 앞 작업의 선택 검사 회귀 없음 |
| 35 | [40107292541](https://github.com/baebae0502/learn/actions/runs/40107292541) | 10-24 15:30 | library / 아니오 / 5db52b2 (Task 5 수정: 투어 경쟁, 균형 잡힌 빈 상태 문구, Linux 선택 색) | 106초 → 2분(무료) | **성공**: 확인 23개 모두 ok — 결과 없음 설명이 두 줄로 고르게 나뉜다(고아 어절 없음) |
| 36 | [40112125869](https://github.com/baebae0502/learn/actions/runs/40112125869) | 10-24 16:33 | library / 아니오 / 6babaff (Task 6 인스펙터) | 111초 → 2분(무료) | **성공**: 증거 테스트 7개, 확인 27개 모두 ok — 1024 창에서 항목 패널은 기본으로 접힘, 실제 ⌥⌘I가 네이티브로 열었다(320, y 52), 보기 메뉴의 "항목 패널 가리기 ⌥⌘I" |
| 37 | [40114025717](https://github.com/baebae0502/learn/actions/runs/40114025717) | 10-24 16:58 | library / 아니오 / e42c46c (Task 6 수정: 원본 없음 머리의 원인 표시, 검사가 실제 비교) | 93초 → 2분(무료) | **성공**: 확인 27개 모두 ok |
| 38 | [40117002928](https://github.com/baebae0502/learn/actions/runs/40117002928) | 10-24 17:38 | library / 아니오 / 8f8c26d (Task 7 정보 편집) | 119초 → 2분(무료) | **성공**: 증거 테스트 8개, 확인 30개 모두 ok — 실제 ⌘↩가 폼에 닿아 저장, 표시한 필드 앞에서 실제 ⌘W는 창을 닫지 않고 실제 ⌘Q는 종료를 취소(flush 기록 close·quit 모두 invalid) |
| 39 | [40118510941](https://github.com/baebae0502/learn/actions/runs/40118510941) | 10-24 17:57 | library / 아니오 / 7e434be (Task 7 수정 1: flush 안전, 막힌 떠나기의 포커스, 한 번에 저장 하나) | 100초 → 2분(무료) | **성공**: 확인 30개 모두 ok |
| 40 | [40119488421](https://github.com/baebae0502/learn/actions/runs/40119488421) | 10-24 18:10 | library / 아니오 / d325421 (Task 7 수정 2: 막힌 떠나기가 그리기를 기다리지 않고 바로 답함) | 119초 → 2분(무료) | **성공**: 확인 30개 모두 ok |
| 41 | [40123090917](https://github.com/baebae0502/learn/actions/runs/40123090917) | 10-24 18:57 | library / 아니오 / c031b33 (Task 8 사본 내보내기) | 130초 → 3분(무료) | **성공**: 증거 테스트 9개, 확인 35개 모두 ok — 저장 패널이 시트로 다운로드 폴더에서 열렸고, 바쁨 토스트가 949ms에 나타났다 |
| 42 | [40125361565](https://github.com/baebae0502/learn/actions/runs/40125361565) | 10-24 19:27 | library / 아니오 / 9b9987f (Task 8 수정: 라이브러리 안·원본 위 저장 거부, 한 번에 하나, 토스트 링크 위치) | 131초 → 3분(무료) | **성공**: 확인 35개 모두 ok |
| 43 | [40127825772](https://github.com/baebae0502/learn/actions/runs/40127825772) | 10-24 20:00 | library / 아니오 / 58800ab (Task 9 팔레트 자료 결과) | 140초 → 3분(무료) | **실패**: 팔레트 증거 테스트가 둘째 앱을 띄웠는데 공유 세션의 Electron이 맨 앞에 남아 실제 ⌘K 앞의 앞으로 가져오기가 실패 — 팔레트 확인과 PNG 없음 |
| 44 | [40130074939](https://github.com/baebae0502/learn/actions/runs/40130074939) | 10-24 20:30 | library / 아니오 / aa99063 (⌘K를 공유 세션에서) | 109초 → 2분(무료) | **성공**: 증거 테스트 10개, 확인 39개 모두 ok — 실행기 "검색 및 명령", 자료가 명령 위, 초성 예, 결과 없음에도 검색 행 |
| 45 | [40134381407](https://github.com/baebae0502/learn/actions/runs/40134381407) | 10-24 21:28 | perf / 아니오 / acca1f7 (Task 10 1만 항목과 드롭 프로파일) | 101초 → 2분(무료) | **성공**: 1만 항목 목록 IPC 중앙값 90, 첫 그리기 39, 입력→그리기 p95 30, 검색 p95 2.7, 스크롤 p95 18.7, 정렬 21, 항목 패널 18(ms) — 드롭 뒤 최장 프레임 간격 202ms(목표 100), 긴 프레임 항목 없음(`unmeasured`) → 수정 W·I |
| 46 | [40136294230](https://github.com/baebae0502/learn/actions/runs/40136294230) | 10-24 21:54 | perf / 아니오 / 3a3670b (Task 10 수정 W·I) | 145초 → 3분(무료) | **성공(목표 미달)**: 드롭 뒤 최장 간격 201ms, 원인 script, 가장 긴 프레임 1660ms(스크립트·스타일 0), 완료 토스트 1284ms — 목록 IPC 159·정렬 45처럼 수정과 무관한 값도 느렸다 |
| 47 | [40136585407](https://github.com/baebae0502/learn/actions/runs/40136585407) | 10-24 21:59 | perf / 아니오 / acca1f7 (임시 브랜치 `m4-t10-base`, 수정 전 비교) | 125초 → 3분(무료) | **성공**: 수정 전 코드에서도 최장 간격 166ms, 가장 긴 프레임 1121ms(스크립트·스타일 0), 완료 토스트 1341ms — 같은 현상 |
| 48 | [40136618624](https://github.com/baebae0502/learn/actions/runs/40136618624) | 10-24 21:59 | perf / 아니오 / 3a3670b (47과 같은 시각) | 113초 → 2분(무료) | **성공**: 최장 간격 132ms, 가장 긴 프레임 1462ms(스크립트 0, 스타일 1), 완료 토스트 1260ms — 판정: 원인을 알 수 없는 1.1–1.7초 프레임은 러너(GPU 없는 가상 Mac) 현상이고 수정 W·I의 효과는 이 잡음 속에서 가를 수 없다. 실기 Mac 확인으로 넘긴다 |
| 49 | [40142306581](https://github.com/baebae0502/learn/actions/runs/40142306581) | 10-24 23:20 | evidence / 아니오 / ab3eef6 (Task 11 창마다 다른 preload, 시트 부모 판정, main 문구) | 238초 → 4분(무료) | **성공**: 증거 테스트 16개(2개 건너뜀), `m3-shell.json` 확인 66개 모두 ok — m5: 시트 아래 메인 창은 메인으로 남고, 설정 창이 키를 가져가면 흐려지며, 시트가 키를 되찾으면 돌아온다; 시트·설정 창이 각자의 preload만으로 동작 |
| 50 | [40149289047](https://github.com/baebae0502/learn/actions/runs/40149289047) | 10-25 01:06 | perf / 아니오 / 910b7e0 (Task 12 미리 준비한 설정 창, 시트 측정, 같은 프레임의 테마) | 170초 → 3분(무료) | **성공**: 설정 창 첫 열기 30ms(미리 준비, 목표 300), 이후 새 창 274–363, 테마 두 페이지 차이 0–20ms — ⌘/ 시트 중앙값 406ms(목표 250) |
| 51 | [40149559452](https://github.com/baebae0502/learn/actions/runs/40149559452) | 10-25 01:10 | demo / 아니오 / 910b7e0 (테마 프레임) | 370초 → 7분(무료) | **성공**: 데모 테스트 1개 |
| 52 | [40150161469](https://github.com/baebae0502/learn/actions/runs/40150161469) | 10-25 01:19 | perf / 아니오 / 910b7e0 (시트 지연 재측정) | 144초 → 3분(무료) | **성공**: ⌘/ 시트 중앙값 290ms(231–328 — M3의 292·300·311과 같은 수준, 50의 406은 잡음), 설정 첫 열기 50ms, 테마 차이 최대 1ms — 시트 250 목표는 러너에서 미달, 실기 확인으로 넘긴다 |
| 53 | [40154334711](https://github.com/baebae0502/learn/actions/runs/40154334711) | 10-25 02:24 | all / 예 / 013eee0 (Task 13 첫 `all` + 데모) | 1199초 → 20분(무료) | **실패**: 증거 42/42 ok(셸 판정·라이브러리 판정 모두), 기능 E2E 9 — 하네스: 1024px 화면이 항목 패널 도우미를 위해 넓어지지 못함(6), 갤러리의 Linux 레이블, 첫 응답자 없는 모두 선택, 사이드바 위 88px 비교. 고침: d02da2a, bfe3b9b |
| 54 | [40158520631](https://github.com/baebae0502/learn/actions/runs/40158520631) | 10-25 03:31 | e2e / 아니오 / bfe3b9b (위 고침 확인) | 647초 → 11분(무료) | **실패**: 181 통과, 5 — 위 88px 비교 2개, 툴팁 3개(러너의 변덕으로 판단, 진단 추가). 고침: 3a7981b |
| 55 | [40162034858](https://github.com/baebae0502/learn/actions/runs/40162034858) | 10-25 04:29 | all / 예 / a2f5add (Task 13 최종 `all` + 데모) | 1335초 → 23분(무료) | **실패**(기능 E2E만): 증거 42/42 ok, 셸 69/69, 라이브러리 39/39, 데모 첫 시도에 녹화, 기능 E2E 184 통과 · 3 실패(사이드바 위 88px 비교 2개, `drop.spec.ts` 드롭 문구 시간 단언). 고침: 1d2b91e(3라운드) |
| 56 | [40164735397](https://github.com/baebae0502/learn/actions/runs/40164735397) | 10-25 05:13 | e2e / 아니오 / 1d2b91e (3라운드 확인) | 690초 → 12분(무료) | **실패**: 183 통과, 4 — 사이드바 위 88px 비교 1개, 호버 툴팁 3개(react-aria는 포인터로 움직인 것이 확인된 뒤에만 호버 툴팁을 연다 — 키를 누른 뒤 컨트롤 위로 바로 옮긴 포인터는 무시). 고침: cc146f9(토글을 왼쪽에서 정수 픽셀에), 011fca7 |
| 57 | [40166026616](https://github.com/baebae0502/learn/actions/runs/40166026616) | 10-25 05:34 | e2e / 아니오 / 011fca7 (4라운드 확인) | 610초 → 11분(무료) | **실패**: 185 통과, 2 — 툴팁은 통과, 남은 것은 위 88px 비교 2개(반투명 재질 위 글리프 가장자리). 고침: c030271(macOS만 불투명 색에 합성해 비교) |
| 58 | [40167674805](https://github.com/baebae0502/learn/actions/runs/40167674805) | 10-25 06:02 | e2e / 아니오 / c030271 (5라운드 확인) | 887초 → 15분(무료) | **실패**: 170 통과, 3, 32 건너뜀 — 위 88px 비교 2개(런처 오른쪽 둥근 모서리 6픽셀의 알파 180 대 152, 두 시험이 같은 값), axe 시험의 포커스 경합(팔레트 입력란이 포커스를 받기 전에 친 글자가 빠른 검색으로 가서 행이 걸러짐). 그 시험이 잘못된 편집을 남긴 채 끝나 앱이 종료를 거부했고(제품 동작은 맞다) 작업자 정리 120초에 묶여 전체 840초 한도를 넘었다(14개 미실행). 고침: 8e2e0b0 이후 0a2b409(입력 전 포커스 대기, 닫기 10초 뒤 강제 종료, macOS 모서리 픽셀 8개 허용) |
| 59 | [40242680541](https://github.com/baebae0502/learn/actions/runs/40242680541) | 10-25 22:59 | all / 예 / 0a2b409 (M4 최종 `all` + 데모) | 1338초 → 23분(무료) | **성공**: 증거 42/42, 셸 판정 69/69, 라이브러리 판정 39/39, 기능 E2E 189 통과 · 0 실패 · 18 건너뜀, 데모 `m4-demo.final.mov` 158초 16장 첫 시도에 녹화. 드롭 뒤 최장 프레임 간격 36ms, 바쁨 토스트는 저장 패널이 닫힌 뒤 345ms |

**합계: macOS 59회, 362분.** Task 3의 판정 값과 PNG는 `evidence/m4-t3d/40098617639/evidence/evidence-results/`, Task 4는 `evidence/task4b/40100757864/evidence/evidence-results/`(`m4-library.json`, `task4b/m4-04*.png`), Task 5는 `evidence/task5b/40107292541/evidence/evidence-results/`(`task5b/m4-05*.png`), Task 6은 `evidence/m4-t6/40112125869/evidence/evidence-results/`(`m4-t6/m4-inspector-*.png`), Task 7은 `evidence/m4-t7c/40119488421/evidence/evidence-results/`(`m4-t7c/m4-inspector-edit-*.png`), Task 8은 `evidence/m4-t8b/40125361565/evidence/evidence-results/`(`m4-t8b/m4-08-*.png`), Task 9는 `evidence/m4-t9b/40130074939/evidence/evidence-results/`(`m4-t9b/m4-09-*.png`). 28회의 비활성 창 PNG는 키 창 상태로 찍혀 있었다(디자인 비평이 찾음): 그 실행의 검사는 계산된 스타일만 읽어 통과했다.

## M4 라이브러리 (2026-10-25, macos-15 arm64)

M4의 macOS 실행. 마지막 `all` 실행(**run 40162034858, a2f5add**)에서 증거 42/0, 셸 판정 69/69, 라이브러리 판정 39/39, 데모는 첫 시도에 녹화됐다. 같은 실행의 기능 E2E는 184 통과 · 3 실패 · 18 건너뜀(사이드바 위 88px 비교 2개와 `drop.spec.ts`의 드롭 문구 시간 단언)이었고, 3라운드 수정(1d2b91e, 테스트만)이 그 셋을 고쳤다. 그 뒤 기능 E2E만 세 번 더 돌려(표 56–58) 남은 Mac 차이를 고쳤고, 최종 검토 수정까지 들어간 **최종 `all`(run 40242680541, 0a2b409)은 처음으로 전부 녹색**이다: 증거 42/42, 셸 판정 69/69, 라이브러리 판정 39/39, 기능 E2E 189 통과 · 0 실패, 데모 158초 16장. 아래의 자세한 판정 값은 40162034858의 것이고, 최종 실행의 값도 모두 ok다(바뀐 숫자: 바쁨 토스트 345ms, 드롭 뒤 최장 프레임 간격 36ms). 아래 값은 `evidence/<label>/<run>/evidence/evidence-results/`의 JSON(`m4-library.json`, `m3-shell.json`, `library-perf.json`, `perf.json`, `open-latency.json`, `theme-switch.json`, `drop-import.json`, `e2e-report.json`)과 데모 파일에서 옮겼다. UI 작업마다 컨트롤러가 `library` suite를 한 번씩 돌렸다(P-25). 실행 기록은 위 "M4 표 스파이크"와 "M4 작업별 실행" 표이고, 거기서 Task 1 스파이크 1회(27), Task 3–9 `library`, Task 10·12 `perf`, Task 11 `evidence`, Task 12 `demo`, Task 13 `all` 2회와 `e2e` 1회(53–55)로 M4는 모두 29회다. 저장소가 공개라 모두 무료다.

### 라이브러리 판정 값 (`m4-library.json`, run 40162034858)
39개 모두 ok. Task 3–9의 판정 전부다. 요약: 실제 ⌘A가 모든 행을 고른다, 비활성 창은 중립 선택에 고리가 없다(캡처 픽셀로 판정), 네이티브 열 머리 메뉴를 잡았다, 실제 ⇧⌘R은 네이티브, 실제 ⌘F는 네이티브, 1024 폭에서 항목 패널이 접혀 있다가 실제 ⌥⌘I로 열린다(320px, y 52), 실제 ⌘↩가 저장한다, ⌘W는 창을 유지하고 ⌘Q는 잘못된 칸 앞에서 취소된다(flush 기록 close/invalid, quit/invalid), 저장 패널은 다운로드 폴더의 시트이고 바쁨 토스트는 패널이 닫힌 뒤 863ms에(Task 8 run에서는 949ms), 라이브러리 안이나 원본으로의 내보내기는 거절한다, 팔레트는 자료가 명령 위이고 초성 힌트는 라이브러리 제목에서 나오며 일치가 없어도 검색 행이 남는다.

- header 28 px, rows 28 px at 보통, first row 4 px under the header — {header: 28, row: 28, pitch: 28, gap: 4}
- header labels follow the column catalogue: 제목 · 저자 · 연도 · 종류 · 추가일 — {labels: [제목, 저자, 연도, 종류, 추가일], want: [제목, 저자, 연도, 종류, 추가일]}
- the sorted header (추가일, newest first) is primary 500 with a 12 px chevron — {ariaSort: descending, weight: 500, color: oklch(0.23 0.008 250), primary: oklch(0.23 0.008 250), arrow: 12}
- stripes on every second row — {row0: rgba(0, 0, 0, 0), row1: oklch(0.984 0.0015 250), row2: rgba(0, 0, 0, 0), alt: oklch(0.984 0.0015 250)}
- focused selection: accent fill and white text — {fill: oklch(0.53 0.088 190), accent: oklch(0.53 0.088 190), text: oklch(1 0 0), onAccent: oklch(1 0 0)}
- multiple selection with the keyboard cursor: a 75 % white ring on the filled cursor row — {selected: 3, ring: oklch(1 0 0 / 0.75) 0px 0px 0px 2px inset}
- unfocused selection: neutral fill — {fill: oklch(0.23 0.01 250 / 0.13), neutral: oklch(0.23 0.01 250 / 0.13)}
- ⌘A on the keyboard selects every row, not the page text — {drawn: 30, pageText: 0}
- inactive window: neutral selection and no cursor ring — {ring: none, neutral: oklch(0.23 0.01 250 / 0.13), toolbarPoint: [600, 26], rowPixel: [225, 226, 226], toolbarPixel: [236, 236, 236], referencePixel: [225, 226, 226]}
- column menu: the real native menu was captured — {}
- column menu: every catalogue column, the shown ones checked, 제목 fixed, then 열 구성 되돌리기 — {items: [[제목, true, false], [저자, true, true], [연도, true, true], [종류, true, true], [추가일, true, true], [수정일, false, true], [보관, false, true], [크기, false, true], [원래 파일 이…
- selection: a row to select was imported — [imported]
- selection: one selected row enables both 파일 items — [true, true]
- selection: 파일 lists Finder에서 보기 and 기본 앱으로 열기 — {names: [파일 가져오기…, 외부 파일 연결…, -, Finder에서 보기, 사본 내보내기…, 기본 앱으로 열기, -, 윈도우 닫기, Close All], selectedAfterMenu: false}
- selection: ⇧⌘R reveals the selected row — {native: true, namedCopy: true}
- selection: no selected row greys both 파일 items — [false, false]
- selection: ⌘/ lists ⇧⌘R under 자료 — [Finder에서 보기⇧⌘R⇧⌘R]
- selection: the ⌘/ sheet has two columns and fits the 806 pt room — {columns: [[앱, 라이브러리], [자료, 리더, 팔레트·대화상자]], natural: 620}
- search: a row to find was imported — [imported]
- search: ⌘F focuses the quick search field — {native: true}
- search: 초성 ㅅㅎ finds the row and marks 신호 — {count: 3개 / 50개, mark: 신호}
- search: 편집 lists 빠른 검색 — {names: [실행 취소, 실행 복귀, -, 오려두기, 복사하기, 붙여넣기, 모두 선택, -, 빠른 검색, -, AutoFill, Start Dictation…, Emoji & Symbols]}
- search: no results in dark says which query — {title: ‘효소 억제제’와 일치하는 자료가 없습니다}
- inspector: shown exactly when 240 + 520 + 320 fit (it folds before the sidebar) — {width: 1024, state: hidden}
- inspector: ⌥⌘I reaches the 보기 item and toggles the panel — {native: true, after: shown}
- inspector: under the 52 px toolbar, flush with the right edge, the toolbar over both — {panel: {x: 704, y: 52, width: 320, height: 632}, toolbarRight: 1024, vw: 1024}
- inspector: 보기 lists 항목 패널 가리기 with ⌥⌘I, and no 개발자 도구 — [명령 팔레트…, -, 사이드바 가리기, 항목 패널 가리기, -, 글자 크게, 글자 작게, 기본 글자 크기, -, 전체 화면 시작]
- edit: ⌘↩ saves — {native: true, publisher: 학습출판}
- edit: closing the window over a marked field keeps it open — {native: true, open: true}
- edit: quitting over a marked field is called off (the app stays) — {native: true, alive: true, flushLog: [{action: close, result: invalid}, {action: quit, result: invalid}]}
- export: the save panel opens as a sheet on the title-named default in Downloads — {name: 세포 신호 개요.pdf, inDownloads: true, sheet: true}
- export: no busy toast while the save panel is up — {shown: 0}
- export: 내보내는 중… from 300 ms after the panel closed, while the copy runs — {ms: 863}
- export: nothing at the chosen path before the copy is whole — {there: false}
- export: 사본을 저장했습니다, and its Finder에서 보기 reveals the saved copy — {left: [세포 신호 개요.pdf], label: Finder에서 보기, revealedTheCopy: true}
- palette: the launcher says 검색 및 명령 — {text: 검색 및 명령⌘K}
- palette: 자료 above 명령, the cursor on the first item, 라이브러리에서 ‘신호’ 검색 last — {via: keystroke, groups: [자료, 명령], cursorOnItem: true, lastIsSearch: true, hint: ↑↓이동↩열기esc닫기초성 검색 지원 · ㅎㄱ → 형광}
- palette: the 초성 hint comes from the library (ㅅㅎ → 신호) — {hint: ↑↓이동↩열기esc닫기초성 검색 지원 · ㅎㄱ → 형광}
- palette: with no match the notice and the search row stay — {searchRow: 1, foot: [↩실행, esc닫기]}

### 셸 판정 (M4에서 더한 것, `m3-shell.json`)
- **실제 ⌘O 패널**(`openPanel`): 시트로 붙음 443ms, 그 아래 메인 창 `notKey` true · `notMain` false, 가져오기 명령 거절(`importEnabled` false), 실제 esc 뒤 사라짐, 다시 키 창이고 포커스 `content`, 가져온 것 없음(행 3 → 3). 캡처 `m4-shell-01-open-panel.screen.png`(링·커서 없음: 판정 필드는 기록하고, 확인은 Mac 비평이 캡처로 한다).
- **하네스 정리**: 확대 테스트 뒤 틀 20, 45, 984×644(`zoomed` false), ⌘, 전체 화면 정리 `backAtFrame` true.

### 성능 (참고값, 판정은 기준 장비)
| 측정(명세 9절) | 예산 | Linux(xvfb, Task 10) | Mac run 40134381407 | Mac run 40162034858 |
|---|---|---|---|---|
| 1만 항목 목록 IPC | ≤ 150ms | 269 | 90 | 121 |
| 첫 표 그리기 | ≤ 500ms | 98 | 39 | 57 |
| 검색 입력 → 그리기 p95 | ≤ 50ms | 54 | 30 | 31 |
| 메타데이터 검색 p95 | ≤ 300ms | 5.9 | 2.7 | 5.7 |
| 스크롤 프레임 간격 p95 | ≤ 16.7ms | 16.7 | 18.7 | 18.5 |
| 정렬 열 바꾸기 → 그리기 | ≤ 100ms | 48 | 21 | 25 |
| 인스펙터: 선택 → 정보 | ≤ 100ms | 26 | 18 | 21 |
- Linux CI는 예산의 2배(목록 IPC 300, 입력 → 그리기 100)에서 실패한다. 위 Linux 값은 Task 10의 로컬 xvfb 실행이고, GitHub의 Linux CI는 PR #5의 run 40244798965(24d139e, 녹색)다. Mac 러너는 스크롤 p95 18.7·18.5가 예산 16.7을 넘는다 — 그 러너는 가만히 있어도 p95가 약 33ms라 60Hz를 못 지킨다.
- **시트·설정 창 열기**(`open-latency.json`, 목표 250ms / 설정 첫 열기 300ms, P-4 뒤): run 40149289047 — ⌘/ 시트 중앙값 406(403 · 463 · 406 · 343 · 416), 설정 중앙값 284, 첫 열기 시트 403 · 설정 30(미리 만든 창), 새 세션 첫 열기 설정 중앙값 42. run 40150161469 — 시트 290(290 · 231 · 257 · 328 · 310; 앞 실행의 406은 잡음), 설정 190(첫 열기 50), 새 세션 첫 열기 설정 27. run 40162034858 — 시트 305, 설정 246(첫 열기 41), 새 세션 첫 열기 시트 341 · 설정 41. M3의 시트 중앙값은 274 · 292 · 311 · 518 · 300이라 같은 수준이고, 250 목표는 러너에서 미달한다(M5 입력). 미리 만든 설정 창의 메모리: 렌더러 작업 집합 124,880 KB(메인 창 렌더러 146,416 KB).
- **테마 전환**(`theme-switch.json`): 두 페이지 차 0–1ms(같은 프레임), 네이티브 적용은 두 페이지가 보인 뒤(`nativeAppliedBecause` shown). 데모 13장의 60fps 프레임 판독은 영상 비평에서 확인한다(열린 항목).
- **드롭**(`drop-import.json`, 8개): 최종 run 페이지 최장 프레임 간격 34ms, main 최장 정지 3ms, 긴 프레임 하나(62ms, 스크립트 0ms), 원인 none. 이전 러너 실행(40136585407 · 40136294230 · 40136618624)은 132–202ms였고 1.1–1.7초의 긴 프레임에 귀속이 없어 러너의 효과로 판단했다(M5 입력으로 실기 확인).
- **냉시작·번들**(`perf.json`): app-ready 중앙값 687ms, JS 2,858,393 B(M3 2,607,919 B), CSS 104,083 B, PDF.js 워커 1,264,342 B.
- **시트 부모**(Task 11, run 40142306581): 시트 아래에서 메인 창은 계속 메인이고, 설정 창이 키를 가져가면 흐려진다.

### 데모 (run 40162034858, 최종 run 40242680541)
- 최종: artifact `demo-m4-final2-40242680541`, 파일 `m4-demo.final.mov`: 158초(157.6), 1600×900, 60fps, 장 16개, 첫 시도에 녹화. 장 목록과 장면은 아래(40162034858)와 같다.
- artifact `demo-m4-40162034858`, 파일 `m4-demo.final.mov`: 158초, 1600×900, 60fps, 장 16개 내장. 첫 시도에 녹화, `notes` 없음, 커서 `system`, 네이티브 키 6회. 러너 화면을 1600×900으로 바꿔 녹화했다(`displaySwitch` switched).
- 장 목록(`m4-demo.final.chapters.txt`, 완성된 영상의 시각):

     | 시각 | 장 |
     |---|---|
     | 0:00 | Learn을 처음 열면 빈 라이브러리가 가져오는 방법을 안내합니다. |
     | 0:04 | 자료 파일을 창으로 끌어 놓으면 사본으로 가져옵니다. (끌기는 스크립트로 재현합니다) |
     | 0:14 | 열 머리를 누르면 그 열로 정렬하고, 한 번 더 누르면 순서를 뒤집습니다. (저자·연도는 데모에서 미리 적어 두었습니다) |
     | 0:27 | 열 머리를 오른쪽 클릭하면 보일 열을 고르고, 경계를 끌어 폭을 바꿉니다. (메뉴 고르기는 스크립트로 재현합니다) |
     | 0:38 | ⇧ 클릭으로 범위를, ⌘ 클릭으로 하나씩 더 고릅니다. 항목 패널이 고른 자료를 요약합니다. |
     | 0:50 | ⌘F 키로 빠른 검색에 들어갑니다. 초성으로도 찾습니다: ㅅㅍ → 세포. |
     | 1:01 | 항목 패널에서 정보를 바로 고칩니다. 저장하면 표에도 반영됩니다. |
     | 1:17 | ⌘K 팔레트에서도 자료를 찾아 바로 엽니다. |
     | 1:28 | ⌘1 키로 라이브러리로 돌아갑니다. 정렬과 열은 그대로입니다. |
     | 1:33 | ‘사본 내보내기…’로 자료의 사본을 원하는 곳에 저장합니다. (메뉴 고르기와 저장 창은 스크립트로 재현합니다) |
     | 1:41 | ‘Finder에서 보기’를 누르면 Finder가 앞에 오고, Learn 창은 비활성으로 흐려집니다. |
     | 1:52 | 창이 좁아지면 표 자리를 지키려고 항목 패널이 먼저 접힙니다. 넓히면 다시 나옵니다. |
     | 2:01 | ⌘, 설정 창에서 테마를 바꾸면 두 창이 같은 순간에 바뀝니다. |
     | 2:12 | 다크 모드에서도 같은 화면, 같은 정보입니다. |
     | 2:22 | ⌘/ 키로 단축키 도움말을 엽니다. ⌘F 빠른 검색과 ⇧⌘R ‘Finder에서 보기’도 들어 있습니다. |
     | 2:32 | Learn 둘러보기를 마칩니다. |
- 영상에서 확인할 것(열린 항목, 컨트롤러의 Mac 비평이 채운다): 장마다 자막과 화면이 맞는지, 15장의 첫 ⌘/ 열기(키 → 시트 첫 프레임 초), 13장의 테마 프레임, 비평(opus) 판정과 남은 부차·사소.

## M5 작업별 실행 (브랜치 `m5-organize`, macos-15 arm64)

| # | run id | 날짜(UTC) | suite / 패키지 / head | mac 잡 (초 → 과금 분) | 결과 |
|---|---|---|---|---|---|
| 60 | [40335921797](https://github.com/baebae0502/learn/actions/runs/40335921797) | 10-26 14:02 | evidence / 아니오 / 755300c (Task 4 메뉴 기반) | 335초 → 6분(무료) | **성공(캡처 틀림)**: 18 통과 · 2 건너뜀, PNG 74장 — 그러나 `m5-04*-menu-view-sort-keyboard.screen.png` 둘이 보기 › 정렬 기준 ▸이 아니라 이동 메뉴를 보였다. 줄·표시 읽기는 맞았는데(`submenuItems`는 열리지 않은 메뉴의 구조도 읽는다) 고정된 ↓ 횟수가 macOS의 키보드 이동(꺼진 줄을 건너뛴다)과 달라 → 가 다음 메뉴로 갔다. 고침: `captureOpenSubmenu`가 ↓를 한 줄씩 누르며 AXSelected를 보고, `opened`를 단언(ecab07f · 44e0cfd) |
| 61 | [40391961051](https://github.com/baebae0502/learn/actions/runs/40391961051) | 10-26 20:01 | organize / 아니오 / 44e0cfd (Task 5 사이드바·컬렉션) | 91초 → 2분(무료) | **성공**: 증거 테스트 5개, PNG 20장 — 트리 기하 28/16/12/16, 선택은 중립 채움 → 포커스에서 강조 채움, 이름 칸 22 + 후광, 힌트 각주 3차색, 컨텍스트 메뉴 순서·구분선, 삭제 시트 ‘학회 준비’를 삭제하겠습니까? / 자료는 내 라이브러리에 남습니다. / 취소·삭제(기본) |
| 62 | [40392351200](https://github.com/baebae0502/learn/actions/runs/40392351200) | 10-26 20:04 | evidence / 아니오 / 44e0cfd (60의 캡처 고침 확인) | 308초 → 6분(무료) | **성공**: 18 통과 — `opened`·`selected`·`stillSelected` 모두 참, PNG에 보기 › 정렬 기준 ▸이 열려 ✓추가일 ✓내림차순(다음 장 ✓오름차순) |

**합계: macOS 62회, 376분.** Task 5 Mac 비평(opus, 61의 PNG): blocker·major 0, 부차 하나(모든 `ui.confirm`이 `warning` 종류라 되돌릴 수 있는 컬렉션 삭제에도 주의 삼각형 — Task 6에서 `caution` 선택 항목으로 고침).

## 알려진 한계

- 러너는 M1 가상 머신(3 vCPU, 가상 GPU, 1024×768 @1x)이다. 콜드 시간은 run마다 2–3배 차이가 나고, Retina(@2x) 렌더링·실제 GPU·트랙패드는 확인할 수 없다.
- 해상도는 러너가 정한다. 비교용 스크린샷은 Playwright page 샷을 쓰고, 창/전체 화면 샷은 OS 크롬 확인용이다.
- `screencapture -v` 녹화 프레임률이 이미지마다 다르다(macOS 15 약 51fps, 26 약 11fps).
- 패키지 앱은 ad-hoc 서명 상태로만 실행했다. 실제 서명·공증·hardened runtime은 P6.
- `pnpm dev`(Vite dev server) 경로는 러너에서 돌리지 않았다.
- 데모용 커서·키 입력 오버레이(`LEARN_DEMO_OVERLAY`)는 M3에서 생겼다(녹화 전용, 비패키지 실행에서만 켜진다).
- `NSFullScreenMenuItemEverywhere = false`는 비패키지 실행에서도 쓴다(최종 리뷰 m11). 증거가 비패키지 앱의 보기 메뉴에서 전체 화면 줄이 하나인지 세기 때문이다. 비패키지 앱의 defaults 도메인은 Electron 자신의 것(`com.github.Electron`)이라, 그 Mac의 모든 비패키지 Electron 앱에 이 키가 남는다. AppKit이 읽는 힌트일 뿐 다른 앱에 해가 없고, `defaults delete com.github.Electron NSFullScreenMenuItemEverywhere`로 지운다. 패키지 앱은 Learn 자신의 도메인(`app.learn.desktop`)에 쓴다.
- **M3 실행에서 받아들인 러너 한계**(Task 14 Mac 비평 1–3차):
  - @1x 렌더링: 1.5pt 획이 반쯤 덮인 두 열에 걸친다(메인이 아닌 토글 획 206 on 236). 다크 툴팁의 3차 글자 ⌃⌘S는 2.94:1로 그려진다(토큰 3.20).
  - 영어 시스템과 비패키지 앱: 메뉴 막대의 "Electron", Dock과 NSAlert의 Electron 아이콘, AppKit이 넣는 영어 항목(편집의 AutoFill 등, 윈도우의 타일 항목, 앱 메뉴의 숨은 "Quit and Keep Windows"), 열기 패널의 영어 문구. 패키지·`ko` 실행(스파이크 5·6)은 Learn과 한국어다.
  - 가상 디스플레이와 마우스: 바탕 화면 그림이 없어 재질이 평평하다(246 / 56), 항상 보이는 옛 스크롤 막대(표에 15pt 여백, PDF와 ⌘/ 시트의 스크롤러), `.screen` 캡처 아래쪽 30–40pt의 Dock 그림자, 화면 녹화 점, Metal 디스플레이 정보 없음.
  - 1600×900 모드에서 가장 높은 부모 창이 802pt라 806pt의 ⌘/ 시트(1440×900 Mac + Dock)는 실기 항목으로 남는다. ⌘/ 시트는 10fa0bb의 전체 화면 줄로 29pt 높아졌다(802 부모에서 743 → 약 772pt).
  - `screencapture -v`의 첫 몇 초는 화면을 늦게 담는다. 시작 직후 수백 프레임이 거의 같은 시각(pts 2.78초 부근)에 몰리고, 3차에서는 3.42초까지 움직이는 것이 없었다. 페이지의 그리기 시점으로는 이것을 알 수 없다. 그래서 Mac 데모는 사전 녹화 4.5초 뒤에 첫 장을 시작하고, `finish-demo.sh`가 멈춘 머리를 0.5초로 자른다(a9766bf).
  - M4: 러너의 1024×768 모드(녹화를 두 번 잃은 뒤의 계획)에서는 1024 − 240 − 320 = 464 < 520이라 항목 패널이 처음부터 접힌다. 데모는 그때 ⌥⌘I로 보이고 좁은 창 장을 뺀다(notes). 이번 최종 데모는 1600×900 모드로 녹화돼 좁은 창 장이 들어 있다.
  - 스파이크 X(HTML `<video>` 전체 화면): `exitFullscreen()`이 끝나지 않는 현상이 M3 실행에서도 같다(run 39892840988: "exitFullscreen did not resolve"). 위 "추가 발견" 참고.

## 남은 실기 확인 항목

- VoiceOver로 라이브러리·뷰어 탐색(AC18).
- 트랙패드 스크롤·핀치 확대, 관성 스크롤.
- Finder에서 드래그 & 드롭 가져오기.
- HEVC 재생 확정(실제 하드웨어 디코더, 캔버스 읽기 포함).
- AC16 기준 장비(Apple Silicon 16 GB)에서 첫 PDF·첫 MP4·냉시작 시간.
- Retina @2x에서 PDF 캔버스 선명도와 글꼴 렌더링.
- 전체 화면 빠른 토글 시 멈춤이 실기에서도 나는지.
- 서명·공증된 패키지(P6)에서 PDF·영상(AC20).
- **M4 라이브러리**:
  - VoiceOver: 표(grid — 행, 열 머리, 정렬 상태, 선택 알림), 항목 패널 폼(칸 이름, 오류 문구가 읽히는지), 팔레트 자료 결과;
  - 검색 필드에서 실제 한국어 IME(조합 중 거르기, esc·↩). E2E는 CDP 조합과 keyCode 229만 확인한다;
  - 트랙패드로 1만 행 스크롤(관성), Retina @2x의 표 글자;
  - 실제 저장 패널(사본 내보내기, 덮어쓰기 확인). Mac 증거와 데모는 저장 패널을 건너뛴다;
  - 1440×900 Mac(Dock 포함)에서 항목 패널과 사이드바가 함께 보이는지(1440 − 240 − 320 = 880 ≥ 520). 러너의 1024 모드에서는 항목 패널이 처음부터 접힌다;
  - 드롭 뒤 멈춤과 ⌘/ 시트 열기 지연이 실제 Mac에서도 나는지(러너 값은 위 "성능").
- **M3 셸**(Task 14 체크리스트의 실기 항목):
  - fn-F / Globe-F 전체 화면. 메뉴에는 우리 ⌃⌘F 항목만 보여야 한다(2.5);
  - VoiceOver: 팔레트 콤보박스·리스트박스, 실행기의 `aria-keyshortcuts`(⌘K)(2.6, 6.3);
  - 팔레트에서 실제 한국어 IME(2.7, 4.6);
  - 라이브러리 위치를 고른 뒤의 실제 재시작(5.7);
  - 실제 Finder 드래그: 오버레이, ⌥로 연결 전환, 커서 배지(5.9); 드롭 뒤 중복 시트 전에 창이 앞으로 오는지(macOS 14+ 협력적 활성화, 5.10); `dragenter` 때 `DataTransferItem.type`(5.11); 가만히 들고 있을 때 오버레이가 깜박이지 않는지(5.12);
  - 1440×900 Mac(Dock 포함 작업 영역 약 806pt)에서 ⌘/ 시트가 스크롤 없이 다 보이는지(6.1의 806 경우).
