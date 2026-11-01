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
  | { kind: 'purge'; variant: PurgeVariant; items: number; collections: number };
export type SheetResult =
  /** `applyToRest`: the same choice for the remaining duplicates (always false when `remaining` was 0). */
  | { kind: 'duplicate'; choice: DuplicateChoice; applyToRest: boolean }
  | { kind: 'shortcuts' }
  | { kind: 'purge'; confirmed: boolean };
