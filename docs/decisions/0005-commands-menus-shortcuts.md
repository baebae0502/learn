# ADR-0005: 명령·메뉴·단축키 — 단일 명령 레지스트리

- 상태: **채택** (2026-10-21, M3) · M2에서 골격, M3에서 가용성·메뉴 상태·팔레트·단축키 시트 연결 · M5: 하위 메뉴·체크·값·대상을 더함(1, 4절), 1–8 키(3절), 팔레트의 컬렉션(5절) · 관련: `docs/design/design-spec.md` 7절, ADR-0004

## 맥락
메뉴 막대, ⌘K 팔레트, 컨텍스트 메뉴, 도구 막대 버튼, 단축키 도움말(⌘/)이 같은 명령을 각자 정의하면 레이블·단축키·활성 조건이 어긋나고, 핸들러 없는 "가짜 컨트롤"이 생긴다. 현재 앱은 Electron 기본 메뉴(⌘R 새로 고침, DevTools 노출)를 그대로 쓰고 단축키가 없다. 한국어 입력기(IME)는 한 글자 단축키와 충돌한다.

## 결정

### 1. 레지스트리
- `packages/domain/src/commands.ts`에 모든 명령을 데이터로 둔다(zod 없음, 순수 TS).
  ```ts
  type CommandContext = 'app' | 'library' | 'viewer' | 'item' | 'collection' | 'tag'; // item·collection·tag: 그 종류의 대상이 있어야 한다
  type MenuName = 'app' | 'file' | 'edit' | 'view' | 'go' | 'window' | 'help'; // app: macOS 앱 메뉴(그 밖에는 파일 끝)
  type ContextMenuKind = 'item' | 'collection' | 'tag' | 'column';
  interface CommandSpec {
    id: CommandId;               // 'file.importManaged', 'nav.back', 'item.relink' …
    label: string;               // 한국어, 메뉴 표기 그대로('파일 가져오기…')
    labelOff?: string;           // macOS 앱 이름(Finder)이 들어간 레이블의 Linux/Windows 판
    accelerator?: string;        // Electron 형식 'Alt+CmdOrCtrl+O' — 메뉴가 소유
    key?: KeySpec;               // { code: 'KeyJ', shift?, inText? } 한 글자 단축키 — 렌더러 키맵이 소유
    menu?: { menu: MenuName; group: number; order: number };
    contextMenu?: { kinds: readonly ContextMenuKind[]; group: number; order: number; onlyWhenAvailable?: boolean };
    contexts: CommandContext[];
    palette?: boolean;           // 기본: 대상 자료가 필요 없는 명령이면 true
    keywords?: readonly string[]; // 팔레트 검색어: 한국어 먼저(초성 검색), 영어는 습관용
    submenu?: 'collections' | 'tagColors' | 'sortColumns'; // 값 하위 메뉴: 줄마다 값(args)이 붙는 같은 명령
    paletteLabel?: string;       // 팔레트에서만 다른 이름('컬렉션 이름 바꾸기')
  }
  ```
- 값과 대상: `CommandArgs = { collectionId?; position?; column?; direction?; addSelection? }`, `CommandTarget = { itemIds?; collectionIds?; tagIds?; args? }`. 렌더러 처리기는 `(env, target: CommandTarget) => void`이고 메뉴 막대·팔레트·키맵·컨텍스트 메뉴가 같은 대상으로 부른다(`runPicked({ commandId, args }, env, target)`). `CommandTargetInfo`는 종류가 붙은 합집합(`item | collection | tag`)이라 자료 규칙은 자료 대상만 본다.
- 묶음 하위 메뉴: 명령 여럿을 한 하위 메뉴에 모으는 것은 별도 `SUBMENUS: SubmenuSpec[]`(`{ id; label; commands; menu?; contextMenu? }`, 첫 사용은 색 태그 `tag.color1`–`8`)다. 키맵·⌘/·팔레트가 명령마다 키를 알아야 해서 명령을 하나로 합치지 않는다. 처리기 없는 줄은 여전히 생길 수 없다(`submenuProblems`가 검사한다).
- 가용성은 `isCommandAvailable(id, ctx, targets)` 하나다. main(메뉴 막대·컨텍스트 메뉴)과 렌더러(팔레트·도구 막대·키맵)가 같은 함수를 쓴다. 렌더러는 핸들러 표(`COMMAND_HANDLERS`)만 갖는다.
- 단축키 도움말(⌘/), 팔레트 목록, 메뉴 막대, 컨텍스트 메뉴, 도구 막대 툴팁의 단축키 표기는 모두 레지스트리에서 생성한다.

