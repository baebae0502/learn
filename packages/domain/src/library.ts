import type { ErrorCode } from './errors';

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
