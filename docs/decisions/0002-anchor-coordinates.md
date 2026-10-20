# ADR-0002: 앵커 좌표계 (schema v1)

- 상태: 채택 (2026-10-20) · 관련: spec 06·08, `packages/domain/src/anchors.ts`
- 이번 세션에는 타입·스키마만 정의했다. 앵커 생성·표시(필기)는 P2에서 구현하며 이 좌표 규칙이 그때의 검증 기준이다.

## 결정
- 모든 앵커는 불변 `revisionId`에 귀속하고 `schema_version`을 함께 저장한다. 원본 revision이 바뀌면 조용히 옮기지 않고 `ok/review/orphan` 상태로 구분한다.
- **PDF**: `pageIndex`(0부터) + 회전 전 PDF user space의 quad 배열(`[x1,y1,…,x4,y4]`, 단위 pt, 원점 좌하단) + `coordinateSpace:'pdf-user-space'` + 선택 시 quote(exact/prefix/suffix). 화면 좌표는 viewport 변환의 역변환으로 얻는다. 확대·회전과 무관하게 같은 값이어야 한다(AC03, 허용 오차 2pt).
- **동영상**: `startMs`/`endMs`(정수 ms) + 정지 프레임 `frame{atMs,width,height}`(디코딩 해상도) + `rect[x,y,w,h]`를 letterbox를 제외한 프레임 기준 0–1로 정규화(AC04, 허용 오차 0.5%).
- **EPUB**: `spineHref` + `cfi` + quote. **웹**: 스냅샷 revision의 텍스트 위치 + quote. **슬라이드**: 원본 revision + 파생 PDF revision + `slideIndex` + 파생 쪽 quad.
- 화면 픽셀을 그대로 저장하지 않는다.

## 근거
렌더 배율·회전·창 크기·글꼴이 바뀌어도 같은 원문 위치를 가리켜야 하고, 텍스트가 바뀐 revision에서 재앵커를 시도할 근거(quote)가 필요하다.