### 2. 메뉴가 소유하는 단축키
- ⌘·⌃·⌥ 조합은 **네이티브 메뉴 막대**가 소유한다. 한국어 메뉴: Learn · 파일 · 편집 · 보기 · 이동 · 윈도우 · 도움말(macOS 한국어 표준 이름 '윈도우'). "다시 불러오기(⌘R)"는 없고, DevTools는 개발 빌드에서만.
- 메뉴 클릭(또는 가속기)은 main이 **항상 메인 창**의 렌더러로 `menu:command { id }`를 보낸다(설정·시트 창이 포커스를 가져도 같다. 메인 창이 포커스가 없으면 먼저 포커스한다). main 소유 명령(`MAIN_OWNED_COMMANDS`, M3 Task 10의 설정)은 렌더러로 보내지 않고 main이 직접 실행한다. 렌더러는 같은 조합을 `keydown`으로 다시 듣지 않는다(⌘K가 **정확히 1번** 처리됨을 E2E로 확인).
- 렌더러는 `CommandContextState`(`view`, `blocked`, M3 Task 10부터 `textSize`)를 바뀔 때마다 `ui:reportContext`로 보내고, main은 `availableMenuCommands(ctx)`로 활성 항목을 정한다. 메뉴는 시작할 때 한 번 만들고(플랫폼·레이블이 바뀔 때만 다시 만든다. 아직 그런 경우는 없다), 보고는 상황이 달라졌을 때만 각 레지스트리 항목과 숨은 짝의 `enabled`를 그 자리에서 바꾼다(`applyMenuEnabled`, 항목 id는 `menuItemIds`). 다시 만들지 않으므로 열린 메뉴가 닫히지 않고, 창마다 `setMenu`가 다시 돌지 않으며, ⌘+/− 같은 잦은 보고에도 가볍다. 메인 창 밖에서 온 보고는 무시한다. 첫 보고 전과 메인 창이 닫힌 뒤(또는 렌더러가 죽은 뒤)에는 레지스트리 항목이 모두 비활성이다. `MAIN_OWNED_COMMANDS`(설정)는 항상 활성.
- 표기: 기호 순서 ⌃⌥⇧⌘, 대화상자를 여는 항목은 "…", 위험 동작은 그룹 맨 아래. 키캡·한 줄 표기와 플랫폼 가속기는 `accelerator.ts`(`acceleratorKeys`·`acceleratorLabel`·`platformAccelerator`)가 만든다. ⌃⌘ 조합은 Linux/Windows에서 Ctrl+Shift가 되고, ⌘+에는 US 자판의 ⌘=를 받는 숨은 짝 항목이 있다.
- ⌘[/⌘]는 PDF 이동 기록(M7)이므로 M3의 라이브러리로 돌아가기는 ⌘1(첫 탭).

### 3. 렌더러 키맵(한 글자 단축키)
- 대상: 1–8(색 태그), J/K/L·스페이스·쉼표/마침표·C·M·F(영상), H/U/N/P/E(필기 도구, M9), 리더의 화살표·스페이스 스크롤.
- **무시 조건**: `event.isComposing` 또는 `keyCode === 229`(IME 조합 중), 포커스가 `input`·`textarea`·`[contenteditable]`·RAC 텍스트 필드, ⌘/⌃/⌥가 눌림(이건 메뉴 몫).
- 글자 키는 `event.key`가 아니라 **`event.code`**(물리 키, `KeyJ`)로 비교한다. 한국어 두벌식 상태에서 J는 `key: 'ㅓ'`지만 `code: 'KeyJ'`이므로 입력 소스와 무관하게 동작한다.
- 한 글자 단축키도 레지스트리의 `key`에서 오므로 도움말에 나온다.
- **1–8 (M5)**: `tag.color1`–`8`은 `key: { code: 'Digit1' }`…를 가진 레지스트리 명령이고 가속기를 갖지 않는다. 숫자 키패드의 `Numpad1`–`8`도 같은 키로 받는다. Linux·Windows 메뉴 막대의 "색 태그 ▸"는 "1"…"8"을 표시만 하고 등록하지 않는다(`registerAccelerator: false`) — 등록하면 글자 칸의 숫자 입력까지 메뉴가 가로챈다. macOS에서는 `registerAccelerator: false`가 듣지 않고, AppKit이 ⌘ 없는 키도 웹 보기보다 먼저 메인 메뉴에 주므로(Chromium `RenderWidgetHostViewCocoa`가 "메인 메뉴에 ⌘ 없는 키 등가를 두지 말라"고 가정한다) 메뉴 막대의 그 줄에는 숫자를 아예 두지 않는다. 컨텍스트 메뉴는 모든 플랫폼에서 숫자를 보이고, 팝업은 모달이라 렌더러가 키를 볼 수 없으므로 숫자로 고른 줄(`triggeredByAccelerator`)도 실행한다. 메뉴 막대의 숫자 줄을 가속기로 고른 것은 무시한다(키는 렌더러 키맵 몫). 자리에 태그가 없어도 명령은 돌고 처리기가 토스트로 말한다. 팔레트는 그 자리에 태그가 있을 때만 이 명령을 보이고(`paletteListed`), ⌘/ 시트는 "정리" 묶음에 한 줄 "1–8 · 색 태그 붙이기/떼기"로 접어 보인다.

