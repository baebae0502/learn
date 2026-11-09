# ADR-0008: 본문 검색 — PDF 쪽 글 표, FTS5 trigram, 빠른 검색의 범위

- 상태: 채택 (2026-11-10) · M7c · 번호는 ADR-0009 6절이 예약해 두었다(계획 P-28) · 관련: 명세 [`2026-11-08-m7c-images-search-perf-design.md`](../superpowers/specs/2026-11-08-m7c-images-search-perf-design.md) 5·10·13·17절, ADR-0003 "스키마 v4", ADR-0006(휴지통·영구 삭제), ADR-0007(`library.searchScope`), ADR-0009 6절(`extracted_chunks`의 시점), [`spec-amendments.md`](../spec-amendments.md) 8·14절
- 근거: 소유자 결정 2026-11-08(Q3 "빠른 검색에 범위 추가(Zotero식)", 설계안 3절 "너의 '추천안'대로 진행해"), 명세 5절의 컨트롤러 판정 J13–J26·J34·J35, 구현 중 판정 R29–R31·R56·R59·R63·R65·R66·R68(`spec-amendments.md` 14절)

## 맥락
- M4의 빠른 검색은 정보(제목·저자·연도·출판사·원래 이름·초록·메모)만 찾는다. 렌더러의 메모리 색인이고 FTS5가 아니다. 본문은 앵커와 텍스트 추출이 생긴 뒤로 미뤘다(`spec-amendments.md` 8절). ADR-0009 6절은 `extracted_chunks`(인용 단위)와 FTS의 시점을 이 ADR에 맡겼다.
- PDF는 불신 입력이다. main은 PDF를 열지 않는다. `better-sqlite3`는 동기라 main에서 오래 도는 질의는 메뉴·IPC를 멈춘다.
- 한국어 낱말은 2글자가 흔하다("형광", "세포"). FTS5의 trigram 토크나이저는 3글자 이상만 색인으로 찾는다.
- 번들된 SQLite는 3.53.4다(`better-sqlite3` 13.0.3). trigram의 `remove_diacritics 2`가 있다.
- 지금까지 `jobs` 표를 소비하는 코드가 없었다. 가져오기가 모든 자료에 `extract:<sha256>:text-v0` 작업을 넣기만 했다.

## 결정

### 1. 쪽 글 표 — 파일 내용(sha) + 쪽 번호 (J35)
- `page_texts(id INTEGER PRIMARY KEY, sha256, page_index, text, UNIQUE (sha256, page_index))`(마이그레이션 004). 파일 내용마다, 쪽 하나에 행 하나다. 같은 파일을 쓰는 자료 여럿(사본·외부 연결·중복)이 한 벌을 나눈다.
- 판본(revision)이 아니라 sha로 열쇠를 둔다. 판본은 자산마다라, 판본으로 두면 사본과 외부 연결처럼 자산이 둘인 같은 내용이 두 벌이 된다. 작업 키도 sha이고, 영구 삭제가 작업을 지우는 규칙(그 sha의 마지막 자산이 떠날 때)과 같다.
- 앵커 규칙(Global Constraints)과 맞다: 쪽 글은 sha + 쪽 번호라 그 판본의 pdf 앵커(`pageIndex`)로 가리킬 수 있다.
- 쓰기는 `INSERT`만이다. 새 추출기 버전이 그 sha의 첫 묶음을 쓰는 트랜잭션에서 옛 행을 먼저 지운다. 다시 실행해 이어 쓸 때 이미 넣은 쪽은 `UNIQUE`가 막는다 — 중복은 버그로 실패하게 둔다(`INSERT OR REPLACE`를 쓰지 않는다).
- 쪽 글은 일꾼이 정리한다(`text/page-text.ts`): 항목을 잇고 줄 끝은 줄바꿈, 글자 사이의 줄 끝 하이픈은 지우고 잇기, 표시 문자 `U+E000`·`U+E001`과 공백 아닌 제어 문자 지우기(R11), 공백 덩어리 하나로, 앞뒤 공백 제거, **NFC**. 대소문자는 접지 않는다 — 조각이 원문 대소문자로 보이고 접기는 색인이 한다. main은 길이 한도와 표시 문자 제거를 한 번 더 한다(`guardStoredText`).

