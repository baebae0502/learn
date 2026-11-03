import { z } from 'zod';
import { COMMAND_IDS, type CommandContextState, type PickedCommand } from './commands';
import type { BackupInfo } from './backup';
import type { LearnEventMap, WindowState } from './events';
import type {
  AppInfo, Collection, DuplicateGroup, EditedCopy, ItemDetail, KeepOneResult, LibraryItem, PurgedRows, SearchText, Tag, TrashView,
} from './library';
import { itemMetadataSchema } from './metadata';
import type { OrganizeSnapshot } from './organize';
import { readingLocatorSchema, type ReadingPosition } from './reading';
import type { Result } from './result';
import type { Prefs } from './settings';
import { CHECK_ACTS, type PurgeVariant, type SheetAction, type SheetPayload } from './sheets';
import { prefsFields } from './settings';
import { LIBRARY_COLUMN_IDS, LIBRARY_SORT_COLUMNS, type LibraryColumnId } from './library-columns';
import { TAG_COLORS, type TagColorId } from './tag-colors';
import { translationFromSchema, translationToSchema, type TranslationResult } from './translation';

export const storageModeSchema = z.enum(['managed', 'linked']);
/** The collection an import files its items into: a uuid, or null/absent for none. */
const importCollectionSchema = z.uuid().nullable().optional();
export const pickAndImportInput = z.object({
  mode: storageModeSchema,
  allowDuplicate: z.boolean().default(false),
  collectionId: importCollectionSchema,
}).strict();
/**
 * A file path a page sends (a drop): absolute, so main never resolves it against its own working folder (R4), and with no
 * NUL byte. The app runs on macOS and Linux, where an absolute path starts with "/".
 */
export const absolutePathSchema = z.string().min(1).max(4096).refine((p) => p.startsWith('/') && !p.includes('\0'), 'absolute path');
export const importPathsInput = z.object({
  paths: z.array(absolutePathSchema).min(1).max(500),
  mode: storageModeSchema,
  allowDuplicate: z.boolean().default(false),
  collectionId: importCollectionSchema,
}).strict();
export const itemIdInput = z.object({ itemId: z.uuid() });
export const emptyInput = z.object({}).strict().optional();

export const itemIdsInput = z.object({ itemIds: z.array(z.uuid()).min(1).max(5000) });
/**
 * An item's edited copy, by its bare file name in that item's folder (M6 spec 6): never a path (R4) — main finds the
 * file itself (editedCopyFile). NFC like every name a page sends.
 */
const copyNameSchema = z
  .string()
  .normalize('NFC')
  .min(1)
  .max(255)
  .refine((name) => !/[/\\\u0000]/.test(name) && name !== '.' && name !== '..');
export const editedCopyInput = z.object({ itemId: z.uuid(), name: copyNameSchema }).strict();
/**
 * library.purge (영구 삭제…): trashed items and collection rows of the trash view, at least one id. Live and unknown ids
 * are skipped by main. The item bound is the selection's (a trash view of a large library, all selected).
 */
export const purgeInput = z
  .object({ itemIds: z.array(z.uuid()).max(1_000_000), collectionIds: z.array(z.uuid()).max(5000) })
  .strict()
  .refine((input) => input.itemIds.length + input.collectionIds.length > 0);
/** library.keepOneOfDuplicates: rows chosen in the duplicates view; each one's group is cleaned once. */
export const keepOneInput = z.object({ itemIds: z.array(z.uuid()).min(1).max(1_000_000) }).strict();
const idPairSchema = z.tuple([z.uuid(), z.uuid()]);
/** library.undoKeepOne: the token keepOne handed out. Only items still in the trash under its stamp come back, and the merge is taken away only when all of them do. */
export const keepOneUndoInput = z
  .object({
    trashed: z.array(z.uuid()).max(1_000_000),
    stamp: z.iso.datetime(),
    kept: z.array(z.uuid()).max(1_000_000),
    memberships: z.array(idPairSchema).max(1_000_000),
    tags: z.array(idPairSchema).max(1_000_000),
  })
  .strict();
