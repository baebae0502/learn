// The organize screens' copy (spec 3, 4). 합니다체; the scope names are design-spec 6 "트리" (특수 보기).
import { eulReul, euroRo, iGa } from './josa';

export const organize = {
  scopes: {
    recent: '최근 연 자료',
    unfiled: '미분류',
    duplicates: '중복 항목',
  },
  /** Between the names of a collection's path, in the toolbar title's tooltip: "분자생물학 › 6장 · 신호 전달". */
  pathSeparator: ' › ',
  sidebar: {
    /** The tree's accessible name (the special views and the collections are one tree). */
    tree: '라이브러리와 컬렉션',
    collections: '컬렉션',
    /** What a new collection starts as and an empty name falls back to (Finder's new folder). */
    newName: '새\u00a0컬렉션',
    newTip: '새\u00a0컬렉션',
    emptyHint: '컬렉션이 없습니다. 자료를 묶으려면 새\u00a0컬렉션을 만드세요.',
    nameLabel: '컬렉션 이름',
    nameTooLong: '컬렉션 이름은 200자까지 쓸 수 있습니다.',
  },
  /** The table body and the item panel while a view has nothing in it (spec 3.6). */
  empty: {
    collectionTitle: '이\u00a0컬렉션은 비어 있습니다',
    collectionBody: (name: string) => `다른\u00a0컬렉션의 자료를 사이드바의 ‘${name}’${euroRo(name)} 끌어\u00a0놓거나, 파일을 바로 이\u00a0컬렉션으로 가져오세요.`,
    collectionMeta: (made: string) => `자료 0개 · ${made} 만듦`,
    recent: '최근 30일 안에 연 자료가 없습니다',
    unfiled: '모든\u00a0자료가 컬렉션에 들어 있습니다',
    duplicates: '중복된 자료가 없습니다',
  },
  /** 컬렉션 삭제… (spec 3.4): the sheet and the toast. */
  remove: {
    message: (name: string) => `‘${name}’${eulReul(name)} 삭제하겠습니까?`,
    detail: (children: number) => `${children > 0 ? `하위 컬렉션 ${children}개도 함께 삭제합니다.\n` : ''}자료는 내 라이브러리에 남습니다.`,
    confirm: '삭제',
    done: (name: string) => `‘${name}’${eulReul(name)} 삭제했습니다`,
  },
  /** The tag selector and what comes of tags (spec 4, 5.1). 합니다체; "이 보기", "모든 태그" bound with U+00A0. */
  tags: {
    heading: '태그',
    /** The chip group's name (a toolbar of toggle chips). */
    listLabel: '태그 목록',
    /** The "…" button's name (its tooltip) and the menu's captions. */
    moreLabel: '태그 표시',
    show: '표시',
    showView: '현재 보기의 태그만',
    showAll: '모든\u00a0태그',
    sort: '정렬',
    sortName: '이름순',
    sortCount: '많이 쓴 순',
    clearFilter: '태그 선택 해제',
    filterLabel: '태그 필터',
    filterPlaceholder: '태그 필터',
    /** In the cloud: the filter field matches no tag / the view has no tagged item. */
    noMatch: '일치하는 태그가 없습니다',
    noneInView: '이\u00a0보기에는 태그가 없습니다',
    /** Read after a dim chip's name: it has no item in the view shown. */
    notInView: '이\u00a0보기에 없음',
    nameLabel: '태그 이름',
    nameTooLong: '태그 이름은 200자까지 쓸 수 있습니다.',
    removeLabel: (name: string) => `‘${name}’ 태그 떼기`,
    /** The table row's description (spec 5.1): the coloured tags, the way the dots show them. */
    description: (names: string) => `태그: ${names}`, // the names, already joined by commas
    /** The palette's row for a colour key: the slot and the tag that holds it. */
    paletteName: (slot: number, name: string) => `색 태그 ${slot} · ${name}`,
    /** A colour key pressed with no tag at its slot (spec 4.2). */
    noSlot: (slot: number) => `색 태그 ${slot}${iGa(slot)} 없습니다. 태그의 컨텍스트 메뉴에서 색을 지정하세요.`,
    /** Renaming a tag to another's name (spec 4.1): the sheet. */
    mergeMessage: (existing: string) => `‘${existing}’ 태그가 이미 있습니다. 두 태그를 합치겠습니까?`,
    mergeDetail: (from: string, into: string) => `‘${from}’ 태그의 자료는 ‘${into}’${euroRo(into)} 옮겨지고, ‘${from}’ 태그는 없어집니다.`,
    mergeConfirm: '합치기',
    /** 태그 삭제… (spec 4.1): the sheet; there is no undo. */
    deleteMessage: (name: string) => `‘${name}’ 태그를 삭제하겠습니까?`,
    deleteDetail: (items: number) => (items > 0 ? `자료 ${items}개에서 떼어집니다.` : '붙어 있는 자료가 없습니다.'),
    deleteConfirm: '삭제',
    /** The table body when the chosen tags leave no item and nothing is typed in the search (spec 3.6). */
    filterEmpty: '고른 태그를 모두 가진 자료가 없습니다',
  },
} as const;
