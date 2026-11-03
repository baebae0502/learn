# Fixtures

`pnpm fixtures` 가 `fixtures/generated/` 에 테스트 자료를 만든다(이미 있으면 건너뜀, `node fixtures/generate.mjs --force`로 재생성). ffmpeg는 없는 동영상 fixture를 만들 때만 찾으므로, 다른 곳에서 만든 fixture를 받아 둔 환경(macOS 증거 잡)에서는 ffmpeg 없이 통과한다. 생성물은 커밋하지 않는다. `pnpm e2e`는 자동으로 먼저 실행한다.
모든 파일은 이 저장소의 스크립트가 직접 합성한 것이라 제3자 저작물이 없다.

| 파일 | 출처 | 용도 |
|---|---|---|
| `sample.pdf` | pdf-lib, Helvetica, 3쪽(2쪽 90° 회전) | PDF 렌더·쪽 이동 |
| `한글 경로 (테스트) #1.pdf` | 위와 같은 생성기, 다른 라벨 | 경로의 한글·공백·특수문자 |
| `paper-100.pdf` | pdf-lib, A4 100쪽, 두 단 Helvetica 10/13, 1쪽 첫 줄에 번역 시험 문장 넷, 2쪽 줄 끝 하이픈, 쪽 안·밖 링크 4개(쪽 50·100, https, mailto), 장·절·소절 3단 목차 | 리더 스크롤·글 선택·링크·목차 |
| `korean.pdf` | pdf-lib + `@pdf-lib/fontkit`, Pretendard 가변 글꼴 전체 포함(`subset: false`), 3쪽(NFC · NFD · 한영 두 단) | 글 레이어의 한국어(글리프는 pdf.js가 그리지 못하고 글 내용과 폭만 맞다) |
| `locked.pdf` | `fixtures/static/locked.pdf` 복사(mutool로 한 번 만든 암호 `learn`, 명령은 `fixtures/static/README.md`) | 암호 입력 |
| `sample-h264-aac.mp4` | ffmpeg `testsrc2` + `sine`, 1280×720 30fps 10초, H.264 High/AAC, GOP 60, faststart | 재생·seek 정확도(AC05) |
| `sample-mpeg4part2.mp4` | ffmpeg `testsrc2`, MPEG-4 Part 2 | Chromium 미지원 코덱 안내 |
| `sample-hevc.mp4` | ffmpeg `libx265`(있을 때만) | 플랫폼 의존 코덱 기록용(판정 기준 아님) |
