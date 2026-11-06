import { COMMANDS, isCommandAvailable, type CommandArgs, type CommandContextState, type CommandId, type CommandTargetInfo, type PickedCommand } from '@learn/domain/commands';
import type { PageColor, StorageMode } from '@learn/domain';
import type { TextSize, TextSizeUpdate } from '../settings/textSize';
import type { ReaderNav, ZoomValue } from '../viewers/pdf/readerStore';

/** What the main window can do now: its command context plus the handlers. Rebuilt every render; later tasks add handlers. */
export interface CommandEnv extends CommandContextState {
  /** The availability facts of a target: its items (the library list, the file re-checked), its collections and tags. */
  targetsOf(target: CommandTarget): CommandTargetInfo[];
  /**
   * The table selection in table order: the targets of an item command run from the menu bar. Read when the
   * command runs, so a closing palette does not run it on an older selection.
   */
  selection(): readonly string[];
  /** `into`: undefined = the collection being viewed, if any (⌘O in a collection files there); null = none; an id = that collection. */
  importFiles(mode: StorageMode, into?: string | null): void;
  /** 라이브러리 점검…: main checks again and shows its sheet over this window (held as any sheet it asks for). */
  checkLibrary(): void;
  /** ⇧⌘N and 새 하위 컬렉션: a row for the new collection (at the top, or under `parentId`), named in place by the sidebar. */
  newCollection(opts?: { parentId?: string | null; onCreated?: (collectionId: string) => void }): void;
  /** 이름 바꾸기: the collection's row becomes its name field. */
  renameCollection(collectionId: string): void;
  /** 휴지통으로 이동 on a collection (spec 4.2): at once, with 실행 취소. */
  deleteCollection(collectionId: string): void;
  /** 1–8 (spec 4.2): the tag at the slot goes on the items, or off them when every one has it; a slot with no tag says so. */
  toggleTagPosition(position: number, itemIds: readonly string[]): void;
  /** 이름 바꾸기 on a tag chip: the chip becomes its name field. */
  renameTag(tagId: string): void;
  /** 색 지정 ▸ N: colour N is slot N; the tag that held the slot loses it. */
  setTagColor(tagId: string, position: number): void;
  clearTagColor(tagId: string): void;
  /** 태그 삭제…: the sheet, then the delete (no undo). */
  deleteTag(tagId: string): void;
  /** 태그 선택 해제. */
  clearTagFilter(): void;
  back(): void;
  /** ↩, a double-click and ⌘↩: one tab per item (the first one's shown unless `background`); eleven or more ask first. */
  openItems(itemIds: readonly string[], opts?: { background?: boolean }): void;
  /** ⌘W and the tab menu: the reader tab of this item, or the shown one (the library's tab closes the window). */
  closeTab(itemId?: string): void;
  /** ⇧⌘T. */
  reopenClosedTab(): void;
  /** ⌃⇥ / ⌃⇧⇥. */
  selectRelativeTab(delta: 1 | -1): void;
  /** ⌘2…⌘8: the tab at this place in the strip (0 is the library's). */
  selectTabAt(index: number): void;
  /** ⌘9. */
  selectLastTab(): void;
  /** ⌥⇧← / ⌥⇧→ and the palette: this item's tab, or the shown one, a place left or right. */
  moveTab(delta: -1 | 1, itemId?: string): void;
  /** 다른 탭 닫기: all reader tabs but this item's (or the shown one). */
  closeOtherTabs(itemId?: string): void;
  /** 라이브러리에서 보기: the library tab shows, with the item's row selected and in view. */
  revealInLibrary(itemId: string): void;
  relink(itemId: string): void;
  /** ⌃⌘S (Task 4). */
  toggleSidebar(): void;
  /** ⌥⌘I: the item panel, by the sidebar's rules (shell/layout.ts toggledInspector). */
  toggleInspector(): void;
  /** ⌘/ (Task 6). */
  showShortcuts(): void;
  /** ⌘K (Task 9): opens the palette, or selects its field when it is already open. */
  openPalette(): void;
  /** Finder에서 보기 / 기본 앱으로 열기 (Task 7). */
  showInFolder(itemId: string): void;
  openExternally(itemId: string): void;
  /** 사본 내보내기…: main's save panel, then the copy; the toast that says it is saved can reveal it. */
  exportCopy(itemId: string): void;
  /** 정보 편집: the item panel shows (if folded) and its 정보 section becomes the form. */
  editInfo(itemId: string): void;
  /** 컬렉션에 추가 ▸: the items into the collection a menu row names, or (addSelection) into a new one named in the tree. */
  addToCollection(itemIds: readonly string[], args: CommandArgs): void;
  /** 이 컬렉션에서 빼기: out of the collection viewed and below it; the toast offers 실행 취소. */
  removeFromCollection(itemIds: readonly string[]): void;
  /** 하나만 남기고 휴지통으로: each group of these items keeps its earliest import; the toast offers 실행 취소 (spec 5). */
  keepOneOfDuplicates(itemIds: readonly string[]): void;
  /** 중복 N묶음 모두 정리. */
  keepAllDuplicates(): void;
  /** The trash view's selected rows, items and collections apart (P-10): what 복원 and 영구 삭제… act on from a menu or the palette. */
  trashSelection(): TrashRows;
  /** 휴지통으로 이동 ⌘⌫ (spec 4.1): at once, with 실행 취소. */
  trashItems(itemIds: readonly string[]): void;
  /** 복원 (spec 4.4). */
  restore(rows: TrashRows): void;
  /** 영구 삭제… (spec 4.5, P-25): the sheet, then the delete. */
  purge(rows: TrashRows): void;
  /** 휴지통 비우기… (spec 4.5): the sheet, then the delete. */
  emptyTrash(): void;
  /** ⌘, (Task 10; main-owned: main opens the window, also from the palette). */
  openSettings(): void;
  /** ⌘+ / ⌘− / ⌘0 (Task 10): the UI text size pref, as a step from the newest size (settings/textSize.ts). */
  setTextSize(update: TextSizeUpdate): void;
  /** ⌘+ / ⌘− / ⌘0 in the reader (P-9): one step of the zoom steps, or the actual size. */
  zoom(dir: 'in' | 'out' | 'actual'): void;
  /** 자동 맞춤 · 너비에 맞춤 · 한 쪽 전체 보기, or a scale (1 is 100 %). */
  setZoom(zoom: ZoomValue): void;
  /** ⌘R / ⌘L: every page a quarter turn. */
  rotate(delta: 90 | -90): void;
  /** 쪽 색: saved as the reader's setting. */
  setPageColor(color: PageColor): void;
  /** ⌥⌘G: the page field takes the focus with its number selected. */
  goToPage(): void;
  /** ⌘F in the reader: the find bar opens (or its field is taken again) with its text selected. */
  openFind(): void;
  /** ⌘G / ⇧⌘G: the next or the previous match; a bar that is closed opens first. */
  findAgain(previous: boolean): void;
  /** ⌘E: the selected text becomes the find bar's query. */
  findSelection(): void;
  /** 선택한 글 번역 (palette): the reader's selection is translated, its pop-up shown again. */
  translateSelection(): void;
  /** ⌥⌘2 / ⌥⌘3: the reader's sidebar shows the thumbnails or the outline (the sidebar opens if it is folded). */
  showReaderNav(kind: ReaderNav): void;
  /** 가져오기 취소 (the palette; the progress toast's 취소 does the same): main's queue stops (spec 3.5). */
  cancelImport(): void;
  /** 백업 만들기… (spec 8.1): main asks for a folder and puts the backup on its work line; the window stays in use. */
  backup(): void;
  /** 백업에서 복원… (spec 9.1): main asks for a backup and a place and restores into a new folder on its work line. */
  restoreBackup(): void;
  /** F6 / ⇧F6 (Task 12): the next / previous pane (shell/panes.ts). */
  focusPane(direction: 1 | -1): void;
  /** ⌘F: the quick search field takes the focus with its text selected (library/LibrarySearch.tsx). */
  focusSearch(): void;
  /** 내 라이브러리 전체에서 찾기: the view becomes 내 라이브러리; the query, which the quick search holds, stays (spec 3.5, 7.1). */
  findEverywhere(): void;
  /** 보기 › 정렬 기준: sets the sort of the view shown from a column and/or a direction (the other stays as it is). */
  sortBy(args: CommandArgs): void;
  /**
   * A modal surface owns the keyboard: a sheet, the palette, the drop overlay (MainWindow derives it once). Not
   * reported to main; it tells an import (blocked alone) from a modal surface for `duringWork` commands.
   */
  modal: boolean;
  /**
   * A sheet was asked for and is not on screen yet (T13M-n4). Commands are judged as in the blocked, modal window it
   * is about to be, and main's menu bar is told so (reportedContext), but nothing is drawn disabled: the window does
   * not grey before the sheet appears.
   */
  held?: boolean;
  /** The import queue has files to finish (jobs/jobProgress.ts): 가져오기 취소 is available. */
  importRunning?: boolean;
  /** A backup is on main's work line (jobs/jobProgress.ts): 백업 만들기… is off until it ends. */
  backupRunning?: boolean;
  /** A restore is on main's work line (jobs/jobProgress.ts): 백업에서 복원… is off until it ends. */
  restoreRunning?: boolean;
}