### 2. FTS5 trigram 외부 내용 표 (J34)
- `page_texts_fts USING fts5(text, content = 'page_texts', content_rowid = 'id', tokenize = 'trigram remove_diacritics 2')`. 글은 한 번만 저장하고 `snippet()`이 내용 표에서 읽는다. 동기화는 004의 트리거 셋(넣기·지우기·고치기)이다.
- 대소문자 접기(유니코드 단순 접기 — 라틴·그리스·키릴)와 발음 부호 지우기는 색인과 질의 양쪽에서 SQLite가 한다. `detail=full`(기본)이다 — `detail=none`은 구(phrase) 질의를 거부한다.
- NFD 질의는 NFC 본문을 찾지 못한다. 그래서 저장과 질의 모두 NFC다.

### 3. 질의 — 3글자는 색인, 2글자는 훑기, 1글자는 정보만 (J19 · J20)
- 낱말 나누기는 도메인 함수 하나 `bodyQueryWords(query)`다: NFC, 공백으로 나눔, 같은 낱말은 하나로, 앞 8개까지. 길이는 코드 포인트로 센다(trigram도 코드 포인트로 자른다). 렌더러(절을 보일지)와 main(질의)이 같은 규칙을 쓴다.
  - **3글자 이상**: FTS5 구 `"낱말"`(안의 `"`는 둘로) — 색인을 쓴다.
  - **2글자**: 같은 `page_texts`의 `text LIKE '%낱말%' ESCAPE '\'` — 전체 훑기. ASCII는 대소문자를 무시하고 한글에는 대소문자가 없다.
  - **1글자**: 본문에서 찾지 않는다(정보만). 1글자 낱말을 빼고 남는 것이 없으면 본문 검색을 하지 않는다(`searched: false`).
- 낱말 사이는 AND이고 **한 쪽 안에** 모두 있어야 그 쪽이 일치한다(J19 — '본문 일치'의 쪽 목록과 같은 뜻. 자료 단위 AND는 쪽 하나를 가리킬 수 없다).
- `search:body`(창마다 하나): 휴지통이 아닌 PDF 자료의 id만 돌려준다. 2글자 낱말만이면 FTS 없이 `page_texts`를 `id` 범위 2,000행씩 나눠 훑고 덩어리 사이에 `setImmediate`로 main을 놓아준다. 새 요청이 오면 앞의 것을 `AbortSignal`로 멈추고 앞의 것은 `CANCELLED`로 답한다(J20 — 1만 PDF의 2글자 훑기가 main을 수백 ms 잡지 않게, 그리고 취소할 자리가 생기게).
- `search:pages`(자료 하나): 그 자료 원본의 sha에서 일치하는 쪽을 `page_index` 순서로 최대 20개, 쪽마다 조각 하나, 일치한 쪽 수 전체. 3글자 낱말의 질의 계획은 파일의 쪽 수(그 sha의 열쇠에서 센 수)로 고른다(R79):
  - **64쪽까지**: 그 sha의 쪽을 열쇠로 걷고 쪽마다 색인에 rowid로 묻는다(Task 9 — 서재 전체의 `MATCH`를 두 번 돌리지 않는다). 쪽 하나에 약 0.4 ms이고, 일치가 드물면 행 질의가, 개수 질의는 늘 파일의 모든 쪽을 걷는다.
  - **64쪽을 넘으면**: 색인을 먼저 읽고 그 파일의 쪽만 남긴다(`page_texts_fts CROSS JOIN page_texts … p.sha256 = ?`, 행과 개수 모두). 비용은 파일 길이가 아니라 그 낱말의 서재 전체 일치 수다. 짧은 파일에는 쓰지 않는다 — 12쪽 논문에서 33 ms 대 5 ms(최종 리뷰의 스크래치 측정).
  - 측정(`search-perf.evidence.ts`, 1,000 PDF 시드에 1,000쪽 책 하나, 논문들에는 거의 모든 쪽에 있고 책에는 마지막 쪽에만 있는 낱말 "transduction", 표본 20, 로컬 Linux `taskset -c 0-3`): 고치기 전 p95 **722 ms**(중앙값 677.6) → 고친 뒤 **70.7 ms**(중앙값 51.1), 예산 100. 같은 실행에서 12쪽 논문의 p95는 8.6 → 8.8 ms로 그대로다. 최종 리뷰의 스크래치에서 5,000쪽 책은 쪽 걷기로 1.8–2.3초였다.
  - 2글자 낱말만이면 그 sha의 쪽을 `LIKE`로 훑는다(5,000쪽에서 약 5 ms, 스크래치).
  - 조각은 3글자 낱말이 있으면 `snippet(page_texts_fts, 0, char(57344), char(57345), '…', 48)`(J21 — 약 50자, 320 폭 패널의 두 줄), 2글자 낱말만이면 main이 같은 규칙으로 첫 일치 앞 20자·뒤 28자를 낱말 경계에서 자른다. 표시 `U+E000`…`U+E001`은 렌더러가 `<mark>`로 바꾼다(HTML로 넣지 않는다). 휴지통 자료는 아무것도 돌려주지 않는다.
