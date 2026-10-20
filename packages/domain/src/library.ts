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
  tagIds: string[];
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
  | { status: 'imported'; path: string; item: LibraryItem }
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
}

/** Renderer and assets share this origin so asset reads are same-origin (no CORS). */
export const APP_ORIGIN = 'learn://app';
export const assetUrl = (assetId: string): string => `${APP_ORIGIN}/asset/${encodeURIComponent(assetId)}`;