### 4. 컨텍스트 메뉴
- 네이티브 `Menu.popup`. 렌더러가 `learn.ui.showContextMenu({ kind, …대상, x, y })`를 호출 → main이 레지스트리에서 `contextMenu.kinds`에 그 종류가 있는 명령을 모아 `isCommandAvailable`로 활성 상태를 정해 메뉴를 만든다. 선택한 명령은 `ui:showContextMenu` invoke의 **반환값**(`{ commandId, args? } | null`)으로 돌아오고, 렌더러는 `runPicked`로 실행한다(main이 새 파일 상태로 이미 판정). 종류는 `item | collection | tag`(열 머리 메뉴는 자기 채널 `ui:showColumnMenu`)이고, 어느 명령도 올리지 않은 종류는 DB를 읽기 전에 null을 돌려준다. `onlyWhenAvailable` 명령(다시 연결…)은 쓸 수 없으면 빠진다. 오른쪽 클릭은 먼저 선택을 바꾼다(명세 7.1).
- **하위 메뉴·체크·값 (M5)**: 메뉴 줄은 레지스트리 명령 + 값에서만 나온다. 값 하위 메뉴(컬렉션에 추가 ▸, 색 지정 ▸, 정렬 기준 ▸)의 줄은 항목 id `cmd?k=v`, 묶음 하위 메뉴의 머리는 `submenu.<id>`이다. 체크 표시(`checkbox`·`radio`)와 줄 오른쪽 힌트("1"…"8"), 색 지정·색 태그 줄의 16px 색 점 이미지, 이름 속 `&`의 두 번 쓰기(Q-28)를 구성기(`M/menu/submenus.ts`)가 만든다. 자료 메뉴의 체크는 질의 한 번의 소속·붙임으로 계산하고, 1만 개 선택에서는 자료 전체 대신 판정에 쓰는 두 열만 읽는다(`targetFacts`, M5 Task 11).
- **메뉴 막대는 동적이다 (M5)**: 컬렉션 트리·색 태그·정렬 열은 main이 DB와 보고된 맥락(`CommandContextState`의 `scope`·`collectionCount`·`tagPositions`·`selectionTagPositions`·`sortColumn`·`sortDirection`·`columnsShown` …)에서 만든다. `libraryChanged`(`collections`·`tags`)와 맥락 변화에서 100ms 디바운스로 다시 만들고, 네이티브 메뉴가 열려 있는 동안(`nativeMenu { open }`)과 닫힌 뒤 100ms는 미룬다(열린 메뉴가 닫히지 않게). 활성 상태만 바뀌면 다시 만들지 않고 그 자리에서 `enabled`를 바꾼다. 메뉴 막대의 "컬렉션에 추가 ▸"에는 체크가 없다(main이 선택의 소속을 모른다). "색 태그 ▸"는 고른 자료가 모두 가진 색 태그에 체크한다 — 렌더러가 그 자리들을 비트 마스크 `selectionTagPositions`(0–255)로 보고하고, 마스크가 바뀔 때만 다시 만든다.
- **키보드로 열기 (M5)**: ⇧F10과 메뉴 키가 포커스된 표 행·트리 행·태그 칩 아래에 메뉴를 연다(`R/ui/contextMenuKey.ts`). 같은 키가 `keydown`과 `contextmenu`로 두 번 오므로 500ms 안의 둘째는 무시한다.
- **확인 시트 `ui:confirm` (M5)**: `{ message, detail?, confirm }` → boolean. 메인 창 전용이고 메인 창의 시트로 붙는 `dialog.showMessageBox`이며 단추는 [확인, 취소](기본 = 확인)다. 주의 아이콘은 `caution`일 때만이고(실행 취소가 있는 컬렉션 삭제는 앱 아이콘), 문구는 렌더러의 `strings/`가 만든다(조사 함수가 렌더러에 있다).
- 입력란에는 별도의 편집 메뉴(잘라내기·복사·붙여넣기·모두 선택, 맞춤법 없음).
- 웹으로 그리는 팝업 메뉴는 내용 안의 팝업 버튼(확대 비율, 자막 선택)에만 쓰고, 항목은 역시 레지스트리 명령이다.