- `search:progress`: `{ done, total }` — 휴지통이 아닌 PDF 자료 가운데 이 버전의 작업이 끝난(완료 또는 실패) 것과 전체(P-9).

### 4. 추출 작업 — `jobs` 표 (5.1, J13–J15)
- 작업 하나 = 파일 하나: `kind = 'extract'`, `dedupe_key = 'extract:<sha256>:pdf-text-1'`. 버전 이름에 형식을 넣어(J13) M8의 자막 추출과 겹치지 않게 한다. `dedupe_key`의 UNIQUE와 `ON CONFLICT(dedupe_key) DO NOTHING`이 중복을 막는다 — 같은 파일의 사본·외부 연결·중복 자료도 작업은 하나다. 가져오기는 **PDF에만** 작업을 넣는다. 004가 아무도 소비하지 않은 `text-v0` 작업을 지웠다.
- 상태: `queued` → `running` → `done`(비어 있음 포함) | `failed`(`locked`·`damaged`·`too-large`·`gave-up`). `payload_json` = `{ sha256, type: 'pdf', nextPage, pages, chars, truncated }`. `nextPage`가 다음에 시작할 쪽이라 **다시 실행하면 이어서** 한다.
- **채워 넣기**: 일정기가 깰 때마다 한 문장으로 모든 PDF 자료(휴지통 포함)의 sha 가운데 이 버전의 작업이 없는 것에 `queued` 작업을 넣는다. 작업의 `created_at`은 그 sha를 쓰는 PDF 자료의 가장 늦은 `items.created_at`이다(P-8). 그래서 백업에서 복원한 라이브러리와 004 이전에 가져온 PDF도 같은 길로 색인된다.
- **고르는 순서**: 최근에 만든 작업부터, 휴지통이 아닌 PDF 자료가 하나라도 있는 sha만(J14 — 방금 가져온 논문을 먼저 찾을 수 있게). 읽을 파일이 없는 sha는 이 실행 동안 건너뛰고 시도를 세지 않는다(P-14).
- **언제 도나**: 한 번에 하나. 주 창의 첫 유휴와 시작 점검의 첫 실행이 모두 끝난 뒤 5초가 지나야 시작하고(J15, P-29 — 냉시작 예산과 첫 화면에서 벗어나고, 점검이 막 시작한 작업을 `interrupted`로 바꾸지 않게), main의 작업 줄(가져오기·백업·복원)이 바쁜 동안에는 새 작업을 시작하지 않는다. 가져오기가 끝나면 이어서 돈다. E2E는 멈춘 채 시작한다(P-13, `LEARN_TEXT_EXTRACTION=run`이면 켜진 채 — 데모와 냉시작 증거).
- **진행 알림**: `libraryChanged{text}`(그 sha를 쓰는 자료들 — 상세와 본문 검색 결과만 무효)와 `search:progress`(1초에 최대 한 번, 대기열이 비거나 작업이 포기될 때 마지막 한 번, R30).

