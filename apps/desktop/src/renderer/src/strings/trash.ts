// The trash's copy (M6 spec 4; the owner-approved mockups library.html?state=trash and reader-pdf.html?state=trashed). 합니다체;
// "이 자료", "이 자리" bound with U+00A0.
import { eulReul } from './josa';

export const trash = {
  /** ⌘⌫ (spec 4.1): the toast with 실행 취소 — several counted, one named. */
  moved: (n: number) => `자료 ${n}개를 휴지통으로 옮겼습니다`,
  movedOne: (title: string) => `‘${title}’⁠${eulReul(title)} 휴지통으로 옮겼습니다`,
  /** A collection's 휴지통으로 이동 (spec 4.2), with 실행 취소. */
  collectionMoved: (name: string) => `‘${name}’ 컬렉션을 휴지통으로 옮겼습니다`,
  /** 복원 (spec 4.4): no 실행 취소 (⌘⌫ again); items and collections counted together. */
  restored: (n: number) => `${n}개를 복원했습니다`,
  /** After 영구 삭제… (Q-6f; spec 4.5: told as done even when a file could not be removed — the check shows it). */
  purged: (items: number, collections: number) =>
    items > 0 && collections > 0
      ? `자료 ${items}개와 컬렉션 ${collections}개를 영구히 삭제했습니다`
      : collections > 0
        ? `컬렉션 ${collections}개를 영구히 삭제했습니다`
        : `자료 ${items}개를 영구히 삭제했습니다`,
  emptied: '휴지통을 비웠습니다',
  /** A trashed collection row, where the author goes: the items it still has in the library. */
  collectionItems: (n: number) => `자료 ${n}개`,
  panel: {
    /** Under 복원 in the item panel: where the item is and since when ("오늘 오전 9:12"). */
    note: (when: string) => `휴지통에 있습니다 · ${when}에 옮김`,
    /** The same line for rows trashed at different times. */
    noteMixed: '휴지통에 있습니다',
    /** One trashed collection chosen: its kind line. */
    collectionKind: (items: number) => `컬렉션 · 자료 ${items}개`,
    /** The kind line's part for the collections among several rows. */
    collections: (n: number) => `컬렉션 ${n}개`,
    /** Several trash rows chosen: the panel's title. */
    selected: (items: number, collections: number) =>
      items > 0 && collections > 0 ? `자료 ${items}개와 컬렉션 ${collections}개 선택` : collections > 0 ? `컬렉션 ${collections}개 선택` : `자료 ${items}개 선택`,
  },
  /** The reader when its item went to the trash (spec 4.6). */
  reader: {
    title: '이 자료는 휴지통에 있습니다',
    body: '복원하면 이 자리에서 다시 엽니다.',
  },
} as const;