/** library.getItems: items by id. 5,000 like the other id lists; main asks the database 500 at a time. */
export const getItemsInput = z.object({ ids: z.array(z.uuid()).min(1).max(5000) }).strict();
/** Collection/tag names: NFC first (macOS can hand over decomposed Hangul), so equal-looking names compare equal. */
export const nameSchema = z.string().normalize('NFC').trim().min(1).max(200);
/** Item titles allow more than collection/tag names; NFC first, like names. */
export const titleSchema = z.string().normalize('NFC').trim().min(1).max(500);
export const positionSchema = z.number().int().min(1).max(8);
export const tagColorSchema = z.enum(TAG_COLORS.map((c) => c.id) as [TagColorId, ...TagColorId[]]);

export const updateMetadataInput = z.object({
  itemId: z.uuid(),
  title: titleSchema.optional(),
  metadata: itemMetadataSchema.optional(),
});
/** The organize inputs (collections, tags) and the imports that file into a collection are strict like every M5 input: an
 * unknown key is refused, not dropped. */
export const collectionIdInput = z.object({ collectionId: z.uuid() }).strict();
export const createCollectionInput = z.object({ name: nameSchema, parentId: z.uuid().nullable().optional() }).strict();
export const renameCollectionInput = z.object({ collectionId: z.uuid(), name: nameSchema }).strict();
export const moveCollectionInput = z.object({ collectionId: z.uuid(), parentId: z.uuid().nullable() }).strict();
export const collectionItemsInput = z.object({ collectionId: z.uuid(), itemIds: z.array(z.uuid()).min(1).max(5000) }).strict();
export const createTagInput = z.object({ name: nameSchema }).strict();
export const tagIdInput = z.object({ tagId: z.uuid() }).strict();
export const renameTagInput = z.object({ tagId: z.uuid(), name: nameSchema }).strict();
export const setTagColorInput = z.object({ tagId: z.uuid(), color: tagColorSchema.nullable(), position: positionSchema.nullable() }).strict();
export const tagItemsInput = z.object({ tagId: z.uuid(), itemIds: z.array(z.uuid()).min(1).max(5000) }).strict();
export const togglePositionInput = z.object({ position: positionSchema, itemIds: z.array(z.uuid()).min(1).max(5000) }).strict();
export const settingGetInput = z.object({ key: z.string().min(1).max(100) });
export const settingSetInput = z.object({ key: z.string().min(1).max(100), value: z.unknown() });
/** Main-internal prefs patch (the store's own input): built from default-free fields so omitted keys stay omitted. */
export const prefsPatchInput = z.object(prefsFields).partial().strict();
export type PrefsPatch = z.input<typeof prefsPatchInput>;
/** What the renderer may change: everything but the library location and the backup folder, which only main sets (R4). */
export const prefsSetInput = z.object(prefsFields).omit({ libraryRoot: true, backupDir: true }).partial().strict();
/** translation.translate: the selection's text (up to 20,000; the service refuses what is over 5,000 once prepared). */
export const translateInput = z.object({ text: z.string().min(1).max(20000), from: translationFromSchema, to: translationToSchema }).strict();
export type TranslateInput = z.input<typeof translateInput>;
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
    /** The colour slots 1–8 whose tag every selected item has, as a bitmask (bit n−1 = slot n). */
    selectionTagPositions: z.number().int().min(0).max(255),
    scope: z.enum(['all', 'recent', 'unfiled', 'duplicates', 'trash', 'collection']),
    collectionCount: contextCount,
    /** The colour slots 1–8 in use as a bitmask (bit n−1 = slot n). */
    tagPositions: z.number().int().min(0).max(255),
    tagFilterCount: contextCount,
    searchActive: z.boolean(),
    sortColumn: z.enum(LIBRARY_SORT_COLUMNS),
    sortDirection: z.enum(['asc', 'desc']),
    /** The columns drawn as a bitmask over LIBRARY_COLUMN_IDS (columnsMask). */
    columnsShown: z.number().int().min(0).max(2 ** LIBRARY_COLUMN_IDS.length - 1),
    /** Trashed items and collection rows (OrganizeSnapshot.trashCount): 휴지통 비우기 needs one (P-10). */
    trashCount: contextCount,
    /** The import queue has files to finish (가져오기 취소); absent where nothing imports. */
    importRunning: z.boolean().optional(),
    /** A backup is on main's work line: 백업 만들기… is off. */
    backupRunning: z.boolean().optional(),
    /** A restore is on main's work line: 백업에서 복원… is off. */
    restoreRunning: z.boolean().optional(),
    /** Duplicate groups of two or more listed items: 중복 N묶음 모두 정리 needs two and names the count (spec 11.1). */
    duplicateGroups: contextCount.optional(),
  })
  .strict() satisfies z.ZodType<CommandContextState>;
