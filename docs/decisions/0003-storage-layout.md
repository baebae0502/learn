# ADR-0003: 저장 구조

- 상태: 채택 (2026-10-20), 스키마 v2 반영 (2026-10-21, M2), 점검·백업·복원·영구 삭제 반영 (2026-11-02, M6) · 관련: spec 08·09·12, ADR-0007

## 결정
- 라이브러리 = 한 폴더: `library.sqlite`, `assets/<sha256 앞 2자>/<sha256>`, `staging/`, `derived/`, `exports/`. 기본 위치 macOS `~/Library/Application Support/Learn/Library`, Linux `~/.config/Learn/Library`(앱 이름 `Learn`), `LEARN_LIBRARY_DIR`로 바꿀 수 있다.
  - `derived/`는 다시 만들 수 있는 파생물을 두는 곳이지만, `derived/open/<assetId>/`는 예외다(M3, 최종 리뷰 I1). 기본 앱으로 열기의 이름 붙은 복사본과, 사용자가 다른 앱에서 고친 수정본(`<제목> (수정본 <날짜 시각>).<확장자>`)이 여기 있다. 그래서 `derived/`를 지우거나 다시 만드는 복구·캐시 정리·복원은 `derived/open/`을 빼야 한다.
  - (M6) 영구 삭제의 정리는 `derived/open/<assetId>/`에서 **이름 붙은 읽기 전용 복사본과 `.DS_Store`만** 지운다(Q-5j). 수정본(`<제목> (수정본 …)`)은 어떤 코드 경로도 지우거나 덮어쓰지 않는다. 복사본이 수정을 담았을 수 있으면(잠금이 풀렸거나 크기가 다르면 — 열기 때와 같은 판정) 지우지 않고 수정본 이름으로 비켜 둔다. 그 폴더는 빈 뒤에만 지운다. 다른 점 파일은 남긴다. 수정본을 지우는 유일한 길은 사용자가 "새 자료로 가져오기"를 눌러 가져오기가 커밋되고 해시가 확인된 뒤의 그 수정본이다. ADR-0006 6절.
- 관리형 파일 이름은 해시뿐이다. 표시 이름은 DB에 둔다. 외부 연결은 경로만 기록하며 이식 불가능하다(백업에는 참조로만 남김).
- 가져오기: staging 복사 → 해시 재검증 → 원자적 rename → 단일 트랜잭션 커밋 → 추출 job 등록. 중간 실패는 DB에 흔적을 남기지 않고, 남은 파일은 라이브러리 점검이 보인다(M6: 파일 › 라이브러리 점검…과 정리할 것이 있을 때의 자동 시트). 앱은 사용자가 시트에서 고르기 전에 아무것도 지우지 않는다.
  - 이미 관리형으로 배치된 같은 해시의 자산을 재사용할 때는 디스크의 파일을 해시로 검증하고, 파일이 없으면 원본에서 복원한다(`ensurePlaced`). 대상이 손상돼 있으면 삭제하지 않고 `staging/corrupt-<sha256>-<id>`로 격리한 뒤 검증된 복사본을 배치하며(점검 시트의 "따로 보관한 손상된 사본" 줄이 보인다 — "Finder에서 보기"만 있고 앱은 지우지 않는다), 복사 중 원본이 바뀐 경우도 감지한다. 커밋이 실패한 뒤 재시도하면 이미 배치된 파일(inode)을 재사용한다.
  - **점검 시트의 처리(M6, 명세 7절)**: `staging/*.part`는 "임시 파일 정리"로 지운다(쓰는 중인 `.part`와 점(`.`)으로 시작하는 파일, `.DS_Store`는 세지도 지우지도 않는다 — Q-8k). `staging/corrupt-*`는 위의 격리 사본이라 보이기만 한다. `assets/` 아래 DB에 없는 관리 사본은 "쓰이지 않는 사본"으로 "자료로 되살리기"(가져오기 큐, 같은 해시라 다시 복사하지 않음) 또는 "정리…"(그 줄 안의 확인 뒤 삭제, 기본 단추는 남김 — Q-8h)로 처리한다. DB에는 있으나 사본이 사라진 관리 자산은 "다시 연결…"로 같은 바이트의 파일에서 사본을 되돌린다(Q-8b). 점검은 `derived/open/`을 정리 대상으로 삼지 않는다. 주인 없는 수정본(자산 행이 없는 `derived/open/<id>/`의 수정본)은 "새 자료로 가져오기"와 "Finder에서 보기"만 있다.
  - **관리 경로 잠금(M6, Q-5b)**: 관리 경로 하나에는 한 번에 하나만 손댄다(`withManagedPath`, main 프로세스 안). 가져오기는 그 파일의 자산을 찾는 순간부터 커밋까지, 영구 삭제·되돌림·정리는 그 사본을 건드리는 동안 그 경로를 쥔다. 영구 삭제 직후 같은 파일의 가져오기가 곧 지워질 사본을 다시 쓰는 경쟁을 막는다(ADR-0006 5절).