### 5. `utilityProcess` 일꾼 (5.2–5.3, J16–J18)
- `out/main/text-worker.js`를 `utilityProcess.fork`로 띄운다. 서비스 이름 "Learn 본문 색인"(활동 모니터에 보이는 이름), `--max-old-space-size=1024`, 낮은 우선순위(`PRIORITY_BELOW_NORMAL`). **일꾼은 DB를 만지지 않는다** — 쓰기는 main 하나다.
- pdf.js(`pdfjs-dist` 6.4.299)를 같은 프로세스의 '가짜 일꾼'으로 쓴다. `utilityProcess`에서는 pdf.js의 `isNodeJS`가 거짓이라 DOM 팩터리가 기본이 된다 — 그래서 `data`(일꾼이 읽은 바이트), `cmaps/`·`standard_fonts/`를 `fs`로 읽는 작은 팩터리(이름은 `[A-Za-z0-9._-]+`만, 폴더 밖 거부), `useWorkerFetch: false`, `isOffscreenCanvasSupported: false`, `isImageDecoderSupported: false`, `useWasm: false`, `disableFontFace: true` 등을 준다. 자료 폴더는 main이 넘기는 `out/renderer/pdfjs`다(P-12).
- 메시지는 `opened` · `pages`(쪽 20개 또는 50만 자까지 한 묶음) · `done` · `failed`이고, main은 모든 메시지를 zod로 검사한다. 틀리면 일꾼을 죽이고 실패 한 번으로 센다. main은 묶음마다 한 트랜잭션으로 쪽 글을 넣고, 그 전에 작업 행이 아직 있고 `running`인지 같은 트랜잭션에서 본다(P-10 — 지운 sha의 쪽 글이 고아로 남지 않게).
- 수명(J16): 대기열에 일이 있는 동안 하나를 살려 두고 차례로 준다. 실패·시간 초과 뒤와 50작업마다 새로 띄우고, 30초 동안 일이 없으면 내린다.
- 한도(J18 — 논문·교과서 한 권이 넉넉히 들고, 한 쪽의 비정상 글 흐름과 일꾼 메모리를 묶는 값):

  | 한도 | 값 | 넘으면 |
  |---|---|---|
  | 파일 크기 | 512 MiB | 열지 않음 — `failed: too-large` |
  | 쪽 수 | 앞 5,000쪽 | 거기서 멈추고 `done`, `truncated: true` |
  | 쪽 하나의 글자 | 10만 자 | 그 쪽은 거기서 자름 |
  | 문서 전체 글자 | 1,000만 자 | 거기서 멈추고 `done`, `truncated: true` |
  | 메시지 사이 · 작업 하나 | 30초 · 15분 | 일꾼을 죽이고 실패 한 번(다음 시도는 `nextPage`부터) |
  | 시도 | 3번 | 넷째 시작 대신 `failed: gave-up` |

- 암호 PDF는 `failed: locked`(암호를 저장하지 않으므로 다시 하지 않는다), 그 밖에 열지 못하면 `failed: damaged`. 끝까지 뽑았는데 쪽당 평균 10자 미만이면 상태는 '글자 없음(스캔본일 수 있음)'이고 뽑은 글자는 그대로 색인한다(J17).
- 실패한 작업을 다시 돌리는 화면은 없다. 추출기 버전이 바뀌면 새 작업이 생긴다.

