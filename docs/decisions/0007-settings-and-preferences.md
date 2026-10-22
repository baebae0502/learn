# ADR-0007: 설정·환경설정·읽기 위치 — 세 저장소의 구분

- 상태: 채택 (2026-10-21) · M2 · 관련: ADR-0003(저장 구조), ADR-0005(명령·메뉴), 명세 09·12

## 맥락
M2에서 테마·밀도·정렬·창 배치·읽기 위치를 저장하기 시작한다. 이것들을 한 곳에 몰면 둘 중 하나가 깨진다. 라이브러리 위치 자체는 라이브러리 DB 안에 둘 수 없고(DB를 열려면 위치를 먼저 알아야 한다), 읽기 위치는 자료·revision과 함께 지워지고 복원돼야 한다. 또 사용자 홈이 여러 서버에 NFS로 공유되는 환경도 있어 기기 값과 라이브러리 값이 섞이면 기기마다 다른 설정이 서로를 덮어쓴다.

## 결정
저장소는 셋이고, 값은 "누구에게 속하는가"로 나눈다.

| 저장소 | 위치 | 속하는 것 | 스키마 |
|---|---|---|---|
| 기기 환경설정 | `userData/preferences.json` (라이브러리 밖) | 이 기기·이 사용자 계정의 값 | `prefsSchema`(`packages/domain/src/settings.ts`) |
| 라이브러리 설정 | `library.sqlite`의 `settings(key, value)` KV | 이 라이브러리를 어떻게 보여 줄지 | `SETTINGS` zod 키 레지스트리 |
| 읽기 위치 | `library.sqlite`의 `reading_positions` 테이블 | 자료(item)·revision에 묶인 구조화 데이터 | 마이그레이션 `002-organize.ts` |

### 1. 무엇이 어디에 가는가
- **기기 환경설정**: `theme`(`system`·`light`·`dark`), `density`(`compact`·`regular`·`comfortable`, 행 높이 24/28/32, 기본 `regular`), `fontSize`(12·13·14·15pt, 기본 13), `libraryRoot`(절대 경로 또는 `null`). 라이브러리를 열기 전에 필요한 값(라이브러리 위치)과 창이 뜨기 전에 적용해야 하는 값(테마)이 여기 있다. 사용자 단축키 재지정(P6)도 여기에 둘 계획이다(ADR-0005, 아직 필드 없음).
- **라이브러리 설정(KV)**: `library.sort`(정렬 열·방향), `layout.panes`(패널 폭, 0–4000 정수), `ui.lastOpenItemId`(uuid 또는 `null`). 라이브러리 폴더를 다른 기기로 복원하면 따라가야 하는 화면 상태다. 값은 JSON 문자열로 저장하고 쓸 때 `parseSetting`으로, 읽을 때 같은 스키마로 다시 검증한다.
- **구조화 테이블 `reading_positions`**: item당 한 행(`item_id` PK) — `revision_id`, `locator_json`, `progress`(0–1 또는 NULL), `opened_at`, `updated_at`. 자료에 외래 키(`ON DELETE CASCADE`)로 묶이므로 자료가 지워지면 같이 사라지고, `listItems`가 `LEFT JOIN`으로 진행률·마지막 연 시각을 목록에 싣는다. KV가 아니라 테이블인 이유는 정렬·조인·무결성 제약(`progress` CHECK, FK)이 필요하고, 값이 자료 수만큼 늘어나기 때문이다. 키 레지스트리에 항목별 키를 만들면 레지스트리가 데이터가 된다.
  - `opened_at`은 "마지막으로 연 시각"이다. 뷰어가 열릴 때마다 렌더러가 `reader.open({itemId})`을 한 번 부른다. main은 행이 있으면 `opened_at`만 지금으로 바꾸고, 없으면 자료 종류의 시작 위치(`{kind:'pdf',pageIndex:0}`·`{kind:'video',timeMs:0}`), 자료의 최신 revision, `progress` NULL로 행을 만든다. 그래서 쪽이나 시각을 바꾸지 않고 닫아도 열람이 기록된다. `reader.getPosition`은 읽기만 하고, `reader.savePosition`은 `opened_at`을 바꾸지 않는다(비어 있을 때만 채운다). 열기는 `libraryChanged`로 알리지 않는다(M2 목록은 이 값을 표시하지 않는다).

판별 규칙: (a) 라이브러리를 열기 전에 필요하거나 기기마다 달라야 하면 환경설정, (b) 라이브러리 전체에 하나뿐인 화면 상태면 KV, (c) 자료·revision마다 하나씩 있거나 조회·정렬·무결성이 필요하면 테이블.

