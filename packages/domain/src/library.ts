import type { BodyTextState } from './body-search';
import type { ErrorCode } from './errors';
import type { ItemMetadata } from './metadata';
import type { TagColorId } from './tag-colors';

export type ItemType = 'pdf' | 'video' | 'image';
export type StorageMode = 'managed' | 'linked';
export type Availability = 'available' | 'missing';

export interface LibraryItem {
  id: string;
  title: string;
  type: ItemType;
  mime: string;
  size: number;
  storageMode: StorageMode;
  availability: Availability;
  assetId: string;
  revisionId: string;
  originalName: string;
  createdAt: string;
  updatedAt: string;
  creators: string[];
  year: number | null;
  /** From the metadata (quick search's short fields, spec 4.2); null when there is none. */
  publisher: string | null;
  progress: number | null;
  openedAt: string | null;
  /** The pixel size of an image item (EXIF orientation applied); null when it could not be read, and for other types. */
  imageSize?: { width: number; height: number } | null;
}

export interface Collection {
  id: string;
  name: string;
  parentId: string | null;
  itemCount: number;
  createdAt: string;
  updatedAt: string | null;
}

export interface Tag {
  id: string;
  name: string;
  color: TagColorId | null;
  position: number | null;
  itemCount: number;
}

/**
 * The long metadata fields quick search reads (spec 4.2: 초록, 메모 = `extra`), fetched once when the first query is
 * typed rather than with every list read (10,000 abstracts would not fit the list's time budget).
 */
export interface SearchText {
  id: string;
  abstract: string | null;
  extra: string | null;
}

/** Quick search reads at most this many characters of each long field (spec 7.1): what lies past it is not searched. */
export const SEARCH_TEXT_FIELD_MAX = 4000;

