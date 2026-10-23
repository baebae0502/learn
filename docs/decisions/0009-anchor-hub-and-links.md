# ADR-0009: 앵커 허브와 연결 — 모든 소비자는 `anchor_id`를 가리킨다

- 상태: 제안 (2026-10-22) · M7 첫 작업의 스파이크로 검증한 뒤 채택 · 관련: ADR-0002(앵커 좌표, 그대로 유효), ADR-0010(튜터 백엔드), 명세 05·06·08·10, `docs/design/design-spec.md` 1.1, `docs/spec-amendments.md` 1절, `packages/domain/src/anchors.ts`, `packages/db/src/migrations/001-initial.ts`
- 근거 합의: 2026-10-22 제품 방향 합의 2a·2b·2c, 1c(포맷 계열), 1c 추가(GitHub 저장소)

## 맥락
- 제품 원칙 B(디자인 명세 1.1): 노트·질문·답변·기억은 앵커를 거쳐 원문 위치로 돌아간다. 그러려면 앵커가 필기만의 것이 아니라 모든 연결이 모이는 허브여야 한다.
- 지금 스키마 v2: `anchors`(`revision_id`, `kind`, `locator_json`, `quote`, `status`, `schema_version`)와 `annotations.anchor_id`가 있고, `anchors.ts`의 zod 유니언이 pdf·video·epub·web·slide 다섯 kind를 검증한다. 앵커를 만들거나 읽는 저장소·IPC·화면은 아직 없다. 튜터·기억 테이블은 명세 08절에만 있다.
- 포맷이 늘어난다(`spec-amendments.md` 1절): 이미지·오디오·Markdown·GitHub 저장소, 그리고 커넥터의 영상 링크와 튜터의 웹 인용.
- `items.type` CHECK는 `'slides'`, `anchors.kind` CHECK는 `'slide'`다(`001-initial.ts`). 같은 형식을 두 이름으로 부른다.

## 결정

### 1. 앵커는 하이브리드 허브다
kind별 타입 유니언이 정본이고, 좌표는 ADR-0002 그대로다. 그 위에 공통 필드 둘과 새 kind를 더한다.

```ts
{
  kind,          // 'pdf' | 'video' | 'epub' | 'web' | 'slide'            (ADR-0002)
                 // | 'image' | 'audio' | 'markdown' | 'link' | 'code'    (새로)
  revisionId,    // 불변 revision (ADR-0002)
  precision,     // 'item' | 'span' | 'region'
  text: {        // 재앵커 근거. kind별 필수 여부는 M7 스파이크에서 정한다
    quote:    { exact, prefix, suffix },
    position: { start, end },
  },
  ...좌표        // kind별 좌표: quads·startMs/endMs·cfi·textPosition … (ADR-0002)
}
// 코드: { kind:'code', revisionId, commit, path, lineStart, lineEnd } + text.quote
```

- **`precision`**: `item` = 자료 전체(예: 저장소 하나), `span` = 자료 안의 구간(글·시간·줄 범위, 저장소 안의 파일 하나), `region` = 쪽·프레임 위의 영역. kind마다 어떤 값을 허용하는지는 M7 스파이크와 각 kind의 마이그레이션에서 정한다.
- **`text`**: W3C의 TextQuote·TextPosition과 같은 짝이다. revision이 바뀌면 이것으로 재앵커를 시도하고 결과를 `ok/review/orphan`으로 남긴다(ADR-0002, 명세 06절). 기존 kind의 `quote`(locator 안과 `anchors.quote` 열)와 `text.quote`의 관계는 M7 마이그레이션에서 정한다.
- **새 kind**

  | kind | 계열 | 위치 | 처음 쓰는 곳 |
  |---|---|---|---|
  | `image` | 쪽 | 쪽 계열의 영역 좌표. 필드는 M7에서 정한다 | M7 |
  | `audio` | 시간 | 시간 계열의 구간. 필드는 M8에서 정한다 | M8 |
  | `markdown` | 재배치 | 재배치 계열의 텍스트 위치 + quote | M11(README), M12 |
  | `link` | 링크 | 링크 항목 안의 위치(영상 링크 + 시간, 합의 4b)와 웹 인용(ADR-0010 3절). 필드는 M13에서 정한다 | M13 |
  | `code` | 코드 | `{commit, path, lineStart, lineEnd}` + quote. `precision`은 `item`(저장소) 또는 `span`(파일·줄 범위) | M11 |

- **코드 앵커**: 저장소 항목은 commit SHA에 고정한 스냅샷이고 revision = commit이다. 새 commit으로 갱신하면 새 revision이 생기고, 앵커는 `ok/review/orphan`으로 재앵커된다.
- **`'slides'`/`'slide'` 불일치**는 M7 마이그레이션에서 한 이름으로 맞춘다. 어느 쪽으로 맞출지는 그때 정한다.

