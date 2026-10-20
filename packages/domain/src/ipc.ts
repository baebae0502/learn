import { z } from 'zod';
import type { CommandId } from './commands';
import type { LearnEventMap } from './events';
import type { AppInfo, Collection, DuplicateGroup, ImportOutcome, ItemDetail, LibraryItem, RecoveryReport, Tag } from './library';
import { itemMetadataSchema, type ItemMetadata } from './metadata';
import { readingLocatorSchema, type ReadingLocator, type ReadingPosition } from './reading';
import type { Result } from './result';
import type { Prefs } from './settings';
import { prefsSchema } from './settings';
import { TAG_COLORS, type TagColorId } from './tag-colors';

export const storageModeSchema = z.enum(['managed', 'linked']);
export const pickAndImportInput = z.object({ mode: storageModeSchema, allowDuplicate: z.boolean().default(false) });
export const importPathsInput = z.object({
  paths: z.array(z.string().min(1).max(4096)).min(1).max(500),
  mode: storageModeSchema,
  allowDuplicate: z.boolean().default(false),
});
export const itemIdInput = z.object({ itemId: z.uuid() });
export const assetIdInput = z.object({ assetId: z.uuid() });
export const emptyInput = z.object({}).strict().optional();

export const itemIdsInput = z.object({ itemIds: z.array(z.uuid()).min(1).max(5000) });
export const nameSchema = z.string().trim().min(1).max(200);
export const positionSchema = z.number().int().min(1).max(8);
export const tagColorSchema = z.enum(TAG_COLORS.map((c) => c.id) as [TagColorId, ...TagColorId[]]);

export const updateMetadataInput = z.object({
  itemId: z.uuid(),
  title: nameSchema.optional(),
  metadata: itemMetadataSchema.optional(),
});
export const collectionIdInput = z.object({ collectionId: z.uuid() });
export const createCollectionInput = z.object({ name: nameSchema, parentId: z.uuid().nullable().optional() });
export const renameCollectionInput = z.object({ collectionId: z.uuid(), name: nameSchema });
export const moveCollectionInput = z.object({ collectionId: z.uuid(), parentId: z.uuid().nullable() });
export const collectionItemsInput = z.object({ collectionId: z.uuid(), itemIds: z.array(z.uuid()).min(1).max(5000) });
export const createTagInput = z.object({ name: nameSchema });
export const tagIdInput = z.object({ tagId: z.uuid() });
export const renameTagInput = z.object({ tagId: z.uuid(), name: nameSchema });
export const setTagColorInput = z.object({ tagId: z.uuid(), color: tagColorSchema.nullable(), position: positionSchema.nullable() });
export const tagItemsInput = z.object({ tagId: z.uuid(), itemIds: z.array(z.uuid()).min(1).max(5000) });
export const togglePositionInput = z.object({ position: positionSchema, itemIds: z.array(z.uuid()).min(1).max(5000) });
export const settingGetInput = z.object({ key: z.string().min(1).max(100) });
export const settingSetInput = z.object({ key: z.string().min(1).max(100), value: z.unknown() });
export const prefsSetInput = prefsSchema.partial();
export const savePositionInput = z.object({
  itemId: z.uuid(),
  revisionId: z.uuid(),
  locator: readingLocatorSchema,
  progress: z.number().min(0).max(1).nullable(),
});
export const showContextMenuInput = z.object({
  kind: z.literal('item'),
  itemIds: z.array(z.uuid()).min(1).max(5000),
  x: z.number().finite(),
  y: z.number().finite(),
});

export type PickAndImportInput = z.input<typeof pickAndImportInput>;
export type ImportPathsInput = z.input<typeof importPathsInput>;

export type UpdateMetadataInput = z.input<typeof updateMetadataInput>;
export type CreateCollectionInput = z.input<typeof createCollectionInput>;
export type SavePositionInput = z.input<typeof savePositionInput>;
export type ShowContextMenuInput = z.input<typeof showContextMenuInput>;