### 6. 휴지통 · 영구 삭제 · 다시 실행 (5.7)
- **휴지통**: 쪽 글은 지우지 않는다. 휴지통 자료는 질의의 `i.deleted_at IS NULL`로 일치에서 빠지고, 복원하면 다시 뽑지 않고 곧바로 일치한다. 도는 작업의 sha에 휴지통 아닌 PDF가 더 없으면 일꾼을 멈추고 작업은 `queued`로 남는다 — 이 멈춤은 시도를 세지 않는다(R29: 휴지통과 복원을 세 번 오가도 `gave-up`이 되지 않는다).
- **영구 삭제**: 그 sha의 마지막 자산이 떠날 때 작업을 지우는 같은 자리(`removeUnusedAssets`)에서 `DELETE FROM page_texts WHERE sha256 IN (…)`. 트리거가 색인 행을 지운다(ADR-0006 4절).
- **다시 실행**: 시작 점검이 `running`을 `interrupted`로 바꾸고 일정기가 처음 깰 때 `queued`로 되돌린다. 이어서 `nextPage`부터다. 정상 종료는 도는 작업을 시도를 돌려준 채 `queued`로 되돌린다(R31). SIGKILL은 시도 한 번으로 센다.

### 7. 화면 — 빠른 검색의 범위 (5.8, 소유자 Q3)
- 별도 검색 화면은 없다. 라이브러리 검색 필드 맨 앞(돋보기 자리)의 **검색 범위 ▾**(웹 팝업 메뉴, 레지스트리 명령이 아님): **정보** · **정보와 본문**(설명 "PDF 본문 포함"). 색인 중이면 메뉴 맨 아래에 선택할 수 없는 줄 "본문 색인 37 / 120". 고른 값은 라이브러리 설정 `library.searchScope`(ADR-0007, 기본 `metadata`). 화면 문구는 '메타데이터'가 아니라 '정보'다(J23).
- 표: '정보와 본문'이면 결과 = 정보 일치 ∪ 본문 일치. 정보 결과는 지금처럼 즉시, 본문 결과는 늦춘 질의가 200ms 멈춘 뒤(J22). 본문만 일치한 행에 따로 표시는 없다(목업 승인). 다른 것이 보이지 않는 채 본문 답이 300ms를 넘으면 표 자리에 "찾는 중…"(R59). 휴지통 보기는 범위와 상관없이 정보만 찾는다(R60).
- 결과 없음의 "·PDF 본문"은 본문을 실제로 찾았을 때만 붙인다(J24, R56). 1글자뿐이면 "본문은 두 글자 이상인 낱말로 찾습니다.", 색인 중이면 "본문 색인이 끝나면 더 찾을 수 있습니다(37 / 120)."를 덧붙인다.
- 항목 패널의 **'본문 일치' 절**(PDF 하나, 범위 '정보와 본문', 본문 낱말 있음): 머리 바로 아래(J25), "쪽 34개", 행은 "12쪽" + 두 줄 조각(최대 20) + "외 14쪽". 행을 누르면 그 쪽에서 리더가 열리고 찾기 막대가 그 질의의 본문 낱말 하나로 열린다(P-23). 그 낱말은 `findWordOf`가 고르는 가장 긴 것(3글자 낱말이 2글자보다 먼저, 같으면 앞의 것)이다 — 쪽은 낱말이 모두 있으면 일치하지만 pdf.js 찾기는 질의를 한 구로 찾아, 질의 전체로 열면 붙어 있지 않은 낱말의 쪽에서 "찾을 수 없음"이 되기 때문이다(R79, J24). 절은 표처럼 입력한 질의를 열쇠로 한다(R65).
- 색인 상태는 완료가 아닐 때만 말한다(J26): 파일 절의 "본문 검색" 줄과 '본문 일치' 절에 색인 중 · 글자 없음 · 실패(이유). 휴지통 자료와 원본 없는 자료에는 줄이 없다(R63). 잘린 색인은 "앞 5,000쪽까지 색인했습니다."를 행 아래, 일치가 없으면 그 줄만 보인다(R68). `search:pages`가 실패하면 절을 보이지 않는다(R66).

### 8. 인용 단위(`extracted_chunks`)는 T1
- 쪽 글은 검색용이다. 튜터가 인용하는 최소 단위(문단·문장 범위와 앵커)는 T1이 인용 검증과 함께 정한다. ADR-0009 6절의 "검색 ADR과 함께 정한다"는 이것으로 닫는다 — 이 ADR은 `extracted_chunks`를 만들지 않는다.
- T1의 인용 단위는 이 표를 다시 쓸 수 있다: 같은 sha + 쪽이고, 쪽 글은 pdf.js의 찾기와 같은 정리(하이픈·합자·NFC)를 거쳤다.