const clampTextSize = (n: number): TextSize => Math.min(15, Math.max(12, n)) as TextSize;

/**
 * What a command acts on: the table's items, a sidebar collection, a tag chip, and the value of the menu row that ran it.
 * Every way in (the menu bar, the palette, the key map, a context menu, the buttons) hands a handler this one shape.
 */
export interface CommandTarget {
  itemIds?: readonly string[];
  collectionIds?: readonly string[];
  tagIds?: readonly string[];
  args?: CommandArgs;
}

/** Rows of the trash view (P-10): trashed items and collection rows. */
export interface TrashRows {
  itemIds: string[];
  collectionIds: string[];
}
const trashRowsOf = (t: CommandTarget): TrashRows => ({ itemIds: [...(t.itemIds ?? [])], collectionIds: [...(t.collectionIds ?? [])] });

type Handler = (env: CommandEnv, target: CommandTarget) => void;

/** The one item an item command acts on (its availability rule asks for exactly one). */
const itemOf = (target: CommandTarget): string => target.itemIds![0]!;
/** The one collection a collection command acts on (its availability rule asks for exactly one). */
const collectionOf = (target: CommandTarget): string => target.collectionIds![0]!;
/** The one tag a tag command acts on (its availability rule asks for exactly one). */
const tagOf = (target: CommandTarget): string => target.tagIds![0]!;
/** A colour key: the tag at the slot goes on the items handed over (the table selection), or off them when all have it. */
const colorAt = (slot: number): Handler => (env, t) => env.toggleTagPosition(slot, t.itemIds ?? []);