/** @deprecated removed in M2 Task 4 (flat predecessor of LearnApi). */
export interface LegacyLearnApi {
  appInfo(): Promise<Result<AppInfo>>;
  pickAndImport(input: PickAndImportInput): Promise<Result<ImportOutcome[]>>;
  importPaths(input: ImportPathsInput): Promise<Result<ImportOutcome[]>>;
  listItems(): Promise<Result<LibraryItem[]>>;
  getItem(input: { itemId: string }): Promise<Result<LibraryItem>>;
  pickAndRelink(input: { assetId: string }): Promise<Result<LibraryItem | null>>;
  recoveryReport(): Promise<Result<RecoveryReport>>;
  /** Drag & drop: resolves a dropped File to its path via webUtils (sandbox-safe). */
  pathForFile(file: File): string;
}

/** The only surface the renderer sees (window.learn). */
export interface LearnApi {
  app: { info(): Promise<Result<AppInfo>> };
  library: {
    pickAndImport(input: PickAndImportInput): Promise<Result<ImportOutcome[]>>;
    import(input: ImportPathsInput): Promise<Result<ImportOutcome[]>>;
    list(): Promise<Result<LibraryItem[]>>;
    get(input: { itemId: string }): Promise<Result<LibraryItem>>;
    pickAndRelink(input: { assetId: string }): Promise<Result<LibraryItem | null>>;
    recoveryReport(): Promise<Result<RecoveryReport>>;
    detail(input: { itemId: string }): Promise<Result<ItemDetail>>;
    updateMetadata(input: { itemId: string; title?: string; metadata?: ItemMetadata }): Promise<Result<LibraryItem>>;
    trash(input: { itemIds: string[] }): Promise<Result<number>>;
    restore(input: { itemIds: string[] }): Promise<Result<number>>;
    listTrash(): Promise<Result<LibraryItem[]>>;
    duplicateGroups(): Promise<Result<DuplicateGroup[]>>;
  };
  collections: {
    list(): Promise<Result<Collection[]>>;
    create(input: { name: string; parentId?: string | null }): Promise<Result<Collection>>;
    rename(input: { collectionId: string; name: string }): Promise<Result<Collection>>;
    move(input: { collectionId: string; parentId: string | null }): Promise<Result<Collection>>;
    remove(input: { collectionId: string }): Promise<Result<void>>;
    restore(input: { collectionId: string }): Promise<Result<Collection>>;
    addItems(input: { collectionId: string; itemIds: string[] }): Promise<Result<number>>;
    removeItems(input: { collectionId: string; itemIds: string[] }): Promise<Result<number>>;
  };
  tags: {
    list(): Promise<Result<Tag[]>>;
    create(input: { name: string }): Promise<Result<Tag>>;
    rename(input: { tagId: string; name: string }): Promise<Result<Tag>>;
    setColor(input: { tagId: string; color: TagColorId | null; position: number | null }): Promise<Result<Tag>>;
    remove(input: { tagId: string }): Promise<Result<void>>;
    assign(input: { tagId: string; itemIds: string[] }): Promise<Result<number>>;
    unassign(input: { tagId: string; itemIds: string[] }): Promise<Result<number>>;
    togglePosition(input: { position: number; itemIds: string[] }): Promise<Result<number>>;
  };
  settings: {
    get(input: { key: string }): Promise<Result<unknown>>;
    set(input: { key: string; value: unknown }): Promise<Result<void>>;
  };
  prefs: {
    get(): Promise<Result<Prefs>>;
    set(input: Partial<Prefs>): Promise<Result<Prefs>>;
  };
  reader: {
    getPosition(input: { itemId: string }): Promise<Result<ReadingPosition | null>>;
    savePosition(input: { itemId: string; revisionId: string; locator: ReadingLocator; progress: number | null }): Promise<Result<void>>;
  };
  ui: {
    showContextMenu(input: { kind: 'item'; itemIds: string[]; x: number; y: number }): Promise<Result<{ commandId: CommandId } | null>>;
  };
  /** Subscribe to a main->renderer push event; returns an unsubscribe function. */
  on<K extends keyof LearnEventMap>(name: K, cb: (payload: LearnEventMap[K]) => void): () => void;
  /** Drag & drop: resolves a dropped File to its path via webUtils (sandbox-safe). */
  pathForFile(file: File): string;
}