### 2. 레지스트리와 검증
- 라이브러리 설정은 `SETTINGS`에 등록된 키만 받는다. 미등록 키는 쓰기·읽기 모두 `VALIDATION_FAILED`. 저장된 값이 깨졌거나(JSON 오류) 스키마와 맞지 않으면 `get`은 예외 대신 `undefined`(= 기본값)를 돌려주고 코드만 로그에 남긴다.
- 키를 추가하려면 레지스트리에 zod 스키마를 넣는다. DB 마이그레이션은 필요 없다.
- 환경설정은 필드마다 따로 검증한다(`prefsFields`). 파일에 없는 필드는 기본값을 쓰고, 값이 잘못된 필드는 **그 필드만** 기본값으로 쓰며 로그에는 `PREFS_FIELD_INVALID <필드 이름>`만 남긴다. 나머지 필드, 특히 `libraryRoot`는 그대로 쓴다. 필드 하나 때문에 파일 전체를 기본값으로 되돌리거나 격리하지 않는다(§3).
- 모르는 키는 앱에 노출하지 않지만 버리지도 않는다. 저장할 때 패치를 **파일에 저장돼 있던 객체 위에** 덮어 쓰므로, 더 새로운 빌드가 쓴 키와 이 빌드가 읽지 못하는 값은 이전 빌드가 다른 값을 저장해도 남는다. 파일에 없던 알려진 필드는 현재 값(기본값)으로 채워 쓴다.
- 패치 자체는 엄격하게 검증한다(알려진 필드만, `strict`): 렌더러가 보내는 `prefs.set`은 `prefsSetInput`(`libraryRoot` 없음, 아래 "라이브러리 위치"), main 안의 저장소 입력은 `prefsPatchInput`이다. 모르는 키나 잘못된 값은 `VALIDATION_FAILED`이고 아무것도 쓰지 않는다. 패치에서 `undefined`로 온 키는 "변경 없음"이지 기본값으로 되돌리는 것이 아니다. 상대 경로 `libraryRoot`는 저장을 거부하고, 손으로 고친 상대 경로는 무시한다.

### 3. 환경설정 파일의 쓰기와 손상 처리 (`apps/desktop/src/main/prefs.ts`)
- 쓰기는 원자적이다: 같은 폴더에 프로세스·호스트·난수가 들어간 임시 파일 → fsync → rename → 폴더 fsync. 크래시 후에는 옛 파일이나 새 파일 중 하나가 남고 반쪽 파일은 없다(홈이 NFS로 공유될 수 있어 임시 이름에 호스트를 넣는다).
- 파일이 없으면 기본값으로 시작하고, 첫 변경 때까지 파일을 만들지 않는다.
- 파일을 JSON으로 읽을 수 없거나, JSON이지만 객체가 아니거나(배열·`null`·문자열·숫자), 읽기 오류(ENOENT 제외)가 나면 파일을 지우지 않고 `preferences.invalid-<타임스탬프>.json`으로 옮기고(같은 이름이 있으면 `-1`, `-2`…) 기본값으로 시작한다. 객체 안의 필드 값이 잘못된 것은 격리 사유가 아니다(§2, 그 필드만 기본값).
- 옮기는 것까지 실패하면 이번 실행은 **읽기 전용**이다. 기본값으로 동작하되 `set`은 `PREFS_UNAVAILABLE`로 거부한다. 우리가 한 번도 읽지 못한 파일을 덮어쓰는 것이 더 나쁘기 때문이다.
- 로그에는 errno 코드만 남기고 경로·메시지는 남기지 않는다.

### 4. 우선순위
- 라이브러리 위치: `LEARN_LIBRARY_DIR`(환경 변수) > `preferences.json`의 `libraryRoot`(절대 경로일 때만) > `userData/Library`. 환경 변수는 테스트·개발·임시 실행용 덮어쓰기라서 환경설정 파일을 읽은 뒤에도 항상 이긴다.
- 같은 이름의 값은 기기 환경설정과 라이브러리 설정에 중복해서 두지 않는다(출처가 둘이면 우선순위 규칙이 또 필요하다). 둘 사이에 겹치는 키는 현재 없다.
- 라이브러리 설정에서 값이 없거나 깨졌으면 기본값을 쓴다.

### 5. 백업에 포함되는 것
- 백업은 `VACUUM INTO`로 만든 DB 스냅샷이다(ADR-0003). 따라서 **`settings` 테이블과 `reading_positions` 테이블은 스냅샷에 통째로 들어가고** 빈 폴더로 복원하면 그대로 돌아온다.
- manifest `counts`에는 `readingPositions`가 포함된다(복원 시 개수 대조). `settings`는 개수에 넣지 않는다. 설정 값은 자료가 아니라 화면 상태이므로 개수 일치로 검증할 대상이 아니다. `collections`·`collectionItems`·`tags`·`itemTags`·`readingPositions`는 v2에서 추가돼 구 manifest에서는 선택 필드이고, 복원 시 manifest에 있는 필드만 비교한다.
- **`preferences.json`은 백업에 들어가지 않는다.** 기기 값이라 다른 기기로 옮기면 안 되고(특히 `libraryRoot`는 그 기기의 경로다), 라이브러리 폴더 밖에 있다. 새 기기에서는 기본값으로 시작한다.
- 복원된 읽기 위치의 `revision_id`·`item_id`는 같이 복원되는 행을 가리키므로 일관된다. 관리형 파일이 빠진 자산은 missing으로 표시되지만 위치 행은 남는다.

