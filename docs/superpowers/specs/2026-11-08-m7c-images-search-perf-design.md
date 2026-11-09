# M7c — 이미지 · PDF 본문 검색 · 성능 설계

- 상태: 소유자 승인 (2026-11-08, 질문 넷은 모두 "추천" 답, 설계안 0–7절은 "너의 '추천안'대로 진행해") · 이 문서는 승인한 설계를 코드에 맞춰 정밀하게 한 것이다. 승인한 결정은 바꾸지 않았다. 설계가 열어 둔 기술 선택은 "(컨트롤러 판정 Jn: 이유)"로 표시했다 — 소유자가 뒤집을 수 있다.
- 관련: [M7b 명세](2026-11-05-m7b-reader-tabs-design.md)(탭·탭별 리더 상태), [M7a 명세](2026-11-03-m7a-reader-design.md)(리더 v2·위치 기억), [디자인 명세](../../design/design-spec.md) 2.4(패널 머리·검색 필드)·3.1(토큰)·6(검색 필드)·7.3(웹 팝업 메뉴·보기 ▾)·7.4(키)·9(문체)·10.1·10.3, [ADR-0003](../../decisions/0003-storage-layout.md)(스키마·`.pre-vN.bak`), [ADR-0007](../../decisions/0007-settings-and-preferences.md)(설정), [ADR-0009](../../decisions/0009-anchor-hub-and-links.md)(앵커, P-11), [ADR-0012](../../decisions/0012-translation.md)(번역), [`spec-amendments.md`](../../spec-amendments.md) 1·8·10·12·13절, [`next-session.md`](../../next-session.md) "M7b에서 나온 M7c 입력"·"M6에서 나온 M7 입력"·"PR 남은 것 (M5 …)"·"M5에서 나온 M6 입력"
- 브랜치 `m7c-images-search`, 워크트리 `.worktrees/m7c`. 기준 코드: main 4e57fad(M7b 병합).

## 0. 소유자 결정 (2026-11-08)

| 질문 | 결정 |
|---|---|
| 범위 | **M7c는 PR 하나.** Mac 간헐 실패 4건은 먼저 별도 작은 PR(`mac-flakes`)로 — M7c 범위 밖 |
| Q1 이미지 형식 | **래스터 5종: PNG · JPEG · WebP · GIF · AVIF.** Chromium이 그대로 그린다, 새 의존성 없음. HEIC·TIFF는 M14(변환·OCR). SVG 제외. 이미지 1장 = 자료 1개 |
| Q2 이미지 리더 | **보기 기본 + 자리 기억.** `image` 앵커는 형식과 검증만, 만드는 UI는 M9·T1 |
| Q3 본문 검색 위치 | **빠른 검색에 범위 추가(Zotero식).** 별도 화면 없음 |
| Q4 번역 주소 재확인 | **문서 조사만, 실제 호출 없음.** 실제 동작 확인은 소유자가 직접 돌릴 명령으로 남긴다 |
| 목업 승인 (12절 ①–⑧) | **"목업 추천대로"**(2026-11-08). ⑦은 추천안, ④의 '본문만 일치한 행 표시 없음'도 이대로. 아래 다섯은 디자인 비평 뒤 컨트롤러 판정(R20–R25 중)을 승인 답에 포함한 것이다 |
| 목업 R20 보기 ▾ 배경 | 웹 보기 ▾는 "배경"을 **펼친 묶음**으로 보인다: 머리 "배경" + 밝게 / 어둡게 / 체크무늬(지금 값에 체크) · — · 시계 방향으로 회전 · 반시계 방향으로 회전(PDF 보기 ▾의 쪽 색 묶음과 같은 문법). 메뉴 막대 보기 메뉴는 "배경 ▸" 그대로 |
| 목업 R21 이미지 배경 | 그림에 테두리 없음. `--image-bg-light` = `oklch(93.2% 0.004 250)`, `--image-bg-dark` = `oklch(17.5% 0.004 250)`(PDF 무대와 같은 면), 체크무늬 `oklch(80% 0 0)` / `oklch(92% 0 0)`(8px 칸, `background-attachment: local`) |
| 목업 R22 사이드바 | ⑦은 '쪽 없음' 안내 "이미지에는 쪽이 없습니다"(`noPages: 'image'`, 아이콘 `image`). 이미지 탭의 모든 상태에서 쓰며 휴지통 상태보다 먼저 고른다. 사이드바 자동 접기는 하지 않는다 |
| 목업 R23 검색 필드 | 폭은 240 그대로(범위 단추가 들어가도 "제목, 저자, 태그, 본문 검색"이 한 줄에 든다) |
| 목업 R24 개수 문법 | '본문 일치' 머리의 개수는 앱의 개수 문법으로 "쪽 34개"(행의 "12쪽"과 구별). "외 14쪽"은 그대로 |
| 목업 고침(구현 뒤, 2026-11-10) | 소유자 승인이 아니라 컨트롤러 판정으로 목업을 앱에 맞췄다(Task 16, 디자인 명세와 같은 커밋): R46 확대 필드 높이 22(`.zoom-field .field`·`.page-field .field`, 두 리더가 M7a부터 22) · 여는 중 툴팁은 ▾에 붙은 "확대 메뉴 · 이미지를 여는 중입니다"(이름 · 이유) · R60 범위 단추의 글리프는 단추 색을 따른다(호버 2차색, 눌림·열림 1차색 — `.field .scope-btn .icon { color: inherit }`) · R68 ⑤에 `?matches=truncated`(행 아래 "앞 5,000쪽까지 색인했습니다.")와 `?matches=truncated-none`(그 줄만) · 디자인 명세 10.1·10.10의 요소 행(R13, 목업 비평 m14) |
| 설계안 0–7절 | 승인("너의 '추천안'대로 진행해"). 이 문서의 자리: 1 이미지 자료와 마이그레이션 004 → 3절, 2 이미지 리더 → 4절, 3 PDF 본문 검색 → 5절, 4 성능과 M7b 입력 → 6·7절, 5 번역 주소 → 8절, 6 시험과 증거 → 13·14절, 7 목업 → 12절 |

## 1. 목표와 완료 조건

- 사진·도판·스크린샷을 PDF처럼 라이브러리에 넣고, 탭에서 맞춰 보고 확대·이동·회전하며, 다시 열면 보던 자리다.
- 빠른 검색이 PDF 본문까지 찾는다. 어느 쪽에 있는지 항목 패널이 보여 주고, 누르면 그 쪽에서 리더가 열려 같은 말을 찾는다.
- M5·M6에서 넘어온 성능 줄을 예산 안으로 되돌린다.
- 완료 조건:
  - Linux CI 녹색, Mac `all`(증거·기능 E2E·데모 영상), Mac 디자인 비평 blocker/major 0건(라이트·다크 프레임 모두).
  - 이미지: 5종을 파일 머리로 판별해 가져오고(확장자가 틀려도), 열고, 창에 맞춤 · 너비에 맞춤 · 실제 크기 · ⌘+/⌘−/⌘0 · 핀치 · 끌기 · 화살표 · ⌘R/⌘L · 배경 셋이 되고, 탭을 닫았다 열거나 SIGKILL 뒤 다시 실행해도 같은 확대·중심·회전이다(E2E). 그릴 수 없는 파일은 리더 안의 끝 상태다(E2E). 진행 열은 한 번 열면 100%다(E2E).
  - 마이그레이션 003→004: 실데이터 형태의 v3 DB에서 모든 행·rowid·외래 키가 그대로이고 `foreign_key_check`가 비며, `'slide'` 앵커는 `'slides'`가 된다(단위). 실패하면 v3 그대로이고 외래 키가 다시 켜진다(단위).
  - 본문 검색: 범위 '정보와 본문'에서 표가 정보 일치 ∪ 본문 일치이고, 항목 패널 '본문 일치' 절이 쪽 번호와 문맥 조각(최대 20개)을 보이며, 누르면 그 쪽에서 찾기가 켜진 채 열린다(E2E). 한국어 2글자·NFD 본문·대소문자·발음 부호(단위 + E2E). 휴지통 자료는 본문 일치에서 빠지고, 영구 삭제하면 쪽 글도 지워진다(E2E). 추출 중 SIGKILL 뒤 다시 실행하면 이어서 끝낸다(E2E).
  - 성능 예산(13절) 안 — 새 줄 "PDF 1,000개에서 본문 검색 p95 ≤ 300ms" 포함.
  - ADR-0012에 번역 주소 재확인(문서 조사)이 적혀 있고, 소유자가 돌릴 명령이 `next-session.md`에 있다.

## 2. 범위

**M7c 안**
1. 이미지 자료: 형식 판별·크기 읽기·종류 `image`가 닿는 곳(3절).
2. 마이그레이션 004와 "외래 키를 끄고 도는 마이그레이션" 실행기(3.3).
3. 이미지 리더(4절), `image` 앵커 형식과 검증(4.5), 항목 패널의 미리보기(4.6).
4. PDF 본문 검색: 추출 작업·`utilityProcess` 일꾼·쪽별 글자 표·FTS5 trigram 색인·질의·화면(5절).
5. 성능 항목(6절), M7b에서 넘긴 셋(7절), 번역 주소 재확인 문서(8절).

**하지 않는 것**
- 이미지: SVG(스크립트를 품는 문서), HEIC·HEIF·TIFF(M14 변환·OCR), RAW, 여러 장을 한 자료로 묶기, 이미지 편집(자르기·저장되는 회전), 슬라이드쇼·다음/이전 이미지, 영역 선택 UI와 앵커를 만드는 화면(M9 필기·T1 그림 칩), 이미지의 OCR(M14), 리더의 이미지 정보 인스펙터(동영상 리더처럼 없다 — 4.1).
- 검색: 별도 검색 화면, 팔레트(⌘K)의 본문 검색, 자막·노트 본문(M8·M9), 동영상·이미지의 본문, 결과의 관련도 순위(표의 정렬을 따른다), 정규식·구문 검색 문법, 암호 PDF의 본문(암호를 저장하지 않는다), 실패한 추출을 다시 돌리는 단추(5.8의 상태 표시만), `extracted_chunks`(인용 단위 — T1).
- 리더: R29(같은 프레임의 잔여 — pdf.js 내부에 기대야 해서 그대로), 트랙패드 두 손가락 쓸기.
- M7b 입력 가운데 승인한 셋 밖의 것: `getByTestId` 패치의 빈틈, 위치 표본기의 reload, 읽기 절 영상 줄의 E2E(다음 시험 작업).

## 3. 이미지 자료와 마이그레이션 004

### 3.1 형식 판별 (`packages/library/src/sniff.ts`)
지금은 PDF·ISO BMFF 동영상·Matroska/WebM만 알고, `ftyp`의 `avif`·`heic` 계열 브랜드는 `NOT_VIDEO_BRANDS`로 거절한다(`sniff.ts` 17·24줄). 처음 512바이트(`HEAD_BYTES`)로 판별하는 구조는 그대로 두고 다섯을 더한다. 확장자는 보지 않는다.

| 형식 | 판별 바이트 | `mime` |
|---|---|---|
| PNG(APNG 포함) | 0–7 = `89 50 4E 47 0D 0A 1A 0A` | `image/png` |
| JPEG | 0–2 = `FF D8 FF` | `image/jpeg` |
| GIF | 0–5 = `GIF87a` 또는 `GIF89a` | `image/gif` |
| WebP | 0–3 = `RIFF`, 8–11 = `WEBP`, 12–15 = `VP8 ` · `VP8L` · `VP8X` 중 하나 | `image/webp` |
| AVIF | 4–7 = `ftyp`이고 주 브랜드(8–11)가 `avif`·`avis`, 또는 주 브랜드가 `mif1`·`msf1`이고 호환 브랜드에 `avif`·`avis`가 있으며 `heic`·`heix`·`heim`·`heis`·`hevc`·`hevx`가 없을 때 | `image/avif` |

- `ftyp` 분기는 AVIF를 먼저 보고, 아니면 지금의 동영상 판정이다. HEIC은 그대로 거절한다. (컨트롤러 판정 J1: HEIF 계열은 `mif1`을 함께 쓰므로 호환 브랜드의 HEVC 표시로 갈라야 HEIC이 AVIF로 들어오지 않는다)
- 거절 문구에 이미지를 더한다(11절). 열기 패널의 형식 필터(`ipc/library.ts` `IMPORT_FILTERS`)에 `png jpg jpeg webp gif avif`, `openable.ts`의 `EXTENSIONS`에 다섯 MIME(`jpeg`는 `['jpg','jpeg']`), 사본 내보내기 필터 이름(`main/strings.ts` `exportCopy.filterName`)에 `image: '이미지'`.

