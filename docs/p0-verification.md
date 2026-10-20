# P0 검증 기록

- 일시: 2026-10-20 · 환경: bce-colab-g01, Debian 13 x86_64, headless + Xvfb 1440×900×24, NFS 홈
- 런타임: Electron 44.9.1 (Node 24.22.0, Chromium 152.0.7977.167, NODE_MODULE_VERSION 149)
- 도구: electron-vite 6.0.0, Vite 8.3.4, TypeScript 7.0.2, vitest 5.0.5, Playwright 1.64.1, pdfjs-dist 6.4.299, better-sqlite3 13.0.3(SQLite 3.53.4), React 19.3.1, zod 4.6.7, pnpm 10.15.1
- 판정 범례: ✅ 통과 · ⚠️ 제한 있음 · ⏳ Mac에서 재확인 필요
- 측정은 Task 11에서 `pnpm fixtures`, `pnpm typecheck`, `pnpm test`, `pnpm e2e:xvfb`를 다시 실행해 얻었다(E2E 6/6 통과, vitest 9개 파일 71개 테스트 통과).

| # | 항목 | 방법 | 기대 | 실측 | 판정 |
|---|---|---|---|---|---|
| 1 | Electron 실행(xvfb) + sandbox renderer | `tests/e2e/smoke.spec.ts` | `learn://app/index.html` 로드, 격리된 renderer(`require` 없음), `window.learn` 존재, DB 마이그레이션 | 통과(0.95초). URL `learn://app/index.html`, 격리 확인, `schemaVersion: 1`, `libraryError: null` | ✅ |
| 2 | better-sqlite3 in Electron, WAL, FTS5, 스냅샷 | smoke(DB 마이그레이션) + vitest + Step 1 node 스크립트 | 로드·WAL·`VACUUM INTO` 동작 | N-API라 Node 22·Electron 44에서 같은 바이너리 로드(SQLite 3.53.4). trigram 2글자 질의 `증폭` → 0건. 공백 포함 구문을 따옴표로 묶은 `"증폭 연"` → 1건. 따옴표 없는 `증폭 연`은 공백이 AND 연산으로 해석되어 2글자 이하 토큰이 각각 0건이라 0건(아래 메모) | ✅ / ⚠️ 한국어 2글자 검색은 P1에서 별도 처리 필요 |
| 3 | pdf.js(sandbox+CSP, 워커) | first-session E2E | 캔버스 잉크 픽셀 > 300(테스트 임계), 회전 쪽 가로형 | 1쪽 `[measure] pdf page1 ink {"dark":1422,"white":495638}`. 2쪽(90° 회전) 캔버스 width > height 확인. 확대 단계와 빠른 쪽·배율 전환에서도 렌더 오류 없음 | ✅ |
| 4 | H.264/AAC MP4 재생·Range·seek | first-session E2E `[measure]` + protocol E2E | Range 206, seek 오차 ≤ 500ms | probe: `bytes=0-`, `bytes=2392064-` 요청, 오차 0.47–0.51ms, seek 168–192ms. E2E 재측정: `[measure] video seek {"errorMs":0.4629999999998802,"seekMs":195.69999998807907,"width":1280,"height":720}` (이번 세션 누적 측정 오차 0.44–0.77ms, seek 시간 ≈178–196ms). Range 206/416은 `protocol.spec.ts`가 검증 | ✅ (Linux) ⏳ Mac |
| 5 | 미지원 코덱 안내 | MPEG-4 Part 2 fixture | 원인 표시 | `MediaError.code=4`, `DEMUXER_ERROR_NO_SUPPORTED_STREAMS: FFmpegDemuxer: no supported streams`, 화면에 한국어 안내(E2E가 `video-error`에 "코덱" 포함을 확인) | ✅ (Linux) ⏳ Mac |
| 6 | HEVC | `sample-hevc.mp4` 수동 열기 | 플랫폼 의존 — 기록만 | 이번 세션에서 열어 보지 않음(미기록) | ⏳ Mac |
| 7 | `file://` origin | probe | — | Origin `null` 전송, pdf.js XHR CORS 차단 → `learn://app` 단일 스킴 채택(ADR-0001) | ✅ 해결 |
| 8 | EPUB 렌더러 후보 | 문헌 비교(구현 없음) | 라이선스·CFI·스크립트 차단 | 아래 표 | 결정은 P5 spike |
| 9 | PPTX 변환 | 서버에 LibreOffice 없음 | — | 미검증 | ⏳ Mac. 대체 경로: 사용자가 PDF를 함께 가져오기 |
| 10 | Electron 바이너리 설치 | `pnpm install` | — | GitHub 릴리스 연결당 ~20–60KB/s. 64개 범위 병렬 수신(20초) + `checksums.json` sha256 검증 후 `@electron/get` 캐시에 배치. Electron 44 npm 패키지에는 postinstall이 없어 바이너리는 첫 `require('electron')`/첫 실행 때 지연 다운로드된다 | ⚠️ 이 서버 한정 |

