# Fixtures

`pnpm fixtures` 가 `fixtures/generated/` 에 테스트 자료를 만든다(이미 있으면 건너뜀, `node fixtures/generate.mjs --force`로 재생성). ffmpeg는 없는 동영상 fixture를 만들 때만 찾으므로, 다른 곳에서 만든 fixture를 받아 둔 환경(macOS 증거 잡)에서는 ffmpeg 없이 통과한다. 생성물은 커밋하지 않는다. `pnpm e2e`는 자동으로 먼저 실행한다.
모든 파일은 이 저장소의 스크립트가 직접 합성한 것이라 제3자 저작물이 없다.

| 파일 | 출처 | 용도 |
|---|---|---|
| `sample.pdf` | pdf-lib, Helvetica, 3쪽(2쪽 90° 회전) | PDF 렌더·쪽 이동 |
| `한글 경로 (테스트) #1.pdf` | 위와 같은 생성기, 다른 라벨 | 경로의 한글·공백·특수문자 |
| `paper-100.pdf` | pdf-lib, A4 100쪽, 두 단 Helvetica 10/13, 1쪽 첫 줄에 번역 시험 문장 넷, 2쪽 줄 끝 하이픈, 쪽 안·밖 링크 5개(쪽 50·100, https, mailto, 쪽 40의 한 점 x 56·y 600을 가리키는 "See figure 2 on page 40." — 쪽 40의 그 점에 "Figure 2" 상자), 장·절·소절 3단 목차 | 리더 스크롤·글 선택·링크·목차 |
| `long-outline.pdf` | pdf-lib, 6쪽, 부 60개 × 소제목 4개 = 목차 300항목 | 긴 목차의 가상 목록 |
| `korean.pdf` | pdf-lib + `@pdf-lib/fontkit`, Pretendard 가변 글꼴 전체 포함(`subset: false`), 3쪽(NFC · NFD · 한영 두 단) | 글 레이어의 한국어(글리프는 pdf.js가 그리지 못하고 글 내용과 폭만 맞다) |
| `no-text.pdf` | pdf-lib, 2쪽, 도형(사각형·원)만 — 글 없음 | 본문 색인: '글자 없음' 상태 |
| `search-30.pdf` | pdf-lib, Helvetica 30쪽, 쪽마다 `Page N: fluorescence signal transduction`과 Pretendard 가변 글꼴 전체 포함(`subset: false`)의 `형광 현미경 관찰 기록 N` | 본문 검색(영어·한국어 낱말, 쪽 번호) |
| `locked.pdf` | `fixtures/static/locked.pdf` 복사(mutool로 한 번 만든 암호 `learn`, 명령은 `fixtures/static/README.md`) | 암호 입력 |
| `transparent.png` `orient6.jpg` `alpha.webp` `two-frames.gif` `still.avif` | `fixtures/static/images/`의 같은 이름 복사 | 이미지 가져오기·읽기(E2E) |
| `png-named.jpg` | `static/images/transparent.png`의 사본(확장자만 `.jpg`) | 확장자가 틀려도 머리로 가려냄 |
| `broken.png` | 생성기가 쓰는 33바이트: PNG 서명 + IHDR(64×48, CRC 맞음)뿐, 그 뒤 몸은 0바이트 | 가져오기는 되지만 그릴 수 없는 이미지(리더의 끝 상태) |
| `photo-4032.jpg` | ffmpeg `testsrc2=size=4032x3024` 한 프레임, `-q:v 3` | 큰 사진(창에 맞춤 < 100%, 이미지 탭 열기 시간) |
| `sample-h264-aac.mp4` | ffmpeg `testsrc2` + `sine`, 1280×720 30fps 10초, H.264 High/AAC, GOP 60, faststart | 재생·seek 정확도(AC05) |
| `sample-mpeg4part2.mp4` | ffmpeg `testsrc2`, MPEG-4 Part 2 | Chromium 미지원 코덱 안내 |
| `sample-hevc.mp4` | ffmpeg `libx265`(있을 때만) | 플랫폼 의존 코덱 기록용(판정 기준 아님) |

## 커밋하는 고정 자료

생성기가 만들 수 없는 것은 저장소에 커밋한다. 모두 이 저장소의 시험용 영어 문장으로 만들어서 제3자 저작물과 소유자 자료가 없다.

| 파일 | 출처 | 용도 |
|---|---|---|
| `static/locked.pdf` | `mutool convert -O encrypt=aes-128,user-password=learn`(명령은 `static/README.md`). 생성기가 `generated/`로 복사한다 | 암호 입력(위 `locked.pdf`) |
| `translation/google-en-ko.json` | `translate.googleapis.com`의 실제 응답(2026-11-03, ADR-0012): 영어 두 문장·줄바꿈, `sl=en&tl=ko` | 응답 해석 단위 시험 |
| `translation/google-auto.json` | 같은 요청, `sl=auto`, 영어 두 문장 | 감지한 원문 언어(`r[2]`) |
| `translation/google-ko.json` | 같은 요청, 한국어 입력 `tl=ko`(같은 글과 `"ko"`) | 같은 언어 응답 |
| `static/images/*` (PNG, JPEG, WebP, GIF, AVIF) | ImageMagick와 ffmpeg로 만든 그라데이션·시험 무늬, JPEG의 EXIF 방향 6은 짧은 node 스크립트(명령은 `static/README.md`). 생성기가 `generated/`로 복사한다(위) | 이미지 머리 판별과 크기 읽기 단위 시험 |
