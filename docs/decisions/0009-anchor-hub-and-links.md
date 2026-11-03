# ADR-0009: 앵커 허브와 연결 — 모든 소비자는 `anchor_id`를 가리킨다

- 상태: 채택 (2026-11-04) · 제안 2026-10-22, M7a 스파이크로 검증 · 관련: ADR-0002(앵커 좌표, 그대로 유효), ADR-0010(튜터 백엔드), 명세 05·06·08·10, `docs/design/design-spec.md` 1.1, `docs/spec-amendments.md` 1절, `packages/domain/src/anchors.ts`, `packages/db/src/migrations/001-initial.ts`
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
- 내부 `position` 단위, `precision` 허용 값, `text` 필수 여부, 기존 `quote`와 `text.quote`의 관계는 M7a 스파이크(아래 "M7a 스파이크 결과")로 정했다.
- 재검토 조건: M7 스파이크 결과가 1–6절과 맞지 않을 때, 또는 위키 링크처럼 앵커를 거치지 않는 연결이 필요해질 때.

## M7a 스파이크 결과 (2026-11-04)
7절의 두 조건을 실제 pdf.js 뷰어에서 시험했다(`tests/e2e/anchors-spike.spec.ts`, 첨부 `anchor-spike.json`). 도메인 함수(`D/anchors.ts`, `anchor-text.ts`, `anchor-geometry.ts`)는 Task 2가, 시험용 선택 훅(`window.__learnPdf`, 창 매개변수 `e2e=1`일 때만)은 `R/viewers/pdf/anchorProbe.ts`가 만든다. 훅은 글 레이어 `span`을 `getTextContent().items`에 맞춘다: 뷰어와 같은 요청(`includeMarkedContent`, `disableNormalization`)의 항목 가운데 `str`이 빈 문자열이 아닌 것이 `span:not(.markedContent)`와 순서대로 일대일이다(빈 `str`는 `span`을 만들지 않는다). 개수가 다르면 훅이 오류를 낸다.

### 판정
| 열린 질문 | 판정 | 근거 |
|---|---|---|
| `text.position` 단위 | **UTF-16 코드 단위, 쪽 글 안 오프셋**(항목을 이은 문자열 기준, 줄 끝은 `\n`). W3C 변환기가 code point로 바꾼다 | 두 시험 모두 이 단위로 통과: 선택의 오프셋이 DOM Range의 `(span, offset)`와 그대로 오가고, 인용 → 앵커의 `position`이 기대 오프셋과 같다 |
| `pdf`의 `precision` | `span`(글 선택), `region`(영역; M9 펜, M7b 이미지 영역). `item`은 쓰지 않는다 | 예상대로 |
| `text` 필수 여부 | `span`은 `text.quote` 필수, `region`은 없음. `text.position`은 선택 | 예상대로(`pdfAnchor`가 검증) |
| locator의 `quote` 와 `anchors.quote` 열 | locator의 `quote`는 `text.quote`로 옮긴다. `anchors.quote` 열은 표시·검색용 `exact`의 사본이다 | 예상대로 |
| `'slides'`/`'slide'` | 한 이름 `'slides'`로 맞추되 **M7b가 첫 새 kind(`image`)와 함께 `kind` CHECK를 한 번에 바꾼다.** 도메인의 `slideAnchor`는 그때까지 `'slide'`다 | 예상과 다름(P-11): 마이그레이션 안의 `anchors` 재작성은 `annotations.anchor_id … ON DELETE RESTRICT`가 행이 있는 서재에서 막는다(앱의 마이그레이션은 외래 키를 켠 트랜잭션 안에서 돈다). M7b 때도 `annotations`는 비어 있다(필기는 M9) |
| 새 kind의 CHECK 시점 | kind를 처음 쓰는 마일스톤이 좌표 zod와 함께 더한다(M7b `image`). M7a는 kind 목록을 바꾸지 않는다 | 예상대로. 그래서 **마이그레이션 003은 열만 더한다**: `ALTER TABLE anchors ADD COLUMN precision TEXT NOT NULL DEFAULT 'span' CHECK (precision IN ('item','span','region'))`와 `ADD COLUMN text_json TEXT` |

