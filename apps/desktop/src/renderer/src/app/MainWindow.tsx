import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { columnsMask, commandById, commandLabel, commandMention, tagPositionsMask, type AppInfo, type LibraryItem, type Prefs, type Result, type StorageMode } from '@learn/domain';
import { ApiError, api, unwrap } from '../api';
import { CommandProvider } from '../commands/CommandProvider';
import { useKeymap } from '../commands/keymap';
import { runCommand, runPicked, type CommandEnv } from '../commands/registry';
import { commandTargets } from '../commands/targets';
import { EmptyTrashButton } from '../trash/EmptyTrashButton';
import { trashActions } from '../trash/actions';
import { splitTrashSelection, trashSelectionCount, withTrashTargets } from '../trash/trashRows';
import { leaveTrashView, useInTrash, useLeaveEmptyTrash, useTrash } from '../trash/useTrashSource';
import { useReportContext } from '../commands/useReportContext';
import { useMenuCommands } from '../commands/useMenuCommands';
import { keys, useItems, useLibrarySync, usePrefs } from '../data/queries';
import { queryClient } from '../data/query-client';
import { useBusyScreen } from '../library/busyScreen';
import { visibleColumns } from '../library/columns';
import { sortFromArgs } from '../library/sort';
import { createExportCopy } from '../library/exportCopy';
import { whenPanelCloses } from '../library/fileActions';
import { runFileAction } from '../library/runFileAction';
import { EmptyLibrary } from '../library/EmptyLibrary';
import { afterEditing } from '../inspector/editGuard';
import { Inspector } from '../inspector/Inspector';
import { InspectorToggle } from '../inspector/InspectorToggle';
import { startEditing } from '../inspector/startEditing';
import { KeepAllDuplicatesButton } from '../library/KeepAllDuplicatesButton';
import { ImportMenuButton } from '../library/ImportMenuButton';
import { LibrarySearch, focusQuickSearch } from '../library/LibrarySearch';
import { LibraryLoading } from '../library/LibraryLoading';
import { LibraryView } from '../library/LibraryView';
import { ListFailed } from '../library/ListFailed';
import { inTableOrder, selectionCounts, selectionTagPositions } from '../library/selection';
import { useImportQueue } from '../library/useImportQueue';
import { useBackupJob } from '../jobs/backupJob';
import { restoreRefused, useRestoreJob } from '../jobs/restoreJob';
import { importBusy, importBusyTotal, useJobProgress } from '../jobs/jobProgress';
import { useLibrarySettings } from '../library/useLibrarySettings';
import { LibraryToolbar } from '../library/LibraryToolbar';
import { useScopeView } from '../library/useScopeView';
import { Palette, openPalette } from '../palette/Palette';
import { createTextSizeSetter } from '../settings/textSize';
import { useLearnEvent } from '../events';
import { askInSheet } from '../ui/sheetAsk';
import { useApplyTheme } from '../settings/theme';
import { useApplyPrefs } from '../settings/useApplyPrefs';
import { DemoOverlay } from '../shell/DemoOverlay';
import { DropOverlay } from '../shell/DropOverlay';
import { Launcher } from '../shell/Launcher';
import { focusPane } from '../shell/panes';
import { Shell } from '../shell/Shell';
import { useInspectorHidden, useToggleInspector } from '../shell/useInspector';
import { usePanePersistence, useSidebarHidden, useToggleSidebar } from '../shell/useSidebar';
import { useWindowState } from '../shell/useWindowState';
import { duplicateActions, membershipCommands } from '../organize/actions';
import type { OrganizeModel } from '../organize/model';
import { SCOPE_ALL } from '../organize/scope';
import { useRestoreView } from '../organize/useRestoreView';
import { setDndGate } from '../dnd/dragState';
import { installDndEvents } from '../dnd/events';
import { collectionActions } from '../sidebar/actions';
import { importTarget, type ImportTarget } from '../sidebar/importTarget';
import { LibrarySidebar } from '../sidebar/LibrarySidebar';
import { useExpandedRead } from '../sidebar/useExpanded';
import { tagActions } from '../tags/actions';
import { TagSelector } from '../tags/TagSelector';
import { useLibrary } from '../state/library-store';
import { useShell } from '../state/shell-store';
import { t } from '../strings';
import { currentPlatform, readWindowParams } from '../ui/platform';
import { afterPaintOr } from '../ui/afterPaint';
import { clearImportMarks, perfMark } from '../ui/perfMarks';
import { countRender } from '../ui/renderCount';
import { Toasts, showToast } from '../ui/toasts';
import { ReaderSidebar } from '../viewers/pdf/ReaderSidebar';
import { readerActions } from '../viewers/pdf/readerActions';
import { useReader } from '../viewers/pdf/readerStore';
import { ReaderToolbar } from '../viewers/ReaderToolbar';
import { ViewerHost } from '../viewers/ViewerHost';
import { useReportIdle } from './useReportIdle';
import { useWarmUp } from './useWarmUp';