export type CommandContextInput = z.input<typeof commandContextInput>;

export const sheetResultInput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('duplicate'), choice: z.enum(['open', 'add', 'skip']), applyToRest: z.boolean() }),
  z.object({ kind: z.literal('shortcuts') }),
  z.object({ kind: z.literal('purge'), confirmed: z.boolean() }),
  z.object({ kind: z.literal('libraryCheck') }),
  z.object({ kind: z.literal('backupDone') }),
  z.object({ kind: z.literal('restoreDone'), switch: z.boolean() }),
]);
/** A native question with the renderer's words (collection delete, tag merge and delete): spec 3.4. */
export const confirmInput = z.object({ message: z.string().min(1).max(300), detail: z.string().max(600).optional(), confirm: z.string().min(1).max(40), caution: z.boolean().optional() }).strict();
export type ConfirmInput = z.input<typeof confirmInput>;
/** 영구 삭제… / 휴지통 비우기… (P-25): main opens the purge sheet with what it is about; the words are the sheet's own. */
export const confirmPurgeInput = z
  .object({ variant: z.enum(['items', 'collections', 'mixed', 'empty']) satisfies z.ZodType<PurgeVariant>, items: contextCount, collections: contextCount, name: z.string().min(1).max(1000).optional() })
  .strict();
export type ConfirmPurgeInput = z.input<typeof confirmPurgeInput>;
export type SheetResultInput = z.input<typeof sheetResultInput>;
/** An open sheet's own action (P-17): the library check's, by row; 다시 연결… names the item, never a path. */
export const sheetActionSchema = z.union([
  z.object({ kind: z.literal('libraryCheck'), act: z.enum(CHECK_ACTS) }).strict(),
  z.object({ kind: z.literal('libraryCheck'), act: z.literal('relink'), itemId: z.uuid() }).strict(),
  z.object({ kind: z.literal('libraryCheck'), act: z.literal('cleanUnreferenced'), keys: z.array(z.string().min(1).max(512)).max(100_000) }).strict(),
  z.object({ kind: z.literal('backupDone'), act: z.literal('reveal') }).strict(),
  z.object({ kind: z.literal('restoreDone'), act: z.literal('reveal') }).strict(),
]) satisfies z.ZodType<SheetAction>;
export const sheetActInput = z.object({ action: sheetActionSchema }).strict();
export type SheetActInput = z.input<typeof sheetActInput>;
/** The progress toast's 취소 (P-20 backup:cancel): which job stops — the backup when none is named. */
export const jobCancelInput = z.object({ job: z.enum(['backup', 'restore']) }).strict().optional();
export type JobCancelInput = z.input<typeof jobCancelInput>;

/** 파일 › 라이브러리 점검… (a fresh check) or, after main's recovery:show, the automatic one (spec 7.1). */
export const checkInput = z.object({ auto: z.boolean().optional() }).strict().optional();
export type CheckInput = z.input<typeof checkInput>;