/** The first SEARCH_TEXT_FIELD_MAX UTF-16 units of a long field, never ending on half a surrogate pair. */
export function clipSearchText(text: string): string {
  if (text.length <= SEARCH_TEXT_FIELD_MAX) return text;
  const cut = text.slice(0, SEARCH_TEXT_FIELD_MAX);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

export interface ItemDetail {
  item: LibraryItem;
  metadata: ItemMetadata;
  file: {
    originalName: string;
    mime: string;
    size: number;
    storageMode: StorageMode;
    externalPath: string | null;
    sha256: string;
    availability: Availability;
  };
  tags: Tag[];
  collections: Collection[];
  /** Where the body text of a PDF stands; null for anything else. */
  text: BodyTextState | null;
}

export interface DuplicateGroup {
  sha256: string;
  itemIds: string[];
}
/** A trashed item as the trash view lists it (spec 4.3): the list row and when it went to the trash. */
export type TrashedItem = LibraryItem & { deletedAt: string };

/**
 * A collection row of the trash view (spec 4.3): a trashed collection whose parent is live, at the top level, or was
 * trashed at another time. The sub-collections trashed with it (the same `deletedAt`) belong to its row, not rows of
 * their own; one trashed later or earlier on its own is a row of its own.
 */
export interface TrashedCollection {
  id: string;
  name: string;
  /** Where it sat in the tree: a live collection, a collection trashed at another time, or null for the top level. */
  parentId: string | null;
  deletedAt: string;
  /** The sub-collections its row holds (trashed with it), at any depth. */
  childCount: number;
  /** The non-trashed items directly in the collections of its row, each once. */
  itemCount: number;
}

export interface TrashView {
  /** Most recently trashed first. */
  collections: TrashedCollection[];
  /** Most recently trashed first. */
  items: TrashedItem[];
  /** Live collection → the trashed items directly in it (non-empty keys only): the read-only item panel's 컬렉션. */
  members: Record<string, string[]>;
  /** Tag → the trashed items that have it (non-empty keys only): the panel's 태그, the tag selector and filter in the trash view. */
  tagged: Record<string, string[]>;
}

/** What a permanent delete removed (영구 삭제, 휴지통 비우기): its items, and every collection — sub-collections included. */
export interface PurgedRows {
  itemIds: string[];
  collectionIds: string[];
}

/** The undo of 하나만 남기고 휴지통으로 (spec 5): what it did, and nothing that was there before it. */
export interface KeepOneUndo {
  /** The items it moved to the trash, all with `stamp`. */
  trashed: string[];
  stamp: string;
  /** The items it kept (KeepOneResult.kept): the only ones whose memberships and tags the undo takes away again. */
  kept: string[];
  /** [collectionId, itemId]: the memberships it gave the items kept. */
  memberships: Array<[string, string]>;
  /** [tagId, itemId]: the tags it gave the items kept. */
  tags: Array<[string, string]>;
}

export interface KeepOneResult {
  /** One per group it cleaned: the item imported first (`createdAt`, then id). */
  kept: string[];
  trashed: string[];
  undo: KeepOneUndo;
}

export type ImportOutcome =
  /** `collectionId`: the collection the item was filed into — present only when that really happened (it is absent if the import asked for none, or the collection was gone by then). */
  | { status: 'imported'; path: string; item: LibraryItem; collectionId?: string }
  | { status: 'duplicate'; path: string; existingItemId: string }
  | { status: 'failed'; path: string; code: ErrorCode; message: string };

/**
 * One run of main's import queue, reported when it ends: the renderer words it and computes nothing. A run is every
 * batch put in from the moment the queue was idle until it is idle again (or stopped).
 */
export interface ImportReport {
  /** Items the run added: new files, and duplicates answered 새 자료로 추가. */
  imported: number;
  /** Of `imported`, the items filed into the collection their batch asked for. */
  filed: number;
  /** Existing items filed into their batch's collection because their duplicate was answered 건너뛰기 (only ones it did not hold yet). */
  filedExisting: number;
  /** Files that failed, by file name (never a path), with main's message (cause, then next step). Stopped files are not failures. */
  failed: Array<{ name: string; message: string }>;
  /** The existing item a duplicate was answered 기존 자료 열기 for (the last such answer wins). */
  openItemId: string | null;
  /** How many files were put in: a stopped run says "imported of requested". */
  requested: number;
  /** 취소 (or quitting) stopped the run: files not started were dropped, gathered duplicates were not asked. */
  cancelled: boolean;
  /** The storage mode every batch of the run used; null when they differed. */
  mode: StorageMode | null;
  /** The collection every batch asked for; null when none did or they differed. */
  collectionId: string | null;
  /** Files 취소 left untouched: not started, gathered as duplicates and not asked, or the one stopped mid-way. 0 for a run that was not stopped. */
  untouched: number;
}

/** The import queue as its progress toast shows it. `current` is a file name, never a path. */
export interface ImportQueueState {
  /** waiting-choice: a duplicate question is open; waiting-job: a backup or restore runs first. */
  state: 'running' | 'waiting-choice' | 'waiting-job' | 'idle';
  /** Files finished in this run: imported, failed, or their duplicate settled. */
  done: number;
  /** Files put in this run so far; it grows as more are put in. */
  total: number;
  /** The bytes of the files finished so far plus the part of the file under way that is done (hash, then copy and commit), out of the sum of their sizes. */
  bytesDone: number;
  bytesTotal: number;
  /** 0–100 from the same progress as `done` and `bytesDone`: never 100 while the run is going. */
  percent: number;
  current: string | null;
  /**
   * How many times 취소 reached main since it started, whichever way it came (the toast, the menu, the palette, a direct call).
   * A drop handed over in chunks stops at a change: the cancelled run's rest must not start a run of its own.
   */
  cancels: number;
}

export const IDLE_IMPORT_STATE: Readonly<ImportQueueState> = Object.freeze<ImportQueueState>({ state: 'idle', done: 0, total: 0, bytesDone: 0, bytesTotal: 0, percent: 0, current: null, cancels: 0 });

/**
 * 라이브러리 점검 (M6 spec 7, P-16): what the library folder holds that the app left behind or lost. Keys inside the
 * library and ids only — no path outside it.
 */
export interface LibraryCheck {
  checkedAt: string;
  /** Live items: the 자료 기록 row's count. */
  items: number;
  /** Stopped imports' staging copies (`staging/*.part`); dot files, folders and corrupt copies are not counted. */
  staging: { count: number; bytes: number };
  /** Files under assets/ that no asset row holds, as `assets/<xx>/<name>` keys in order. */
  unreferenced: { keys: string[]; bytes: number };
  /** Live items whose managed copy is gone. */
  missingManaged: { itemIds: string[] };
  /** Live items whose linked original was not found: shown, never a reason to open the sheet by itself (spec 7.1). */
  missingLinked: { itemIds: string[] };
  /** Damaged copies the importer set aside in staging/ (`corrupt-<sha256>-<id>`), by name. The app never removes them. */
  corrupt: { count: number; bytes: number; files: string[] };
  /** Edited copies kept aside in derived/open/<assetId>/ whose asset has no row any more. */
  orphanEdits: { count: number; bytes: number; copies: Array<{ assetId: string; name: string }> };
  /** A hash of what may open the sheet by itself (not the linked row, not the item count). */
  fingerprint: string;
  /** Something the app left or lost is there: the sheet may open by itself. */
  actionable: boolean;
}

export interface AppInfo {
  version: string;
  libraryRoot: string;
  schemaVersion: number;
  platform: string;
  libraryError: { code: ErrorCode; message: string } | null;
  /** The user's home folder: paths on screen show it as "~" (the full path stays in the tooltip). */
  homeDir: string;
  /** When the library could not be opened: the newest pre-update backup's file name in libraryRoot, or null. */
  backupFile: string | null;
}

/** Renderer and assets share this origin so asset reads are same-origin (no CORS). */
export const APP_ORIGIN = 'learn://app';
export const assetUrl = (assetId: string): string => `${APP_ORIGIN}/asset/${encodeURIComponent(assetId)}`;

/**
 * The video formats Learn imports, as every screen writes them (critic T14-n1): the empty library's formats line and
 * the import's "not supported" advice say the same list the same way, spaced middots as in every other list. The
 * spaces are U+00A0, so the list never breaks inside, nor starts a line with "·" ("(MP4 · MOV · WebM)").
 */
export const IMAGE_FORMATS = 'PNG\u00a0·\u00a0JPEG\u00a0·\u00a0WebP\u00a0·\u00a0GIF\u00a0·\u00a0AVIF';
export const VIDEO_FORMATS = 'MP4\u00a0·\u00a0MOV\u00a0·\u00a0WebM';

/**
 * A copy another app saved beside an item's read-only copy (M6 spec 6): `<제목> (수정본 YYYY-MM-DD HHmm).<확장자>` in
 * derived/open/<assetId>/. The item panel names it back to main by `name` alone (R4: no path reaches the page).
 */
export interface EditedCopy {
  /** The file name, NFC. */
  name: string;
  /** When the other app last wrote it (the file's modification time, ISO). */
  modifiedAt: string;
  size: number;
}
