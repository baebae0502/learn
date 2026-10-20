# Fixtures

`pnpm fixtures` 가 `fixtures/generated/` 에 테스트 자료를 만든다(이미 있으면 건너뜀, `node fixtures/generate.mjs --force`로 재생성). 생성물은 커밋하지 않는다. `pnpm e2e`는 자동으로 먼저 실행한다.
모든 파일은 이 저장소의 스크립트가 직접 합성한 것이라 제3자 저작물이 없다.

| 파일 | 출처 | 용도 |
|---|---|---|
| `sample.pdf` | pdf-lib, Helvetica, 3쪽(2쪽 90° 회전) | PDF 렌더·쪽 이동 |
| `한글 경로 (테스트) #1.pdf` | 위와 같은 생성기, 다른 라벨 | 경로의 한글·공백·특수문자 |
| `sample-h264-aac.mp4` | ffmpeg `testsrc2` + `sine`, 1280×720 30fps 10초, H.264 High/AAC, GOP 60, faststart | 재생·seek 정확도(AC05) |
| `sample-mpeg4part2.mp4` | ffmpeg `testsrc2`, MPEG-4 Part 2 | Chromium 미지원 코덱 안내 |
| `sample-hevc.mp4` | ffmpeg `libx265`(있을 때만) | 플랫폼 의존 코덱 기록용(판정 기준 아님) |