/** Renderer side of the registry: exactly one handler per command id (menus can only show handled commands). */
export const COMMAND_HANDLERS: Record<CommandId, Handler> = {
  'file.importManaged': (env) => env.importFiles('managed'),
  'file.importLinked': (env) => env.importFiles('linked'),
  'file.checkLibrary': (env) => env.checkLibrary(),
  'file.cancelImport': (env) => env.cancelImport(),
  'file.backup': (env) => env.backup(),
  'file.restore': (env) => env.restoreBackup(),
  // One key, two views (P-9): the reader's field is the find bar.
  'library.find': (env) => (env.view === 'viewer' ? env.openFind() : env.focusSearch()),
  'reader.findNext': (env) => env.findAgain(false),
  'reader.findPrevious': (env) => env.findAgain(true),
  'reader.findSelection': (env) => env.findSelection(),
  'translation.translateSelection': (env) => env.translateSelection(),
  'reader.showThumbnails': (env) => env.showReaderNav('thumbnails'),
  'reader.showOutline': (env) => env.showReaderNav('outline'),
  'library.findEverywhere': (env) => env.findEverywhere(),
  'nav.back': (env) => env.back(),
  'item.open': (env, t) => env.openItems(t.itemIds ?? []),
  'item.openInBackground': (env, t) => env.openItems(t.itemIds ?? [], { background: true }),
  // A target names the tab a menu was opened on; without one the shown tab is meant (⌘W, the palette).
  'tab.close': (env, t) => env.closeTab(t.itemIds?.[0]),
  'tab.reopenClosed': (env) => env.reopenClosedTab(),
  'tab.next': (env) => env.selectRelativeTab(1),
  'tab.previous': (env) => env.selectRelativeTab(-1),
  'tab.goTo2': (env) => env.selectTabAt(1),
  'tab.goTo3': (env) => env.selectTabAt(2),
  'tab.goTo4': (env) => env.selectTabAt(3),
  'tab.goTo5': (env) => env.selectTabAt(4),
  'tab.goTo6': (env) => env.selectTabAt(5),
  'tab.goTo7': (env) => env.selectTabAt(6),
  'tab.goTo8': (env) => env.selectTabAt(7),
  'tab.last': (env) => env.selectLastTab(),
  'tab.moveLeft': (env, t) => env.moveTab(-1, t.itemIds?.[0]),
  'tab.moveRight': (env, t) => env.moveTab(1, t.itemIds?.[0]),
  'tab.closeOthers': (env, t) => env.closeOtherTabs(t.itemIds?.[0]),
  'tab.revealInLibrary': (env, t) => env.revealInLibrary(itemOf(t)),
  'item.showInFolder': (env, t) => env.showInFolder(itemOf(t)),
  'item.openExternally': (env, t) => env.openExternally(itemOf(t)),
  'item.exportCopy': (env, t) => env.exportCopy(itemOf(t)),
  'item.editInfo': (env, t) => env.editInfo(itemOf(t)),
  'collection.addItems': (env, target) => env.addToCollection(target.itemIds ?? [], target.args ?? {}),
  'collection.removeItems': (env, target) => env.removeFromCollection(target.itemIds ?? []),
  // ⌘⌫: the trash view's rows are purged after the sheet (P-11); anywhere else the items go to the trash.
  'item.trash': (env, t) => (env.scope === 'trash' ? env.purge(trashRowsOf(t)) : env.trashItems(t.itemIds ?? [])),
  'item.restore': (env, t) => env.restore(trashRowsOf(t)),
  'item.relink': (env, t) => env.relink(itemOf(t)),
  'collection.new': (env) => env.newCollection(),
  'collection.newChild': (env, t) => env.newCollection({ parentId: collectionOf(t) }),
  'collection.rename': (env, t) => env.renameCollection(collectionOf(t)),
  'collection.importInto': (env, t) => env.importFiles('managed', collectionOf(t)),
  'collection.delete': (env, t) => env.deleteCollection(collectionOf(t)),
  'duplicates.keepOne': (env, target) => env.keepOneOfDuplicates(target.itemIds ?? []),
  'duplicates.keepOneAll': (env) => env.keepAllDuplicates(),
  'tag.color1': colorAt(1),
  'tag.color2': colorAt(2),
  'tag.color3': colorAt(3),
  'tag.color4': colorAt(4),
  'tag.color5': colorAt(5),
  'tag.color6': colorAt(6),
  'tag.color7': colorAt(7),
  'tag.color8': colorAt(8),
  'tag.rename': (env, t) => env.renameTag(tagOf(t)),
  // The head of 색 지정 ▸ is not a row: with no slot there is nothing to set.
  'tag.setColor': (env, t) => {
    if (t.args?.position !== undefined) env.setTagColor(tagOf(t), t.args.position);
  },
  'tag.clearColor': (env, t) => env.clearTagColor(tagOf(t)),
  'tag.delete': (env, t) => env.deleteTag(tagOf(t)),
  'tags.clearFilter': (env) => env.clearTagFilter(),
  'view.toggleSidebar': (env) => env.toggleSidebar(),
  'view.toggleInspector': (env) => env.toggleInspector(),
  'app.shortcuts': (env) => env.showShortcuts(),
  'app.palette': (env) => env.openPalette(),
  'app.settings': (env) => env.openSettings(),
  // The same keys zoom the reader's page (P-9); the registry names them by the view.
  'view.textBigger': (env) => (env.view === 'viewer' ? env.zoom('in') : env.setTextSize((size) => clampTextSize(size + 1))),
  'view.textSmaller': (env) => (env.view === 'viewer' ? env.zoom('out') : env.setTextSize((size) => clampTextSize(size - 1))),
  'view.textReset': (env) => (env.view === 'viewer' ? env.zoom('actual') : env.setTextSize(() => 13)),
  'reader.zoomAuto': (env) => env.setZoom('auto'),
  'reader.zoomPageWidth': (env) => env.setZoom('page-width'),
  'reader.zoomPageFit': (env) => env.setZoom('page-fit'),
  'reader.rotateCw': (env) => env.rotate(90),
  'reader.rotateCcw': (env) => env.rotate(-90),
  'reader.goToPage': (env) => env.goToPage(),
  'reader.pageColorAuto': (env) => env.setPageColor('auto'),
  'reader.pageColorOriginal': (env) => env.setPageColor('original'),
  'reader.pageColorSepia': (env) => env.setPageColor('sepia'),
  'reader.pageColorDark': (env) => env.setPageColor('dark'),
  'trash.empty': (env) => env.emptyTrash(),
  'view.nextPane': (env) => env.focusPane(1),
  'view.previousPane': (env) => env.focusPane(-1),
  // A value submenu's head is not a row: with no value there is nothing to sort by.
  'library.sortBy': (env, t) => {
    if (t.args) env.sortBy(t.args);
  },
};

