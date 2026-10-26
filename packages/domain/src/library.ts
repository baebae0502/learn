import type { ErrorCode } from './errors';
import type { ItemMetadata } from './metadata';
import type { TagColorId } from './tag-colors';

export type ItemType = 'pdf' | 'video';
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
}

export interface DuplicateGroup {
  sha256: string;
  itemIds: string[];
}

export type ImportOutcome =
  /** `collectionId`: the collection the item was filed into — present only when that really happened (it is absent if the import asked for none, or the collection was gone by then). */
  | { status: 'imported'; path: string; item: LibraryItem; collectionId?: string }
  | { status: 'duplicate'; path: string; existingItemId: string }
  | { status: 'failed'; path: string; code: ErrorCode; message: string };

export interface RecoveryReport {
  /** File names left in staging/ by an interrupted import. Never auto-deleted. */
  stagingLeftovers: string[];
  /** Library-relative paths under assets/ that no DB row references. Never auto-deleted. */
  unreferencedAssets: string[];
  /** Managed asset ids whose file is gone. */
  missingManagedAssets: string[];
  /** Jobs that were `running` at startup and are now `interrupted`. */
  interruptedJobs: number;
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
export const VIDEO_FORMATS = 'MP4\u00a0·\u00a0MOV\u00a0·\u00a0WebM';