### 3.2 크기 읽기 (새 `packages/library/src/image-size.ts`)
- 가져오기의 `settle`(`importer.ts`)이 커밋 전에 원본 파일의 **처음 1 MiB**(작으면 전체)를 한 번 읽어 순수 함수 `imageSize(head: Uint8Array, mime): { width, height } | null`에 준다. 새 의존성 없음. 모든 읽기는 범위 검사를 거치고, 길이·오프셋이 버퍼를 넘으면 그 자리에서 `null`이다(예외 없음).
- 형식별로 읽는 바이트:
  - **PNG**: 8–11 = 길이 13, 12–15 = `IHDR`, 16–19 가로 · 20–23 세로(u32 BE).
  - **GIF**: 6–7 가로 · 8–9 세로(u16 LE, 논리 화면).
  - **WebP**: `VP8 ` → 23–25 = `9D 01 2A`, 26–27 가로 · 28–29 세로(u16 LE의 아래 14비트). `VP8L` → 20 = `0x2F`, 21–24의 u32 LE `b`에서 가로 = `(b & 0x3FFF) + 1`, 세로 = `((b >>> 14) & 0x3FFF) + 1`. `VP8X` → 24–26 가로−1 · 27–29 세로−1(u24 LE).
  - **JPEG**: 2부터 세그먼트를 걷는다(`FF` 채움 바이트 건너뜀, `D0–D7`·`01`은 길이 없음, 나머지는 u16 BE 길이). SOF(`C0–C3 C5–C7 C9–CB CD–CF`)의 정밀도 다음 세로(u16 BE)·가로(u16 BE). SOF 앞의 APP1이 `Exif\0\0`이면 TIFF 머리(`II*\0`/`MM\0*`) → IFD0의 항목(12바이트씩)에서 태그 `0x0112`(SHORT) 방향을 읽고, **5–8이면 가로·세로를 바꾼다**. SOS(`DA`)를 만나면 멈춘다.
  - **AVIF**: `meta`(전체 상자) 안의 `pitm`(주 항목 id, 판 0은 u16·1은 u32) → `iprp`/`ipma`(그 항목의 속성 번호: 플래그 비트 0이면 u16 아니면 u8, 맨 위 비트는 essential, 1부터 셈) → `ipco`의 그 번호 상자 가운데 `ispe`(가로·세로 u32 BE)와 `irot`(각도 & 3이 홀수면 바꿈). 상자 크기 0·1(64비트)·버퍼 밖은 `null`. (컨트롤러 판정 J2: 가장 큰 `ispe`를 고르는 어림 대신 `pitm`·`ipma`를 따르는 쪽이 격자·썸네일·알파 판이 섞인 파일에서도 맞고 40줄 남짓이다)
- 저장: `assets`에 `width`·`height` 열(마이그레이션 004). 한 변이 1–1,000,000 밖이면 둘 다 `NULL`. 크기를 읽지 못해도(`NULL`) **가져오기는 성공한다** — 그릴 수 있는지는 리더가 말한다(4.1 끝 상태). (컨트롤러 판정 J3: 손상된 PDF도 가져오고 리더가 말하는 지금 규칙과 같게 — 판별은 머리의 마법 바이트로 이미 끝났다)
- 저장한 크기는 **표시용**(항목 패널 "이미지 · 4032 × 3024", 디코드 전 자리 잡기)이다. 리더는 디코드한 `naturalWidth/Height`(Chromium이 `image-orientation: from-image`로 EXIF 방향을 적용한 값)를 정본으로 쓴다. 둘이 다르면(EXIF 밖의 방향 정보) 리더 값이 이긴다.
- 크기는 sha가 같은 파일의 성질이다. 다시 연결(`relinkAsset`)은 같은 sha만 받으므로(`availability.ts` 35–45줄) 다시 읽을 일이 없다.

### 3.3 마이그레이션 004와 실행기
**왜 표를 다시 만드나**: SQLite는 CHECK를 고칠 수 없다. `items.type` CHECK는 `('pdf','video','epub','slides','web')`, `anchors.kind` CHECK는 `('pdf','video','epub','web','slide')`다(`001-initial.ts`). 003은 `annotations.anchor_id … ON DELETE RESTRICT` 때문에 열만 더했다(`003-anchors-translation.ts` 머리 주석, ADR-0009 P-11) — 앱의 마이그레이션이 외래 키를 켠 트랜잭션 안에서 돌기 때문이다(`connection.ts`의 `foreign_keys = ON`, `migrate.ts`의 `db.transaction`). 승인한 설계대로 CHECK를 버리지 않고(zod만으로 지키면 DB 불변식이 약해진다) `writable_schema` 편집도 하지 않는다.

**실행기** (`packages/db/src/migrate.ts`, `migrations/index.ts`)
- `Migration`에 선택 필드 `foreignKeysOff?: true`를 더한다. 004만 켠다.
- 그런 마이그레이션은: (1) 트랜잭션 **밖에서** `PRAGMA foreign_keys = OFF`(트랜잭션 안에서는 효과가 없다) → `PRAGMA foreign_keys`가 0인지 읽어 확인(아니면 `MIGRATION_FAILED`), (2) 지금처럼 `db.transaction` 안에서 SQL 실행, (3) 같은 트랜잭션 안에서 커밋 전에 `PRAGMA foreign_key_check` → 한 행이라도 있으면 던져서 되돌린다(문구는 지금의 실패 문구 그대로: "v4 업데이트에 실패했습니다. 데이터베이스는 v3 상태입니다. …"), (4) `schema_migrations` 행, (5) 성공·실패 모두 `finally`에서 `PRAGMA foreign_keys = ON`. `db.inTransaction`이면 거절한다.
- 백업은 기존 그대로: 대기 중인 첫 마이그레이션 앞에서 `VACUUM INTO`로 `library.sqlite.pre-v4.bak`(`migrate.ts` 37–38줄, `update-backup.ts`의 이름 규칙).
- 외래 키 설정은 연결마다다. 마이그레이션 도중 앱이 죽으면 SQLite 저널이 트랜잭션을 되돌리고, 다음 연결은 `openDatabase`가 다시 켠다.

**004 SQL 개요** (`migrations/004-images-text.ts`, 이름 `images-text`)
```sql
-- 1. items: type CHECK에 'image'. rowid를 지킨다 — 정렬의 동점 처리가 i.rowid를 쓴다
--    (library-repository.ts 143·161·237·396·448줄, collections-repository.ts 164줄).
CREATE TABLE items_v4 (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('pdf','video','epub','slides','web','image')),
  title TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
INSERT INTO items_v4 (rowid, id, type, title, metadata_json, created_at, updated_at, deleted_at)
  SELECT rowid, id, type, title, metadata_json, created_at, updated_at, deleted_at FROM items;
DROP TABLE items;                              -- 외래 키가 꺼져 있어 자식 행(CASCADE)이 지워지지 않는다
ALTER TABLE items_v4 RENAME TO items;          -- 자식의 REFERENCES items(id)가 새 표를 가리킨다
CREATE INDEX items_deleted_at ON items(deleted_at);   -- 002의 색인

-- 2. anchors: 'slide' → 'slides', 'image' 더함. 열 순서는 003 뒤 그대로. rowid를 지킨다(listByRevision ORDER BY rowid).
CREATE TABLE anchors_v4 (
  id TEXT PRIMARY KEY,
  revision_id TEXT NOT NULL REFERENCES source_revisions(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('pdf','video','epub','web','slides','image')),
  locator_json TEXT NOT NULL,
  quote TEXT,
  status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','review','orphan')),
  schema_version INTEGER NOT NULL,
  precision TEXT NOT NULL DEFAULT 'span' CHECK (precision IN ('item','span','region')),
  text_json TEXT
);
INSERT INTO anchors_v4 (rowid, id, revision_id, kind, locator_json, quote, status, schema_version, precision, text_json)
  SELECT rowid, id, revision_id,
         CASE kind WHEN 'slide' THEN 'slides' ELSE kind END,
         CASE WHEN kind = 'slide' AND json_valid(locator_json) THEN json_set(locator_json, '$.kind', 'slides') ELSE locator_json END,
         quote, status, schema_version, precision, text_json
  FROM anchors;
DROP TABLE anchors;
ALTER TABLE anchors_v4 RENAME TO anchors;      -- annotations.anchor_id(RESTRICT)가 새 표를 가리킨다
CREATE INDEX anchors_revision ON anchors(revision_id);  -- 002의 색인

-- 3. 이미지 크기(3.2)
ALTER TABLE assets ADD COLUMN width INTEGER CHECK (width IS NULL OR width > 0);
ALTER TABLE assets ADD COLUMN height INTEGER CHECK (height IS NULL OR height > 0);

-- 4. 쪽별 글자 표와 색인(5.5)
CREATE TABLE page_texts (
  id INTEGER PRIMARY KEY,
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  page_index INTEGER NOT NULL CHECK (page_index >= 0),
  text TEXT NOT NULL,
  UNIQUE (sha256, page_index)
);
CREATE VIRTUAL TABLE page_texts_fts USING fts5(
  text, content = 'page_texts', content_rowid = 'id', tokenize = 'trigram remove_diacritics 2'
);
CREATE TRIGGER page_texts_ai AFTER INSERT ON page_texts BEGIN
  INSERT INTO page_texts_fts(rowid, text) VALUES (new.id, new.text);
END;
CREATE TRIGGER page_texts_ad AFTER DELETE ON page_texts BEGIN
  INSERT INTO page_texts_fts(page_texts_fts, rowid, text) VALUES ('delete', old.id, old.text);
END;
CREATE TRIGGER page_texts_au AFTER UPDATE ON page_texts BEGIN
  INSERT INTO page_texts_fts(page_texts_fts, rowid, text) VALUES ('delete', old.id, old.text);
  INSERT INTO page_texts_fts(rowid, text) VALUES (new.id, new.text);
END;

-- 5. 아무도 소비하지 않은 v0 추출 작업(5.1)
DELETE FROM jobs WHERE kind = 'extract' AND dedupe_key LIKE 'extract:%:text-v0';
```
- **순서가 규칙이다**: 새 표를 만들고 → 옮기고 → 옛 표를 지우고 → 새 표의 이름을 바꾼다. 옛 표의 이름을 먼저 바꾸면(`items` → `items_old`) SQLite 3.26+는 외래 키가 꺼져 있어도 자식 표의 `REFERENCES`를 `items_old`로 고쳐 쓴다 — 그러면 지운 표를 가리키게 된다. 번들된 SQLite는 3.53.4다(명세 작성 중 `better-sqlite3` 13.0.3에서 `sqlite_version()`).
- 자식 표: `items`는 `item_assets`·`collection_items`·`item_tags`·`reading_positions`(모두 `ON DELETE CASCADE`), `anchors`는 `annotations`(RESTRICT)가 가리킨다. 트리거·뷰는 지금 없다(`packages/*/src`·`apps/desktop/src`에 `CREATE TRIGGER`/`VIEW` 없음).
- 명세 작성 중 확인(스크래치, 저장소 밖): 001–003의 SQL로 만든 합성 v3 DB(휴지통 자료·소속·태그·위치·pdf/`'slide'`/JSON 아닌 앵커·RESTRICT annotation·`text-v0` 작업)에 위 SQL을 외래 키를 끄고 한 트랜잭션으로 돌렸다: `foreign_key_check` 빈 배열, `items`·`anchors`의 rowid 그대로, 자식 표의 `foreign_key_list`가 `items`·`anchors`, `'image'` 받음 · `'slide'` 거절, RESTRICT·CASCADE 동작, FTS 트리거 넣기·지우기, `integrity_check` ok.
- 앵커 스키마 번호 `ANCHOR_SCHEMA_VERSION`(`anchors.ts`, 지금 2)은 그대로 둔다. 좌표 규칙이 바뀌지 않고, 이름이 바뀐 행은 004가 locator까지 고친다. (컨트롤러 판정 J4: ADR-0002의 `schema_version`은 좌표 규칙의 판이다)

### 3.4 실데이터에서의 동작
- 실제 v3 라이브러리의 `items.type`은 `pdf`·`video`뿐이고(가져오기가 만드는 종류), 앵커는 앵커 스파이크 E2E 프로필에만 있다(만드는 화면이 없다 — `next-session.md` "그대로 두는 것"). `annotations`는 비어 있다(필기는 M9). 그래도 004는 `'slide'` 행을 열과 `locator_json`의 `kind` 둘 다 `'slides'`로 고친다(`anchors-repository.ts`의 `toRecord`가 `locator_json`을 펼쳐 zod로 읽으므로 열만 고치면 읽히지 않는다). `locator_json`이 JSON이 아니면 그대로 옮긴다(읽을 때 `ANCHOR_INVALID` 경고 — 지금과 같다).
- `jobs`: 지금 가져오기가 모든 자료(동영상 포함)에 `extract:<sha256>:text-v0` 작업을 `queued`로 넣는다(`importer.ts` `EXTRACTOR_VERSION`, `insertImported`의 `INSERT … ON CONFLICT DO NOTHING`). 소비한 코드가 없으니 004가 지우고, 5.1의 채워 넣기가 PDF에만 새 작업을 만든다.
- 시간: 1만 항목의 `items` 다시 만들기는 1초 안(단위 시험의 상한, 13절 보고값).

### 3.5 종류 `image`가 닿는 곳
- 도메인: `ItemType = 'pdf' | 'video' | 'image'`(`library.ts`), `LibraryItem.imageSize: { width; height } | null`(이미지이고 크기를 알 때만; `ITEM_FROM`에 `a.width, a.height`), `IMAGE_FORMATS = 'PNG\u00a0·\u00a0JPEG\u00a0·\u00a0WebP\u00a0·\u00a0GIF\u00a0·\u00a0AVIF'`(`VIDEO_FORMATS`와 같은 결합 규칙), `savedTabItemSchema.type`에 `'image'`(`settings.ts`), `startLocator('image')` = `{ kind: 'image' }`(`reading-repository.ts` — 지금은 그 밖의 종류에 `VALIDATION_FAILED`).
- 렌더러에서 `'pdf' | 'video'`로 가르는 곳: 아이콘(lucide `image`) — `LibraryTable.tsx` 146, `Palette.tsx` 283, `TabBar.tsx` 183, `DragPreview.tsx` 14, `InfoPane.tsx` 131, `InfoHead.tsx` 38, `TrashInfo.tsx` 65, `DuplicateSheet.tsx` 53; 종류 이름 `t.library.type.image = '이미지'`; 정렬 `sort.ts` 37 `TYPE_ORDER = { pdf: 0, video: 1, image: 2 }`(가나다 순서와 같다); 통계 줄 `summary.ts`(이미지 개수); 드롭 요약 `shell/drop.ts`(`image/png|jpeg|webp|gif|avif`만 이미지, 나머지 `image/*`는 기타); 탭 종류 `state/tabs.ts` 112 · `shell/useTabItem.ts` 10; `inspector/fileFacts.ts` 70(지금은 PDF가 아니면 동영상으로 탐침한다 — 이미지는 탐침하지 않고 `imageSize`를 쓴다); `readingLine.ts`(이미지 줄, 11절); `ViewerHost.tsx` 125·133(리더 고르기와 빈 틀); `ReaderTabs.tsx` 60의 포커스 대상에 `.image-stage`.

