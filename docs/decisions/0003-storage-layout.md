# ADR-0003: 저장 구조

- 상태: 채택 (2026-10-20), 스키마 v2 반영 (2026-10-21, M2) · 관련: spec 08·09·12, ADR-0007

## 결정
- 라이브러리 = 한 폴더: `library.sqlite`, `assets/<sha256 앞 2자>/<sha256>`, `staging/`, `derived/`, `exports/`. 기본 위치 macOS `~/Library/Application Support/Learn/Library`, Linux `~/.config/Learn/Library`(앱 이름 `Learn`), `LEARN_LIBRARY_DIR`로 바꿀 수 있다.
- 관리형 파일 이름은 해시뿐이다. 표시 이름은 DB에 둔다. 외부 연결은 경로만 기록하며 이식 불가능하다(백업에는 참조로만 남김).
- 가져오기: staging 복사 → 해시 재검증 → 원자적 rename → 단일 트랜잭션 커밋 → 추출 job 등록. 중간 실패는 DB에 흔적을 남기지 않고, 남은 파일은 복구 스캔이 보고만 한다(자동 삭제 없음).
  - 이미 관리형으로 배치된 같은 해시의 자산을 재사용할 때는 디스크의 파일을 해시로 검증하고, 파일이 없으면 원본에서 복원한다(`ensurePlaced`). 대상이 손상돼 있으면 삭제하지 않고 `staging/corrupt-<sha256>-<id>`로 격리한 뒤 검증된 복사본을 배치하며(복구 스캔이 staging 잔여물로 보고한다), 복사 중 원본이 바뀐 경우도 감지한다. 커밋이 실패한 뒤 재시도하면 이미 배치된 파일(inode)을 재사용한다.
- SQLite: WAL, `foreign_keys=ON`, main 프로세스 단일 연결 = 단일 쓰기 큐. `assets.sha256`은 관리형에만 부분 유일 인덱스. job 등록은 `ON CONFLICT(dedupe_key) DO NOTHING`으로 멱등하며, `setAvailability`/`setExternalPath`는 일치하는 행이 없으면 예외를 던진다.
- 스냅샷·백업은 `VACUUM INTO`(WAL 상태에서도 일관된 단일 파일) + 자산 manifest(sha256) + schema version. 복원은 빈 폴더에만 하고 해시·개수를 검증한다. 마이그레이션 전에는 `library.sqlite.pre-v<N>.bak` 스냅샷을 남긴다.
  - manifest는 zod로 검증한다(format, schemaVersion이 앱 버전 이하일 것). 관리형 경로는 manifest 문자열이 아니라 sha256에서 유도하므로 경로 탈출이 불가능하다.
  - 백업과 복원은 모두 전부 성공 또는 전부 무효다. 형제 임시 폴더에 쓴 뒤 rename하며, 실패 시 임시 폴더를 정리한다.
  - 라이브 라이브러리에서 관리형 파일이 사라져 있으면 백업은 실패하지 않고 그 자산을 `included:false`로 기록한다. 복원 시 해당 자산은 missing으로 표시된다.
- 비밀키는 DB에 저장하지 않는다(OS keychain, P3).

## 스키마 v2 (M2, `packages/db/src/migrations/002-organize.ts`)
v1은 `001`의 테이블 그대로다(`items`, `assets`, `item_assets`, `source_revisions`, `collections`, `collection_items`, `tags`, `item_tags`, `anchors`, `annotations`, `jobs`, `settings`). v2는 `ALTER`와 `CREATE`만 쓰는 추가형 마이그레이션이라 v1 데이터는 그대로 남는다. 적용 전에 v1 상태의 스냅샷 `library.sqlite.pre-v2.bak`(이름의 N은 첫 대기 마이그레이션 버전)을 남긴다.

변경된 것:
- `collections`: `updated_at`, `deleted_at`(휴지통) 열 추가. 인덱스 `collections_parent(parent_id)`.
- `collection_items`: `added_at` 열 추가. 인덱스 `collection_items_item(item_id)`.
- `tags`: `color`, `position`(NULL 또는 1–8 CHECK — 색 태그 단축키 1–8), `created_at` 열 추가. 유일 인덱스 `tags_position`(position이 NULL이 아닐 때), `tags_name_nocase`(`name COLLATE NOCASE` — 대소문자만 다른 같은 이름 거부).
- 새 테이블 `reading_positions`: `item_id` PK(→ `items`, CASCADE), `revision_id`(→ `source_revisions`, CASCADE), `locator_json`, `progress`(NULL 또는 0–1), `opened_at`, `updated_at`. 인덱스 `reading_positions_revision(revision_id)`. 자료당 한 행이며 저장 정책은 ADR-0007.
- 외래 키 자식 열과 조회 열 인덱스(v1에서 빠져 있던 것): `item_tags_tag(tag_id)`, `items_deleted_at(deleted_at)`, `anchors_revision(revision_id)`, `annotations_anchor(anchor_id)`, `jobs_state(state)`.
- 코드 쪽: `LATEST_SCHEMA_VERSION`은 `MIGRATIONS` 배열에서 유도한다(상수를 따로 올리지 않는다). 다단계 업그레이드가 중간에서 실패하면 오류 문구가 어디까지 적용됐는지를 알리고, 백업이 있을 때만 백업 언급을 넣는다.
- 백업: manifest `counts`에 `collections`, `collectionItems`, `tags`, `itemTags`, `readingPositions`를 추가했다. v1 때 만든 manifest에는 없으므로 선택 필드이고, 복원 시 manifest에 있는 필드만 대조한다. DB 스냅샷이 전체이므로 `settings`·`reading_positions` 내용은 개수와 무관하게 복원된다(ADR-0007).

## 근거
원본 불변·재시작 복구·빈 프로필 복원(AC01·AC06·AC15)을 파일 시스템과 DB 양쪽에서 단순하게 보장하기 위해서다.
