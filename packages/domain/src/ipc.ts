import { z } from 'zod';
import { COMMAND_IDS, type CommandContextState, type PickedCommand } from './commands';
import type { LearnEventMap, WindowState } from './events';
import type { AppInfo, Collection, DuplicateGroup, ImportOutcome, ItemDetail, LibraryItem, RecoveryReport, SearchText, Tag } from './library';
import { itemMetadataSchema } from './metadata';
import type { OrganizeSnapshot } from './organize';
import { readingLocatorSchema, type ReadingPosition } from './reading';
import type { Result } from './result';
import type { Prefs } from './settings';
import type { DuplicateChoice, SheetPayload } from './sheets';
import { prefsFields } from './settings';
import { LIBRARY_COLUMN_IDS, LIBRARY_SORT_COLUMNS, type LibraryColumnId } from './library-columns';
import { TAG_COLORS, type TagColorId } from './tag-colors';

export const storageModeSchema = z.enum(['managed', 'linked']);
/** The collection an import files its items into: a uuid, or null/absent for none. */
const importCollectionSchema = z.uuid().nullable().optional();
export const pickAndImportInput = z.object({
  mode: storageModeSchema,
  allowDuplicate: z.boolean().default(false),
  collectionId: importCollectionSchema,
});
export const importPathsInput = z.object({
  paths: z.array(z.string().min(1).max(4096)).min(1).max(500),
  mode: storageModeSchema,
  allowDuplicate: z.boolean().default(false),
  collectionId: importCollectionSchema,
});
export const itemIdInput = z.object({ itemId: z.uuid() });
export const assetIdInput = z.object({ assetId: z.uuid() });
export const emptyInput = z.object({}).strict().optional();

export const itemIdsInput = z.object({ itemIds: z.array(z.uuid()).min(1).max(5000) });
/** library.getItems: items by id. 5,000 like the other id lists; main asks the database 500 at a time. */
export const getItemsInput = z.object({ ids: z.array(z.uuid()).min(1).max(5000) });
/** Collection/tag names: NFC first (macOS can hand over decomposed Hangul), so equal-looking names compare equal. */
export const nameSchema = z.string().normalize('NFC').trim().min(1).max(200);
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
/** Main-internal prefs patch (the store's own input): built from default-free fields so omitted keys stay omitted. */
export const prefsPatchInput = z.object(prefsFields).partial().strict();
export type PrefsPatch = z.input<typeof prefsPatchInput>;
/** What the renderer may change: everything but the library location, which only app.chooseLibraryFolder sets (R4). */
export const prefsSetInput = z.object(prefsFields).omit({ libraryRoot: true }).partial().strict();
/** ui.themeShown: the theme a page now shows (its own resolution of the pref; T13R4-m1). */
export const themeShownInput = z.object({ shade: z.enum(['light', 'dark']) }).strict();
export const savePositionInput = z.object({
  itemId: z.uuid(),
  revisionId: z.uuid(),
  locator: readingLocatorSchema,
  progress: z.number().min(0).max(1).nullable(),
});
export const commandIdSchema = z.enum(COMMAND_IDS);
const paneShownSchema = z.enum(['shown', 'hidden']);
/** An item count in a reported context (the library, the selection). */
const contextCount = z.number().int().min(0).max(1_000_000);
/** The main window's command context (ADR-0005 §2). Strict: later tasks add fields here and in CommandContextState together. */
export const commandContextInput = z
  .object({
    view: z.enum(['library', 'viewer']),
    blocked: z.boolean(),
    sidebar: paneShownSchema.optional(),
    inspector: paneShownSchema.optional(),
    textSize: z.union([z.literal(12), z.literal(13), z.literal(14), z.literal(15)]),
    libraryCount: contextCount,
    selectionCount: contextCount,
    selectionAvailable: contextCount,
    selectionRelinkable: contextCount,
    scope: z.enum(['all', 'recent', 'unfiled', 'duplicates', 'collection']),
    collectionCount: contextCount,
    /** The colour slots 1–8 in use as a bitmask (bit n−1 = slot n). */
    tagPositions: z.number().int().min(0).max(255),
    tagFilterCount: contextCount,
    searchActive: z.boolean(),
    sortColumn: z.enum(LIBRARY_SORT_COLUMNS),
    sortDirection: z.enum(['asc', 'desc']),
    /** The columns drawn as a bitmask over LIBRARY_COLUMN_IDS (columnsMask). */
    columnsShown: z.number().int().min(0).max(2 ** LIBRARY_COLUMN_IDS.length - 1),
  })
  .strict() satisfies z.ZodType<CommandContextState>;
export type CommandContextInput = z.input<typeof commandContextInput>;

export const confirmDuplicateInput = z.object({ path: z.string().min(1).max(4096), existingItemId: z.uuid() });
export const sheetResultInput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('duplicate'), choice: z.enum(['open', 'add', 'skip']) }),
  z.object({ kind: z.literal('shortcuts') }),
]);
export type ConfirmDuplicateInput = z.input<typeof confirmDuplicateInput>;
export type SheetResultInput = z.input<typeof sheetResultInput>;