## 4. 이미지 리더

### 4.1 화면과 상태
- 리더 탭 안에서 연다(M7b 탭 규칙 그대로: ↩는 그 탭으로, ⌘↩는 뒤에서, 살려 둔 탭 4개, 가린 탭은 `hidden` + `inert`).
- 구성: 리더 도구 막대 44(가운데 확대 필드 + ▾, 오른쪽 보기 ▾) 위에 무대 `.image-stage`(`role="region"`, `tabIndex=0`, 이름 "이미지"). 뒤로/앞으로 · 쪽 필드 · 찾기 · 항목 패널 토글은 없다(이미지에는 기록·쪽·글이 없다). 오른쪽 정보 인스펙터는 동영상 리더처럼 없다. (컨트롤러 판정 J5: 승인한 설계에 리더의 정보 패널이 없고, 번역 절처럼 쓸 것이 없다 — `view.toggleInspector`는 지금처럼 PDF에서만 켜진다)
- 왼쪽 사이드바는 '쪽 없음' 안내 "이미지에는 쪽이 없습니다"(아이콘 `image`)다. `ViewerHost`에 `noPages: 'image'`를 새로 두고, 이미지 탭은 여는 중·그림·그릴 수 없음·원본 없음·휴지통 모두에서 이 줄을 쓴다(이미지 탭은 `'trashed'`보다 먼저 고른다 — 동영상 탭의 동작은 그대로). 사이드바를 자동으로 접지 않는다(탭마다 탭 줄이 움직이는 것을 피함, 디자인 명세 2.3). 목업 승인(R22).
- 상태:
  | 상태 | 화면 |
  |---|---|
  | 여는 중 | 무대 바탕만, 도구 막대의 컨트롤은 비활성(확대 필드 "…"), 툴팁 "이미지를 여는 중입니다". 저장된 자리를 적용하기 전에는 그림을 보이지 않는다(PDF처럼 첫 프레임이 다른 자리를 보이지 않게) |
  | 그림 | 저장된 확대·중심·회전으로 그림 |
  | 그릴 수 없음 | `img.decode()`가 거절하거나 `error` — 끝 상태 Notice(아이콘 `image-off`, 제목 "이 이미지를 표시할 수 없습니다", 원인 + 다음 행동, 파일 이름·크기, Finder에서 보기 · 기본 앱으로 열기 — `ReaderNotices.tsx`의 `PdfErrorNotice`·`FileButtons`와 같은 모양). 도구 막대 없음 |
  | 원본 없음 · 휴지통 | 지금의 `MissingNotice`·`TrashedNotice` 그대로 |
- 가린 탭: 크기 관찰에 반응하지 않고, 다시 보일 때 무대 크기가 바뀌었으면 맞춤 모드만 한 번 다시 맞춘다(M7a N-1 규칙). GIF·APNG·AVIF 애니메이션은 Chromium이 그대로 돌린다(숨은 탭은 그리지 않는다).

### 4.2 확대 · 맞춤
- 모드 셋: **창에 맞춤**(기본) · **너비에 맞춤** · 숫자 배율(실제 크기 = 1 = 이미지 픽셀 하나가 CSS 픽셀 하나). 맞춤은 회전을 반영한 상자로 계산하고 사방 24를 남긴다(M7a 쪽 배치의 24와 같다).
- 창에 맞춤은 작은 이미지를 키우지 않는다(배율 = min(1, 맞춤)). 너비에 맞춤은 키운다. (컨트롤러 판정 J6: 아이콘·스크린샷이 흐릿하게 커지지 않게 하는 Preview·Quick Look의 기본과 같고, 너비 맞춤은 사용자가 고른 채움이다)
- 배율 범위 5–800%, ⌘+/⌘−의 계단 `0.05 0.1 0.17 0.25 0.33 0.5 0.67 0.75 1 1.25 1.5 2 3 4 6 8`. 확대 필드는 퍼센트를 입력받아 5–800으로 자른다. (컨트롤러 판정 J7: 큰 사진의 창 맞춤이 10% 근처라 PDF의 25% 바닥으로는 맞춤보다 작게 볼 수 없다)
- 확대 ▾: 창에 맞춤 · 너비에 맞춤 · 실제 크기 ⌘0 · — · 확대 ⌘+ · 축소 ⌘−(지금 모드에 체크). PDF의 퍼센트 다섯은 두지 않는다(승인한 설계에 없음 — 목업에서 원하면 더한다).
- ⌘+/⌘−는 무대 가운데를 지키고, 핀치(`wheel` + `ctrlKey`)는 포인터 아래 점을 지킨다(배율 계수 `exp(-deltaY/100)`, `pdf/zoom.ts`의 `pinchScaleFactor`와 같은 식, 범위만 5–800%). 맞춤 모드에서 확대하면 숫자 배율이 된다.
- 창·패널 크기가 바뀌면 맞춤 모드만 다시 맞추고 숫자 배율은 그대로(M7a I-1과 같은 규칙, 프레임당 한 번).
- 계산은 순수 함수 `viewers/image/imageFit.ts`(맞춤 배율, 회전한 상자, 중심 ↔ 스크롤 변환, 자르기)로 둔다(단위 시험).

### 4.3 이동 · 회전 · 배경
- 무대는 보통의 스크롤 영역이다: 화살표·PageUp/PageDown·스페이스·Home/End는 브라우저 기본 스크롤(화살표 40px), 트랙패드·휠도 그대로 스크롤한다. 그림이 무대보다 클 때만 왼쪽 단추 끌기로 옮긴다(커서 `grab`/`grabbing`, 포인터 캡처). 그림이 다 들어오면 끌기도 커서도 없다. 맞춤 모드에서는 그림이 무대 가운데다.
- 회전: ⌘R / ⌘L(PDF와 같은 명령, 9절), 90° 단위, 보기만 바뀌고 파일은 그대로다. 회전 뒤에도 같은 이미지 점이 무대 가운데다.
- 배경(보기 ▾의 "배경" 묶음): **밝게 / 어둡게 / 체크무늬**. 설정 `reader.imageBackground`(라이브러리마다, 모든 이미지에 하나). 값이 없으면 앱 테마를 따른다(라이트 → 밝게, 다크 → 어둡게) — 메뉴의 체크는 그때 쓰이는 값이다. 체크무늬는 8px 두 색. 그림에는 테두리·그림자를 두지 않는다(목업에서 확인). (컨트롤러 판정 J8: 쪽 색의 '앱 테마 따르기'처럼 처음 쓰는 사람에게 테마와 어긋나지 않게 하되, 승인한 세 값 밖의 네 번째 메뉴 행은 만들지 않는다)
- 보기 ▾(웹 팝업): 머리 "배경" + 밝게 / 어둡게 / 체크무늬(지금 값에 체크) · — · 시계 방향으로 회전 ⌘R · 반시계 방향으로 회전 ⌘L — PDF 보기 ▾의 쪽 색 묶음과 같은 펼친 묶음이다(하위 메뉴 없음, R20). 메뉴 막대 보기 메뉴에는 "배경 ▸" 하위 메뉴(쪽 색 ▸와 같은 규칙 — 네이티브 하위 메뉴에는 체크 없음, P-14).

### 4.4 자리 기억과 진행
- `readingLocatorSchema`(`reading.ts`)의 판별 유니언에 셋째 모양을 더한다(마이그레이션 없음, `locator_json`):
  ```ts
  z.object({
    kind: z.literal('image'),
    /** absent = 'fit' */
    zoom: z.union([z.enum(['fit', 'width']), z.number().min(0.05).max(8)]).optional(),
    /** 무대 가운데에 있는 이미지 점, 회전 전 이미지(EXIF 방향 적용 뒤)의 0–1 좌표. absent = 0.5 */
    cx: z.number().min(0).max(1).optional(),
    cy: z.number().min(0).max(1).optional(),
    rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).optional(),
  })
  ```
  중심을 이미지 좌표로 두어 창 크기가 달라도 같은 곳을 보인다. 창에 맞춤에서는 중심을 쓰지 않는다(가운데). (컨트롤러 판정 J9: 스크롤 픽셀은 창 크기에 묶이고, ADR-0002의 "화면 픽셀 저장 금지"와도 맞는다)
- 저장: 확대·스크롤·회전이 바뀔 때 300ms 묶음(`usePosition`, PDF의 `PAGE_SAVE`와 같다), 탭을 내릴 때와 `beforeunload`에 마지막 값. 기본값(맞춤 · 가운데 · 0°)은 필드를 뺀다.
- 진행: `reader.open`이 행을 만들고(`markOpened`, 진행 `NULL`), 그림이 처음 그려지면 리더가 진행 1을 저장한다 → 진행 열 "✓ 완료", 읽기 절도 "✓ 완료"(M7b R21). 그릴 수 없는 파일은 100%가 되지 않는다. (컨트롤러 판정 J10: '한 번 열면'을 '그림이 한 번 보이면'으로 — 원본 없음·손상 파일이 읽음으로 셈되지 않게)

### 4.5 `image` 앵커 (형식과 검증만)
- `anchors.ts`:
  ```ts
  export const imageAnchor = z
    .object({
      kind: z.literal('image'),
      revisionId: z.uuid(),
      precision: z.literal('region'),
      /** [x, y, w, h]: 회전 전 이미지(Chromium이 EXIF 방향을 적용해 그린 0° 그림)의 0–1 좌표, 왼쪽 위 원점, y 아래로 */
      rect: z.tuple([unit, unit, unit, unit]),
    })
    .refine((a) => a.rect[2] > 0 && a.rect[3] > 0, { message: 'rect has an area' })
    .refine((a) => a.rect[0] + a.rect[2] <= 1 + 1e-9 && a.rect[1] + a.rect[3] <= 1 + 1e-9, { message: 'rect must stay inside the image' });
  ```
  `sourceAnchor` 유니언에 더하고, `slideAnchor.kind`는 `'slides'`가 된다. `precision`은 `'region'`만(이미지 전체는 `[0,0,1,1]`). `text`는 없다(ADR-0009 판정 표의 region 규칙). (컨트롤러 판정 J11: 영역 하나 — 펜·여러 영역은 M9에서 필드를 더한다)
- 리더의 보기 회전은 좌표에 영향이 없다(PDF quad와 같은 원칙). 화면 픽셀을 저장하지 않는다(ADR-0002).
- 저장소: `AnchorsRepository.precisionOf`가 `image`·`slides`를 `'region'`으로, `quote` 열은 `NULL`. 만드는 UI·IPC는 없다(M9·T1). 시험: zod(경계·면적·밖으로 넘침·소수 오차), 저장소 왕복(만들기·읽기·`listByRevision`), 004 뒤 `'slides'` 행 읽기.

### 4.6 항목 패널의 미리보기 (라이브러리)
- 이미지 자료 하나를 고르면 머리 맨 위에 작은 미리보기(폭은 패널 내용 폭, 높이 최대 160, 비율 유지, 체크무늬 없이 `--bg-sunken` 바탕, `loading="lazy"` · `decoding="async"`, `alt`는 제목). 종류 줄은 "이미지 · 4032 × 3024"(크기를 모르면 "이미지").
- 5,000만 화소를 넘는 이미지와 그릴 수 없는 이미지는 미리보기 대신 아이콘 칸(`image` / `image-off`). (컨트롤러 판정 J12: 패널을 지날 때마다 거대한 원본을 디코드하지 않게 — Chromium은 전체를 디코드한 뒤 줄인다)
- 여러 개 선택·휴지통 보기에는 미리보기가 없다. 리더에는 패널이 없다(4.1).

## 5. PDF 본문 검색