### 5. 팔레트(⌘K)
- 활성 명령(`inPalette`: `palette`가 없으면 대상 자료가 필요 없는 명령, 검색어는 `keywords`) + 자료·컬렉션 검색 결과를 한 목록에. 묶음 순서는 검색어와의 일치도(자료 → 컬렉션 → 명령이 기본, 명령 이름과 정확히 맞으면 명령이 위). 컬렉션 묶음(M5)은 최대 5개이고 순위는 질의의 모든 낱말이 이름에 맞는 것만 → 첫 낱말의 위치 → 경로 길이 → 이름이다. 오른쪽 보조 정보는 "<상위 이름> 안 · N개"(2차색, 상위 이름만 말줄임)이고 ↩는 그 컬렉션 보기로(`setScope`) 간다. 컬렉션 명령(새 하위·이름 바꾸기·가져오기·삭제)은 지금 보는 컬렉션이 대상이다. 자료 순위는 점수를 한 번 계산해 상위 5개만 고른다(글자 일치 > 초성 일치 > 다른 필드, 그다음 위치).
- 한국어: NFC 정규화 후 부분 일치 + 초성 일치(ㅅㅎ → 신호). 최근 실행·최근 연 자료에 가중치.
- ↩ 실행, ⌘↩ 새 탭에서 열기, esc 닫기. 열린 상태에서 메뉴 단축키는 팔레트를 닫고 실행한다.
- 팔레트 목록은 레지스트리를 그대로 따른다. 가져오기나 시트가 메인 창을 잡고 있는 동안(`blocked`)에는 그때도 실행할 수 있는 main 소유 명령(설정…)만 남고, 그 위에 까닭을 알리는 안내가 선택할 수 없는 머리로 붙는다. 남는 명령이 없으면 안내만 보인다.

### 6. 재지정
- 사용자 단축키 재지정은 P6. 그때 prefs에 덮어쓰기를 저장하고, 같은 맥락 안 충돌을 거부한다.

## 근거
- 하나의 원천이면 "메뉴에는 있는데 팔레트에는 없다", "툴팁 단축키가 실제와 다르다" 같은 불일치가 구조적으로 생기지 않는다(Codex/Linear식 명령 중심 UI).
- Mac에서 ⌘ 조합은 메뉴 막대가 처리하는 것이 관례이고, 메뉴를 열지 않아도 사용자가 찾을 수 있다(발견 가능성). 웹 `keydown`으로 중복 처리하면 IME·포커스에 따라 두 번 실행되거나 안 된다.
- `event.code` 비교와 조합 중 무시는 한국어 사용자가 입력 소스를 바꾸지 않고 리더를 조작할 수 있게 한다.

## 검증
- 단위: id 유일, `accelerator`·`key` 중복 없음(M3는 메뉴 막대 하나가 모든 화면을 맡으므로 맥락과 무관하게. 가속기는 플랫폼마다 변환·수식키 정렬 뒤 비교하고 숨은 짝과 Electron 역할 기본 단축키도 넣는다), Linux/Windows에서 Super 키가 되는 맨 `Cmd` 없음, 메뉴 경로가 있는 명령은 한국어 레이블. 위험 명령의 확인 대화상자 표시는 그런 명령이 처음 생길 때 레지스트리 필드와 검사를 함께 더한다(M3에는 없다).
- E2E: 메뉴 JSON 덤프(한국어, Reload 없음, 실제 메뉴의 단축키 겹침 없음), 보고한 화면에 따른 메뉴 활성 상태, 메뉴 명령 전달, ⌘K 정확히 1회, 컨텍스트 메뉴 stub, `commands.coverage.spec`(활성 명령을 모두 실행해 예외 없음. M5부터는 값 하위 메뉴의 명령을 대표 값 하나로, 컬렉션·태그 대상 명령을 준비한 대상 위에서 돌리고, M5 명령 22개를 글자 그대로 적은 단언이 새 명령을 막는다(`COVERED_ELSEWHERE`에는 키 명령 F6 둘만 남는다)), CI에서 "P[0-9] 단계" 문구 금지.
- macOS 증거: 메뉴 막대 스크린샷(한국어), 네이티브 컨텍스트 메뉴 캡처(가능하면).
