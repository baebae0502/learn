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

export type SheetPayload = { kind: 'duplicate'; fileName: string; existing: DuplicateCard } | { kind: 'shortcuts' };
export type SheetResult = { kind: 'duplicate'; choice: DuplicateChoice } | { kind: 'shortcuts' };
