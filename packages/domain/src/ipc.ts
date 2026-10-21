import { z } from 'zod';
import type { CommandId } from './commands';
import type { LearnEventMap } from './events';
import type { AppInfo, Collection, DuplicateGroup, ImportOutcome, ItemDetail, LibraryItem, RecoveryReport, Tag } from './library';
import { itemMetadataSchema } from './metadata';
import { readingLocatorSchema, type ReadingPosition } from './reading';
import type { Result } from './result';
import type { Prefs } from './settings';
import { prefsFields } from './settings';
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
/** Item titles allow more than collection/tag names. */
export const titleSchema = z.string().trim().min(1).max(500);
export const positionSchema = z.number().int().min(1).max(8);
export const tagColorSchema = z.enum(TAG_COLORS.map((c) => c.id) as [TagColorId, ...TagColorId[]]);

export const updateMetadataInput = z.object({
  itemId: z.uuid(),
  title: titleSchema.optional(),
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
/** Patch input: built from default-free fields so omitted keys stay omitted. */
export const prefsSetInput = z.object(prefsFields).partial().strict();
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

export type ItemIdInput = z.input<typeof itemIdInput>;
export type AssetIdInput = z.input<typeof assetIdInput>;
export type ItemIdsInput = z.input<typeof itemIdsInput>;
export type CollectionIdInput = z.input<typeof collectionIdInput>;
export type RenameCollectionInput = z.input<typeof renameCollectionInput>;
export type MoveCollectionInput = z.input<typeof moveCollectionInput>;
export type CollectionItemsInput = z.input<typeof collectionItemsInput>;
export type CreateTagInput = z.input<typeof createTagInput>;
export type TagIdInput = z.input<typeof tagIdInput>;
export type RenameTagInput = z.input<typeof renameTagInput>;
export type SetTagColorInput = z.input<typeof setTagColorInput>;
export type TagItemsInput = z.input<typeof tagItemsInput>;
export type TogglePositionInput = z.input<typeof togglePositionInput>;
export type SettingGetInput = z.input<typeof settingGetInput>;
export type SettingSetInput = z.input<typeof settingSetInput>;
export type PrefsSetInput = z.input<typeof prefsSetInput>;
export type UpdateMetadataInput = z.input<typeof updateMetadataInput>;
export type CreateCollectionInput = z.input<typeof createCollectionInput>;
export type SavePositionInput = z.input<typeof savePositionInput>;
export type ShowContextMenuInput = z.input<typeof showContextMenuInput>;

/** The only surface the renderer sees (window.learn). */
export interface LearnApi {
  app: { info(): Promise<Result<AppInfo>> };
  library: {
    pickAndImport(input: PickAndImportInput): Promise<Result<ImportOutcome[]>>;
    import(input: ImportPathsInput): Promise<Result<ImportOutcome[]>>;
    list(): Promise<Result<LibraryItem[]>>;
    get(input: ItemIdInput): Promise<Result<LibraryItem>>;
    pickAndRelink(input: AssetIdInput): Promise<Result<LibraryItem | null>>;
    recoveryReport(): Promise<Result<RecoveryReport>>;
    detail(input: ItemIdInput): Promise<Result<ItemDetail>>;
    updateMetadata(input: UpdateMetadataInput): Promise<Result<LibraryItem>>;
    trash(input: ItemIdsInput): Promise<Result<number>>;
    restore(input: ItemIdsInput): Promise<Result<number>>;
    listTrash(): Promise<Result<LibraryItem[]>>;
    duplicateGroups(): Promise<Result<DuplicateGroup[]>>;
  };
  collections: {
    list(): Promise<Result<Collection[]>>;
    create(input: CreateCollectionInput): Promise<Result<Collection>>;
    rename(input: RenameCollectionInput): Promise<Result<Collection>>;
    move(input: MoveCollectionInput): Promise<Result<Collection>>;
    remove(input: CollectionIdInput): Promise<Result<void>>;
    restore(input: CollectionIdInput): Promise<Result<Collection>>;
    addItems(input: CollectionItemsInput): Promise<Result<number>>;
    removeItems(input: CollectionItemsInput): Promise<Result<number>>;
  };
  tags: {
    list(): Promise<Result<Tag[]>>;
    create(input: CreateTagInput): Promise<Result<Tag>>;
    rename(input: RenameTagInput): Promise<Result<Tag>>;
    setColor(input: SetTagColorInput): Promise<Result<Tag>>;
    remove(input: TagIdInput): Promise<Result<void>>;
    assign(input: TagItemsInput): Promise<Result<number>>;
    unassign(input: TagItemsInput): Promise<Result<number>>;
    togglePosition(input: TogglePositionInput): Promise<Result<{ tagId: string; assigned: boolean } | null>>;
  };
  settings: {
    get(input: SettingGetInput): Promise<Result<unknown>>;
    set(input: SettingSetInput): Promise<Result<void>>;
  };
  prefs: {
    get(): Promise<Result<Prefs>>;
    set(input: PrefsSetInput): Promise<Result<Prefs>>;
  };
  reader: {
    /** Records that the viewer opened the item (sets `openedAt`; creates the position row at the start if none). */
    open(input: ItemIdInput): Promise<Result<void>>;
    /** The stored position, or null. A pure read. */
    getPosition(input: ItemIdInput): Promise<Result<ReadingPosition | null>>;
    savePosition(input: SavePositionInput): Promise<Result<void>>;
  };
  ui: {
    showContextMenu(input: ShowContextMenuInput): Promise<Result<{ commandId: CommandId } | null>>;
  };
  /** Subscribe to a main->renderer push event; returns an unsubscribe function. */
  on<K extends keyof LearnEventMap>(name: K, cb: (payload: LearnEventMap[K]) => void): () => void;
  /** Drag & drop: resolves a dropped File to its path via webUtils (sandbox-safe). */
  pathForFile(file: File): string;
}