## 미채택과 이유
- **판본으로 열쇠 두기**: 사본과 외부 연결처럼 같은 내용이 두 벌 저장된다(J35).
- **글을 FTS 안에 한 벌 더 두는 보통 FTS 표**: 크기가 두 배다. **내용 없는 표(`content=''`)**: `snippet()`을 쓸 수 없다(J34).
- **2글자를 위한 두 번째 색인**(바이그램 토크나이저, 접은 글 열): 색인 크기가 약 한 배 더 든다. 측정한 2글자 훑기(1,000 PDF에서 약 30 ms)가 예산(300 ms) 안이라 크기를 아꼈다.
- **main에서 PDF 열기, 렌더러의 pdf.js로 뽑기**: main은 불신 입력을 열지 않는다(Global Constraints). 렌더러는 탭이 닫히면 사라지고 화면 프레임을 나눈다.
- **작업마다 일꾼 띄우기**: PDF 1,000개에 띄우기만 몇 분이다. **하나를 끝까지 쓰기**: 한 파일의 메모리 누수가 남는다(J16).
- **별도 검색 화면, 팔레트(⌘K)의 본문 검색**: 소유자가 빠른 검색의 범위를 골랐다(Q3).
- **휴지통으로 옮길 때 쪽 글 지우기**: 복원 뒤 다시 뽑아야 한다. 승인한 설계의 "휴지통 자료의 본문 제거"를 "휴지통 동안 검색에서 빠짐 + 영구 삭제 때 행 삭제"로 읽었다(명세 5.7 해석 메모).
- **관련도 순위, 정규식·구문 문법, 암호 PDF의 본문, 실패한 추출을 다시 돌리는 단추**: M7c 밖이다(명세 2절).

## 결과와 위험
- **측정**(Linux CI run 42654046397, a197d45, `search-perf.evidence.ts`, 1,000 PDF × 12쪽 × 4,000자 시드): 본문 검색(`search:body` 왕복) p95 **29.1 ms**(예산 300), '본문 일치'(`search:pages`) p95 **3.6 ms**(예산 100), 추출이 도는 동안 표 스크롤 프레임 p95 16.7 ms(예산 16.7), 처리량 초당 320.9쪽, 묶음 쓰기 중앙값 13.7 ms(최대 49.7 ms, 묶음 100), 캐시 없는 첫 질의 0.4–29.9 ms(형광 29.9 · 세포 26.9 · zq 18.6 · 현미경 9.5 · transduction 29.5 · 단백질 신호 29.5 · xylophone 0.4), 시드 7.27초. 범위별 검색 입력 → 정보 결과 그리기 p95(P6, `perf.evidence.ts`): **40 ms**(정보) · **41 ms**(정보와 본문), 예산 50, 본문 답의 그리기가 입력의 그리기로 잡힌 것 0회.
- **DB 크기**: 같은 시드에서 **221,137,352 B**(약 221 MB). 시드 직후(20편을 더 색인하기 전) `library.sqlite`와 `library.sqlite-wal`을 합한 파일 크기다 — WAL 파일의 크기가 들어 있다. 명세 작성 중 스크래치 값(154.8 MB)보다 크지만 그 차이를 나눠 재지는 않았다. 색인이 글의 약 두 배라 백업·복원이 그만큼 길어진다. 실제 논문 1,000편의 크기는 재지 않았다(M14 실기 목록, `next-session.md`). 넘치면 `columnsize=0` 같은 선택을 판정으로 본다.
- **알려진 한계 — 2글자의 대소문자**: SQLite `LIKE`는 ASCII만 접는다. "Éc"와 "éc"처럼 ASCII 밖 라틴 글자의 2글자 낱말은 대소문자가 다르면 찾지 못한다. 한국어와 ASCII에는 영향이 없다. 바꾸려면 접은 글 열을 하나 더 두는 비용(약 한 배 크기)이 든다.
- **1글자 질의**는 본문을 찾지 않는다. 결과 없음이 그 사실을 말한다(J24).
- **main 막힘**: 2글자 훑기는 나눠서, FTS는 한 문장이다. `search:pages`는 파일 길이로 계획을 골라(3절) 1,000쪽 책에서도 p95 70.7 ms다(고치기 전 722 ms, 로컬 `search-perf`). 그 '색인 먼저' 계획과 `search:body`의 비용은 낱말의 서재 전체 일치 수에 비례한다 — 1,000 PDF에서 수십 ms이고, 1만 PDF 규모는 측정 밖이다(보고만).
- **pdf.js 찾기와 색인의 차이**: 하이픈·합자·NFC를 맞췄지만 어긋나면 쪽은 열리고 찾기 막대가 "찾을 수 없음"이다(쪽은 맞다). `search-30.pdf`·`korean.pdf`의 E2E가 지킨다.
- **포장한 앱**: 일꾼이 asar 안의 `out/renderer/pdfjs`에서 cMap·글꼴을 `fs`로 읽는지는 확인하지 않았다(포장하지 않은 Electron에서는 `korean-cmap.pdf`로 확인). M14 실기 목록에 있다.
- **스캔한 PDF**는 '글자 없음'이다. OCR은 M14다.
- **추출이 주는 부하**: 한 번에 하나 · 낮은 우선순위 · 작업 줄이 쉴 때만 · 유휴 뒤에 시작. 위의 "추출 중 스크롤 p95"가 지킨다.