- SQLite: WAL, `foreign_keys=ON`, main 프로세스 단일 연결 = 단일 쓰기 큐. `assets.sha256`은 관리형에만 부분 유일 인덱스. job 등록은 `ON CONFLICT(dedupe_key) DO NOTHING`으로 멱등하며, `setAvailability`/`setExternalPath`는 일치하는 행이 없으면 예외를 던진다.
- 스냅샷·백업은 `VACUUM INTO`(WAL 상태에서도 일관된 단일 파일) + 자산 manifest(sha256) + schema version. 복원은 빈 폴더에만 하고 해시·개수를 검증한다. 마이그레이션 전에는 `library.sqlite.pre-v<N>.bak` 스냅샷을 남긴다.
  - manifest는 zod로 검증한다(format, schemaVersion이 앱 버전 이하일 것). 관리형 경로는 manifest 문자열이 아니라 sha256에서 유도하므로 경로 탈출이 불가능하다.
  - **백업 폴더의 모양(M6, 명세 8절, Q-9c)**: 사용자가 고른 위치 안의 `Learn 백업 YYYY-MM-DD HHmm`(같은 이름이 있으면 ` 2`, ` 3`) 폴더에 `library.sqlite`(`VACUUM INTO` 스냅샷), 관리 사본(`managedRelativePath(sha)`로 sha에서 유도한 경로), `manifest.json`이 있다. `derived/`·`staging/`·`exports/`는 넣지 않는다. 휴지통의 자료와 그 사본은 넣는다. manifest `counts`: `items`는 살아 있는 자료, `trashedItems`·`trashedCollections`가 휴지통의 것이다(구 manifest에는 없으니 선택 필드이고 복원은 있는 필드만 대조한다). 외부 연결 자산은 파일 없이 위치만 적는다.
  - **백업 사본은 복제가 아니라 복사다(Q-9g)**: APFS 복제(`COPYFILE_FICLONE`)는 블록을 공유해 원본이 손상되면 백업도 같이 손상된다. 그래서 스트림으로 진짜 읽어 쓰고, 쓴 파일을 flush(fsync)한 뒤 다시 읽어 해시를 확인한다. 폴더 fsync는 만들 때와 복원할 때 모두 한다(Q-2d). 라이브러리 폴더 안에는 백업하지 않고(Q-9h), 백업 폴더 안에는 복원하지 않는다(Q-10g).
  - 복원은 새 빈 폴더(`Learn 복원 YYYY-MM-DD HHmm`)에만 하고 지금 라이브러리는 건드리지 않는다. 복원한 DB에는 `migrate` 뒤에 `PRAGMA quick_check`를 돌려 통과하지 못하면 거부하고(SQLite 손상 코드만 "백업의 라이브러리 데이터가 손상되었습니다"로 매핑한다), DB의 자산 행과 manifest 항목을 교차 확인한다(명세 9.2, Q-2i). 다시 읽어 다른 사본은 `staging/corrupt-<sha>-<id>`로 비킨다(Q-10e).
  - 백업과 복원은 모두 전부 성공 또는 전부 무효다. 형제 임시 폴더에 쓴 뒤 rename하며, 실패 시 임시 폴더를 정리한다.
  - 라이브 라이브러리에서 관리형 파일이 사라져 있으면 백업은 실패하지 않고 그 자산을 `included:false`로 기록한다. 복원 시 해당 자산은 missing으로 표시된다.
- 비밀키는 DB에 저장하지 않는다(OS keychain, P3).
  - (2026-10-22) 튜터는 ACP로 사용자의 에이전트를 띄우고 로그인은 각 공급사 CLI가 맡는다. 그래서 Learn이 비밀을 다루는 것은 나중의 API 키 어댑터부터다(ADR-0010, `docs/spec-amendments.md`). 규칙(DB에 두지 않고 키체인에 둔다)은 그대로다.

## 스키마 v2 (M2, `packages/db/src/migrations/002-organize.ts`)
v1은 `001`의 테이블 그대로다(`items`, `assets`, `item_assets`, `source_revisions`, `collections`, `collection_items`, `tags`, `item_tags`, `anchors`, `annotations`, `jobs`, `settings`). v2는 열·인덱스·테이블을 더하는 마이그레이션이라 v1 데이터는 그대로 남는다. 예외는 하나다. v1의 `tags.name UNIQUE`는 대소문자를 구분했으므로, 대소문자만 다른 이름의 태그는 가장 먼저 만든 태그(가장 작은 rowid)로 합친다. 할당(`item_tags`)은 그 태그로 옮기고(중복은 하나만) 나머지 태그는 지운다. 그래야 `tags_name_nocase`를 만들 수 있다. 적용 전에는 스냅샷 `library.sqlite.pre-v<N>.bak`을 남긴다(N은 첫 대기 마이그레이션 버전이므로 v1→v2에서는 `library.sqlite.pre-v2.bak`).

