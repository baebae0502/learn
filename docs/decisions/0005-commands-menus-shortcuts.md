# ADR-0005: 명령·메뉴·단축키 — 단일 명령 레지스트리

- 상태: 제안 (2026-10-21) · M2에서 골격, M3부터 화면 연결 · 관련: `docs/design/design-spec.md` 7절, ADR-0004

## 맥락
메뉴 막대, ⌘K 팔레트, 컨텍스트 메뉴, 도구 막대 버튼, 단축키 도움말(⌘/)이 같은 명령을 각자 정의하면 레이블·단축키·활성 조건이 어긋나고, 핸들러 없는 "가짜 컨트롤"이 생긴다. 현재 앱은 Electron 기본 메뉴(⌘R 새로 고침, DevTools 노출)를 그대로 쓰고 단축키가 없다. 한국어 입력기(IME)는 한 글자 단축키와 충돌한다.

## 결정

### 1. 레지스트리
- `packages/domain/src/commands.ts`에 모든 명령을 데이터로 둔다(zod 없음, 순수 TS).
  ```ts
  interface CommandSpec {
    id: CommandId;               // 'library.import', 'reader.find', 'video.togglePlay' …
    label: string;               // 한국어, 메뉴 표기 그대로('파일 가져오기…')
    context: 'app' | 'library' | 'reader.pdf' | 'reader.video' | 'palette';
    accelerator?: string;        // Electron 형식 'CmdOrCtrl+Shift+N' — 메뉴가 소유
    key?: { code: string; shift?: boolean }; // 한 글자 단축키 — 렌더러 키맵이 소유
    menu?: { path: MenuPath; group: number; order: number };
    palette?: boolean;           // 기본 true
    contextMenus?: ContextMenuKind[]; // 'item' | 'collection' | 'tag' | 'column' | 'tab' | 'selection'
    destructive?: boolean;
  }
  ```
- 렌더러는 `registerHandler(id, fn, isEnabled)`로 핸들러를 붙인다. **핸들러가 없거나 비활성인 명령은 메뉴·팔레트·도구 막대에서 그리지 않거나 비활성으로 표시**한다(가짜 금지의 강제 장치).
- 단축키 도움말(⌘/), 팔레트 목록, 메뉴 막대, 컨텍스트 메뉴, 도구 막대 툴팁의 단축키 표기는 모두 레지스트리에서 생성한다.

### 2. 메뉴가 소유하는 단축키
- ⌘·⌃·⌥ 조합은 **네이티브 메뉴 막대**가 소유한다. 한국어 메뉴: Learn · 파일 · 편집 · 보기 · 이동 · 자료 · 창 · 도움말. "다시 불러오기(⌘R)"는 없고, DevTools는 개발 빌드에서만.
- 메뉴 클릭(또는 가속기)은 main → 포커스된 창의 렌더러로 `menu:command { id }` 푸시 → 레지스트리 디스패치. 렌더러는 같은 조합을 `keydown`으로 다시 듣지 않는다(⌘K가 **정확히 1번** 처리됨을 E2E로 확인).
- 렌더러는 상황(활성 탭 종류, 선택 수, 편집 중, 찾기 막대 열림)을 `ui:context`로 main에 알리고, main은 메뉴 항목의 `enabled`/`checked`를 갱신한다.
- 표기: 기호 순서 ⌃⌥⇧⌘, 대화상자를 여는 항목은 "…", 위험 동작은 그룹 맨 아래.

### 3. 렌더러 키맵(한 글자 단축키)
- 대상: 1–8(색 태그), J/K/L·스페이스·쉼표/마침표·C·M·F(영상), H/U/N/P/E(필기 도구, M9), 리더의 화살표·스페이스 스크롤.
- **무시 조건**: `event.isComposing` 또는 `keyCode === 229`(IME 조합 중), 포커스가 `input`·`textarea`·`[contenteditable]`·RAC 텍스트 필드, ⌘/⌃/⌥가 눌림(이건 메뉴 몫).
- 글자 키는 `event.key`가 아니라 **`event.code`**(물리 키, `KeyJ`)로 비교한다. 한국어 두벌식 상태에서 J는 `key: 'ㅓ'`지만 `code: 'KeyJ'`이므로 입력 소스와 무관하게 동작한다.
- 한 글자 단축키도 레지스트리의 `key`에서 오므로 도움말에 나온다.

### 4. 컨텍스트 메뉴
- 네이티브 `Menu.popup`. 렌더러가 `learn.ui.showContextMenu({ kind, targetIds })`를 호출 → main이 레지스트리에서 `contextMenus`에 그 종류가 있는 명령을 모아 메뉴를 만들고 → 선택 결과를 같은 `menu:command` 경로로 돌려준다. 오른쪽 클릭은 먼저 선택을 바꾼다(명세 7.1).
- 입력란에는 별도의 편집 메뉴(잘라내기·복사·붙여넣기·모두 선택, 맞춤법 없음).
- 웹으로 그리는 팝업 메뉴는 내용 안의 팝업 버튼(확대 비율, 자막 선택)에만 쓰고, 항목은 역시 레지스트리 명령이다.

### 5. 팔레트(⌘K)
- 활성 명령(`palette !== false`) + 자료·컬렉션 검색 결과를 한 목록에. 묶음 순서는 검색어와의 일치도(자료 → 컬렉션 → 명령이 기본, 명령 이름과 정확히 맞으면 명령이 위).
- 한국어: NFC 정규화 후 부분 일치 + 초성 일치(ㅅㅎ → 신호). 최근 실행·최근 연 자료에 가중치.
- ↩ 실행, ⌘↩ 새 탭에서 열기, esc 닫기. 열린 상태에서 메뉴 단축키는 팔레트를 닫고 실행한다.

### 6. 재지정
- 사용자 단축키 재지정은 P6. 그때 prefs에 덮어쓰기를 저장하고, 같은 맥락 안 충돌을 거부한다.

## 근거
- 하나의 원천이면 "메뉴에는 있는데 팔레트에는 없다", "툴팁 단축키가 실제와 다르다" 같은 불일치가 구조적으로 생기지 않는다(Codex/Linear식 명령 중심 UI).
- Mac에서 ⌘ 조합은 메뉴 막대가 처리하는 것이 관례이고, 메뉴를 열지 않아도 사용자가 찾을 수 있다(발견 가능성). 웹 `keydown`으로 중복 처리하면 IME·포커스에 따라 두 번 실행되거나 안 된다.
- `event.code` 비교와 조합 중 무시는 한국어 사용자가 입력 소스를 바꾸지 않고 리더를 조작할 수 있게 한다.

## 검증
- 단위: id 유일, 같은 `context` 안 `accelerator`·`key` 중복 없음, 메뉴 경로가 있는 명령은 한국어 레이블, 위험 명령은 확인 대화상자 플래그.
- E2E: 메뉴 JSON 덤프(한국어, Reload 없음), 메뉴 명령 전달, ⌘K 정확히 1회, 컨텍스트 메뉴 stub, `commands.coverage.spec`(활성 명령을 모두 실행해 예외 없음), CI에서 "P[0-9] 단계" 문구 금지.
- macOS 증거: 메뉴 막대 스크린샷(한국어), 네이티브 컨텍스트 메뉴 캡처(가능하면).