const point = { x: z.number().finite(), y: z.number().finite() };
/** Native context menus by kind (ADR-0005 §4): the registry commands that list the kind fill it; a kind none lists answers null. */
export const showContextMenuInput = z.discriminatedUnion('kind', [
  // The whole table selection (⌘A in a large library): the bound of the reported selection counts.
  z.object({ kind: z.literal('item'), itemIds: z.array(z.uuid()).min(1).max(1_000_000), ...point }),
  z.object({ kind: z.literal('collection'), collectionIds: z.array(z.uuid()).min(1).max(5000), ...point }),
  z.object({ kind: z.literal('tag'), tagIds: z.array(z.uuid()).min(1).max(5000), ...point }),
  // The trash view's rows (P-10): trashed items and collection rows together; either list may be empty, main answers null when none is in the trash.
  z.object({ kind: z.literal('trash'), itemIds: z.array(z.uuid()).max(1_000_000), collectionIds: z.array(z.uuid()).max(5000), ...point }),
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
export type ItemIdsInput = z.input<typeof itemIdsInput>;
export type PurgeInput = z.input<typeof purgeInput>;
export type KeepOneInput = z.input<typeof keepOneInput>;
export type KeepOneUndoInput = z.input<typeof keepOneUndoInput>;
export type EditedCopyInput = z.input<typeof editedCopyInput>;
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
    /** 마지막 백업 for the settings window (spec 8.2): when, and the folder's name; null when this library has none. */
    backupInfo(): Promise<Result<BackupInfo | null>>;
    /** Shows the last backup's folder in Finder; main has its path (the page never sends one). */
    revealBackup(): Promise<Result<void>>;
    /** The fatal screen's Finder에서 보기 (spec 9.4): main shows the pre-update backup it found, selected; the page sends no path. */
    revealUpdateBackup(): Promise<Result<void>>;
  };
  library: {
    /**
     * 파일 가져오기… / 외부 파일 연결…: main's open panel on the calling window, then the files go into main's import
     * queue (spec 3.7). Answered at once: `queued` is the run's total with them in, 0 when nothing was picked. What
     * becomes of them comes as import:progress and import:finished.
     */
    pickAndImport(input: PickAndImportInput): Promise<Result<{ queued: number }>>;
    /** Dropped files (absolute paths, 500 a call at most) into the import queue; answered as pickAndImport is. */
    import(input: ImportPathsInput): Promise<Result<{ queued: number }>>;
    /** 취소 on the progress toast, 가져오기 취소 in the palette: the file under way stops at its next checkpoint (spec 3.5). */
    cancelImport(): Promise<Result<void>>;
    list(): Promise<Result<LibraryItem[]>>;
    get(input: ItemIdInput): Promise<Result<LibraryItem>>;
    /**
     * 다시 연결… from one item: main shows the open panel, points that item's file at the picked one (every item on the
     * file follows) and answers that item; null when the panel was cancelled.
     */
    pickAndRelink(input: ItemIdInput): Promise<Result<LibraryItem | null>>;
    /**
     * 라이브러리 점검 (spec 7.1): checks again and shows the sheet over the calling window — with 문제가 없습니다 when nothing
     * is wrong; `{ auto: true }` (after recovery:show) shows the startup's list, or nothing when that has nothing to act
     * on. Answers when the sheet has closed.
     */
    check(input?: CheckInput): Promise<Result<void>>;
    detail(input: ItemIdInput): Promise<Result<ItemDetail>>;
    updateMetadata(input: UpdateMetadataInput): Promise<Result<LibraryItem>>;
    trash(input: ItemIdsInput): Promise<Result<number>>;
    restore(input: ItemIdsInput): Promise<Result<number>>;
    /** The trash view (spec 4.3): its collection rows and items, most recently trashed first. */
    trashView(): Promise<Result<TrashView>>;
    /**
     * 영구 삭제: the trashed ones among these, in one transaction; their files go after it (ADR-0006). Answers what was
     * removed (nothing for live or unknown ids). Announced as libraryChanged{purge}.
     */
    purge(input: PurgeInput): Promise<Result<PurgedRows>>;
    /** 휴지통 비우기: everything in the trash, as purge does. */
    emptyTrash(): Promise<Result<PurgedRows>>;
    /** 하나만 남기고 휴지통으로 (spec 5) for the duplicate groups of these items; the answer carries its undo. */
    keepOneOfDuplicates(input: KeepOneInput): Promise<Result<KeepOneResult>>;
    /** 중복 N묶음 모두 정리: every duplicate group. */
    keepOneOfAllDuplicates(): Promise<Result<KeepOneResult>>;
    /** The undo of either: how many items came back. */
    undoKeepOne(input: KeepOneUndoInput): Promise<Result<number>>;
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
    /** The copies another app saved beside the item's read-only copy, newest first (spec 6); [] when there are none. */
    editedCopies(input: ItemIdInput): Promise<Result<EditedCopy[]>>;
    /**
     * 새 자료로 가져오기: the copy into the import queue as a new item (a managed copy, titled after the copy, in no
     * collection). Once its import committed and its bytes were checked again, main removes the copy.
     */
    importEditedCopy(input: EditedCopyInput): Promise<Result<{ queued: number }>>;
    /** Finder에서 보기 with the copy selected. */
    revealEditedCopy(input: EditedCopyInput): Promise<Result<void>>;
  };
  collections: {
    list(): Promise<Result<Collection[]>>;
    create(input: CreateCollectionInput): Promise<Result<Collection>>;
    rename(input: RenameCollectionInput): Promise<Result<Collection>>;
    move(input: MoveCollectionInput): Promise<Result<Collection>>;
    remove(input: CollectionIdInput): Promise<Result<void>>;
    restore(input: CollectionIdInput): Promise<Result<Collection>>;
    /** The ids whose membership really changed. */
    addItems(input: CollectionItemsInput): Promise<Result<string[]>>;
    removeItems(input: CollectionItemsInput): Promise<Result<string[]>>;
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
  translation: {
    translate(input: TranslateInput): Promise<Result<TranslationResult>>;
    /** Stops the request in flight, if any: it answers CANCELLED. */
    cancel(): Promise<Result<void>>;
  };
  reader: {
    /** Records that the viewer opened the item (sets `openedAt`; creates the position row at the start if none). */
    open(input: ItemIdInput): Promise<Result<void>>;
    /** The stored position, or null. A pure read. */
    getPosition(input: ItemIdInput): Promise<Result<ReadingPosition | null>>;
    savePosition(input: SavePositionInput): Promise<Result<void>>;
  };
  backup: {
    /** 백업 만들기…: main asks for a folder over the calling window and puts the backup on its work line (spec 8.1). */
    create(): Promise<Result<{ started: boolean }>>;
    /** The progress toast's 취소: the job named (the backup when none is) stops at its next checkpoint and leaves nothing. */
    cancel(input?: JobCancelInput): Promise<Result<void>>;
    /**
     * 백업에서 복원… (spec 9.1): main asks for a backup over the calling window, checks it, asks where, and restores into a
     * new folder there on its work line; answers once it is on the line, not when it ends.
     */
    restore(): Promise<Result<{ started: boolean }>>;
  };
  ui: {
    showContextMenu(input: ShowContextMenuInput): Promise<Result<PickedCommand | null>>;
    /** The calling window's current state (the windowState push only reports changes). */
    windowState(): Promise<Result<WindowState>>;
    /** The main window's command context changed; main re-derives the menu bar from it (other windows are ignored). */
    reportContext(input: CommandContextInput): Promise<Result<void>>;
    /** A sheet on the main window with the confirming button first (the default) and 취소: true when it was chosen. */
    confirm(input: ConfirmInput): Promise<Result<boolean>>;
    /** The purge sheet (P-25): true when its destructive button was pressed; 취소, esc, ↩ and a sheet that went away are false. */
    confirmPurge(input: ConfirmPurgeInput): Promise<Result<boolean>>;
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
    /** The open sheet's own action (P-17): main does it and answers what the sheet shows now (the check's rows). */
    act(input: SheetActInput): Promise<Result<SheetPayload>>;
  };
  /** Subscribe to a main->renderer push event; returns an unsubscribe function. */
  on<K extends keyof LearnEventMap>(name: K, cb: (payload: LearnEventMap[K]) => void): () => void;
  /** Drag & drop: resolves a dropped File to its path via webUtils (sandbox-safe). */
  pathForFile(file: File): string;
}