### 메모

- **trigram**: FTS5 `trigram` 토크나이저는 3글자 미만 토큰을 색인하지 않으므로 2글자 한국어 단어(`증폭`)는 질의가 0건이다. 단계 지시서의 `증폭 연` 예시는 따옴표 없이 쓰면 공백이 AND로 해석되어 0건이 나오며, 같은 문자열을 구문(`"증폭 연"`)으로 질의하면 1건이다. 2글자 검색은 P1에서 별도 처리(예: LIKE 보조 질의)로 해결한다.
- **측정 범위**: 모든 값은 Linux/Xvfb(소프트웨어 렌더링)에서 얻었다. 코덱·성능 판정은 Mac에서 다시 확인해야 한다.

## EPUB 렌더러 후보 (P5에서 spike로 확정)

| 후보 | 라이선스 | CFI | 비고 |
|---|---|---|---|
| foliate-js | MIT | 지원 | 의존성 없음, 활발. 스크립트 실행 차단을 iframe sandbox로 직접 구성해야 함 |
| epub.js | BSD-2-Clause | 지원 | 오래 쓰였지만 유지보수 느림. iframe 기반. GitHub API는 LICENSE를 `NOASSERTION`(비표준 서식)으로 분류하나 npm 메타데이터와 파일 본문(FuturePress, 재배포 조건 문구)은 BSD 계열 |
| Readium ts-toolkit | BSD-3-Clause | Locator(CFI 변환 필요) | 표준 지향, 구성 요소 많음 |

CFI 지원·유지보수 상태는 문헌 비교이며 이번에 코드로 검증하지 않았다.

## 의존성·변환기 라이선스

| 구성 요소 | 라이선스 | 배포 메모 |
|---|---|---|
| Electron | MIT | Chromium/FFmpeg 고지 포함(번들 LICENSES.chromium.html) |
| better-sqlite3 / SQLite | MIT / Public Domain | 네이티브 모듈 — macOS 서명 대상 |
| pdfjs-dist | Apache-2.0 | cmaps(Adobe, BSD-3) 포함 |
| React | MIT | |
| zod | MIT | |
| electron-vite / Vite | MIT | 개발 도구 |
| LibreOffice(후보) | MPL-2.0 | 번들하지 않고 사용자 설치 감지 예정 |
| FFmpeg(fixture 생성만) | LGPL/GPL(빌드 구성 의존) | 앱에 포함하지 않음 |

### 라이선스 확인 방법

- `npm view <pkg> license`(읽기 전용): electron MIT, better-sqlite3 MIT, pdfjs-dist Apache-2.0, react MIT, zod MIT, electron-vite MIT, vite MIT, foliate-js MIT, epubjs BSD-2-Clause, @readium/navigator BSD-3-Clause.
- `gh api repos/<owner>/<repo>/license --jq .license.spdx_id`: johnfactotum/foliate-js MIT, readium/ts-toolkit BSD-3-Clause, mozilla/pdf.js Apache-2.0, futurepress/epub.js NOASSERTION(위 비고 참고).
- pdf.js cmaps: 설치된 `pdfjs-dist@6.4.299/cmaps/LICENSE` 머리말이 Adobe Systems Incorporated의 재배포 조건(BSD 계열)임을 직접 확인.
- LibreOffice와 FFmpeg, SQLite의 표의 라이선스는 일반 지식이며 이번에 소스로 검증하지 않았다. LibreOffice의 GitHub 미러(`LibreOffice/core`)는 저장소 수준 LICENSE를 GPL-3.0으로 보고하므로, 변환기를 실제로 연동하는 P5에서 배포 형태에 맞춰 다시 확인한다. 번들하지 않으므로 이번 표의 결정에는 영향이 없다.