/** Just the context fields (what main needs for the menu bar: availability and counts, and the pane states for its labels). */
export function contextOf(env: CommandEnv): CommandContextState {
  return {
    view: env.view,
    blocked: env.blocked,
    textSize: env.textSize,
    libraryCount: env.libraryCount,
    selectionCount: env.selectionCount,
    selectionAvailable: env.selectionAvailable,
    selectionRelinkable: env.selectionRelinkable,
    selectionTagPositions: env.selectionTagPositions,
    scope: env.scope,
    collectionCount: env.collectionCount,
    tagPositions: env.tagPositions,
    tagFilterCount: env.tagFilterCount,
    searchActive: env.searchActive,
    sortColumn: env.sortColumn,
    sortDirection: env.sortDirection,
    columnsShown: env.columnsShown,
    trashCount: env.trashCount,
    ...(env.pdfOpen ? { pdfOpen: true } : {}),
    ...(env.pdfSelection ? { pdfSelection: true } : {}),
    ...(env.translationOff ? { translationOff: true } : {}),
    ...(env.sidebar ? { sidebar: env.sidebar } : {}),
    ...(env.inspector ? { inspector: env.inspector } : {}),
    ...(env.importRunning ? { importRunning: true } : {}),
    ...(env.backupRunning ? { backupRunning: true } : {}),
    ...(env.restoreRunning ? { restoreRunning: true } : {}),
    ...(env.duplicateGroups !== undefined ? { duplicateGroups: env.duplicateGroups } : {}),
    ...(env.tabCount ? { tabCount: env.tabCount } : {}),
    ...(env.closedOpenable ? { closedOpenable: true } : {}),
  };
}

