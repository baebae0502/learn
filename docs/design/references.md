# 디자인 참고 — 채택한 특성 (글로만)

Learn은 아래 제품에서 **특성(구조·관례·수치)** 만 참고한다. 코드·이미지·아이콘·글꼴·문구는 가져오지 않았다. 특히 Zotero는 AGPL이므로 `reader`·`note-editor`·스타일시트를 열람해 옮기지 않았고, 공개 문서와 사용 관찰만 근거로 삼았다. SF Symbols는 라이선스상 쓰지 않는다.

(2026-10-22) Learn은 AGPL-3.0-or-later로 공개하기로 했다(ADR-0011). 그래서 이제 AGPL 코드(예: SingleFile, Zotero 번역기)를 가져다 쓸 수 있다. 다만 이 문서는 여전히 UX 특성의 참고 목록이고, 가져다 쓰는 코드는 해당 마일스톤의 계획과 ADR이 정한다. 위 문장은 M1–M3에 대해 사실 그대로 둔다.

## Zotero 7 (데스크톱)
출처: https://www.zotero.org/blog/zotero-7/ · https://www.zotero.org/support/collections_and_tags · https://www.zotero.org/support/sorting · https://www.zotero.org/support/pdf_reader · https://www.zotero.org/support/kb/keyboard_shortcuts · https://www.zotero.org/support/preferences/general

| 특성 | Learn에서 |
|---|---|
| 3단: 컬렉션 트리 + 아래 태그 선택기 / 항목 표 / 접히는 섹션의 항목 패널 | 라이브러리 화면의 기본 구조(레이아웃 A·B 공통) |
| 트리 맨 위 "내 라이브러리", 아래에 미분류·중복 항목·휴지통 같은 특수 보기 | 사이드바 "라이브러리" 섹션(최근 연 자료 추가) |
| 항목 표: 열 선택·정렬·크기 조절, 정렬 열 화살표 표시 | M4 표. 기본 열 제목·저자·연도·진행·추가일 |
| 색 태그 8색, 숫자 키 1–8로 토글, 색 태그가 표 제목 옆 점으로 보임 | 같은 순서·값의 8색(`tokens.tagColors`), 1–8 단일 키 |
| 태그 선택기: 현재 보기의 태그만, 나머지는 흐리게, 아래 필터 필드 | 사이드바 아래 태그 선택기 |
| 항목 패널 섹션(정보·태그·관련·첨부 등)을 접고 펼침 | 항목 패널: 읽기·정보·태그·컬렉션·파일 |
| 리더는 탭으로 열림, 라이브러리 탭은 닫을 수 없음 | 탭 모델(M7) |
| 리더 왼쪽 사이드바: 썸네일 / 필기 / 목차, 각 보기 검색 | PDF 탐색기: 썸네일 / 목차 / 필기(M9) |
| 찾기 팝업, 확대 모드(자동·폭·쪽), 스크롤·펼침 모드, 회전 | 찾기 막대, 확대 메뉴, 보기 메뉴 |
| 읽기 위치 기억, 리더 테마(다크·세피아) | 위치 기억(M7), 쪽 색 원본·세피아·어둡게 |
| 글꼴 크기·밀도(Compact/Comfortable) 설정 | 설정의 글자 크기·밀도(3단계) |
| 네이티브 메뉴와 컨텍스트 메뉴 | ADR-0005 |

## OpenAI Codex 데스크톱 앱 / Linear 계열
출처: https://developers.openai.com/codex/app · https://linear.app/now/how-we-redesigned-the-linear-ui

| 특성 | Learn에서 |
|---|---|
| 창 높이 전체의 반투명 사이드바 안에 신호등, 내용 영역은 조용한 면 | 레이아웃 B |
| 절제된 크롬: 관심을 얻지 않은 요소는 경쟁하지 않는다, 중립 회색 + 강조색 하나 | 원칙 1, 중립 hue 250 / chroma ≤ 0.01 |
| ⌘K 명령 팔레트: 명령·대상(자료·컬렉션)을 한 입력으로, 키 힌트 줄 | `palette.html`, 단일 명령 레지스트리 |
| 테마를 base / accent / contrast 몇 개 값에서 생성(지각 균일 색 공간) | OKLCH 토큰, `accent` / `accentText` / `textOnAccent` |
| 아이콘·레이블을 픽셀 격자에 맞춤, 작은 크기에서 얇은 선 | lucide 16px / stroke 1.5, 4px 격자 |
| 즉각 반응, 목록 갱신에는 모션 없음 | 8.1 모션 |

## macOS 관례 (Apple Human Interface Guidelines)
출처: https://developer.apple.com/design/human-interface-guidelines/sidebars · …/toolbars · …/typography · …/dark-mode · …/materials · …/keyboards · Electron https://www.electronjs.org/docs/latest/api/browser-window · https://www.electronjs.org/docs/latest/tutorial/custom-title-bar

| 특성 | Learn에서 |
|---|---|
| 숨긴 제목 막대 + 내용과 합쳐진 도구 막대(통합형 52pt) | 52px 제목 막대, `titleBarStyle: 'hidden'` |
| 신호등은 창 왼쪽 위, 그 옆 사이드바 토글 | 84px 인셋, 토글 위치(A: 막대, B: 사이드바 위) |
| 사이드바 머티리얼(비브런시), 사이드바 아이콘은 강조색 | `vibrancy: 'sidebar'`, `--accent-text` 아이콘 |
| macOS 본문 13pt, 보조 11–12pt | 타입 스케일 body 13/18 |
| 선택: 포커스된 목록은 강조색 채움 + 흰 글자, 아닌 목록은 회색 | 3.1 선택 규칙 |
| 다크 모드: 내용 면이 크롬보다 어둡고 떠 있는 면이 밝다, 그림자보다 테두리 | 3.1·8.2 |
| 단축키 기호 ⌃⌥⇧⌘ 순서, 대화상자를 여는 메뉴 항목에 "…" | 7.3·7.4 |
| 표준 단축키: ⌘, 설정, ⌃⌘S 사이드바, ⌥⌘I 인스펙터, ⌘[ ⌘] 뒤/앞, ⌘0 실제 크기, ⌥⌘G 쪽으로 이동(미리보기) | 키 맵 |
| 오버레이 스크롤 막대, 시스템 다크 모드·고대비·동작 줄이기 설정 존중 | 토큰의 `prefers-contrast`, `prefers-reduced-motion` |

## 접근성
출처: https://www.w3.org/TR/WCAG22/ (1.4.3 대비, 1.4.11 비텍스트 대비, 2.4.7 포커스 표시, 1.4.10 리플로) · https://react-spectrum.adobe.com/react-aria/

## 글꼴·아이콘
- Pretendard: https://github.com/orioncactus/pretendard (SIL OFL 1.1)
- lucide: https://lucide.dev/license (ISC)