const point = { x: z.number().finite(), y: z.number().finite() };
/** Native context menus by kind (ADR-0005 §4): the registry commands that list the kind fill it; a kind none lists answers null. */
export const showContextMenuInput = z.discriminatedUnion('kind', [
  // The whole table selection (⌘A in a large library): the bound of the reported selection counts.
  z.object({ kind: z.literal('item'), itemIds: z.array(z.uuid()).min(1).max(1_000_000), ...point }),
  z.object({ kind: z.literal('collection'), collectionIds: z.array(z.uuid()).min(1).max(5000), ...point }),
  z.object({ kind: z.literal('tag'), tagIds: z.array(z.uuid()).min(1).max(5000), ...point }),
]);
/** The table header's native menu: which columns show now, which a view forces on (drawn checked and fixed), and where the pointer is. */
export const showColumnMenuInput = z
  .object({
    visible: z.array(z.enum(LIBRARY_COLUMN_IDS)).max(LIBRARY_COLUMN_IDS.length),
    locked: z.array(z.enum(LIBRARY_COLUMN_IDS)).max(LIBRARY_COLUMN_IDS.length).optional(),
    ...point,
  })
  .strict();

export type PickAndImportInput = z.input<typeof pickAndImportInput>;
export type ImportPathsInput = z.input<typeof importPathsInput>;
export type GetItemsInput = z.input<typeof getItemsInput>;

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
export type ThemeShownInput = z.input<typeof themeShownInput>;
export type UpdateMetadataInput = z.input<typeof updateMetadataInput>;
export type CreateCollectionInput = z.input<typeof createCollectionInput>;
export type SavePositionInput = z.input<typeof savePositionInput>;
export type ShowContextMenuInput = z.input<typeof showContextMenuInput>;
export type ShowColumnMenuInput = z.input<typeof showColumnMenuInput>;

/** The only surface the renderer sees (window.learn). */
export interface LearnApi {
  app: {
    info(): Promise<Result<AppInfo>>;
    /** Reveal the library folder in Finder / the file manager. */
    showLibraryFolder(): Promise<Result<void>>;
    /** Main picks and checks a folder, confirms the restart, saves it and relaunches (the renderer never sends a path). */
    chooseLibraryFolder(): Promise<Result<{ relaunching: boolean }>>;
  };
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
    /** Reveal the item's file in Finder / the file manager. */
    showInFolder(input: ItemIdInput): Promise<Result<void>>;
    /** Open the file with the system's default app. */
    openExternally(input: ItemIdInput): Promise<Result<void>>;
    /**
     * 사본 내보내기…: main asks where in a save panel on the calling window (a sheet on macOS), then copies the item's
     * file there through a temporary name and a rename. `saved: false` when the panel was cancelled. The path stays
     * in main (revealExport).
     */
    exportCopy(input: ItemIdInput): Promise<Result<{ saved: boolean }>>;
    /** Reveals the copy exported last in this run (NOT_FOUND when there is none, or it has gone since). */
    revealExport(): Promise<Result<void>>;
    /** Abstracts and memos of the items that have one (quick search reads them from its first query on). */
    searchTexts(): Promise<Result<SearchText[]>>;
    /** Collections, tags, memberships, tag assignments and duplicate groups in one read (the sidebar's data). */
    organize(): Promise<Result<OrganizeSnapshot>>;
    /** The non-trashed items among `ids`, once each in the order asked; unknown and trashed ids are skipped. */
    getItems(input: GetItemsInput): Promise<Result<LibraryItem[]>>;
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
    showContextMenu(input: ShowContextMenuInput): Promise<Result<PickedCommand | null>>;
    /** The calling window's current state (the windowState push only reports changes). */
    windowState(): Promise<Result<WindowState>>;
    /** The main window's command context changed; main re-derives the menu bar from it (other windows are ignored). */
    reportContext(input: CommandContextInput): Promise<Result<void>>;
    /** The duplicate sheet over the calling window; closing it without an answer is 'skip'. */
    confirmDuplicate(input: ConfirmDuplicateInput): Promise<Result<{ choice: DuplicateChoice }>>;
    /** The ⌘/ shortcut sheet over the calling window; resolves when it closes. */
    showShortcuts(): Promise<Result<void>>;
    /** ⌘, : opens the settings window, or brings it to the front (the main-owned app.settings command). */
    openSettings(): Promise<Result<void>>;
    /**
     * The calling page (the main or the settings window) now shows `shade`, after a theme change: main lets the
     * native theme follow it (T13R4-m1). Other windows are PERMISSION_DENIED.
     */
    themeShown(input: ThemeShownInput): Promise<Result<void>>;
    /**
     * The main window's page has drawn its first list and been idle once: main prepares the settings window hidden, so
     * the first ⌘, only shows it (spec 8). Other windows are PERMISSION_DENIED.
     */
    reportIdle(): Promise<Result<void>>;
    /** The column header menu: the column picked to show or hide, a reset, or null when dismissed. */
    showColumnMenu(input: ShowColumnMenuInput): Promise<Result<{ toggle: LibraryColumnId } | { reset: true } | null>>;
  };
  /** Only callable from an open sheet window. */
  sheet: {
    payload(): Promise<Result<SheetPayload>>;
    resolve(input: SheetResultInput): Promise<Result<void>>;
  };
  /** Subscribe to a main->renderer push event; returns an unsubscribe function. */
  on<K extends keyof LearnEventMap>(name: K, cb: (payload: LearnEventMap[K]) => void): () => void;
  /** Drag & drop: resolves a dropped File to its path via webUtils (sandbox-safe). */
  pathForFile(file: File): string;
}