### 5.1 추출 작업 (`jobs` 표)
- 작업 하나 = 파일 하나: `kind = 'extract'`, `dedupe_key = 'extract:<sha256>:pdf-text-1'`(파일 해시 + 추출기 버전). 옵션은 지금 없어 키에 넣지 않는다 — 생기면 `:<옵션>`을 붙인다. `importer.ts`의 `EXTRACTOR_VERSION`을 `'pdf-text-1'`로 바꾸고 **PDF만** 작업을 넣는다(동영상·이미지는 넣지 않는다). `dedupe_key`의 UNIQUE와 `ON CONFLICT DO NOTHING`이 중복을 막는다 — 같은 파일의 사본·외부 연결·중복 자료도 작업은 하나다. 영구 삭제의 작업 지우기(`trash.ts` 165줄의 `substr(dedupe_key, …)`)는 이 키 모양을 그대로 쓴다. (컨트롤러 판정 J13: 버전 이름에 형식을 넣어 M8의 자막 추출과 겹치지 않게)
- 상태: `queued` → `running` → `done`(글자를 저장함, 비어 있음 포함) | `failed`. `interrupted`는 시작 때 `queued`로 되돌린다. `payload_json` = `{ sha256, type: 'pdf', nextPage, pages, chars, truncated }`, `progress` = `nextPage / pages`, `error` = 실패 이유(5.3), `attempts` = 시작한 횟수.
- **채워 넣기(기존 PDF)**: 일꾼을 처음 깨울 때마다(5.2) 한 문장으로 모든 PDF 자료(휴지통 포함)의 sha 가운데 이 버전의 작업이 없는 것에 `queued` 작업을 넣는다(`INSERT INTO jobs … SELECT DISTINCT a.sha256 … WHERE i.type = 'pdf' … ON CONFLICT(dedupe_key) DO NOTHING`). 그래서 백업에서 복원한 라이브러리와 004 이전에 가져온 PDF도 같은 길로 색인된다.
- **고르는 순서**: 최근에 만든 작업부터(`created_at DESC, rowid DESC`), 휴지통이 아닌 PDF 자료가 하나라도 있는 sha만. (컨트롤러 판정 J14: 방금 가져온 논문을 먼저 찾을 수 있게)
- **언제 도나**: 한 번에 하나. 주 창이 처음으로 유휴를 알린 뒤(`ui:reportIdle`, 설정 창을 미리 만드는 그 신호) 5초가 지나야 시작하고, main의 작업 줄(가져오기·백업·복원, `jobs/lane.ts`)이 바쁜 동안에는 새 작업을 시작하지 않는다(도는 작업은 끝까지 간다). 새 PDF를 가져오면 그 가져오기 실행이 끝난 뒤 이어서 돈다. 일꾼 프로세스는 낮은 우선순위(`os.setPriority(pid, PRIORITY_BELOW_NORMAL)`)다. (컨트롤러 판정 J15: 냉시작 예산 1.5초와 첫 화면에서 벗어나고, 디스크를 가져오기와 나누지 않게)

### 5.2 `utilityProcess` 일꾼과 메시지
- 새 진입점 `apps/desktop/src/main/text/worker.ts` → `out/main/text-worker.js`(`electron.vite.config.ts`의 `main.build.rollupOptions.input`에 더한다). main의 `text/extractor.ts`가 `utilityProcess.fork(worker, [], { serviceName: 'Learn 본문 색인', execArgv: ['--max-old-space-size=1024'], stdio: 'pipe' })`로 띄운다. 일꾼은 **DB를 만지지 않는다** — 쓰는 것은 main 하나(지금의 단일 쓰기 규칙).
- pdf.js: `pdfjs-dist` 6.4.299의 `build/pdf.mjs`와 `build/pdf.worker.mjs`를 일꾼 번들에 넣고, `globalThis.pdfjsWorker = <pdf.worker 모듈>`을 먼저 둔 뒤 `getDocument`를 부른다(같은 프로세스 안의 '가짜 일꾼'). `utilityProcess`에서는 `process.type === 'utility'`라 pdf.js의 `isNodeJS`가 거짓이다(`pdf.mjs` 28줄) — 그래서 Node 전용 팩터리가 아니라 DOM 팩터리가 기본이 된다. 이를 피하는 옵션: `data`(일꾼이 파일을 읽은 `Uint8Array`), `BinaryDataFactory`(일꾼의 `fs`로 `cmaps/`·`standard_fonts/`를 읽는 작은 클래스 — 파일 이름은 `[A-Za-z0-9._-]+`만, 폴더 밖 거부), `useWorkerFetch: false`, `isOffscreenCanvasSupported: false`, `isImageDecoderSupported: false`, `useWasm: false`, `disableFontFace: true`, `useSystemFonts: false`, `enableXfa: false`, `verbosity: ERRORS`. 쪽 글은 `page.streamTextContent()`(기본 정규화 — 합자 `ﬁ` → `fi`)로 받아 쪽 한도에서 끊는다. 끝나면 `loadingTask.destroy()`.
  - **명세 작성 중 확인**(스크래치 스파이크, 저장소 밖): Electron 44.9.1의 `utilityProcess`(`process.type` `'utility'`, Node 24.22.0, `Worker`·`window`·`document` 없음)에서 위 방식으로 `sample.pdf` 세 쪽의 글을 뽑았다. `PDFDocumentProxy.destroy`는 6.4.299에 없다 — `loadingTask.destroy()`를 쓴다.
  - 자료 폴더: main이 `out/renderer/pdfjs/`(`scripts/copy-pdfjs-assets.mjs`가 복사하는 cmaps·standard_fonts)의 절대 경로를 넘긴다.
- 메시지(`process.parentPort` ↔ `child.postMessage`). main은 일꾼이 보낸 모든 메시지를 zod로 검사하고, 틀리면 일꾼을 죽이고 그 작업을 실패 한 번으로 센다(일꾼은 불신 입력을 다룬다).
  | 방향 | 메시지 |
  |---|---|
  | main → 일꾼 | `{ type: 'extract', jobId, file, startPage, limits: { maxPages, maxPageChars, maxDocChars, maxFileBytes }, assetsDir }` |
  | 일꾼 → main | `{ type: 'opened', jobId, pages }` · `{ type: 'pages', jobId, from, texts: string[] }`(쪽 20개 또는 50만 자까지 한 묶음) · `{ type: 'done', jobId, pages, truncated }` · `{ type: 'failed', jobId, reason: 'locked' | 'damaged' | 'too-large' }` |
- main은 `pages` 묶음마다 한 트랜잭션으로 쪽 글을 넣고(5.5) `payload.nextPage`·`progress`를 고친다. 그래서 **다시 실행하면 이어서** 한다: 시작할 때 `startPage = nextPage`.
- 일꾼의 수명: 대기열에 일이 있는 동안 하나를 살려 두고 작업을 차례로 준다. 실패·시간 초과 뒤와 50작업마다 새로 띄우고, 30초 동안 일이 없으면 내린다. 앱 종료·라이브러리 전환에서는 죽인다(도는 작업은 다음 실행에서 `interrupted` → `queued`). (컨트롤러 판정 J16: 작업마다 띄우면 PDF 1,000개에 띄우기만 몇 분이고, 하나를 끝까지 쓰면 한 파일의 메모리 누수가 남는다)

### 5.3 한도와 실패 (불신 입력)
| 한도 | 값 | 넘으면 |
|---|---|---|
| 파일 크기 | 512 MiB | 열지 않음 — `failed: too-large` |
| 쪽 수 | 앞 5,000쪽 | 거기서 멈추고 `done`, `truncated: true` |
| 쪽 하나의 글자 | 10만 자 | 그 쪽은 거기서 자름(`streamTextContent` 읽기를 취소) |
| 문서 전체 글자 | 1,000만 자 | 거기서 멈추고 `done`, `truncated: true` |
| 메시지 사이 시간 | 30초 | 일꾼을 죽이고 실패 한 번 |
| 작업 하나의 시간 | 15분 | 일꾼을 죽이고 실패 한 번(다음 시도는 `nextPage`부터 이어서) |
| 시도 | 3번 | 넷째 시작 대신 `failed: gave-up` |
- 암호 PDF(`PasswordException`) → `failed: locked`(암호를 저장하지 않으므로 다시 하지 않는다). 그 밖에 열지 못함 → `failed: damaged`. 일꾼이 죽음(종료 코드 ≠ 0)·시간 초과 → 시도 횟수만 늘고 다음에 다시. 실패한 작업을 다시 돌리는 화면은 없다(2절) — 추출기 버전이 바뀌면 새 작업이 생긴다.
- **글자 없음**: 끝까지 뽑았는데 쪽당 평균 10자 미만이면 상태는 '글자 없음(스캔본일 수 있음)'이다. 뽑은 글자는 그대로 색인한다. (컨트롤러 판정 J17: 스캐너 앱이 찍는 머리글 몇 자 때문에 스캔본이 '완료'로 보이지 않게)
- (컨트롤러 판정 J18: 한도 숫자 — 논문·교과서 한 권이 넉넉히 들어가고(5,000쪽·1,000만 자), 한 쪽의 비정상 글 흐름과 일꾼 메모리를 묶는 값. 나중에 실측으로 고친다)

### 5.4 쪽 글 정리 (일꾼, 순수 함수 `text/page-text.ts`)
- 항목을 잇는다: `str`, 줄 끝(`hasEOL`)은 줄바꿈. 그다음: 글자 사이의 줄 끝 하이픈을 지우고 잇는다(`\p{L}-\n\p{L}` → 하이픈 없이 — pdf.js 찾기와 같은 결과가 되게), 공백 덩어리(줄바꿈 포함)를 공백 하나로, 앞뒤 공백 제거, **NFC**, 제어 문자와 사설 영역 `U+E000`·`U+E001`(조각 표시, 5.6) 제거. 대소문자는 접지 않는다(조각이 원문 대소문자로 보이게 — 접기는 색인이 한다).
- main은 길이 한도와 `U+E000/E001` 제거를 한 번 더 한다(방어).

### 5.5 저장과 FTS5 색인
- `page_texts(sha256, page_index, text)` — 파일 내용(sha)마다 쪽 하나에 행 하나. 같은 파일을 쓰는 자료 여럿(사본·외부 연결·중복)이 한 벌을 나눈다. (컨트롤러 판정 J35: 판본(revision)은 자산마다라 판본으로 열쇠를 두면 사본과 외부 연결처럼 자산이 둘인 같은 내용이 두 벌이 된다 — 작업 키도 sha이고, 영구 삭제가 작업을 지우는 규칙(그 sha의 마지막 자산이 떠날 때)과 같다) 쓰기는 `INSERT`만이고 고칠 때는 지우고 다시 넣는다. 새 추출기 버전이 그 sha의 첫 묶음을 쓰는 트랜잭션에서 옛 행을 먼저 지운다.
- `page_texts_fts`: **외부 내용 표**(`content='page_texts'`) — 글은 한 번만 저장하고 `snippet()`이 내용 표에서 읽는다. (컨트롤러 판정 J34: 글을 FTS 안에 한 벌 더 두는 보통 표는 크기가 두 배이고, 내용 없는 표(`content=''`)는 `snippet()`을 못 쓴다) 동기화는 004의 트리거 셋. 토크나이저 `trigram remove_diacritics 2`: 대소문자 접기(유니코드 단순 접기 — 라틴·그리스·키릴 포함)와 발음 부호 지우기는 색인과 질의 양쪽에서 SQLite가 한다. `detail=full`(기본) — `detail=none`은 구(phrase) 질의를 거부한다.
- 명세 작성 중 확인(`better-sqlite3` 13.0.3 / SQLite 3.53.4, 스크래치): `"cafe"`가 `Café`를, `"école"`이 `ÉCOLE`을, `"σίσυ"`가 `ΣΊΣΥΦΟΣ`를 찾는다. **NFD 질의는 NFC 본문을 찾지 못한다** — 그래서 저장과 질의 모두 NFC다. `LIKE`는 ASCII만 대소문자를 무시한다(`'%éc%'`는 `ÉC`를 못 찾음). `snippet(…, 64)`는 trigram에서 약 69자.
- 크기(같은 스크래치, 합성 글 1,000개 × 12쪽 × 4,000자): DB 154.8 MB(글 약 1 + 색인 약 2). 백업·복원이 그만큼 커진다(17절 위험).