### 2. 포맷 계열
포맷은 계열로 설계한다. 계열마다 viewer 하나와 앵커 형 하나를 공유한다.

| 계열 | 형식 |
|---|---|
| 쪽(paged) | PDF, 슬라이드(PPTX의 파생 PDF), **이미지** |
| 시간(timed) | 동영상, **오디오**(튜터용 전사) |
| 재배치(reflow) | EPUB, 웹 스냅샷, **Markdown**(가져온 `.md`) |
| 링크(link) | URL만 있는 항목(영상 링크 등, 보관하지 않음) |
| 코드(code) | **GitHub 저장소** 스냅샷 |

### 3. W3C Web Annotation은 내보내기·상호운용 변환기다
- `toWebAnnotation(anchor)`가 내부 앵커를 W3C Web Annotation Data Model(https://www.w3.org/TR/annotation-model/, 2017-02-23 Recommendation)의 선택자로 바꾼다. 저장 형식이 아니다.
  - 쪽: FragmentSelector `page=` (`conformsTo` http://tools.ietf.org/rfc/rfc3778)
  - 시간: FragmentSelector `t=` (Media Fragments, `conformsTo` http://www.w3.org/TR/media-frags/)
  - 줄: FragmentSelector `line=` (RFC 5147, `conformsTo` http://tools.ietf.org/rfc/rfc5147). 코드 앵커는 `#line=a,b`
  - 글: TextQuoteSelector `{exact, prefix, suffix}` + TextPositionSelector `{start, end}`
- W3C는 TextPosition을 유니코드 code point로 센다("in terms of unicode code points … not in terms of code units"). 내부 `position`의 단위는 M7 스파이크에서 정하고, W3C와 다르면 변환기가 바꾼다.
- EPUB: W3C "EPUB Annotations 1.0" 편집자 초안(https://w3c.github.io/epub-specs/epub34/annotations/)은 FragmentSelector의 `conformsTo`로 EPUB CFI를 허용하지 않는다("Other URLs MUST NOT be used"). EPUB의 내보내기 표기는 M12에서 정한다.

### 4. 모든 소비자는 `anchor_id`를 가리킨다
- `annotations.anchor_id`(있음), `message_sources.anchor_id`(명세 08절), `conversation_context.anchor_id`(새로, 5절).
- **클립**은 출처가 커넥터인 annotation이다. 클립 테이블을 따로 두지 않는다. 출처를 어떻게 적는지는 M13에서 정한다.
- **기억**은 `memory_evidence`를 거쳐 앵커에 닿는다. 근거는 message·annotation·study_event 가운데 하나다(명세 08절의 `event_id/message_id`에 annotation이 더해진다).

### 5. 전용 연결 테이블 + 쿼리로 얻는 역링크
- 명세 08절의 테이블에 다음을 더한다.

  | 추가 | 내용 |
  |---|---|
  | `conversation_context` | `(conversation_id, anchor_id, role)`. `role`은 `opened_from`(세션을 연 위치) / `attached`(붙인 맥락) |
  | `annotations.origin_message_id` | 튜터 제안(`propose_note`, "노트로 저장")으로 만든 노트의 출처 메시지 |
  | `conversations.parent_id` | 부모 세션 |

- **이름**: 튜터 세션은 `conversations`다(화면 이름 "세션"). 명세 08절의 원시 관측(`sessions / events`, "append-only 원시 관측")은 `study_events`라는 이름이 된다. 명세의 `sessions`(관측 묶음) 테이블을 따로 둘지는 M10에서 정한다.
- **역링크**: 자료 하나의 세션·노트·그 자료를 인용한 답변과 그 답변에서 나온 기억은 앵커 허브를 거치는 쿼리로 얻는다(자료 → revision → `anchors` → `annotations` / `message_sources` → `messages` → `conversations` / `conversation_context` / `memory_evidence`). 역링크를 따로 저장하지 않는다.
- 범용 `links` 테이블은 사용자가 쓰는 위키 링크(`[[…]]`)가 생길 때까지 미룬다.

### 6. 마이그레이션은 쓰는 마일스톤에서
| 마일스톤 | 마이그레이션 |
|---|---|
| M7 | 앵커 확장: `precision`, `text`, 새 kind, `'slides'`/`'slide'` 정리 |
| T1 | 튜터 테이블: `conversations`(`parent_id` 포함)·`messages`·`message_sources`·`conversation_context` |
| M9 | `annotations.origin_message_id`(노트 제안 카드가 생기는 곳) |
| M10 | 기억·복습: `study_events`·`concepts`·`memory_claims`·`memory_evidence`·`reviews`·`review_attempts` |

- 새 kind 값을 `anchors.kind` CHECK에 M7에서 한 번에 넣을지, kind를 처음 쓰는 마일스톤마다 넣을지는 M7 스파이크에서 정한다.
- `extracted_chunks`(인용 가능한 최소 단위, FTS 연동)의 시점은 검색 ADR(ADR-0008, 예약)과 함께 정한다.

### 7. 채택 조건 — M7 첫 작업의 스파이크
- (1) PDF 선택 → 앵커 → 확대·회전 뒤 다시 표시(AC03, 허용 오차 2pt). (2) Claude의 쪽 단위 인용 → 앵커. T1의 인용은 Citations API가 아니라, 프롬프트로 받은 인용을 그 턴의 도구 기록으로 검증한 것이다(ADR-0010 3절).
- 통과하면 상태를 "채택"으로 바꾼다. 결과가 이 결정과 맞지 않으면 명세 13절의 규칙("P0 결과가 요구와 충돌하면 ADR과 범위표를 먼저 수정한다")처럼 이 ADR을 먼저 고친다.
- 채택 뒤의 추적: `docs/acceptance.md` AC03(필기 위치), AC10(인용 → 같은 revision 위치), AC22(코드 앵커 재앵커).

### ADR-0002와의 관계
ADR-0002는 그대로 유효하다: 불변 revision 귀속, `schema_version`, `ok/review/orphan`, kind별 좌표(PDF user space quad, letterbox를 뺀 0–1 영상 좌표), 화면 픽셀 저장 금지. 이 ADR은 그 좌표를 감싸는 공통 필드, 새 kind, 소비자 연결을 더한다. ADR-0002의 "P2에서 구현"은 새 로드맵의 M7(앵커)과 M9(필기)다.

## 근거
- **정본은 타입 유니언**: kind마다 zod로 검증되는 정확한 좌표가 AC03·AC04의 기준이다(ADR-0002). 실제 구현도 저장 형식은 자체 형식이고 W3C 선택자는 일부에만 쓴다.
  - Zotero는 PDF 위치를 자체 JSON `PDFPosition { pageIndex, rects?, paths?, nextPageRects? }`로 저장하고(https://github.com/zotero/reader/blob/master/src/common/types.ts), W3C 선택자는 EPUB(CFI FragmentSelector)과 스냅샷(CssSelector + `refinedBy` TextPositionSelector)에만 쓴다(같은 저장소 `src/dom/epub/epub-view.ts`, `src/dom/snapshot/snapshot-view.ts`). 위치는 JSON 문자열로 저장하고 크기 상한 65000을 넘으면 나눈다(https://github.com/zotero/zotero/blob/main/chrome/content/zotero/xpcom/annotations.js).
  - Hypothesis는 W3C 선택자에 자체 `PageSelector`·`EPUBContentSelector`·`ShapeSelector`("PDF user space coordinates (points), with the origin at the bottom-left corner of the page")를 더하고, TextPosition을 W3C의 code point가 아니라 UTF-16 오프셋으로 센다(https://github.com/hypothesis/client/blob/main/src/types/api.ts).
- **재앵커에 quote와 position을 함께 둔다**: Hypothesis는 PDF에서 position을 먼저 시도하고("the fastest anchoring method") quote로 확인하며, 실패하면 예상 쪽에서 가까운 쪽부터 quote를 찾는다(https://github.com/hypothesis/client/blob/main/src/annotator/anchoring/pdf.ts). 퍼지 일치의 가중치는 quote 50, prefix 20, suffix 20, position 2다(`match-quote.ts`). HTML은 Range → TextPosition → TextQuote 순으로 시도하고 매번 quote로 확인한다(`html.ts`).
- **소비자가 `anchor_id`를 가리킨다**: revision이 바뀌어 앵커가 재앵커되면 노트·인용·세션 맥락이 한 곳의 상태(`ok/review/orphan`)를 함께 따른다.
- **전용 테이블**: 연결마다 FK와 삭제 규칙을 따로 건다(예: 명세 08절 `memory_evidence` "최소 한 근거; 근거 삭제 시 재검토", AC13). 범용 `links`는 사용자가 직접 쓰는 연결이 생길 때 필요해진다.

## 결과와 위험
- SQLite는 CHECK 제약을 바꾸려면 테이블을 다시 만들어야 한다. `anchors.kind`·`items.type`의 CHECK 변경은 테이블 재작성 마이그레이션이다(마이그레이션 전 백업 `.pre-vN.bak`, ADR-0003).
- 내부 `position` 단위(code point / UTF-16), `precision` 허용 값, `text` 필수 여부, 기존 `quote`와 `text.quote`의 관계가 M7 스파이크 전까지 열려 있다.
- 재검토 조건: M7 스파이크 결과가 1–6절과 맞지 않을 때, 또는 위키 링크처럼 앵커를 거치지 않는 연결이 필요해질 때.
