import { COMMANDS, isCommandAvailable, type CommandArgs, type CommandContextState, type CommandId, type CommandTargetInfo, type PickedCommand } from '@learn/domain/commands';
import type { StorageMode } from '@learn/domain';
import type { TextSize, TextSizeUpdate } from '../settings/textSize';

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
  /** ⇧⌘N and 새 하위 컬렉션: a row for the new collection (at the top, or under `parentId`), named in place by the sidebar. */
  newCollection(opts?: { parentId?: string | null; onCreated?: (collectionId: string) => void }): void;
  /** 이름 바꾸기: the collection's row becomes its name field. */
  renameCollection(collectionId: string): void;
  /** 컬렉션 삭제…: the sheet, then the delete with its 실행 취소. */
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
  open(itemId: string): void;
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
  /** ⌘, (Task 10; main-owned: main opens the window, also from the palette). */
  openSettings(): void;
  /** ⌘+ / ⌘− / ⌘0 (Task 10): the UI text size pref, as a step from the newest size (settings/textSize.ts). */
  setTextSize(update: TextSizeUpdate): void;
  /** F6 / ⇧F6 (Task 12): the next / previous pane (shell/panes.ts). */
  focusPane(direction: 1 | -1): void;
  /** ⌘F: the quick search field takes the focus with its text selected (library/LibrarySearch.tsx). */
  focusSearch(): void;
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
  'library.find': (env) => env.focusSearch(),
  'nav.back': (env) => env.back(),
  'item.open': (env, t) => env.open(itemOf(t)),
  'item.showInFolder': (env, t) => env.showInFolder(itemOf(t)),
  'item.openExternally': (env, t) => env.openExternally(itemOf(t)),
  'item.exportCopy': (env, t) => env.exportCopy(itemOf(t)),
  'item.editInfo': (env, t) => env.editInfo(itemOf(t)),
  'collection.addItems': (env, target) => env.addToCollection(target.itemIds ?? [], target.args ?? {}),
  'collection.removeItems': (env, target) => env.removeFromCollection(target.itemIds ?? []),
  'item.relink': (env, t) => env.relink(itemOf(t)),
  'collection.new': (env) => env.newCollection(),
  'collection.newChild': (env, t) => env.newCollection({ parentId: collectionOf(t) }),
  'collection.rename': (env, t) => env.renameCollection(collectionOf(t)),
  'collection.importInto': (env, t) => env.importFiles('managed', collectionOf(t)),
  'collection.delete': (env, t) => env.deleteCollection(collectionOf(t)),
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
  'view.textBigger': (env) => env.setTextSize((size) => clampTextSize(size + 1)),
  'view.textSmaller': (env) => env.setTextSize((size) => clampTextSize(size - 1)),
  'view.textReset': (env) => env.setTextSize(() => 13),
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
    ...(env.sidebar ? { sidebar: env.sidebar } : {}),
    ...(env.inspector ? { inspector: env.inspector } : {}),
  };
}

/**
 * The targets of a command from the menu bar (its accelerator or a click): an item command acts on the table's
 * selection, which only the library view shows (spec 6: off in the reader, as main's availableMenuCommands judges it).
 */
export function menuTarget(id: CommandId, env: CommandEnv): CommandTarget {
  if (!COMMANDS.find((c) => c.id === id)?.contexts.includes('item')) return {};
  return { itemIds: env.view === 'library' ? env.selection() : [] };
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
  if (!Object.hasOwn(COMMAND_HANDLERS, commandId) || judged(env).blocked) return false; // COMMAND_HANDLERS has exactly the registry ids
  COMMAND_HANDLERS[commandId](env, args ? { ...target, args } : target);
  return true;
}