## 검증
- 단위: `packages/domain/test/body-search.test.ts`(낱말 나누기 1·2·3글자 · 코드 포인트 · 8개 · 중복, FTS 구 따옴표, `LIKE` 이스케이프), `packages/db/test/body-search.test.ts`("finds by a two-letter scan and by a trigram phrase", "ignores case and diacritics in the index", "wants every word on one page", "leaves trashed items out and drops everything at a purge", `bodyPages`·`bodyLikeChunks`와 질의 계획 — 짧은 파일의 쪽 걷기, 65쪽 이상의 색인 먼저, 70쪽 파일에서 두 계획의 같은 답), `packages/db/test/text-repository.test.ts`(중복 방지 · 순서 · 채워 넣기 · 다시 실행 · 시도 · 묶음 쓰기 전 확인), `packages/db/test/migrate.test.ts` "migration v4 (images-text)", `apps/desktop/src/main/text/*.test.ts`(쪽 글 정리 · 메시지 zod · 자료 팩터리 이름 검사 · 일정기 · 질의 · 시드), `apps/desktop/src/main/ipc/search.test.ts`(취소 · 창마다 하나 · 입력 거절).
- E2E: `tests/e2e/text-worker.spec.ts`(실제 일꾼 — `korean.pdf` NFC, `korean-cmap.pdf`의 cMap, 하이픈, `locked`·`damaged`·`too-large`, 한도, 프로세스 이름 — P-11: pdf.js 6.4.299는 Node 22의 vitest에서 돌지 않아 Electron 안에서 시험한다), `tests/e2e/body-search.spec.ts`(멈춘 채 시작 · SIGKILL 뒤 이어서 · 휴지통과 복원 · 영구 삭제 뒤 `pageTextCount` 0 · 진행 알림 · 범위 메뉴와 기억 · 합집합 · 2글자와 1글자 · NFD · 찾는 중 · 진행 줄 · 휴지통 · '본문 일치'의 쪽·조각·외 N쪽 · 행을 누르면 그 쪽과 찾기 막대 · 상태 줄 · 잘린 색인).
- 증거: `tests/evidence/search-perf.evidence.ts` "body search over 1,000 PDFs, and the table while twenty papers index"(`search-perf.json` — 1,000쪽 책의 `search:pages` 줄 `bookPages` 포함), `tests/evidence/perf.evidence.ts`의 범위별 검색 입력 줄. CI는 예산의 2배를 넘을 때만 실패한다(`tests/evidence/budget.ts`).