변경된 것:
- `collections`: `updated_at`, `deleted_at`(휴지통) 열 추가. 인덱스 `collections_parent(parent_id)`.
- `collection_items`: `added_at` 열 추가. 인덱스 `collection_items_item(item_id)`.
- `tags`: `color`, `position`(NULL 또는 1–8 CHECK — 색 태그 단축키 1–8), `created_at` 열 추가. 유일 인덱스 `tags_position`(position이 NULL이 아닐 때), `tags_name_nocase`(`name COLLATE NOCASE` — 대소문자만 다른 같은 이름 거부. v1에 이미 있던 그런 이름은 위 규칙으로 합친 뒤 만든다).
- 새 테이블 `reading_positions`: `item_id` PK(→ `items`, CASCADE), `revision_id`(→ `source_revisions`, CASCADE), `locator_json`, `progress`(NULL 또는 0–1), `opened_at`, `updated_at`. 인덱스 `reading_positions_revision(revision_id)`. 자료당 한 행이며 저장 정책은 ADR-0007.
- 외래 키 자식 열과 조회 열 인덱스(v1에서 빠져 있던 것): `item_tags_tag(tag_id)`, `items_deleted_at(deleted_at)`, `anchors_revision(revision_id)`, `annotations_anchor(anchor_id)`, `jobs_state(state)`, `source_revisions_parent(parent_revision_id)`.
- 코드 쪽: `LATEST_SCHEMA_VERSION`은 `MIGRATIONS` 배열에서 유도한다(상수를 따로 올리지 않는다). 업그레이드가 실패하면 오류 문구가 어디까지 적용됐는지("데이터베이스는 v<M> 상태입니다")와 다음 행동("앱을 다시 시작해 보세요")을 알리고, 백업을 만들었을 때만 그 파일 이름을 넣는다("업데이트 전 백업(library.sqlite.pre-v<N>.bak)이 라이브러리 폴더에 있습니다").
- 백업: manifest `counts`에 `collections`, `collectionItems`, `tags`, `itemTags`, `readingPositions`를 추가했다. v1 때 만든 manifest에는 없으므로 선택 필드이고, 복원 시 manifest에 있는 필드만 대조한다. DB 스냅샷이 전체이므로 `settings`·`reading_positions` 내용은 개수와 무관하게 복원된다(ADR-0007).

## 스키마 v4 (M7c, `packages/db/src/migrations/004-images-text.ts`)
SQLite는 CHECK를 고칠 수 없어 `items`와 `anchors`를 다시 만든다. `items.type`에 `image`를 더하고, `anchors.kind`는 `slide`를 `slides`로 바꾸며 `image`를 더한다(`slide` 행은 열과 `locator_json`의 `kind`를 함께 `slides`로 고친다. JSON이 아닌 `locator_json`은 그대로 옮긴다). 두 표 모두 rowid를 그대로 옮긴다(정렬의 동점 처리가 `i.rowid`, `listByRevision`이 `rowid`를 쓴다). 002의 색인 `items_deleted_at`·`anchors_revision`은 다시 만든다.

- 순서가 규칙이다. 새 표를 만들고, 옮기고, 옛 표를 지우고, 새 표의 이름을 바꾼다. 옛 표의 이름을 먼저 바꾸면 SQLite 3.26+는 외래 키가 꺼져 있어도 자식 표의 `REFERENCES`를 옛 이름으로 고쳐 쓴다.
- `assets.width`·`assets.height`(NULL 또는 양수): 이미지의 표시용 크기. 읽지 못하면 둘 다 NULL이고 가져오기는 성공한다.
- `page_texts(id, sha256, page_index, text)`(`UNIQUE(sha256, page_index)`)와 외부 내용 FTS5 표 `page_texts_fts`(`content='page_texts'`, `tokenize='trigram remove_diacritics 2'`). 넣기·지우기·고치기 트리거 셋이 색인을 맞춘다.
- 아무도 소비하지 않은 `extract:*:text-v0` 작업을 지운다.

외래 키를 끄는 실행기(`Migration.foreignKeysOff`, 004만 켠다)의 규칙 다섯:
1. 트랜잭션 밖에서 `PRAGMA foreign_keys = OFF`를 하고(트랜잭션 안에서는 효과가 없다) 값이 0인지 읽어 확인한다. 트랜잭션 안에서 불리면 거절한다.
2. SQL은 한 트랜잭션 안에서 돈다.
3. 커밋 전, 같은 트랜잭션 안에서 `PRAGMA foreign_key_check`를 하고 한 행이라도 있으면 던져 되돌린다. 실패 문구는 다른 마이그레이션과 같다.
4. `schema_migrations` 행은 같은 트랜잭션에서 쓴다(일반 길과 같은 `record()`).
5. 성공이든 실패든 `finally`에서 `PRAGMA foreign_keys = ON`으로 되돌린다. 설정은 연결마다라서 도중에 앱이 죽어도 저널이 되돌리고 다음 연결이 다시 켠다.

백업은 그대로다(대기 중인 첫 마이그레이션 앞에서 `library.sqlite.pre-v4.bak`).

## 근거
원본 불변·재시작 복구·빈 프로필 복원(AC01·AC06·AC15)을 파일 시스템과 DB 양쪽에서 단순하게 보장하기 위해서다.