### 6. 비밀값 금지
- 세 저장소 어디에도 API 키·토큰·비밀번호를 두지 않는다. `preferences.json`은 평문이고 `library.sqlite`는 백업·내보내기로 다른 곳에 복사된다. 키 레지스트리와 `prefsSchema`에도 그런 필드를 추가하지 않는다.
- 외부 서비스 키는 P3에서 OS 키체인(macOS Keychain)에 저장하고, 설정에는 "키가 설정됨" 같은 상태 표시나 키체인 항목 이름만 둔다.
  - (2026-10-22) 시점이 바뀌었다: ACP 튜터(T1)는 Learn이 키나 토큰을 다루지 않으므로 키체인은 나중의 API 키 어댑터에서 쓴다(ADR-0010). 저장 규칙은 그대로다.
- 로그에는 환경설정·설정 값을 남기지 않는다(오류 코드만).

## 근거
- 라이브러리 위치는 DB 밖에 있어야 DB를 열 수 있다. 테마는 창을 만들기 전에 알아야 해서 DB를 기다릴 수 없다. 이 둘이 기기 파일을 따로 두는 이유다.
- 정렬·패널 폭은 라이브러리를 복원하면 같이 돌아오는 편이 자연스럽고, 단일 DB 트랜잭션·백업 경로를 그대로 쓴다.
- 읽기 위치를 KV에 JSON으로 넣으면 진행률 정렬·조인·자료 삭제 시 정리를 직접 구현해야 한다. 테이블이면 FK 하나로 끝난다.
- 기기 파일의 손상 처리는 "이전 값을 잃어도 되지만 읽지 못한 파일을 덮어쓰면 안 된다"는 기준이다. 환경설정은 재생성할 수 있지만 사용자가 손으로 고친 파일은 복구 여지가 있어야 한다.

## 검증
- 단위: `prefs.test.ts`(기본값·병합·undefined 무시·필드별 기본값과 `libraryRoot` 유지·모르는 키 보존·패치 검증·원자적 쓰기·폴더 fsync·손상/읽기 불가 격리·읽기 전용·`LEARN_LIBRARY_DIR` 우선), `settings-repository.test.ts`, `settings.test.ts`, `migrate.test.ts` "migration v2 (organize)", `backup.test.ts`(v2 counts에 `readingPositions`), `reading-repository.test.ts`(`markOpened`: 행이 없으면 시작 위치로 생성, 있으면 `opened_at`만 갱신), `apps/desktop/src/main/ipc/reader.test.ts`(`getPosition`은 순수 읽기, `open`은 알림 없음).
- E2E(`tests/e2e/platform.spec.ts`): "prefs: theme dark survives a restart and drives nativeTheme.themeSource", "settings: library.sort survives a restart; an unregistered key is VALIDATION_FAILED". `position.spec.ts`: 읽기 위치 복원, "opening a PDF records openedAt even when the page never changes".
- M3: `packages/domain/test/settings.test.ts` "prefs inputs (R4)", `apps/desktop/src/main/library-folder.test.ts`, `apps/desktop/src/main/ipc/app.test.ts`, E2E `tests/e2e/settings.spec.ts`.

## 라이브러리 위치 (M3)
- `libraryRoot`는 렌더러가 바꿀 수 없다(`prefs.set` 입력에서 제외). 설정 창의 "다른 폴더 선택…"은 `app.chooseLibraryFolder`를 부르고, main이 폴더 대화상자를 띄워 존재·디렉터리·쓰기 가능 여부를 확인한 뒤, "다시 시작해야 합니다" 확인을 받고 저장·재시작한다. 렌더러는 경로를 보내지 않는다(이 채널은 입력이 없다).
- 두 대화상자(폴더 선택, 다시 시작 확인)는 설정 창에 붙는 시트다(macOS). 시트가 열린 동안 설정 창은 메인 창으로 남고, 닫힌 뒤 키 창이 되면 창 상태를 다시 읽는다(메인 창의 시트와 같은 규칙).
- 변경은 **재시작 후** 적용된다(라이브러리 DB를 실행 중에 바꾸지 않는다). 새 폴더에 라이브러리가 없으면 첫 실행처럼 만든다. 이전 라이브러리는 그대로 남는다.
- `LEARN_LIBRARY_DIR` 환경 변수는 여전히 우선한다(개발·E2E). E2E(`LEARN_E2E=1`)에서는 재시작 대신 요청만 기록한다(Playwright는 재시작한 프로세스를 따라갈 수 없다).
- 라이브러리를 열지 못한 화면에서도 위치를 바꿀 수 있다: "설정…"(⌘,)은 main이 직접 여는 명령(`MAIN_OWNED_COMMANDS`)이고, 그 화면의 "설정 열기" 단추도 같은 창을 연다.