/** A failed relink, context-menu or file call: the message comes from main and is already Korean (cause + next step). */
const actionFailed = (e: unknown) => showToast({ kind: 'error', title: t.toast.actionFailed, body: (e as Error).message, testId: 'action-error' });

/** The busy toast's second line: the file being copied, by the name it came with. */
const fileNameOf = (itemId: string): string => queryClient.getQueryData<LibraryItem[]>(keys.items)?.find((i) => i.id === itemId)?.originalName ?? '';

/** Finder에서 보기 / 기본 앱으로 열기: main re-checks the file and makes its named copy (busy past 300 ms); a failure is a toast. */
const fileAction = (kind: 'open' | 'reveal', itemId: string, call: () => Promise<Result<void>>): void => void runFileAction(kind, fileNameOf(itemId), call).catch(actionFailed);
/** A window that paints no frame after a drop (hidden at once) still starts the import after this long. */
const DROP_CLEAR_FALLBACK_MS = 250;
/** The list before its first read: one array, so the command env's memo holds. */
const NO_ITEMS: readonly LibraryItem[] = [];

export function MainWindow(_props: { info: AppInfo }) {
  countRender('MainWindow');
  useApplyPrefs();
  useWindowState();
  useLibrarySync();
  const scopeReady = useRestoreView();
  usePanePersistence();
  const items = useItems();
  // The trash view (spec 4.3): its own list and collection rows; an emptied trash closes it.
  const inTrash = useInTrash();
  const trash = useTrash();
  useLeaveEmptyTrash();
  const prefs = usePrefs().data;
  useApplyTheme(prefs?.theme);
  // The first rows' fonts and Intl data, at an idle moment once the list has settled (spec 8, the drop stall).
  useWarmUp(items.isSuccess || items.isError);
  // Once the first list has settled and the page is idle, main prepares the settings window hidden.
  useReportIdle(items.isSuccess || items.isError);
  const view = useShell((s) => s.view);
  const setView = useShell((s) => s.setView);
  const overlayOpen = useShell((s) => s.paletteOpen || s.dropOverlay);
  const toggleSidebar = useToggleSidebar();
  const sidebarHidden = useSidebarHidden();
  // Cold-start mark (Task 13 perf): the first render in which the library list has settled, not the mount (R-18).
  const readyAt = useRef(0);
  if (readyAt.current === 0 && (items.isSuccess || items.isError)) readyAt.current = Date.now();

  // Where an import goes, read when it runs (spec 3.7): the collection being viewed, if any. Refs, so the command env and the
  // drop handler do not change with the view.
  const intoRef = useRef<ImportTarget | null>(null);
  const modelRef = useRef<OrganizeModel | undefined>(undefined);
  // Main's import queue (spec 3): imports run behind the window; this window puts files in and shows their progress.
  const { runner: imports, panelOpen: importPanel } = useImportQueue((id) => modelRef.current?.node(id)?.name ?? null);
  const importRunning = useJobProgress((s) => s.import.state !== 'idle');
  /** The queue asks about a duplicate (spec 3.4): its sheet holds this window once it shows. */
  const waitingChoice = useJobProgress((s) => s.import.state === 'waiting-choice');
  const busyTotal = useJobProgress(importBusyTotal);
  // main's backup on the work line (spec 8): its toast here; its result sheet comes from main.
  useBackupJob();
  const backupRunning = useJobProgress((s) => s.backup.state !== 'idle');
  /** 백업 만들기…'s folder panel is up (a sheet on this window), as 파일 가져오기…'s: it holds the window. */
  const [backupPanel, setBackupPanel] = useState(false);
  const startBackup = useCallback(async () => {
    setBackupPanel(true);
    try {
      await unwrap(api().backup.create());
    } catch (e) {
      actionFailed(e);
    } finally {
      setBackupPanel(false);
    }
  }, []);
  // main's restore on the work line (spec 9): its toast here; its result sheet comes from main.
  useRestoreJob();
  const restoreRunning = useJobProgress((s) => s.restore.state !== 'idle');
  /** 백업에서 복원…'s two folder panels are up (sheets on this window), as 백업 만들기…'s: they hold the window. */
  const [restorePanel, setRestorePanel] = useState(false);
  const startRestore = useCallback(async () => {
    setRestorePanel(true);
    try {
      await unwrap(api().backup.restore());
    } catch (e) {
      // Refused before it ran (not a backup, a newer one, a place it cannot use): the toast a failed restore shows.
      showToast(restoreRefused(e));
    } finally {
      setRestorePanel(false);
    }
  }, []);
  /** 다시 연결…'s open panel is up: a sheet on this window (follow-up D), which holds it like ours do (blocked). */
  const [relinking, setRelinking] = useState(false);
  /** 사본 내보내기…'s save panel is up: a sheet on this window, which holds it like 다시 연결…'s panel (blocked). */
  const [exportPanel, setExportPanel] = useState(false);
  /** ⌘/ asked for and not answered yet: from the request until the sheet has closed. */
  const [sheetRequested, setSheetRequested] = useState(false);
  /** Main says one of our sheets hangs over this window: pushed when it shows (windowState.sheetOpen). */
  const [sheetShown, setSheetShown] = useState(false);
  useLearnEvent('windowState', (state) => setSheetShown(state.sheetOpen));
  /** A question main asks in one of our sheets for this window (the purge sheet, ui/sheetAsk.ts): held as ⌘/ is. */
  const sheetAsked = useShell((s) => s.sheetAsks > 0);
  const asked = sheetRequested || sheetAsked;
  /** The ⌘/ sheet or the purge sheet is modal: commands (and drops) stay disabled until it closes. */
  const sheetOpen = asked && sheetShown;
  /** A duplicate question of the import queue hangs on this window: main asked, and its sheet is up. */
  const questionOpen = waitingChoice && sheetShown;
  // T13M-n4: until a sheet is on screen nothing greys — the window would read as lagging — but every command is refused
  // already (env.held), main's menu included: from the request, or from the queue's waiting-choice notice.
  const held = (asked || waitingChoice) && !sheetShown;
  // An import no longer holds the window (spec 3.2): only what hangs on it does — a sheet (⌘/ or a duplicate question)
  // and the panels of 파일 가져오기…, 다시 연결… and 사본 내보내기…. The registry (env.blocked), main's menu and the
  // window's drop target follow this one value.
  // A sheet main opened by itself (the backup's result) holds the window as the ones this window asked for do.
  const blocked = sheetOpen || questionOpen || importPanel || relinking || exportPanel || backupPanel || restorePanel || sheetShown;
  // The one modal predicate (Task 12 polish): a surface that owns the keyboard — a sheet (⌘/ or a duplicate question), the
  // palette, the drop overlay. The keymap's `active` and the registry's `duringWork` rule both read this value.
  const modal = sheetOpen || questionOpen || overlayOpen;
  const showShortcuts = useCallback(async () => {
    setSheetRequested(true);
    try {
      await unwrap(api().ui.showShortcuts());
    } catch (e) {
      actionFailed(e);
    } finally {
      setSheetRequested(false);
    }
  }, []);
  /**
   * 파일 › 라이브러리 점검…, and the automatic sheet main asks for (recovery:show, spec 7.1): main checks and shows the sheet
   * over this window, held from the request to its close as any sheet this window asks for (Task 6 askInSheet).
   */
  const checkLibrary = useCallback((auto: boolean) => {
    void askInSheet(() => unwrap(api().library.check(auto ? { auto: true } : undefined))).catch(actionFailed);
  }, []);
  useLearnEvent('recovery:show', () => checkLibrary(true));

  // ⌘+ / ⌘− / ⌘0 step from the newest size (also before prefsChanged has come back); applied through prefsChanged
  // (useApplyPrefs), like a change made in the settings window; a refused write is a toast.
  const setTextSize = useMemo(
    () =>
      createTextSizeSetter({
        known: () => queryClient.getQueryData<Prefs>(keys.prefs)?.fontSize ?? 13,
        write: (fontSize) => unwrap(api().prefs.set({ fontSize })),
        failed: actionFailed,
      }),
    [],
  );

  const relink = useCallback(async (itemId: string) => {
    try {
      const item = await unwrap(api().library.get({ itemId }));
      if (item.storageMode !== 'linked') return;
      if (item.availability !== 'missing') {
        void queryClient.invalidateQueries({ queryKey: keys.items });
        return;
      }
      setRelinking(true);
      try {
        await unwrap(api().library.pickAndRelink({ itemId }));
      } finally {
        setRelinking(false);
      }
    } catch (e) {
      actionFailed(e);
    }
  }, []);

  const exportCopy = useMemo(
    () =>
      createExportCopy({
        setPanel: setExportPanel,
        watchPanel: () => whenPanelCloses((cb) => api().on('windowState', cb)),
        run: (itemId, fileName, countFrom) => runFileAction('export', fileName, () => api().library.exportCopy({ itemId }), { countFrom }),
        fileName: fileNameOf,
        revealLabel: commandLabel(commandById('item.showInFolder'), currentPlatform()),
        reveal: () => void unwrap(api().library.revealExport()).catch(actionFailed),
        show: showToast,
        log: (e) => console.error(`[export] the call failed: ${e instanceof ApiError ? e.code : ((e as Error)?.name ?? 'Error')}`),
      }),
    [],
  );

  const onDrop = useCallback(
    (paths: string[], mode: StorageMode, unresolved: number, target?: ImportTarget | null) => {
      clearImportMarks(true);
      perfMark('drop');
      // The collection being viewed, unless the drop says where it goes: a sidebar row (a collection, or null for 내 라이브러리).
      const into = target === undefined ? intoRef.current : target;
      // The overlay leaves in the frame after the drop (Mac run 3, critique n6): the files go to main's queue once the
      // frame without the overlay has been painted, so main's work cannot keep that frame off screen.
      const cleared = new Promise<void>((resolve) =>
        afterPaintOr(DROP_CLEAR_FALLBACK_MS, () => {
          perfMark('drop:clear');
          resolve();
        }),
      );
      // Files without a location on disk are named in a toast; the others are still imported.
      if (unresolved > 0) showToast({ kind: 'error', title: t.toast.dropNoPathTitle(unresolved), body: t.toast.dropNoPathBody(commandMention(commandById('file.importManaged'), currentPlatform())), testId: 'drop-failed' });
      if (paths.length > 0) {
        leaveTrashView();
        void imports.drop(paths, mode, into, cleared);
      }
    },
    [imports],
  );

  // A failed refresh keeps the last list on screen and says so once (a StrictMode re-run sees the same error object).
  // A failed first read has no list to keep: the content column shows the list-failed notice instead (below).
  const shownListError = useRef<unknown>(null);
  const refreshFailed = items.isError && items.data !== undefined;
  useEffect(() => {
    if (!refreshFailed || shownListError.current === items.error) return;
    shownListError.current = items.error;
    showToast({ kind: 'error', title: t.shell.listFailed, body: items.error!.message, testId: 'list-error' });
  }, [refreshFailed, items.error]);

  // The failed first read stays on screen while 다시 시도 reads again: a refetch without data puts the query back to
  // pending (error cleared), which alone would blank the notice and drop its focused button.
  const [lastListFailure, setLastListFailure] = useState<string | null>(null);
  useEffect(() => {
    if (items.isError && items.data === undefined) setLastListFailure(items.error.message);
    else if (items.data !== undefined) setLastListFailure(null);
  }, [items.isError, items.data, items.error]);
  const listFailure = items.data !== undefined ? null : items.isError ? items.error.message : lastListFailure;

  const list = items.data ?? NO_ITEMS;
  const count = list.length;
  /** What the table shows: the trash's items in the trash view, else the library. */
  const viewList = inTrash ? (trash.data?.items ?? NO_ITEMS) : list;
  // The toolbar (LibraryToolbar) names the view and counts its rows; it subscribes to the quick search itself, so a
  // keystroke does not render this window.
  const scopeView = useScopeView(viewList);
  modelRef.current = scopeView.model;
  intoRef.current = importTarget(scopeView.model, scopeView.scope, undefined);
  const sidebarReady = useExpandedRead().isFetched;
  const tagCount = useLibrary((s) => s.tagFilter.size);
  // The command env does not depend on the list (a re-read list is a new array every time); targetsOf reads the newest
  // one here when a command is judged.
  const listRef = useRef(list);
  listRef.current = list;
  /** The trash view's read while it shows: the trash rows' targets and selection (P-10), read when a command is judged. */
  const trashRef = useRef(trash.data);
  trashRef.current = inTrash ? trash.data : undefined;
  // The table selection for the command context: counts only, so the context stays flat and a re-read list with the
  // same facts changes nothing.
  const selected = useLibrary((s) => s.selected);
  // In the trash view the selection is trash rows, which have no file facts that a command reads (P-10).
  const selection = useMemo(
    () => (inTrash ? { count: trashSelectionCount(trash.data, selected), available: 0, relinkable: 0 } : selectionCounts(list, selected)),
    [inTrash, trash.data, list, selected],
  );
  /** The sort in force, read (like listRef) when a menu or palette item command takes the selection in table order. */
  const { sort, setSort, columns, forced } = useLibrarySettings();
  const sortRef = useRef(sort);
  sortRef.current = sort;
  // What the menu bar's 정렬 기준 and the 1–8 keys need to know, as flat values (the reported context has no arrays).
  const columnsShown = useMemo(() => columnsMask(visibleColumns(columns, forced).map((c) => c.id)), [columns, forced]);
  // The colour tags every selected item has: the menu bar's 색 태그 ▸ draws the ✓ (a mask, so the report stays flat).
  const sharedTagPositions = useMemo(() => selectionTagPositions(scopeView.model, viewList, selected), [scopeView.model, viewList, selected]);
  const tagPositions = useMemo(() => tagPositionsMask((scopeView.model?.tags ?? []).map((tag) => tag.position)), [scopeView.model]);
  const scopeKind = scopeView.scope.kind;
  const collectionCount = scopeView.model?.collectionCount ?? 0;
  // 중복 N묶음 모두 정리 needs two groups and names the count (a number, so the reported context stays flat).
  const duplicateGroupCount = scopeView.model?.duplicateGroups.length ?? 0;
  const trashCount = scopeView.model?.trashCount ?? 0;
  // Whether a query is typed, not what it found: the answer follows every keystroke, this only turns over when the field
  // empties or fills.
  const searching = useLibrary((s) => s.query.trim() !== '');
  // An import into the empty library: a quiet screen, then "자료 N개를 가져오는 중…" (N: the queue's total, spec 3.2) past
  // 300 ms, held its minimum time; more files joining change N only.
  const busy = useBusyScreen(count === 0 && !inTrash ? busyTotal : null);
  // The quick search goes with the table: not in the empty library or on its busy screen (spec 3.5, design-spec 2.4); the
  // trash view has its table whatever the library holds.
  const tableShown = inTrash ? trash.data !== undefined : items.data !== undefined && count > 0 && !busy?.holding;
  // The first list is on its way (not failed): that is not an empty library. The toolbar's right group and the item
  // panel stay where they will be, disabled, so 가져오기 and the columns do not jump when the list arrives (design-spec
  // 6: transient states keep their controls).
  const listPending = inTrash ? trash.data === undefined && !trash.isError : items.data === undefined && listFailure === null;
  // The item panel is where the table is (spec 5.1, design-spec 2.4): not on the first-run or busy screen, not after a
  // failed first read, and not in the reader, whose right slot is the tutor's.
  const showsTable = view.kind === 'library' && (tableShown || listPending);
  const inspectorHidden = useInspectorHidden(showsTable);
  const toggleInspector = useToggleInspector();
  // Built from stable inputs only (state, the list, and callbacks that keep their identity), so CommandProvider's
  // context value and the menu and keymap hooks see a new env only when something in it changed (final review nit).
  const viewKind = view.kind;
  const textSize = prefs?.fontSize ?? 13;
  // A PDF with its pages shown: the reader's view commands and its zoom keys are on only then.
  const pdfOpen = useReader((s) => s.pdf?.ready === true);
  const env = useMemo<CommandEnv>(() => ({
    view: viewKind === 'reader' ? 'viewer' : 'library',
    blocked,
    importRunning,
    backupRunning,
    restoreRunning,
    held,
    ...(pdfOpen ? { pdfOpen: true } : {}),
    // The 보기 menu names what ⌃⌘S does now (사이드바 가리기 / 사이드바 보기).
    sidebar: sidebarHidden ? 'hidden' : 'shown',
    // The 보기 menu names what ⌥⌘I does now; where there is no panel no state is reported, so it says the neutral name.
    inspector: showsTable ? (inspectorHidden ? 'hidden' : 'shown') : undefined,
    // ⌘+ / ⌘− stop at 15 / 12 and ⌘0 is off at 13 (prefs.fontSize; the default until prefs are read).
    textSize,
    libraryCount: count,
    selectionCount: selection.count,
    selectionAvailable: selection.available,
    selectionRelinkable: selection.relinkable,
    selectionTagPositions: sharedTagPositions,
    scope: scopeKind,
    collectionCount,
    ...(duplicateGroupCount > 0 ? { duplicateGroups: duplicateGroupCount } : {}), // absent with none, so a library without any reports what it did before
    tagPositions,
    tagFilterCount: tagCount,
    searchActive: searching,
    sortColumn: sort.column,
    sortDirection: sort.direction,
    columnsShown,
    trashCount,
    // Item commands from the menu bar and the palette run on these ids, in the order the table shows them.
    selection: () => inTableOrder(listRef.current, useLibrary.getState().selected, sortRef.current),
    // The freshest fact: the item's own read while it is current (library.get re-checked the file), else the list row; the
    // trash view's rows are trash targets (P-10).
    targetsOf: (target) => withTrashTargets(trashRef.current, target, (rest) => commandTargets(queryClient, listRef.current, rest)),
    trashSelection: () => splitTrashSelection(trashRef.current, useLibrary.getState().selected),
    importFiles: (mode, collectionId) => {
      leaveTrashView(); // the files land in 내 라이브러리 (the trash view has no 가져오기)
      const into = collectionId === undefined ? intoRef.current : importTarget(modelRef.current, { kind: 'all' }, collectionId);
      void imports.pick(mode, into);
    },
    cancelImport: () => {
      void unwrap(api().library.cancelImport()).catch(actionFailed);
    },
    backup: () => void startBackup(),
    restoreBackup: () => void startRestore(),
    newCollection: (opts) => collectionActions.startNew(opts),
    renameCollection: (id) => collectionActions.startRename(id),
    deleteCollection: (id) => void collectionActions.remove(id),
    trashItems: (itemIds) => void trashActions.trashItems(itemIds),
    restore: (rows) => void trashActions.restore(rows),
    purge: (rows) => void trashActions.purge(rows),
    emptyTrash: () => void trashActions.emptyTrash(),
    toggleTagPosition: (position, itemIds) => void tagActions.togglePosition(position, itemIds),
    renameTag: (tagId) => tagActions.startRename(tagId),
    setTagColor: (tagId, position) => void tagActions.setColor(tagId, position),
    clearTagColor: (tagId) => void tagActions.clearColor(tagId),
    deleteTag: (tagId) => void tagActions.remove(tagId),
    clearTagFilter: () => useLibrary.getState().clearTagFilter(),
    back: () => setView({ kind: 'library' }),
    // An open 정보 편집 is asked first: saved, or nothing to save, then the reader; invalid changes keep the library.
    open: (itemId) => afterEditing(() => setView({ kind: 'reader', itemId })),
    relink: (itemId) => void relink(itemId),
    toggleSidebar,
    toggleInspector,
    showShortcuts: () => void showShortcuts(),
    checkLibrary: () => checkLibrary(false),
    openPalette,
    showInFolder: (itemId) => fileAction('reveal', itemId, () => api().library.showInFolder({ itemId })),
    openExternally: (itemId) => fileAction('open', itemId, () => api().library.openExternally({ itemId })),
    exportCopy: (itemId) => void exportCopy(itemId),
    // Opens the edit form on the selected item, showing a folded panel first (inspector/startEditing.ts).
    editInfo: startEditing,
    addToCollection: membershipCommands.add,
    removeFromCollection: (itemIds) => void membershipCommands.remove(itemIds),
    keepOneOfDuplicates: (itemIds) => void duplicateActions.keepOne(itemIds),
    keepAllDuplicates: () => void duplicateActions.keepAll(),
    openSettings: () => void unwrap(api().ui.openSettings()).catch(actionFailed),
    setTextSize,
    ...readerActions,
    focusPane,
    focusSearch: focusQuickSearch,
    findEverywhere: () => useLibrary.getState().setScope(SCOPE_ALL),
    sortBy: (args) => {
      const next = sortFromArgs(sortRef.current, args);
      if (next) setSort(next);
    },
    modal,
  }), [viewKind, blocked, held, pdfOpen, sidebarHidden, showsTable, inspectorHidden, textSize, count, imports, importRunning, backupRunning, startBackup, restoreRunning, startRestore, setView, relink, exportCopy, toggleSidebar, toggleInspector, showShortcuts, checkLibrary, setTextSize, modal, selection.count, selection.available, selection.relinkable, sharedTagPositions, scopeKind, collectionCount, duplicateGroupCount, tagPositions, tagCount, searching, sort.column, sort.direction, columnsShown, trashCount, setSort]);
  useMenuCommands(env);
  useReportContext(env);
  useKeymap(env, !modal);
  const envRef = useRef(env);
  useEffect(() => {
    envRef.current = env;
  });
  // Every way into the reader passes here, so the table can show that row again on return (spec 3.3).
  const setLastOpened = useLibrary((s) => s.setLastOpened);
  useEffect(() => {
    if (view.kind === 'reader') setLastOpened(view.itemId);
  }, [view, setLastOpened]);

  /**
   * The menu for the table's selection, in table order (right-click selected first, design-spec 7.1): the trash rows' own menu
   * in the trash view (P-10: 복원 · — · 영구 삭제…), the item menu elsewhere.
   */
  const showItemMenu = useCallback(async (itemIds: readonly string[], x: number, y: number) => {
    try {
      const trashView = trashRef.current;
      if (trashView) {
        const rows = splitTrashSelection(trashView, new Set(itemIds));
        const picked = await unwrap(api().ui.showContextMenu({ kind: 'trash', ...rows, x, y }));
        if (picked) runPicked(picked, envRef.current, rows);
        return;
      }
      const picked = await unwrap(api().ui.showContextMenu({ kind: 'item', itemIds: [...itemIds], x, y }));
      if (picked) runPicked(picked, envRef.current, { itemIds });
    } catch (e) {
      actionFailed(e);
    }
  }, []);

  /** Open from the list through the registry: refused while an import or a sheet holds the window (blocked). */
  const openFromList = useCallback((itemId: string) => runCommand('item.open', envRef.current, { itemIds: [itemId] }), []);

  // The screen before the list (first run, or the list-failed notice) had focus and left with it, so focus fell to
  // <body>: hand it to the table, whose grid passes it on to its first row; keyboard users keep their place. The
  // virtualizer draws the rows once it has measured its view, so the hand-over waits one frame (and does nothing if
  // the focus went somewhere meanwhile). An import's rows arrive while it runs: the hand-over waits for its end, so the
  // first row is the newest of them all and not the first one that came.
  const leftWithFocus = useRef(false);
  const handOver = useRef(false);
  const importActive = useJobProgress(importBusy);
  useLayoutEffect(() => {
    if (leftWithFocus.current) handOver.current = true;
    leftWithFocus.current = false;
    // Leaving the library drops the pending hand-over: coming back later must not pull the focus.
    if (view.kind !== 'library') handOver.current = false;
    if (!handOver.current || view.kind !== 'library' || count === 0 || importActive) return;
    handOver.current = false;
    requestAnimationFrame(() => {
      if (document.activeElement === null || document.activeElement === document.body) document.querySelector<HTMLElement>('[data-testid="library-table"]')?.focus();
    });
  }, [view.kind, count, importActive]);

  // Every drag and drop of the window goes through one gate (spec 8.4: a held window ignores drops): the library shows and
  // nothing holds the window. The overlay, the rows, the chips and the sidebar all follow it.
  const dndOpen = view.kind === 'library' && !blocked && !held;
  useEffect(() => setDndGate(dndOpen), [dndOpen]);
  useEffect(() => installDndEvents(), []);
  const toolbar =
    view.kind === 'reader' ? (
      <ReaderToolbar itemId={view.itemId} />
    ) : (
      <LibraryToolbar
        title={scopeView.label}
        titleTip={scopeView.tooltip}
        items={viewList}
        scoped={scopeView.scoped.length}
        filtered={scopeView.filtered}
        actions={
          <>
            <KeepAllDuplicatesButton />
            {/* The trash view's head (approved mockup): 휴지통 비우기… in 가져오기's place — what is imported goes to 내 라이브러리. */}
            {inTrash ? <EmptyTrashButton /> : <ImportMenuButton />}
            {(tableShown || listPending) && <LibrarySearch disabled={blocked || listPending} />}
            {showsTable && <InspectorToggle pending={listPending} />}
          </>
        }
        trailing={<Launcher />}
      />
    );
  // N-5: until the first list has arrived the count is unknown, not 0 — show neither the first-run screen nor the
  // list (no empty-library flash). A first read that failed says so where the list would be, with a retry.
  const library = inTrash ? (
    trash.data !== undefined ? (
      <LibraryView items={viewList} onOpen={openFromList} onItemMenu={(itemIds, x, y) => void showItemMenu(itemIds, x, y)} />
    ) : trash.isError ? (
      <ListFailed message={trash.error.message} retrying={trash.isFetching} onRetry={() => void trash.refetch()} focusOnLeave={leftWithFocus} />
    ) : (
      <LibraryLoading />
    )
  ) : items.data === undefined ? (
      listFailure !== null ? (
        <ListFailed message={listFailure} retrying={items.isFetching} onRetry={() => void items.refetch()} focusOnLeave={leftWithFocus} />
      ) : (
        <LibraryLoading />
      )
    ) : count === 0 || busy?.holding ? (
      <EmptyLibrary busy={busy} focusOnLeave={leftWithFocus} />
    ) : (
      <LibraryView items={list} onOpen={openFromList} onItemMenu={(itemIds, x, y) => void showItemMenu(itemIds, x, y)} />
    );

  return (
    <CommandProvider env={env}>
      <Shell
        sidebar={view.kind === 'reader' ? <ReaderSidebar /> : <LibrarySidebar onFilesDrop={onDrop} />}
        sidebarFoot={showsTable ? <TagSelector /> : undefined}
        launcher={<Launcher />}
        toolbar={toolbar}
        inspector={showsTable ? <Inspector mode="info" /> : undefined}
        overlays={
          <>
            <Palette />
            {/* Finder → window while the library shows and nothing holds the window; a file drag closes the palette. */}
            <DropOverlay enabled={dndOpen} onDrop={onDrop} intoName={intoRef.current?.name} />
            <Toasts />
            {/* Demo recordings only (main sets demo=1 for LEARN_DEMO_OVERLAY=1 in an unpackaged build). */}
            {readWindowParams(location.search).demo && <DemoOverlay />}
          </>
        }
      >
        {view.kind === 'reader' ? <ViewerHost key={view.itemId} itemId={view.itemId} /> : library}
      </Shell>
      {(items.isSuccess || items.isError) && scopeReady && sidebarReady && <div data-testid="app-ready" data-at={readyAt.current} hidden />}
      <ImportQueueMarker />
    </CommandProvider>
  );
}

/** E2E (waitImportIdle): where the import stands for this window — main's state, files being handed over, an end being shown. */
function ImportQueueMarker() {
  const state = useJobProgress((s) => s.import.state);
  const sending = useJobProgress((s) => s.sending);
  const settling = useJobProgress((s) => s.settling > 0);
  return <div data-testid="import-queue" data-state={state} data-sending={sending} data-settling={settling ? 'true' : undefined} hidden />;
}