/**
 * The targets of a command from the menu bar (its accelerator or a click) and the palette: a trash command takes the trash
 * view's selected rows there (P-10); an item command the table's selection, which only the library view shows (spec 6: off
 * in the reader, as main's availableMenuCommands judges it).
 */
export function menuTarget(id: CommandId, env: CommandEnv): CommandTarget {
  const contexts = COMMANDS.find((c) => c.id === id)?.contexts ?? [];
  if (contexts.includes('trash') && env.scope === 'trash' && env.view === 'library') return env.trashSelection();
  if (!contexts.includes('item')) return {};
  return { itemIds: env.view === 'library' ? env.selection() : [] };
}

/** The keys a text field edits with (⌘⌫, ⇧⌘⌫ — delete to the line's start): a menu that took one from a field gives it back (Q-6e). */
export function yieldsToText(id: CommandId): boolean {
  return /\+(Backspace|Delete)$/.test(COMMANDS.find((c) => c.id === id)?.accelerator ?? '');
}

/** The window a command is judged in: a held one counts as the blocked, modal window it is about to be. */
const judged = (env: CommandEnv): CommandEnv => (env.held ? { ...env, blocked: true, modal: true } : env);

/** What main is told (ui.reportContext): a held window as blocked, so the menu bar refuses what the sheet will. */
export const reportedContext = (env: CommandEnv): CommandContextState => contextOf(judged(env));

export function isCommandEnabled(id: CommandId, env: CommandEnv, target: CommandTarget = {}): boolean {
  if (!Object.hasOwn(COMMAND_HANDLERS, id)) return false;
  return isCommandAvailable(id, contextOf(env), env.targetsOf(target), { modal: env.modal });
}

/** Runs a command if it is available now; returns whether it ran. */
export function runCommand(id: CommandId, env: CommandEnv, target: CommandTarget = {}): boolean {
  if (!isCommandEnabled(id, judged(env), target)) return false;
  COMMAND_HANDLERS[id](env, target);
  return true;
}

/**
 * A command picked from a native menu (a context menu): main enabled it with fresh file state (the renderer's list may lag
 * one libraryChanged behind), so only the window-level block is checked here. The row's value joins the target the menu
 * was opened for.
 */
export function runPicked(picked: PickedCommand, env: CommandEnv, target: CommandTarget): boolean {
  const { commandId, args } = picked;
  if (!Object.hasOwn(COMMAND_HANDLERS, commandId) || (judged(env).blocked && commandId !== 'tab.close')) return false; // COMMAND_HANDLERS has exactly the registry ids
  COMMAND_HANDLERS[commandId](env, args ? { ...target, args } : target);
  return true;
}
