// The organize screens' copy (spec 3, 4). 합니다체; the scope names are design-spec 6 "트리" (특수 보기).
import { eulReul, euroRo } from './josa';

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
} as const;