### 5.6 질의 (main, `search:body` · `search:pages`)
- 질의 → 낱말: NFC, 공백으로 나눔, 같은 낱말 하나로, 앞 8개까지. 길이는 코드 포인트로 센다(trigram도 코드 포인트로 자른다).
  - **3글자 이상**: FTS5 구(phrase) `"낱말"`(안의 `"`는 둘로) — 색인을 쓴다.
  - **2글자**: 같은 `page_texts`의 `text LIKE '%낱말%' ESCAPE '\'`(`%`·`_`·`\` 이스케이프) — 전체 훑기. ASCII는 대소문자를 무시하고 한글은 대소문자가 없다. ASCII 밖 라틴의 대소문자(예 `Éc`/`éc`)는 같지 않다고 본다(알려진 한계, 17절).
  - **1글자**: 본문에서 찾지 않는다(정보만).
  - 낱말 사이는 AND이고 **한 쪽 안에서** 모두 있어야 그 쪽이 일치한다. 1글자 낱말을 빼고 남는 것이 없으면 본문 검색을 하지 않는다. (컨트롤러 판정 J19: 쪽 단위 AND가 '본문 일치'의 쪽 목록과 같은 뜻이다 — 자료 단위 AND는 쪽 하나를 가리킬 수 없다)
- `search:body`: `SELECT DISTINCT i.id FROM page_texts_fts f JOIN page_texts p ON p.id = f.rowid JOIN assets a ON a.sha256 = p.sha256 JOIN item_assets ia ON ia.asset_id = a.id AND ia.role = 'original' JOIN items i ON i.id = ia.item_id AND i.deleted_at IS NULL AND i.type = 'pdf' WHERE page_texts_fts MATCH ? [AND p.text LIKE ? …]`. 2글자 낱말만이면 FTS 없이 `page_texts`를 `id` 범위 2,000행씩 나눠 훑고 덩어리 사이에 `setImmediate`로 main을 놓아준다. **취소**: 창마다 진행 중인 본문 검색은 하나다 — 새 `search:body`가 오면 앞의 것을 `AbortSignal`로 멈추고 앞의 것은 `CANCELLED`로 답한다(렌더러는 버린다). (컨트롤러 판정 J20: better-sqlite3는 동기라 1만 PDF의 2글자 훑기가 main을 수백 ms 잡을 수 있다 — 나눠 훑으면 메뉴·IPC가 멈추지 않고 취소할 자리가 생긴다)
- `search:pages`(항목 하나): 그 자료 원본의 sha에서 일치하는 쪽을 `page_index` 순서로 최대 20개, 각 쪽의 조각 하나, 그리고 일치한 쪽 수 전체. 조각: 3글자 이상 낱말이 있으면 `snippet(page_texts_fts, 0, char(57344), char(57345), '…', 48)`, 2글자 낱말만이면 main이 같은 규칙(ASCII 대소문자 무시)으로 첫 일치 앞 20자·뒤 28자를 낱말 경계에서 자르고 창 안의 모든 일치를 같은 표시로 감싼다. 표시 `U+E000`…`U+E001`은 렌더러가 `<mark>`로 바꾼다(HTML로 넣지 않는다). (컨트롤러 판정 J21: 48토큰 ≈ 50자 — 320 폭 패널의 두 줄)
- 렌더러: 정보 결과는 지금처럼 즉시, 본문 결과는 늦춘 질의(`useDeferredValue`)가 200ms 멈춘 뒤 `search:body`. 결과는 React Query `['search','body', query]`에 두고 `libraryChanged`의 `text`·`import`·`trash`·`restore`·`purge`에서 무효로 한다. (컨트롤러 판정 J22: 200ms — 글자마다 2글자 훑기를 하지 않되 타자를 멈추면 바로 보이는 값)

### 5.7 휴지통 · 영구 삭제 · 다시 실행
- **휴지통**: 쪽 글은 지우지 않고, 휴지통 자료는 질의의 `i.deleted_at IS NULL`로 일치에서 빠진다. 복원하면 다시 뽑지 않고 곧바로 일치한다. 도는 추출 작업의 sha에 휴지통 아닌 PDF가 더 없으면 일꾼을 멈추고 작업은 `queued`로 남는다(복원하면 이어서). main의 `onBroadcast`(`events.ts`)로 `libraryChanged{trash|restore|purge}`를 듣는다.
- **영구 삭제**: `removeUnusedAssets`(`trash.ts` 142줄)가 그 sha의 마지막 자산이 떠날 때 작업을 지우는 같은 자리에서 `DELETE FROM page_texts WHERE sha256 IN (…)`(트리거가 색인 행을 지운다). 도는 작업이면 먼저 멈춘다.
- **다시 실행**: 시작 점검이 `running`을 `interrupted`로 바꾸고(`check.ts` 68줄), 일꾼을 처음 깨울 때 `interrupted` 추출 작업을 `queued`로 되돌린다. 이어서 `nextPage`부터. 이미 넣은 쪽은 `UNIQUE(sha256, page_index)`라 두 번 들어가지 않는다(넣기는 `INSERT OR REPLACE`가 아니라 시작 쪽부터 — 중복은 버그로 실패하게 둔다).
- 해석 메모: 승인한 설계의 "휴지통 자료의 본문 제거"를 **휴지통 동안 검색에서 빠짐 + 영구 삭제 때 행 삭제**로 읽었다(휴지통으로 옮길 때 행을 지우면 복원 뒤 다시 뽑아야 한다). 다르면 소유자가 고친다.

### 5.8 화면
- **검색 범위 ▾**(라이브러리 검색 필드 안 맨 앞, 돋보기 자리 — Zotero식): 웹 팝업 단추 메뉴(RAC `MenuTrigger` + `Menu selectionMode="single"`, 이름 "검색 범위"). 행: **정보**(설명 "제목·저자·태그·출판사·원래 이름·초록·메모") · **정보와 본문**(설명 "PDF 본문 포함"). 색인이 끝나지 않았으면 맨 아래 구분선 뒤 선택할 수 없는 정보 줄(`--text-secondary`) "본문 색인 37 / 120"(휴지통이 아닌 PDF 자료 수 기준, `search:progress`). 고른 값은 설정 `library.searchScope`에 기억한다(기본 `metadata`). 탭 순서는 범위 단추 → 입력란. 레지스트리 명령이 아니다(태그 선택기 "…"와 같은 웹 팝업 메뉴, 디자인 명세 7.3). 자리표시는 범위마다 "제목, 저자, 태그 검색" / "제목, 저자, 태그, 본문 검색". (컨트롤러 판정 J23: 승인안의 이름 '메타데이터 / 본문 포함'을 화면 문구로는 '정보 / 정보와 본문'으로 — 디자인 명세 9 "사용자 문장에 내부 용어를 쓰지 않는다"와 항목 패널의 '정보' 절 이름에 맞춘다. 기본값은 지금 동작 그대로)
- **표**: 범위가 '정보와 본문'이면 결과 = 정보 일치 ∪ 본문 일치(`useSearch`의 `SearchResult.ids`에 합치고, 보기·태그 거름이 그 답을 자르는 지금 구조 `useLibraryRows.ts` 그대로). 제목의 `<mark>`는 정보 일치에만. 본문만 일치한 행에 따로 표시는 두지 않는다(목업에서 확인). 휴지통 보기에서는 본문 일치가 없다. 휴지통 보기는 범위와 상관없이 정보만 찾는다 — 자리표시와 결과 없음도 '정보'의 것이고, 메뉴는 저장된 범위를 그대로 보인다(R60, 메뉴 안의 안내 줄은 두지 않는다). 개수("0개 / 48개")와 `aria-live`("일치하는 자료 N개")는 본문 결과가 오면 다시 센다. 본문 답을 기다리는 동안 다른 것이 보이지 않으면 300ms 뒤 표 자리에 "찾는 중…"(디자인 명세 6의 불러오기 규칙)이고, 같은 질의의 답이 캐시에 있으면 기다리지 않고 그것을 쓴다(R59).
- **결과 없음**(`SearchEmpty`): 문구는 앱의 `searchEmptyBody`("‘분자생물학’\u2060의 제목\u2060·…·메모에서 찾았습니다.")에서 만들고, 필드 목록 끝 "\u2060·PDF\u00a0본문"은 본문을 실제로 찾았을 때(`search:body`의 `searched: true` — 두 글자 이상)만 붙인다. 본문을 찾지 않은 경우(1글자뿐)에는 "본문은 두\u00a0글자 이상인 낱말로 찾습니다."를, 색인 중이면 "본문 색인이 끝나면 더 찾을 수 있습니다(37 / 120)."를 덧붙인다. (컨트롤러 판정 J24: '결과 없음'이 거짓 음성으로 읽히지 않게 — 안심 문구는 사실일 때만, 디자인 명세 9)
- **'본문 일치' 절**(라이브러리 항목 패널, 자료 하나를 골랐고 범위가 '정보와 본문'이며 본문 낱말이 있고 PDF일 때): 자리는 머리 바로 아래, '읽기' 절 위. 머리 "본문 일치" + 3차색 "쪽 N개"(R24). 행은 쪽마다 하나(최대 20): "12쪽" + 두 줄로 자른 조각(`<mark>`). 20쪽을 넘으면 끝에 "외 N쪽". 행은 RAC `ListBox`(`onAction`, ↩·클릭)이고 이름은 "12쪽, <조각 글>". 불러오기 300ms 규칙(그 전에는 아무것도 없고 넘으면 "찾는 중…"). 일치가 없고 색인이 끝났으면 절이 없다. 색인이 끝나지 않았으면 행 대신 상태 줄 하나(아래). 절은 표처럼 지금 입력한 질의를 열쇠로 한다 — 질의가 멈춘 뒤에만 `search:pages`를 부르고 앞 질의의 답을 남기지 않는다(R65: 남긴 답의 표시와 누름이 낡지 않게. 대가로 타자 한 묶음에 아래 절이 한 번 움직인다, 표의 본문 행과 같다). `search:pages`가 실패하면 절을 보이지 않는다(R66 — 표의 실패 길도 본문에 대해 말하지 않는다, J24). (컨트롤러 판정 J25: 찾는 동안 사용자가 보는 것이 일치이므로 머리 바로 아래)
- **행을 누르면**: `item.open`과 같은 여는 길(편집 중이면 먼저 묻기, 탭 규칙)로 그 자료의 탭을 열거나 가고, 그 탭의 리더 범위(`readerScopes.get(itemId)`)에 `pendingJump = { pageIndex, query }`를 둔다. 리더는 (a) 아직 자리를 적용하지 않았으면 저장된 확대·회전·보기 모드로 그 쪽 위에 놓고(`placePage` 규칙), (b) 이미 열려 있으면 `jumpToPage`(뒤로/앞으로에 기록 — 쪽 필드 이동과 같다), 그다음 찾기 막대를 그 질의로 열고(`findStore.openBar(query)`) 찾는다 — pdf.js 찾기는 지금 쪽부터 찾으므로 첫 강조가 그 쪽이다.
- **색인 상태**: PDF 자료 하나의 항목 패널 '파일' 절에 줄 "본문 검색"을 상태가 완료가 아닐 때만 보인다 — 색인 중 · 글자 없음(스캔본일 수 있음) · 실패(이유). 완료는 조용하다(앞 N쪽만 색인했으면 그 사실 한 줄). '본문 일치' 절도 같은 문구를 쓴다 — 잘린 색인은 절의 행 아래에 그 한 줄을, 일치가 없으면 그 줄만 보인다(R68: 일치 없음이 파일 전체에 없음으로 읽히지 않게). 휴지통 자료와 원본이 없는 자료에는 상태 줄이 없다(R63: 휴지통 자료의 작업은 복원까지 기다리고 원본이 없으면 읽을 수 없어 "색인하는 중"이 거짓이 된다). 원본이 없고 색인이 잘린 자료도 그 줄이 없다. 상태는 `library:detail`의 `ItemDetail.text`(10절)에서 온다. (컨트롤러 판정 J26: 승인한 상태 셋만 보이고 완료는 줄을 두지 않는다 — 조용한 화면. 잘린 문서의 한 줄은 사실을 말하는 보조 문구)

## 6. 성능 항목
목표는 지금 예산(13절)이다. 줄마다 근거·목표·방법. 측정은 기존 perf suite(`organize-perf.evidence.ts`·`perf.evidence.ts`·`p1-perf.evidence.ts`)를 다시 돌린다.

| # | 항목 (근거) | 지금 | 목표 | 방법 |
|---|---|---|---|---|
| P1 | `library:organize` 시간과 페이로드(M6 입력) | Mac 60.7ms, 2,001,990 B | ≤ 50ms, ≤ 800,000 B | 스냅샷의 `members`·`tagged`를 항목 id 표 하나(`itemIds: string[]`) + 번호 배열(`Uint32Array`, 구조화 복제)로 보낸다 — 같은 UUID 문자열 5만 번을 1만 번으로. 렌더러 모델이 받는 곳에서 풀고 겉 모양(`OrganizeSnapshot`)은 그대로 |
| P2 | m-1 메뉴 막대가 소속만 바뀐 알림에도 다시 만들어지고 스냅샷 전체를 읽음(`main/index.ts` 187–190·241) | 알림마다 1회 | 소속만(`itemIds` 있음) 바뀐 알림에 다시 만들기 0회, 메뉴용 읽기는 컬렉션·태그만 | `readMenuOrganize`(컬렉션 + 태그 두 문장)와 `itemIds`가 있는 `collections`·`tags` 알림 건너뛰기. 메뉴 막대 E2E를 다시 돈다 |
| P3 | E6 `1` 키가 정리 모델을 다시 만들고(약 19ms) 태그 변경이 1만 항목 검색 색인을 다시 만든다(61ms) | Mac 119.1ms | `1` 키 하나 붙임 ≤ 100ms | 태그 붙임·뗌은 main 답(`tags.togglePosition`)으로 렌더러가 스냅샷의 `tagged`만 고친 새 스냅샷을 캐시에 넣고(뒤따르는 `libraryChanged{tags}`는 같은 내용이면 다시 읽지 않는다), 검색 색인은 바뀐 항목의 태그 필드만 갈아 끼운다 |
| P4 | m-8 색이 바뀌면 이름 순서가 바뀌어 색인을 괜히 다시 만든다(`library/tagField.ts` 23–41) | 61ms | 색만 바뀐 변경에 다시 만들기 0회 | 항목별 태그 이름을 이름순으로 이어 같음을 비교(모델의 태그 순서와 무관) |
| P5 | m-9 `useScopeView`가 다섯 곳에서 돈다(`MainWindow.tsx` 318, `useLibraryRows.ts` 24, `InfoPane.tsx` 60, `TagSelector.tsx` 39, `TagFilterEmpty.tsx` 27) | 5회 | 1회 | 라이브러리 보기에서 한 번 계산해 컨텍스트로 내린다 |
| P6 | 검색 입력 → 그리기 p95 | Mac 57ms | ≤ 50ms | P3–P5 + 본문 검색은 입력 경로 밖(늦춘 질의 + 200ms + 비동기) |
| P7 | ⌘/ 시트 열기 중앙값 | Mac 288ms | ≤ 250ms | 주 창의 첫 유휴 뒤 시트 창 하나를 숨긴 채 미리 만들어 두고(설정 창 미리 만들기 P-4와 같은 길) 열 때는 내용만 넘긴다. 닫으면 다음 것을 다시 준비 |
| P8 | 표 스크롤 프레임 p95 | Mac 18.3ms | ≤ 16.7ms(Linux CI 판정, Mac 러너는 보고값 — M4 기록상 러너가 가만히 있어도 p95 약 33ms) | 성능 추적으로 스크롤 프레임의 일을 찾아 줄인다: 행 렌더 메모(항목·선택·표시 열이 같으면 다시 그리지 않음), 스크롤 처리 중 레이아웃 읽기 제거 |
| P9 | 토스트 그리기 p95(M6 입력) | CI 17.0 · Mac 18.1ms | ≤ 16.7ms | 아래 P10 |
| P10 | 목록 다시 읽기를 유휴로(M6 PR 남은 것) — 가져오는 중 1초마다 오는 `libraryChanged{import}`가 목록 전체를 다시 읽는다(`data/libraryChange.ts` `everything()`) | 알림마다 | 가져오는 동안 1초에 최대 1회 + 끝에 1회, 유휴 콜백(`whenIdle`, 시한 1,000ms) | `import` 이유의 전체 읽기를 묶어 유휴로 미룬다. 다른 이유는 지금 그대로 |
| P11 | E2 빈 검색 결과에서 보이는 폭 밖 열 머리에 가로로 닿지 못함(`styles/screens/library.css` 75 `.table-scroller[data-empty] { overflow: hidden }`) | 닿지 못함 | 1024 창에서도 머리 띠를 가로로 옮길 수 있다 | 빈 상태에서 머리 띠만 가로 스크롤(본문 스크롤러는 axe 때문에 그대로 `hidden`) |

## 7. M7b에서 넘긴 것 (`next-session.md` "M7b에서 나온 M7c 입력")
- **목차 현재 항목으로 스크롤**(`viewers/pdf/OutlineTree.tsx` — `current`가 `aria-current="location"`을 달지만 가상화 창 밖이면 보이지 않는다): 목차를 보일 때(썸네일 → 목차 전환, 리더를 열 때)와 현재 항목이 바뀔 때 그 행을 `nearest`로 보이게 스크롤한다. 사용자가 목차를 스크롤한 뒤 2초 동안은 따라가지 않는다. 행 클릭 뒤 현재 항목이 클릭한 행이 아니어도(같은 쪽의 하위 항목) 보이게. (컨트롤러 판정 J27: 사용자가 훑는 목록을 빼앗지 않게 2초)
- **탭과 탭 패널 연결**: 탭에 `id="tab-<itemId>"`, 패널에 `id="tabpanel-<itemId>"` + `aria-labelledby`(지금 `ReaderTabs.tsx` 67–68은 `role="tabpanel"` + `aria-label`), 마운트된 패널이 있는 탭만 `aria-controls`. 라이브러리 탭(`tab-library`)과 라이브러리 내용에 `role="tabpanel"`(`tabpanel-library`). axe와 키보드 여정이 지킨다.
- **시험의 `waitForTimeout` 정리**: M7b가 더한 시험(`tabs.spec.ts` 10곳, `history.spec.ts` 4, `view-modes.spec.ts` 7, M7b가 손댄 `position.spec.ts`·`reader-pdf.spec.ts`의 새 시험)의 고정 대기를 조건 기다림으로 바꾼다. "없음"을 확인하는 대기는 양성 대조(같은 경로에서 있는 경우를 먼저 확인) 뒤에만 남기고 까닭을 주석으로 적는다.
- **R29**(같은 프레임의 잔여)는 그대로 둔다(승인).

## 8. 번역 주소 재확인 (문서 조사만)
- 실제 주소(`translate.googleapis.com`)는 부르지 않는다. `google-web.live.test.ts`를 돌리지 않고 `LEARN_TRANSLATION_LIVE`를 켜지 않는다(구현자·컨트롤러 모두).
- 조사할 공개 문서(웹 페이지 읽기만): Google 서비스 약관(policies.google.com/terms), Google API 서비스 약관(developers.google.com/terms), Cloud Translation 가격·할당량(cloud.google.com/translate), DeepL API(무료·유료 판, 키·카드 요구), Microsoft Azure Translator(무료 계층), Apple Translation 프레임워크(developer.apple.com/documentation/translation — 기기 안, 지원 macOS 판, Swift 도우미 필요 여부), Argos Translate(오프라인 모델, 라이선스), LibreTranslate(자체 호스팅, AGPL — 코드를 읽거나 가져오지 않고 문서만).
- ADR-0012에 새 절 "M7c 재확인 (2026-11-…)": (1) 지금 주소가 약관상 어디에 해당하는지(문서가 말하는 것만 인용, 해석은 '불분명'까지), (2) 대안 엔진 표 — 엔진 · 키/계정 · 무료 한도 · 기기 안 여부 · 라이선스 · 붙이는 비용(2절 인터페이스 기준) · 출처 URL·확인 날짜, (3) M14 전 결정에 필요한 것(소유자 몫). "결과와 위험"의 비공식 주소 줄은 이 절을 가리키게 고친다.
- 소유자가 직접 돌릴 확인(`next-session.md` "M7c 결과"의 소유자 할 일에 적는다):
  ```
  LEARN_TRANSLATION_LIVE=1 pnpm vitest run apps/desktop/src/main/translation/google-web.live.test.ts
  ```
  그리고 앱에서 영어 문장 하나를 골라 번역 켜기 → 번역이 나오는지, 같은 문장을 다시 고르면 바로 나오는지(캐시) — M7a 실기 목록 "실제 번역 한 번(R-17)"과 같다.

## 9. 명령 · 메뉴 · 키
- 새 명령(레지스트리, 한국어 이름, 핸들러 없이는 보이지 않는다): `reader.imageBackgroundLight` "밝게" · `reader.imageBackgroundDark` "어둡게" · `reader.imageBackgroundChecker` "체크무늬" — `SUBMENUS`의 새 묶음 "배경 ▸"(보기 메뉴, `reader.pageColor*`와 같은 모양), 팔레트 이름 "배경: 밝게" 등, 맥락 `viewer`, 가용성 `imageOpen`. 명령 전수 장부 `M7C_COMMANDS`(셋), `commands-coverage.spec`이 모두 실행한다. (컨트롤러 판정 J28: '체커'는 외래 약어라 화면 문구는 일상어 '체크무늬')
- 맥락 상태 `CommandContextState`에 `imageOpen?: boolean`(이미지가 그려진 리더 탭이 보일 때만). 가용성: `view.textBigger`·`view.textSmaller`·`view.textReset`(리더에서는 확대·축소·실제 크기), `reader.zoomPageWidth`, `reader.zoomPageFit`, `reader.rotateCw`·`reader.rotateCcw`가 `pdfOpen || imageOpen`. `reader.zoomAuto`(자동 맞춤)·쪽 색·스크롤·펼침·찾기·쪽으로 이동·뒤로/앞으로·`view.toggleInspector`는 PDF만 그대로.
- 이름: `reader.zoomPageFit`은 이미지에서 "창에 맞춤"(PDF는 "한 쪽 전체 보기"). `stateLabels`에 새 열쇠 `reader?: { image: string }`을 더하고 `imageOpen`이면 그 이름 — P-9(보기에 따라 이름이 바뀌는 공유 단축키)와 같은 길이라 메뉴 막대 항목은 그 자리에서 이름만 바뀐다(`menuLabelState`·`menuLabelsChanged`가 `imageOpen`을 본다). (컨트롤러 판정 J29: 새 명령 둘을 더하면 보기 메뉴에 늘 꺼진 줄이 생긴다 — 이름이 바뀌는 한 명령이 PDF와 같은 키 규칙을 지킨다)
- 키 충돌 점검(디자인 명세 7.4와 `commands.ts`): 이미지에 새 단축키는 없다. 회전은 PDF와 같은 ⌘R/⌘L(Finder에서 보기는 ⇧⌘R로 따로), 확대는 ⌘+/⌘−/⌘0(라이브러리에서는 글자 크기 — P-9 그대로), 화살표·스페이스·PageUp/PageDown·Home/End는 무대의 기본 스크롤이고 렌더러 키맵의 한 글자 단축키(1–8 색 태그는 라이브러리 맥락만, F6)와 겹치지 않는다. 탭 줄의 ⌥⇧←/→는 탭 줄에 포커스가 있을 때만이라 무대의 화살표와 겹치지 않는다. 검색 범위 메뉴에는 단축키가 없다.
- 디자인 명세 7.4 표에 '이미지' 범위를 더한다(16절).

## 10. 데이터 · IPC · 알림 (모음)
- **스키마 v4**(3.3): `items.type` + `image`, `anchors.kind` `'slide'` → `'slides'` + `image`, `assets.width`·`height`, `page_texts` + `page_texts_fts` + 트리거 셋, v0 추출 작업 삭제.
- **도메인**: `ItemType` + `'image'`, `LibraryItem.imageSize`, `IMAGE_FORMATS`, `readingLocatorSchema`의 `image` 모양(4.4), `imageAnchor`·`slideAnchor.kind = 'slides'`(4.5), `ItemDetail.text`(PDF가 아니면 `null`):
  ```ts
  export type BodyTextState =
    | { state: 'pending' }                                   // 대기 · 진행 · 중단(다시 실행하면 이어서)
    | { state: 'done'; pages: number; truncated: boolean }   // truncated면 앞 `pages`쪽까지
    | { state: 'empty'; pages: number }                      // 쪽당 평균 10자 미만
    | { state: 'failed'; reason: 'locked' | 'damaged' | 'too-large' | 'gave-up' };
  ```
  본문 질의 낱말 나누기 `bodyQueryWords(query)`(5.6)는 도메인 함수 하나로 두어 렌더러(절을 보일지)와 main(질의)이 같은 규칙을 쓴다.
- **설정**(라이브러리 DB, `SETTINGS`): `library.searchScope: z.enum(['metadata', 'fulltext'])`(없으면 `metadata`), `reader.imageBackground: z.enum(['light', 'dark', 'checker'])`(없으면 테마). `ui.tabs.known`의 종류에 `'image'`. 기기 환경설정은 그대로.
- **IPC**(새 이름공간 `search`, `ns:verb`, 모두 주 창만 — `channel-kinds.ts`):
  | 채널 | 입력(zod, `.strict()`) | 답 |
  |---|---|---|
  | `search:body` | `{ query: z.string().normalize('NFC').max(200) }` | `{ itemIds: string[]; searched: boolean }`(`searched: false` = 본문 낱말 없음). 앞 요청은 `CANCELLED` |
  | `search:pages` | `{ itemId: z.uuid(), query: z.string().normalize('NFC').min(1).max(200) }` | `{ pages: Array<{ pageIndex: number; snippet: string }>; total: number }`(최대 20개, 조각의 표시는 `U+E000`/`U+E001`) |
  | `search:progress` | 없음 | `{ done: number; total: number }`(휴지통이 아닌 PDF 자료 기준) |
  지금 채널의 바뀜: `library:detail`이 `ItemDetail.text`를, `library:list`·`getItems`가 `imageSize`를 싣는다. `reader:open`은 이미지에 시작 자리 `{ kind: 'image' }`를 만든다.
- **알림**: `libraryChanged`의 이유에 `'text'`(`itemIds` = 그 sha를 쓰는 자료들 — 본문 상태가 바뀜; 렌더러는 그 자료의 상세와 본문 검색 결과만 무효로 하고 목록을 다시 읽지 않는다). 새 밀어 넣기 `'search:progress'`(`evt:search-progress`, `{ done, total }`, 추출 중 1초에 최대 1회와 바뀐 뒤 쉴 때 1회 — `jobs/throttle.ts`).
- **일꾼 메시지**(5.2): main만 아는 내부 형식, zod로 검사.
- **시험 훅**(E2E 전용, `LEARN_E2E`): `seedBodyText({ docs, pages, chars, seed })`(13절 픽스처: PDF 자료와 `page_texts`·완료 작업을 직접 넣음), `textExtraction('pause' | 'resume' | 'now')`(`now`는 유휴 뒤 5초를 건너뛴다), `textIdle()`(대기열이 빌 때까지), `pageTextCount(itemId)`, 이미지 리더 상태 읽기(`window.__learnImage`, `e2e=1`일 때만).

## 11. 화면 문구 (합니다체, `strings/` 영역 파일, 조사는 `josa.ts`, 숫자와 단위는 U+00A0)
| 자리 | 문구 |
|---|---|
| 종류 | `image: '이미지'`(`t.library.type`, 드롭 요약 `t.drop.image`, 사본 내보내기 필터) |
| 빈 라이브러리 | `emptyBody1`: "PDF\u2060·동영상\u2060·이미지를 이\u00a0창에 끌어다 놓거나 가져올 파일을 선택하세요." · `formats`: "PDF, ${VIDEO_FORMATS} 동영상, ${IMAGE_FORMATS} 이미지를 지원합니다."(1024에서도 한 줄 — 최대 폭 520) |
| 가져오기 거절 | "지원하지 않는 형식입니다. 지금은 PDF, 동영상(${VIDEO_FORMATS}), 이미지(${IMAGE_FORMATS})를 가져올\u00a0수 있습니다." |
| 열기 패널 필터 | `importFilters.media`: "PDF\u00a0·\u00a0동영상\u00a0·\u00a0이미지" |
| 항목 패널 종류 줄 | "이미지\u00a0· 4032\u00a0×\u00a03024"(크기 모름: "이미지") |
| 읽기 절(이미지) | 진행 "✓ 완료", 줄 "열어 봄\u00a0· 어제"(`t.inspector.reading.viewed`) |
| 이미지 리더 | 도구 막대 이름 "이미지 도구" · 무대 "이미지" · 확대 필드 이름 "확대 비율"과 ▾ 이름 "확대 메뉴"(PDF와 같다) · 여는 중 ▾ 툴팁 "확대 메뉴 · 이미지를 여는 중입니다"(이름 · 이유 — 이유 문자열은 "이미지를 여는 중입니다", R46) · 확대 ▾ "창에 맞춤"·"너비에 맞춤"·"실제 크기"·"확대"·"축소" · 보기 ▾ "배경" 묶음 "밝게"·"어둡게"·"체크무늬" · 쪽 없음 사이드바 "이미지에는 쪽이 없습니다" |
| 그릴 수 없음 | 제목 "이\u00a0이미지를 표시할 수 없습니다" · 본문 "파일 내용이 손상되었거나 그릴 수 없는 형식입니다. 원본\u00a0파일은 그대로 보관됩니다. 다른\u00a0사본이 있으면 다시 가져오세요." |
| 검색 범위 ▾ | 단추 이름·툴팁 "검색 범위" · 행 "정보"(설명은 `SEARCHED_FIELDS` 그대로 — "제목\u2060·저자\u2060·…\u2060·메모") · "정보와 본문"(설명 "PDF 본문 포함") · 진행 줄 "본문 색인 37\u00a0/\u00a0120" |
| 검색 자리표시 | "제목, 저자, 태그 검색"(그대로) · "제목, 저자, 태그, 본문 검색" |
| 결과 없음 덧붙임 | 앱의 `searchEmptyBody`에 필드 목록 끝 "\u2060·PDF\u00a0본문"(본문을 실제로 찾았을 때만, `searched: true`) · 1글자뿐: "본문은 두\u00a0글자 이상인 낱말로 찾습니다." · "본문 색인이 끝나면 더 찾을 수 있습니다(37\u00a0/\u00a0120)." |
| '본문 일치' 절 | 머리 "본문 일치", 개수 "쪽 34개", 행 "12쪽", 더 있음 "외 14쪽", 찾는 중 "찾는 중…", 행 이름 "12쪽, <조각>", 잘린 색인 "앞 5,000쪽까지 색인했습니다."(행 아래, 일치가 없으면 그 줄만 — R68) |
| 표('정보와 본문'에서 본문 답을 기다림) | "찾는 중…"(300ms 뒤, 다른 것이 보이지 않을 때 — R59) |
| 본문 색인 일꾼의 프로세스 이름(활동 모니터) | "Learn 본문 색인"(`main/strings.ts` `textWorker.serviceName`) |
| 본문 상태(파일 절 줄 "본문 검색"과 '본문 일치' 절) | 색인 중 "본문을 색인하는 중입니다." · 글자 없음 "글자를 찾지 못했습니다. 스캔한 PDF일 수 있습니다." · 실패: 암호 "암호로 보호된 PDF라 본문을 색인하지 않았습니다." · 손상 "파일 내용이 손상되어 본문을 색인하지 못했습니다." · 너무 큼 "파일이 너무 커서 본문을 색인하지 않았습니다." · 포기 "본문을 색인하지 못했습니다. 파일이 복잡하거나 손상되었을 수 있습니다." · 잘림 "앞 5,000쪽까지 색인했습니다." |
- 문구는 목업 승인에서 바뀔 수 있다. 바뀌면 이 표를 고친다. (2026-11-10: 구현에서 더하거나 바꾼 문구를 표에 옮겼다 — 이미지 리더의 툴팁 R46, 표의 "찾는 중…" R59, '본문 일치'의 잘린 색인 R68, 일꾼의 프로세스 이름.)

## 12. 목업 게이트 (구현 전 소유자 승인)
UI 구현은 목업 승인 뒤다. 승인을 기다리는 동안 화면과 무관한 작업(마이그레이션 004와 실행기, 머리 파서, 형식 판별, 추출 일꾼·작업·FTS·IPC, 성능 항목 P1–P5·P7·P10, 7절의 시험 정리)은 진행한다.

| # | 목업 | 장면과 상태 |
|---|---|---|
| ① | 새 `reader-image.html`(`m=7c`) | 이미지 탭(탭 줄 아이콘 `image`) · 배경 셋(`?bg=light|dark|checker`) × 앱 테마 라이트·다크 · 투명 PNG(체크무늬) · 흰 바탕 그림(`?img=diagram`, 테두리 없음 확인) |
| ② | 같은 파일 | 확대: 창에 맞춤(큰 사진) · 작은 이미지의 창에 맞춤(100%, 키우지 않음) · 너비에 맞춤(세로 스크롤) · 400%(끌기 커서) · `?menu=zoom`(확대 ▾) · `?menu=view`(배경 묶음 + 회전) |
| ③ | 같은 파일 | 90° 회전 · `?state=loading|error|missing|trashed` · `?w=1024` |
| ④ | `library.html`(`m=7c`) | 검색 필드의 범위 단추(기본·호버·눌림·포커스) · `?search=scope-menu`(진행 줄 있음/없음) · 범위 '정보와 본문'의 표(본문만 일치한 행 표시 없음 — 이대로, 승인) |
| ⑤ | 같은 파일 | 항목 패널 '본문 일치' 절: 일치 3쪽 · 20쪽 넘음("외 N쪽", `&scroll=end`로 끝) · 찾는 중 · 색인 중 · 글자 없음 · 실패(암호) |
| ⑥ | 같은 파일 | 이미지 자료의 항목 패널(미리보기 + "이미지 · 4032 × 3024", 큰 이미지의 아이콘 칸) · 파일 절의 "본문 검색" 줄 · 표의 종류 열 '이미지'(열 순서 제목 · 저자 · 연도 · 종류 · 진행 · 추가일) · `?panel=pdf-failed`(가장 긴 상태 문구) · `?state=noresults&scope=fulltext`(`&indexing=1` · `&onechar=1`, 덧붙임 문구) |
| ⑦ | 판단 질문 | 이미지 탭의 왼쪽 사이드바: '쪽 없음' 안내(승인, `?sidebar=nopages`). 자동 접기 장면은 두지 않는다(R22) |
| ⑧ | `library-empty.html` | 지원 형식 줄(이미지 더함, 1024에서도 한 줄) · 드롭 오버레이 "파일 3개(PDF 1 · 이미지 2)" |

- 디자인 비평(opus) 뒤 소유자에게 Artifact와 대조표로 보이고 승인받는다(M7b와 같은 절차). 토큰 이름: `--image-bg-light`, `--image-bg-dark`, `--image-checker-a`, `--image-checker-b`(테마와 무관한 배경 선택 — 값은 목업에서).

## 13. 성능 예산과 측정
지금 예산은 모두 그대로다(AC16·M5 정리·M6 `p1-perf`·M7a 리더·M7b 탭 — `acceptance.md`). 6절 줄의 목표는 그 예산이다. 새 줄:

| 줄 | 목표 | 측정 |
|---|---|---|
| 본문 검색(`search:body` 왕복, 렌더러에서) | **p95 ≤ 300ms**(PDF 1,000개) | 새 `search-perf.evidence.ts`(`@perf`, `search-perf.json`) — 질의 7종 × 20회 = 140표본: "형광"·"세포"(2글자 한국어, 많이 있음)·"zq"(2글자 없음)·"현미경"(3글자 한국어)·"transduction"(긴 영어)·"단백질 신호"(두 낱말)·"xylophone"(없음). 캐시 없는 첫 질의도 따로 기록 |
| '본문 일치' 절(`search:pages`) | p95 ≤ 100ms | 같은 시험, 질의 7종 × 무작위 자료 20개 |
| 범위 '정보와 본문'에서 검색 입력 → 정보 결과 그리기 | p95 ≤ 50ms(지금 예산 그대로) | `perf.evidence.ts`의 검색 입력 줄을 범위 둘로 |
| 추출이 도는 동안 표 스크롤 프레임 | p95 ≤ 16.7ms(지금 예산) | 같은 시험이 `paper-100.pdf` 20개를 색인하는 동안 스크롤 |
| 추출 처리량 · main의 묶음 쓰기 | 보고값(쪽/초, 묶음 트랜잭션 ms) | 같은 시험 |
| 이미지 탭 열기 → 그림이 보이는 첫 프레임 | ≤ 500ms(4032×3024 JPEG) | `reader-perf.evidence.ts`에 줄 하나 (컨트롤러 판정 J30: 첫 PDF 2초보다 훨씬 가벼운 일 — 디코드 한 번) |
| 냉시작 → app-ready | ≤ 1.5초(그대로) | 일꾼은 유휴 뒤에 뜨므로 들어가지 않음을 기존 줄로 확인 |
| 마이그레이션 003→004(1만 항목) | 보고값, 단위 시험 상한 1초 | `migrate.test.ts` |

- **1,000 PDF 픽스처**: 시험 훅 `seedBodyText({ docs: 1000, pages: 12, chars: 4000, seed: 42 })`가 sha가 서로 다른 PDF 자료 1,000개(`seedAssets`처럼 작은 가짜 PDF 파일)와 쪽 1만 2천 행(합성 글 — 이 저장소의 낱말 표: 영어 학술 낱말 80% · 한국어 20%, 고정 시드 LCG, 쪽당 4,000자), 완료 작업 행을 한 트랜잭션 묶음으로 넣는다(트리거가 색인). 크기는 명세 작성 중 같은 모양의 스크래치 측정으로 DB 154.8 MB, 만들기 7.2초. 그 측정의 따뜻한 캐시 값은 2글자 훑기 중앙값 25–29ms, FTS 3–29ms였다 — 예산에 여유가 있지만 판정은 이 시험이 한다. (컨트롤러 판정 J31: 논문 한 편 ≈ 12쪽 × 4,000자로 어림 — 1,000편 = 4,800만 자)
- CI는 목표의 2배를 넘을 때만 실패한다(기존 규칙, `tests/evidence/budget.ts`). Mac 러너 값은 보고값이고 판정은 기준 장비다.

## 14. 검증
- **단위**(vitest):
  - 머리 파서: 다섯 형식 각각, 잘린 머리, 거짓 길이·상자 크기 0/1, JPEG EXIF 방향 1–8(II·MM), SOF 앞 APP 여럿, WebP 셋, GIF87a/89a, AVIF `pitm`/`ipma`/`ispe`/`irot`(격자·썸네일 섞임), 범위 밖 → `null`. 형식 판별: 확장자가 틀린 파일, HEIC(`mif1` + `heic`)는 거절, AVIF(`mif1` + `avif`)는 받음.
  - 마이그레이션 003→004: `migrate.test.ts`에 v3 실데이터(PDF·동영상·휴지통 자료, 소속·태그·위치, pdf span 앵커 · `'slide'` 앵커(locator의 `kind` 포함) · JSON이 아닌 locator · 그 앵커를 가리키는 annotation, `text-v0` 작업과 다른 종류의 작업) → 모든 행과 **rowid**가 같다, `foreign_key_check` 빈 배열, 뒤에 `PRAGMA foreign_keys` = 1, 자식 표의 `foreign_key_list`가 `items`·`anchors`를 가리킨다, 색인 `items_deleted_at`·`anchors_revision`이 있다, CHECK(`'image'` 됨, `'slide'` 안 됨), `'slides'` 앵커를 저장소가 zod로 읽는다, `text-v0`만 지워졌다, `.pre-v4.bak`은 v3, 1만 항목 1초 안. 실행기: 고아 행을 남기는 `foreignKeysOff` 마이그레이션 → `MIGRATION_FAILED`, v3 그대로, 외래 키 다시 켜짐; 트랜잭션 안에서 부르면 거절.
  - 이미지: locator zod(경계·옛 값 없음), `imageFit`(맞춤·너비·키우지 않음·회전 상자·중심 ↔ 스크롤·자르기), 앵커 zod와 저장소 왕복, `startLocator('image')`, 읽기 줄.
  - 추출: 작업 중복 방지(같은 파일 두 번 가져오기·사본과 외부 연결·채워 넣기 두 번), 순서(최근 먼저, 휴지통만 남은 sha 건너뜀), 다시 실행(`interrupted` → `queued`, `nextPage`부터, 쪽 중복 없음), 시도 3번 → `gave-up`, 휴지통·영구 삭제에서 멈춤, 작업 줄이 바쁠 때 시작하지 않음, 일꾼 메시지 zod(넘는 묶음·범위 밖 `from` 거절), 쪽 글 정리(NFC·하이픈·공백·표시 문자·한도).
  - 검색: 낱말 나누기(1·2·3글자, 코드 포인트, 8개, 중복), FTS 구 따옴표, `LIKE` 이스케이프, 한국어 픽스처(2글자 "형광", NFD 쪽 글도 NFC로 저장되어 NFC 질의가 찾음, 대소문자 "TRANS"/"trans", 발음 부호 "cafe"/"Café"), 쪽 단위 AND, 휴지통 제외, 영구 삭제 뒤 행·색인 없음, 조각 표시와 2글자 조각, 취소.
  - 렌더러: `useSearch`의 합집합과 보기 자르기, 드롭 요약의 이미지, 정렬 `TYPE_ORDER`, 명령 가용성과 이름(`imageOpen`, "창에 맞춤"), 설정 스키마, 6절 P1(스냅샷 풀기)·P3·P4·P10의 순수 부분.
- **E2E**(새):
  - `images.spec.ts`: 다섯 형식 끌어 놓기·파일 가져오기(확장자가 틀린 PNG도 PNG), 열기(맞춤 기본), ⌘+/⌘−/⌘0, 확대 ▾, 핀치(합성 `ctrl` 휠), 끌기와 화살표 이동, ⌘R/⌘L(가운데 점 유지), 배경 셋(테마 따라 기본), 탭을 닫고 ⇧⌘T · 다시 실행 · SIGKILL 뒤 같은 자리, 진행 열 100%, 손상 PNG의 끝 상태, 원본 없음·휴지통 탭, EXIF 방향 6 JPEG(가로세로 바뀜), 항목 패널 미리보기와 크기 줄, 키보드 여정(무대 포커스, F6).
  - `body-search.spec.ts`: 범위 메뉴(키보드로도)와 기억(다시 실행), '정보와 본문'의 합집합, 2글자 한국어·1글자(본문 없음과 결과 없음 문구), `korean.pdf` 2쪽(NFD) 찾기, '본문 일치' 절(쪽·조각·20개와 "외 N쪽"), 행 ↩·클릭 → 그 쪽에서 리더가 열리고 찾기 막대에 질의·첫 강조가 그 쪽(열린 탭이면 ⌘[로 돌아옴), 상태(일꾼 멈춤 훅으로 '색인 중', 글자 없는 PDF로 '글자 없음', `locked.pdf`로 '실패'), 진행 줄, 휴지통으로 옮기면 빠지고 복원하면 돌아옴, 영구 삭제 뒤 `pageTextCount` 0, 추출 중 SIGKILL → 다시 실행해 끝남(쪽 수 정확).
  - 고침: `tabs.spec`(탭 패널 연결), 목차 현재 항목 스크롤(`reader-pdf.spec` 또는 `history.spec`), 메뉴 막대 다시 만들기 횟수(P2), 빈 결과의 머리 띠(P11), 7절의 대기 정리.
  - 키보드 여정(검색 범위 → 입력 → 표 → 항목 패널 '본문 일치' 행 → ↩), 새 상태마다 axe, `commands-coverage`의 `M7C_COMMANDS`, 투어 장면(이미지 리더 라이트·다크 × 배경 셋 · 회전 · 끝 상태, 검색 범위 메뉴, '본문 일치' 절과 상태, 이미지 항목 패널).
- **픽스처**(`fixtures/`, 제3자 저작물 없음): 작은 정적 이미지 다섯(`static/images/` — 투명 PNG, EXIF 방향 6 JPEG, WebP(알파), GIF(움직임 두 프레임), AVIF; 이 저장소의 시험 무늬로 한 번 만들고 명령은 `static/README.md`에 적음) + 생성기가 만드는 것: 손상 PNG(머리만 맞음), 확장자가 틀린 PNG 사본, 4032×3024 JPEG(ffmpeg `testsrc2`, 성능용), `search-30.pdf`(pdf-lib, 30쪽마다 "Page N: fluorescence signal transduction"과 "형광 현미경 관찰 기록 N" — 20쪽 넘는 일치와 2글자), `no-text.pdf`(pdf-lib, 도형만 — 글자 없음). 기존 `paper-100.pdf`는 바꾸지 않는다(번역 문장·링크·목차·앵커 스파이크·위치 시험이 이 파일의 글과 쪽에 기댄다). (컨트롤러 판정 J32: WebP·AVIF 인코더가 모든 러너의 ffmpeg에 있다고 믿을 수 없어 작은 것은 커밋한다 — `locked.pdf`와 같은 규칙)
- 로컬: 새 spec은 `taskset -c 0-1`, 전체는 `taskset -c 0-3`로도 돌려 부하 경합을 CI 전에 본다. `xvfb-run -s "-screen 0 1024x768x24"`로 기능 E2E 한 번.
- **Mac**: 이미지 리더와 본문 검색이 끝난 중간 지점에서 `e2e` 한 번, 끝에 `all`(증거·기능 E2E·데모). 최종 코드에서 `all`은 두 번까지 보내고 서로 다른 간헐 실패는 줄마다 적는다(M7b R48의 관례).
- **데모**(3–4분, 장 목록): 사진·도판 다섯 장 끌어 놓기 → 이미지 열기·창에 맞춤·핀치·끌기·회전·배경 → 탭을 닫고 다시 열어도 같은 자리 → 검색 범위를 '정보와 본문'으로 → 한국어 2글자 검색과 표 → 항목 패널 '본문 일치' → 쪽 열기와 찾기 막대 → 색인 진행 줄 → 휴지통으로 옮기면 일치에서 빠짐.
- **디자인 비평**: UI 작업마다 Linux 투어 PNG와 목업 대조, 끝에 Mac 데모 프레임(라이트·다크).

## 15. 계획의 Global Constraints에 들어갈 것
- 새 데이터 객체는 모두 앵커로 주소를 가질 수 있다(제품 방향 합의): 이미지는 `image` 앵커(4.5), 쪽 글은 sha + 쪽 번호라 그 revision의 pdf 앵커(`pageIndex`)로 가리킬 수 있다.
- AGPL 코드(Zotero reader, zotero-pdf-translate, LibreTranslate)는 보지도 가져오지도 않는다. pdf.js(Apache-2.0) 소스는 읽어도 된다 — 일꾼 번들에 pdf.js가 들어가므로 고지를 렌더러와 같이 확인한다. 런타임 의존성은 정확히 고정하고 새로 더하지 않는다(이미지 머리 파서·FTS5·`utilityProcess`는 모두 있는 것).
- 불신 입력: PDF는 `utilityProcess` 일꾼에서만 연다(main은 열지 않는다). 이미지 머리는 main이 1 MiB 안에서 범위 검사를 하며 읽는다. 일꾼은 DB를 만지지 않고, main은 일꾼의 모든 메시지를 zod로 검사한다. 쓰기는 main 하나.
- 마이그레이션의 외래 키 끄기는 실행기의 `foreignKeysOff` 길에서만, 커밋 전 `foreign_key_check`, 끝나면 반드시 다시 켠다.
- 원격 요청은 main만, 허용 호스트 하나, 동의 전·끈 상태에서는 0회(M7a 그대로). **실제 번역 주소를 부르지 않는다 — `google-web.live.test.ts`를 돌리지 않고 `LEARN_TRANSLATION_LIVE`를 켜지 않는다.**
- 가짜 컨트롤 금지: 메뉴·팔레트·도구 막대는 레지스트리에서만(검색 범위 ▾는 태그 선택기 "…"와 같은 웹 팝업 메뉴이고 실제로 동작하는 값만 둔다), 핸들러 없는 항목은 그리지 않는다.
- 문체는 합니다체, 화면 문구는 `strings/` 영역 파일에. 한국어 조사는 `josa.ts`. 내부 용어(메타데이터·FTS·trigram·추출기)는 화면에 쓰지 않는다.
- 가린 탭은 크기 관찰에 반응하지 않는다(M7a N-1) — 이미지 리더도.
- 시트 뒤 클릭은 `sheetReleased()` 뒤에(macOS 250ms).
- 목업 승인 전에는 UI 구현 없음(12절).
- 구현자는 push·CI 실행·하위 에이전트 실행을 하지 않는다(컨트롤러가 한다).
- 커밋 꼬리말 두 줄(Co-Authored-By, Claude-Session).

## 16. 디자인 명세 변경 (`spec-amendments.md` 14절로 옮길 것)
1. 로드맵: M7c 줄의 범위를 이 명세로(이미지 래스터 5종 · 본문 검색은 빠른 검색의 범위 · 성능 · 번역 주소 문서 조사). `spec-amendments.md` 1절의 이미지 형식을 "래스터 5종, HEIC·TIFF는 M14, SVG 제외"로, 8절의 본문 검색을 "M7c: PDF 쪽 글 + FTS5 trigram, 2글자는 부분 일치 훑기, 1글자는 정보만"으로.
2. 2.4 · 6 검색 필드: 라이브러리 검색 필드 맨 앞의 범위 단추(돋보기 자리)와 범위마다 다른 자리표시.
3. 7.3 웹 팝업 단추 메뉴: "검색 범위 ▾(M7c): 정보 · 정보와 본문(체크) · — · 본문 색인 n / m(색인 중일 때만, 선택할 수 없는 정보 줄 `--text-secondary`)". 이미지 확대 ▾(창에 맞춤 · 너비에 맞춤 · 실제 크기 ⌘0 · — · 확대 · 축소)와 이미지 보기 ▾("배경" 머리 + 밝게/어둡게/체크무늬(체크) · — · 회전 둘). 메뉴 막대 보기 메뉴의 "배경 ▸".
4. 7.4 키 표에 '이미지' 범위: ⌘+/⌘−/⌘0 확대·축소·실제 크기, ⌘R/⌘L 회전, 화살표·스페이스·PageUp/PageDown 이동(무대 스크롤), 끌기 이동(그림이 무대보다 클 때), 핀치 확대.
5. 10.1 라이브러리: 표의 종류 '이미지'와 아이콘, 이미지 항목 패널의 미리보기와 "이미지 · W × H", 파일 절의 "본문 검색" 줄(완료가 아닐 때만), '본문 일치' 절(머리 아래, 쪽 + 조각 최대 20, "외 N쪽"), 결과 없음의 덧붙임.
6. 새 10.x 이미지 리더 — `reader-image.html`(12절 ①–③의 쿼리), 끝 상태 '그릴 수 없음'.
7. 10.2 빈 라이브러리의 지원 형식 줄과 드롭 오버레이의 이미지 개수.
8. 3.1 토큰: `--image-bg-light` · `--image-bg-dark` · `--image-checker-a` · `--image-checker-b`(테마와 무관한 배경). 이미지 배치: 맞춤 여백 24, 창에 맞춤은 100%를 넘기지 않음.
9. 5 아이콘: lucide `image`(종류) · `image-off`(그릴 수 없음).
10. 9 문체: 화면에서 '메타데이터'는 '정보'(검색 범위, J23).

**ADR과 문서**(같은 PR에서)
- ADR-0009: "M7c 결과" 절 — `image` 좌표 필드(4.5), `'slide'` → `'slides'`를 004가 했다(판정 표의 "M7b가 …"를 M7c로 정정), 새 kind는 `image`만.
- ADR-0003: "스키마 v4" 절(3.3 — 다시 만든 두 표, `assets.width`·`height`, `page_texts`·`page_texts_fts`, 외래 키를 끄는 실행기의 규칙).
- ADR-0007: 새 설정 `library.searchScope`·`reader.imageBackground`.
- ADR-0012: 8절의 재확인.
- ADR-0008(본문 검색): 5절의 결정 — 쪽 글 표, FTS5 trigram 외부 내용 표, 2글자 훑기·1글자 정보만, 추출 작업과 일꾼, 인용 단위(`extracted_chunks`)는 T1. (컨트롤러 판정 J33: ADR-0009 6절이 FTS·추출의 시점을 예약된 ADR-0008로 미뤄 두었다)
- `acceptance.md`(AC16 본문 검색 줄, M7c 완료 조건), `next-session.md`("M7c 결과", 소유자 할 일의 번역 확인 명령), `mac-verification.md`("M7c").

## 17. 위험
- **`utilityProcess`의 pdf.js**: `isNodeJS`가 거짓이라 기본 팩터리가 DOM 것이다(5.2). 명세 작성 중 스파이크로 글 뽑기는 확인했지만 한국어 cMap(`korean.pdf`)·큰 문서·포장한 앱(asar 안의 `out/renderer/pdfjs`를 `fs`로 읽기)은 아직이다 → 첫 추출 작업이 `korean.pdf`·`paper-100.pdf`로 단위·E2E를 먼저 세우고, 포장 빌드 확인은 M14 실기 목록에 넣는다. 막히면 `pdfjs-dist/legacy/build`로 바꿔 보고 판정으로 적는다.
- **DB 크기**: 색인이 글의 약 2배라 PDF 1,000개에 약 150 MB가 늘고 백업·복원이 그만큼 길어진다(스크래치 측정). 실제 논문 크기로 재고(`search-perf.json`에 DB 크기 줄) 넘치면 `columnsize=0` 등을 판정으로 본다.
- **main 막힘**: 동기 SQLite 질의 — 2글자 훑기는 나눠서(5.6), FTS는 한 문장. 1만 PDF 규모는 측정 밖이라 보고만 한다.
- **마이그레이션의 표 다시 만들기**: 순서를 틀리면(옛 표 이름 먼저 바꾸기) 자식 외래 키가 지운 표를 가리킨다. 단위 시험이 `foreign_key_list`와 `foreign_key_check`로 지킨다. 실패하면 트랜잭션이 되돌리고 `.pre-v4.bak`이 있다.
- **2글자의 대소문자**: SQLite `LIKE`는 ASCII만 접는다 — "Éc"와 "éc"는 다르게 본다. 한국어와 ASCII에는 영향이 없다. 바꾸려면 접은 글 열을 하나 더 두는 비용(약 1배 크기)이 든다 → 알려진 한계로 적는다.
- **pdf.js 찾기와 색인의 차이**: 하이픈·합자·NFC를 맞췄지만 어긋나면 쪽은 열리고 찾기 막대가 "찾을 수 없음"이다(쪽은 맞다). E2E가 `search-30.pdf`·`korean.pdf`로 지킨다.
- **이미지 크기와 방향**: EXIF 밖의 방향(WebP·PNG `eXIf`, AVIF `imir`)은 저장한 크기와 그림이 다를 수 있다 — 리더는 디코드 값을 쓰고 패널 줄만 틀릴 수 있다. EXIF 방향 6 JPEG는 E2E가 지킨다.
- **거대한 이미지**: 디코드 실패는 끝 상태로, 패널은 5,000만 화소 위에서 미리보기를 하지 않는다(J12). 디코드 메모리는 Chromium 몫이다.
- **추출이 주는 부하**: 한 번에 하나·낮은 우선순위·작업 줄이 쉴 때만·유휴 뒤에 시작. 13절의 "추출 중 스크롤 p95"가 지킨다.
- **R48류 Mac 간헐 실패**: 새 E2E가 많다 — 조건 기다림만 쓰고(7절과 같은 규칙) 부정 확인은 양성 대조 뒤에만.
