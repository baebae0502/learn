import type { ItemType, StorageMode } from './library';

/** Modal sheet windows (design-spec 6 시트). Types only (no zod): the preload never needs the schemas. */
export type DuplicateChoice = 'open' | 'add' | 'skip';

export interface DuplicateCard {
  title: string;
  type: ItemType;
  size: number;
  createdAt: string;
  storageMode: StorageMode;
}

/** What 영구 삭제… or 휴지통 비우기… asks about (P-25): its title and text follow. */
export type PurgeVariant = 'items' | 'collections' | 'mixed' | 'empty';

export type SheetPayload =
  /** `remaining`: the other duplicates of this import still to settle; above 0 the sheet offers one answer for all. */
  | { kind: 'duplicate'; fileName: string; existing: DuplicateCard; remaining: number }
  | { kind: 'shortcuts' }
  | { kind: 'purge'; variant: PurgeVariant; items: number; collections: number }
  | LibraryCheckPayload;
export type SheetResult =
  /** `applyToRest`: the same choice for the remaining duplicates (always false when `remaining` was 0). */
  | { kind: 'duplicate'; choice: DuplicateChoice; applyToRest: boolean }
  | { kind: 'shortcuts' }
  | { kind: 'purge'; confirmed: boolean }
  | { kind: 'libraryCheck' };

// ---- 라이브러리 점검 (M6 spec 7, P-16/P-17/P-26) ----

/** The check sheet's rows in the spec's table order (7.2); the 자료 기록 row is not one of them (it is always last). */
export const CHECK_ROW_KINDS = ['staging', 'unreferenced', 'missingManaged', 'missingLinked', 'corrupt', 'orphanEdits'] as const;
export type CheckRowKind = (typeof CHECK_ROW_KINDS)[number];
/** How a row was fixed in the sheet — its ok sentence; `none` when it went by itself. */
export type CheckFix = 'cleaned' | 'revived' | 'relinked' | 'imported' | 'none';
/** `auto`: opened by itself after the startup check; `manual`: 파일 › 라이브러리 점검…. */
export type CheckMode = 'auto' | 'manual';
/** A name the row shows: an item to relink (its title, a linked one's original location), or the first copy's name. */
export interface CheckEntry {
  itemId: string | null;
  label: string;
  /** A linked item's original location, as recorded; the sheet shows it home-relative with the whole path as its tooltip. */
  path: string | null;
}
export interface CheckRow {
  kind: CheckRowKind;
  /** `todo`: something left to do; `done`: fixed (or gone) since the sheet opened — it keeps its place as an ok row. */
  state: 'todo' | 'done';
  count: number;
  /** What its files take (staging, unused, corrupt and orphan copies); 0 for the item rows. */
  bytes: number;
  /** Two names at most (P-26); the sheet adds 외 N개 for the rest of `count`. */
  entries: CheckEntry[];
  /** Set on a done row. */
  fix: CheckFix | null;
}
/** What the last action could not finish, in main's words, under its row. */
export interface CheckFailure {
  kind: CheckRowKind;
  message: string;
}
export interface LibraryCheckPayload {
  kind: 'libraryCheck';
  mode: CheckMode;
  /** Live items (the 자료 기록 row). */
  items: number;
  /** The rows there are or were since the sheet opened, in table order. */
  rows: CheckRow[];
  homeDir: string;
  failed: CheckFailure | null;
}
/** The check sheet's row actions; 다시 연결… names an item, never a path (R4). */
export const CHECK_ACTS = ['cleanStaging', 'revive', 'cleanUnreferenced', 'revealCorrupt', 'importOrphanEdits', 'revealOrphanEdit'] as const;
export type CheckAction = { kind: 'libraryCheck'; act: (typeof CHECK_ACTS)[number] } | { kind: 'libraryCheck'; act: 'relink'; itemId: string };
/** What an open sheet asks main to do (sheet:act). The backup and restore result sheets add theirs. */
export type SheetAction = CheckAction;