**quad 점 순서(P-2)**: `[x1,y1,…,x4,y4]`는 **왼쪽 위 · 오른쪽 위 · 왼쪽 아래 · 오른쪽 아래**, 회전 전 쪽 공간(PDF 주석 QuadPoints의 실무 순서). 선택 사각형은 쪽 뷰포트의 `convertToPdfPoint`로 바꿔 축에 맞춘 상자로 만들고, 한 줄의 조각은 한 quad로 잇는다. 회전된 뷰어에서도 이 순서가 그대로여서 회전은 거리에 영향을 주지 않았다.

### 시험 행렬과 최대 거리
확대 50·100·200·400% × 회전 0·90·180·270 × 선택 넷(`paper-100.pdf` 1쪽 한 줄, 1쪽 두 줄에 걸친 선택, 3쪽 오른쪽 단의 한 줄, `korean.pdf` 1쪽 한국어 한 줄). 기준은 (100%, 0°)에서 만든 앵커이고, 조합마다 같은 글을 새로 골라 얻은 quad와의 최대 좌표 차(pt)를 쟀다. 앵커를 `quadToRect`로 화면에 되돌린 상자도 새 선택의 사각형 경계와 2pt(× 뷰포트 배율 px) 안이다.

| 확대 | 0° | 90° | 180° | 270° | 최대 |
|---|---|---|---|---|---|
| 50% | 1.51 | 1.51 | 1.51 | 1.51 | 1.51 |
| 100% | 0 | 0 | 0 | 0 | 0 |
| 200% | 0.49 | 0.49 | 0.49 | 0.49 | 0.49 |
| 400% | 0.36 | 0.36 | 0.36 | 0.36 | 0.36 |

- 전체 최대 **1.51 pt**(허용 2 pt). 같은 확대에서는 네 회전의 값이 같다.
- 50%의 1.5 pt는 글 레이어 `span`의 상자 높이(글자 크기를 양자화한 줄 높이)가 확대마다 조금 달라서 생긴다. 한계에 가까우므로 글 조각 기하를 쓰는 쪽(M9 필기 그리기)이 쪽을 낮은 배율로 그릴 때는 이 오차를 염두에 둔다.
- 쪽 인용 시험: 두 줄에 걸친 인용(줄바꿈 대신 공백), 하이픈 줄넘김(`transduc-` + 줄바꿈 + `tion`), NFD 쪽 글(`korean.pdf` 2쪽)을 NFC 인용으로 찾기 — 모두 앵커의 `position`이 기대 오프셋과 같고 quad가 같은 글을 새로 고른 것과 같다(0 pt). 없는 인용은 `NOT_FOUND`다.

### 스파이크가 찾아 고친 것
- **회전된 쪽의 글 레이어**(Task 6): pdf.js는 글·링크 레이어를 쪽 크기로 놓고 `data-main-rotation`만 붙이며 돌리는 일은 쪽의 CSS에 맡기는데, 앱의 `pdf-viewer.css`에 그 규칙이 없어서 회전하면 글 레이어가 캔버스와 어긋나 있었다(선택·링크 위치 오류). 규칙을 더했다.
- **글 레이어 크기**: 쪽과 레이어는 `round(down, …)`로 크기가 정해져 큰 쪽에서는 뷰포트보다 몇 px 작다. 글 위치는 레이어의 백분율이므로 quad는 레이어 크기로 잰다.
- **Task 2 함수**: `rectsToQuads`는 줄을 묶는 허용 오차가 비교 함수 안에 있어 이행적이지 않았다 — 줄을 먼저 위 가장자리 순서로 나누고 줄 안에서 정렬하도록 고쳤다(회전된 쪽의 병합은 PDF 공간에서 하므로 문제가 없음을 행렬로 확인). `findQuote`는 일치가 지워진 줄 끝 하이픈·soft hyphen 바로 앞에서 끝나면 그것을 범위에 넣었다 — 넣지 않도록 고쳤다. `1990-\n2000`의 하이픈이 남는다는 시험도 더했다.
