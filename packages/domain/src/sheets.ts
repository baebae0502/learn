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

export type SheetPayload =
  /** `remaining`: the other duplicates of this import still to settle; above 0 the sheet offers one answer for all. */
  | { kind: 'duplicate'; fileName: string; existing: DuplicateCard; remaining: number }
  | { kind: 'shortcuts' };
export type SheetResult =
  /** `applyToRest`: the same choice for the remaining duplicates (always false when `remaining` was 0). */
  | { kind: 'duplicate'; choice: DuplicateChoice; applyToRest: boolean }
  | { kind: 'shortcuts' };
