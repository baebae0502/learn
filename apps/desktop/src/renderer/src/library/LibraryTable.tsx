import { defaultRangeExtractor, useVirtualizer, type Range } from '@tanstack/react-virtual';
import { ChevronDown, ChevronUp, Clapperboard, FileText } from 'lucide-react';
import {
  memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
  type CSSProperties, type FocusEvent, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode,
} from 'react';
import { COLUMN_WIDTH_MAX, type ColumnConfig, type LibraryColumnId, type LibraryColumnSpec, type LibraryItem, type OrganizeTag } from '@learn/domain';
import { api, unwrap } from '../api';
import { usePrefs } from '../data/queries';
import { defaultDensity, density as ROW_HEIGHT, layout } from '../design/tokens';
import { formatDate, formatSize } from '../format';
import type { Match } from '../palette/hangul';
import { highlight } from '../palette/highlight';
import { useLibrary } from '../state/library-store';
import { t } from '../strings';
import { cx } from '../ui/cx';
import { Icon } from '../ui/Icon';
import { isNavigationKey, lastInput } from '../ui/inputModality';
import { isContextMenuKey, isKeyMenuEcho, menuPointFor } from '../ui/contextMenuKey';
import { currentPlatform } from '../ui/platform';
import { showToast } from '../ui/toasts';
import { useNow } from '../useNow';
import { columnTemplates, defaultColumns, fixedWidths, toggleColumn, tradeWidths, visibleColumns, withWidths } from './columns';
import { useRowDnd } from '../dnd/rowDnd';
import { gridKey } from './gridKeys';
import { TagDots } from '../tags/TagDots';
import { tagsDescription } from '../tags/dotTags';
import { LinkMark, StatusFlags } from './ItemMarks';
import { inOrder, openTarget, reduceSelection, rowOrder, type SelectAction, type SelectionState } from './selectionModel';
import { useRevealRow } from './tableDom';
import { firstDirection, type LibrarySort, type LibrarySortColumn } from './sort';

export interface LibraryTableProps {
  rows: readonly LibraryItem[];
  columns: ColumnConfig;
  /** Columns the view shows whatever `columns` says (the recent view's 마지막으로 연 날): drawn after the title, locked in the header menu. */
  forced?: readonly LibraryColumnId[];
  sort: LibrarySort;
  onSortChange(sort: LibrarySort): void;
  /** Resize release, column-menu toggle / reset. */
  onColumnsChange(next: ColumnConfig): void;
  onOpen(itemId: string): void;
  onContextMenu(itemIds: readonly string[], x: number, y: number): void;
  /** Matched range per title, for <mark> (the quick search's). */
  titleMatches?: ReadonlyMap<string, Match> | null;
  /** The tags of an item (the organize model's, coloured ones first by slot): the colour dots after its title and the row's description. */
  tagsOf?: (itemId: string) => readonly OrganizeTag[];
  /** Scroll this row into view once after mount (return from the reader). */
  revealId?: string | null;
  /** What the body shows while there are no rows (the loading line, a no-results state). The header stays. */
  empty?: ReactNode;
}

/** design-spec 6 표 (M3 .table-body): the first row starts 4 px under the header; the scroll ends 8 px past the last. */
const BODY_TOP = 4;
const BODY_BOTTOM = 8;
/** Rows drawn beyond each edge of the view, so a fast scroll does not show empty slots. */
const OVERSCAN = 8;
/** ← / → on a focused column edge. */
const RESIZE_STEP = 8;
const NO_COLUMNS: readonly LibraryColumnId[] = [];
/** Tabular figures (design-spec 6 표: 숫자는 tabular). */
const NUMERIC: ReadonlySet<LibraryColumnId> = new Set<LibraryColumnId>(['year', 'createdAt', 'updatedAt', 'openedAt', 'size']);
const ROW = '[data-testid="item-row"]';
const NO_TAGS: readonly OrganizeTag[] = [];
const tagsDescriptionId = (itemId: string) => `row-tags-${itemId}`;
const rowIdOf = (target: EventTarget): string | null =>
  target instanceof Element ? (target.closest<HTMLElement>(ROW)?.dataset['itemId'] ?? null) : null;
const isMac = () => currentPlatform() === 'darwin';
const snapshot = (s: SelectionState): SelectionState => ({ selected: s.selected, anchorId: s.anchorId, cursorId: s.cursorId });

/** A cell's text (spec §3.1). An empty value leaves the cell empty: "—" is the progress column's mark (M7). */
function cellText(column: LibraryColumnId, item: LibraryItem, now: Date): string {
  switch (column) {
    case 'title':
      return item.title;
    case 'creators':
      return item.creators.join(', ');
    case 'year':
      return item.year === null ? '' : String(item.year);
    case 'type':
      return t.library.type[item.type];
    case 'createdAt':
      return formatDate(item.createdAt, now);
    case 'updatedAt':
      return formatDate(item.updatedAt, now);
    case 'openedAt':
      return item.openedAt === null ? '' : formatDate(item.openedAt, now);
    case 'storageMode':
      return t.library.storage[item.storageMode];
    case 'size':
      return formatSize(item.size);
    case 'originalName':
      return item.originalName;
  }
}

/** Kind icon 16 + 8 + the title (its full text as the tooltip: the cell truncates), then its marks and the colour dots. */
function TitleCell({ item, match, tags }: { item: LibraryItem; match: Match | null; tags: readonly OrganizeTag[] }) {
  return (
    <>
      <Icon icon={item.type === 'video' ? Clapperboard : FileText} />
      <span className="item-title ellipsis" title={item.title}>
        {highlight(item.title, match)}
      </span>
      {/* The mockup's order: title, link mark, dots, status flags. */}
      <LinkMark item={item} />
      <TagDots tags={tags} />
      <StatusFlags item={item} flagTestId="missing-flag" />
    </>
  );
}

interface ItemRowProps {
  item: LibraryItem;
  index: number;
  /** The row's offset in the body (the virtualizer's place for it). */
  top: number;
  selected: boolean;
  /** The table's one Tab / F6 stop (roving tabindex). */
  tabStop: boolean;
  /** The keyboard cursor ring: this row has the focus and the keyboard moved it. */
  ring: boolean;
  columns: readonly LibraryColumnSpec[];
  now: Date;
  /** The part of the title the quick search matched. */
  match: Match | null;
  /** The item's tags, for its dots and its description. */
  tags: readonly OrganizeTag[];
  /** The rows a drag of this row takes (spec 8.2): the selection in table order when the row is in it, else the row alone. */
  dragIdsOf: (rowId: string) => string[];
}

/**
 * One row (spec §3.4): it redraws only when its item, its place or its state changed — a re-read list redraws the rows
 * whose items changed, a click the two rows whose selection changed. Widths are not a prop: the grid tracks come from
 * the table's CSS variables, so a column drag redraws no row.
 */
const ItemRow = memo(function ItemRow({ item, index, top, selected, tabStop, ring, columns, now, match, tags, dragIdsOf }: ItemRowProps) {
  const last = columns.length - 1;
  const rowRef = useRef<HTMLDivElement>(null);
  const { rowProps, isDropTarget } = useRowDnd(rowRef, item.id, dragIdsOf);
  // The names of the coloured tags are the row's description; they sit beside the cells, not in the title, so the row's name stays the title.
  const description = tagsDescription(tags);
  return (
    <div
      ref={rowRef}
      {...rowProps}
      role="row"
      aria-rowindex={index + 2}
      aria-selected={selected}
      aria-describedby={description !== null ? tagsDescriptionId(item.id) : undefined}
      tabIndex={tabStop ? 0 : -1}
      className="table-row"
      style={{ transform: `translateY(${top}px)` }}
      data-testid="item-row"
      data-item-id={item.id}
      data-title={item.title}
      data-index={index}
      data-selected={selected || undefined}
      data-focus-visible={ring || undefined}
      data-missing={item.availability === 'missing' || undefined}
      data-drop-target={isDropTarget || undefined}
    >
      {columns.map((c, i) => (
        <div
          key={c.id}
          role={c.id === 'title' ? 'rowheader' : 'gridcell'}
          aria-colindex={i + 1}
          className={cx('td', c.align === 'end' && 'end', NUMERIC.has(c.id) && 'num', i === 0 && 'is-first', i === last && 'is-last')}
          data-col={c.id}
        >
          {c.id === 'title' ? (
            <TitleCell item={item} match={match} tags={tags} />
          ) : (
            <span className="ellipsis" title={c.id === 'originalName' ? item.originalName : undefined}>
              {cellText(c.id, item, now)}
            </span>
          )}
        </div>
      ))}
      {description !== null && (
        <span hidden id={tagsDescriptionId(item.id)}>
          {description}
        </span>
      )}
    </div>
  );
});

/**
 * The library table (M4 spec 3; ADR-0004 "M4 표": TanStack Virtual + our own grid): a `role="grid"` whose rows the
 * virtualizer places, columns from the catalogue on one CSS grid template, header sort, column edges that trade width
 * with the next column, the native column header menu, and the selection model of design-spec 7.1
 * (selectionModel.ts) — the selection itself lives in useLibrary, so commands and the item panel read it without the
 * table. The focus is a roving one: the cursor row is the table's only Tab and F6 stop.
 */
export function LibraryTable(props: LibraryTableProps) {
  const { rows, columns, sort } = props;
  useRevealRow(rows, props.revealId);
  const now = useNow(); // 오늘/어제 move on at midnight
  const selected = useLibrary((s) => s.selected);
  const cursorId = useLibrary((s) => s.cursorId);
  const rowHeight = ROW_HEIGHT[usePrefs().data?.density ?? defaultDensity];
  const header = layout.tableHeaderHeight;
  const forced = props.forced ?? NO_COLUMNS;
  const visible = useMemo(() => visibleColumns(columns, forced), [columns, forced]);
  const last = visible.length - 1;
  const order = useMemo(() => rowOrder(rows.map((r) => r.id)), [rows]);
  const cursorIndex = order.indexOf(cursorId);
  // The one stop: the cursor row; before there is one, the first selected row, else the first row.
  const stop = cursorIndex >= 0 ? cursorIndex : Math.max(0, rows.findIndex((r) => selected.has(r.id)));

  const grid = useRef<HTMLDivElement>(null);
  const getItemKey = useCallback((i: number) => rows[i]!.id, [rows]);
  // The stop row is always drawn, however far the view scrolled from it: a focused row that left the DOM would drop
  // the focus to <body>.
  const rangeExtractor = useCallback(
    (range: Range) => {
      const shown = defaultRangeExtractor(range);
      if (stop < range.count && !shown.includes(stop)) return [...shown, stop].sort((a, b) => a - b);
      return shown;
    },
    [stop],
  );
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => grid.current,
    estimateSize: () => rowHeight,
    overscan: OVERSCAN,
    getItemKey,
    rangeExtractor,
    paddingStart: BODY_TOP,
    paddingEnd: BODY_BOTTOM,
    // The sticky header sits above the rows in the same scroll view; a row brought into view clears it by the 4 px inset.
    scrollMargin: header,
    scrollPaddingStart: header + BODY_TOP,
    scrollPaddingEnd: BODY_BOTTOM,
  });
  // Rows have one height, the density's: a new density measures every row again (spec §3.4).
  useLayoutEffect(() => virtualizer.measure(), [virtualizer, rowHeight]);

  // The title takes what the other columns leave (at least its minimum): its width, for its edge, is computed.
  const viewWidth = virtualizer.scrollRect?.width ?? 0;
  const [live, setLive] = useState<ReadonlyMap<LibraryColumnId, number> | null>(null);
  const widths = useMemo(() => live ?? fixedWidths(columns, visible), [live, columns, visible]);
  const tracks = useMemo(() => columnTemplates(visible, widths), [visible, widths]);
  const titleWidth = Math.max(visible[0]!.minWidth, viewWidth - (tracks.minWidth - visible[0]!.minWidth));

  // Handlers read the newest props and values here (set after each commit, before any later event).
  const latest = useRef({ props, order, visible, widths, titleWidth, rowHeight, stop });
  useLayoutEffect(() => {
    latest.current = { props, order, visible, widths, titleWidth, rowHeight, stop };
  });
  const dragIdsOf = useCallback((rowId: string): string[] => {
    const selection = useLibrary.getState().selected;
    return selection.has(rowId) ? inOrder(selection, latest.current.order) : [rowId];
  }, []);
  // Another view starts at the top (spec 3.5); a view entered for one item (a collection path in the item panel) shows that row.
  const scopeEpoch = useLibrary((s) => s.scopeEpoch);
  const seenEpoch = useRef(scopeEpoch);
  useLayoutEffect(() => {
    if (seenEpoch.current === scopeEpoch) return;
    seenEpoch.current = scopeEpoch;
    const reveal = useLibrary.getState().revealOnScope;
    const at = reveal === null ? -1 : latest.current.order.indexOf(reveal);
    if (at >= 0) virtualizer.scrollToIndex(at);
    else virtualizer.scrollToOffset(0);
  }, [scopeEpoch, virtualizer]);

  // ---- selection --------------------------------------------------------------------------------------------------
  const follow = useRef(false);
  /** One model step into the store; `move` also brings the new cursor into view and gives it the focus. */
  const apply = useCallback((action: SelectAction, move = false) => {
    const store = useLibrary.getState();
    const before = snapshot(store);
    const next = reduceSelection(before, action, latest.current.order);
    store.setSelection(next);
    if (!move) return;
    if (next.cursorId !== before.cursorId) follow.current = true;
    else virtualizer.scrollToIndex(latest.current.order.indexOf(next.cursorId)); // at an end already: just show it
  }, [virtualizer]);
  useLayoutEffect(() => {
    if (!follow.current || cursorIndex < 0) return;
    follow.current = false;
    virtualizer.scrollToIndex(cursorIndex);
    grid.current?.querySelector<HTMLElement>(`${ROW}[data-index="${cursorIndex}"]`)?.focus({ preventScroll: true });
  }, [cursorIndex, virtualizer]);

  // ---- focus and the keyboard cursor ring ------------------------------------------------------------------------
  const [focusedId, setFocusedId] = useState<string | null>(null);
  // The ring shows for keyboard use only (design-spec 6: 마우스 클릭으로는 링을 띄우지 않는다): a key turns it on, a
  // press turns it off, and focus that enters the table brings it when the last input was a key (F6, Tab).
  const [ring, setRing] = useState(false);
  const keyMenuAt = useRef<number | null>(null);
  const focusStop = useCallback(() => {
    grid.current?.querySelector<HTMLElement>(`${ROW}[data-index="${latest.current.stop}"]`)?.focus({ preventScroll: true });
  }, []);
  const onFocus = useCallback((e: FocusEvent<HTMLDivElement>) => {
    const from = e.relatedTarget;
    if (!(from instanceof Node && e.currentTarget.contains(from))) setRing(lastInput() === 'keyboard');
    if (e.target === e.currentTarget) return focusStop(); // the grid passes its focus on to the stop row
    const id = rowIdOf(e.target);
    if (id === null) return;
    setFocusedId(id);
    // Focus that enters the table (F6, Tab, the hand-over) on a row that is not the cursor yet makes it the cursor, and
    // the selection when there is none (the arrows then go on from there).
    const store = useLibrary.getState();
    if (store.cursorId === id) return;
    store.setSelection(store.selected.size === 0 ? { selected: new Set([id]), anchorId: id, cursorId: id } : { ...snapshot(store), cursorId: id });
  }, [focusStop]);
  const onBlur = useCallback((e: FocusEvent<HTMLDivElement>) => {
    const to = e.relatedTarget;
    if (!(to instanceof Node && e.currentTarget.contains(to))) setFocusedId(null);
  }, []);
  // The grid can hold the focus itself (the window's hand-over, a press on the empty body): the stop row takes it as
  // soon as there is one.
  useLayoutEffect(() => {
    if (rows.length > 0 && document.activeElement === grid.current) focusStop();
  });

  const onKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    if (isNavigationKey(e)) setRing(true);
    if (e.target instanceof Element && e.target.closest('[role="separator"]')) return; // a column edge has its own keys
    if (isContextMenuKey(e.nativeEvent)) {
      // ⇧F10 and the menu key open the focused row's menu under it, as a right-click would (spec 9.1); the browser's own
      // menu event for the key is not wanted (it would open a second menu elsewhere).
      const row = e.target instanceof Element ? e.target.closest<HTMLElement>(ROW) : null;
      const id = row ? rowIdOf(row) : null;
      if (row === null || id === null) return; // the header and the empty body keep the browser's
      e.preventDefault();
      setRing(true);
      keyMenuAt.current = performance.now();
      apply({ kind: 'contextMenu', id });
      const at = menuPointFor(row);
      latest.current.props.onContextMenu(inOrder(useLibrary.getState().selected, latest.current.order), at.x, at.y);
      return;
    }
    const key = gridKey(e.nativeEvent, isMac());
    if (!key) return;
    e.preventDefault();
    switch (key.kind) {
      case 'move': {
        const view = grid.current?.clientHeight ?? 0;
        const page = Math.floor((view - header - BODY_TOP) / latest.current.rowHeight);
        return apply({ kind: 'move', to: key.to, extend: key.extend, page }, true);
      }
      case 'all':
      case 'clear':
        return apply(key);
      case 'open': {
        // ↩ opens one selected item; with several it does nothing (several tabs are M7, spec §3.3).
        const id = openTarget(useLibrary.getState().selected);
        if (id !== null) latest.current.props.onOpen(id);
        return;
      }
      case 'swallow':
        return;
    }
  }, [apply, header]);

  // The edit menu's 모두 선택 (role selectAll) runs the page's select-all, which asks <body> first (selectstart): while
  // the table has the focus it selects every row instead of the page's text. ⌘A itself comes as a key (onKeyDown).
  useEffect(() => {
    const onSelectStart = (e: Event) => {
      if (e.target !== document.body || !grid.current?.contains(document.activeElement)) return;
      e.preventDefault();
      apply({ kind: 'all' });
    };
    document.addEventListener('selectstart', onSelectStart);
    return () => document.removeEventListener('selectstart', onSelectStart);
  }, [apply]);

  // ---- rows: press, double-click, right-click (delegated: the rows keep no handlers of their own) ----------------
  // A press on a row inside a multiple selection keeps the selection until the button goes up: a drag that starts from it
  // takes all of it (spec 8.2). A release without a drag is a click, which then makes that row the selection.
  const pendingCollapse = useRef<string | null>(null);
  const onBodyMouseDown = useCallback((e: MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const mac = isMac();
    if (mac && e.ctrlKey) return; // ⌃-click is the context menu on macOS (onContextMenu)
    pendingCollapse.current = null;
    const id = rowIdOf(e.target);
    if (id === null) return;
    const toggle = mac ? e.metaKey : e.ctrlKey;
    const selection = useLibrary.getState().selected;
    if (!e.shiftKey && !toggle && selection.size > 1 && selection.has(id)) {
      pendingCollapse.current = id;
      return;
    }
    apply({ kind: 'click', id, shift: e.shiftKey, toggle });
  }, [apply]);
  const onBodyClick = useCallback(() => {
    const id = pendingCollapse.current;
    pendingCollapse.current = null;
    if (id !== null) apply({ kind: 'click', id, shift: false, toggle: false });
  }, [apply]);
  // A double-click opens its row, which the first press selected alone (spec §3.3; M3's single-click open is gone).
  const onBodyDoubleClick = useCallback((e: MouseEvent<HTMLDivElement>) => {
    if (e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
    const id = rowIdOf(e.target);
    if (id !== null) latest.current.props.onOpen(id);
  }, []);
  // Right-click selects first (design-spec 7.1, Finder): a row outside the selection becomes the selection; inside it,
  // the menu acts on every selected item, in table order.
  const onBodyContextMenu = useCallback((e: MouseEvent<HTMLDivElement>) => {
    if (isKeyMenuEcho(performance.now(), keyMenuAt.current)) {
      e.preventDefault();
      return;
    }
    const id = rowIdOf(e.target);
    if (id === null) return;
    e.preventDefault();
    apply({ kind: 'contextMenu', id });
    (e.target as Element).closest<HTMLElement>(ROW)?.focus({ preventScroll: true });
    latest.current.props.onContextMenu(inOrder(useLibrary.getState().selected, latest.current.order), e.clientX, e.clientY);
  }, [apply]);

  // ---- header: sort, column menu, column edges -------------------------------------------------------------------
  const onSort = useCallback((column: LibrarySortColumn) => {
    const p = latest.current.props;
    const flipped = p.sort.direction === 'asc' ? 'desc' : 'asc';
    p.onSortChange({ column, direction: column === p.sort.column ? flipped : firstDirection(column) });
  }, []);
  const onHeaderMenu = useCallback((e: MouseEvent<HTMLElement>) => {
    e.preventDefault();
    const at = { x: e.clientX, y: e.clientY };
    void (async () => {
      try {
        const { columns: current, forced: locked } = latest.current.props;
        const picked = await unwrap(api().ui.showColumnMenu({ visible: current.visible, ...(locked && locked.length > 0 ? { locked: [...locked] } : {}), ...at }));
        if (!picked) return;
        const { columns: cfg, onColumnsChange } = latest.current.props;
        onColumnsChange('reset' in picked ? defaultColumns() : toggleColumn(cfg, picked.toggle));
      } catch (err) {
        showToast({ kind: 'error', title: t.toast.actionFailed, body: (err as Error).message, testId: 'action-error' });
      }
    })();
  }, []);

  /** Every shown column's width now, the title's included. */
  const currentWidths = useCallback(() => new Map(latest.current.widths).set('title', latest.current.titleWidth), []);
  /** Stores the widths that changed (the others keep following their defaults); false when none did. */
  const saveWidths = useCallback((next: ReadonlyMap<LibraryColumnId, number>): boolean => {
    const { columns: cfg, onColumnsChange } = latest.current.props;
    const before = fixedWidths(cfg, latest.current.visible); // the configured ones, not a drag's live widths
    const changed = new Map([...next].filter(([id, w]) => before.get(id) !== w));
    if (changed.size > 0) onColumnsChange(withWidths(cfg, changed));
    return changed.size > 0;
  }, []);
  // A drag shows its widths at once (live) and is saved once, on release (spec §3.2).
  const drag = useRef<{ id: LibraryColumnId; x: number; start: Map<LibraryColumnId, number>; widths: Map<LibraryColumnId, number> | null } | null>(null);
  const onEdgeDown = useCallback((e: PointerEvent<HTMLDivElement>, id: LibraryColumnId) => {
    if (e.button !== 0) return;
    e.preventDefault(); // neither the focus nor a text selection moves
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id, x: e.clientX, start: currentWidths(), widths: null };
  }, [currentWidths]);
  const onEdgeMove = useCallback((e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    d.widths = tradeWidths(latest.current.visible, d.start, d.id, d.start.get(d.id)! + e.clientX - d.x);
    setLive(d.widths);
  }, []);
  const onEdgeUp = useCallback(() => {
    const d = drag.current;
    if (!d) return; // the release and the lost capture both end a drag
    drag.current = null;
    if (!d.widths || !saveWidths(d.widths)) setLive(null);
  }, [saveWidths]);
  // The saved widths come back as new columns: only then do the live ones go, so no frame shows the widths from before.
  useEffect(() => {
    if (!drag.current) setLive(null);
  }, [columns]);
  // A double-click puts the column back at its default width; ← / → move the edge by 8 px. Both trade with the next
  // column like a drag, and are saved at once.
  const onEdgeDoubleClick = useCallback((spec: LibraryColumnSpec) => {
    if (spec.defaultWidth !== null) saveWidths(tradeWidths(latest.current.visible, currentWidths(), spec.id, spec.defaultWidth));
  }, [currentWidths, saveWidths]);
  const onEdgeKey = useCallback((e: KeyboardEvent<HTMLDivElement>, id: LibraryColumnId) => {
    const step = e.key === 'ArrowRight' ? RESIZE_STEP : e.key === 'ArrowLeft' ? -RESIZE_STEP : 0;
    if (step === 0 || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    e.preventDefault();
    const start = currentWidths();
    saveWidths(tradeWidths(latest.current.visible, start, id, start.get(id)! + step));
  }, [currentWidths, saveWidths]);

  const items = virtualizer.getVirtualItems();
  const showEmpty = rows.length === 0 && props.empty !== undefined && props.empty !== null;
  const vars = { '--head-cols': tracks.head, '--row-cols': tracks.row, '--table-min-width': `${tracks.minWidth}px` } as CSSProperties;
  return (
    <div
      ref={grid}
      role="grid"
      aria-label={t.library.table}
      aria-multiselectable="true"
      aria-rowcount={rows.length + (showEmpty ? 2 : 1)}
      aria-colcount={visible.length}
      tabIndex={-1}
      className="library-table"
      data-testid="library-table"
      style={vars}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      onBlur={onBlur}
      onPointerDownCapture={() => setRing(false)}
    >
      <div role="row" aria-rowindex={1} className="table-head" onContextMenu={onHeaderMenu}>
        {visible.map((c, i) => {
          const direction = sort.column === c.id ? sort.direction : null;
          const width = c.id === 'title' ? titleWidth : widths.get(c.id)!;
          return (
            <div
              key={c.id}
              role="columnheader"
              aria-colindex={i + 1}
              aria-sort={direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'none'}
              className={cx('th', c.align === 'end' && 'end', i === 0 && 'is-first', i === last && 'is-last')}
              data-testid="column-header"
              data-col={c.id}
              data-sorted={direction !== null || undefined}
            >
              {/* Out of the Tab order (the grid is one stop) and pressed without taking the focus from the rows. */}
              <button type="button" tabIndex={-1} className="th-sort" onMouseDown={(e) => e.preventDefault()} onClick={() => onSort(c.id)}>
                <span className="ellipsis">{c.label}</span>
                {direction && <Icon icon={direction === 'asc' ? ChevronUp : ChevronDown} size="xs" />}
              </button>
              {/* A column edge (design-spec 2.1): the last column has none (no next column to trade with). */}
              {i < last && (
                <div
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={t.library.resizeColumn(c.label)}
                  aria-valuenow={Math.round(width)}
                  aria-valuemin={c.minWidth}
                  aria-valuemax={COLUMN_WIDTH_MAX}
                  tabIndex={-1}
                  className="col-resizer"
                  data-testid="column-resizer"
                  data-col={c.id}
                  onPointerDown={(e) => onEdgeDown(e, c.id)}
                  onPointerMove={onEdgeMove}
                  onPointerUp={onEdgeUp}
                  onLostPointerCapture={onEdgeUp}
                  onDoubleClick={() => onEdgeDoubleClick(c)}
                  onKeyDown={(e) => onEdgeKey(e, c.id)}
                />
              )}
            </div>
          );
        })}
      </div>
      {showEmpty ? (
        <div role="row" aria-rowindex={2} className="table-empty">
          <div role="gridcell" className="table-empty-cell">
            {props.empty}
          </div>
        </div>
      ) : (
        <div
          role="rowgroup"
          className="table-body"
          style={{ height: virtualizer.getTotalSize() }}
          onMouseDown={onBodyMouseDown}
          onClick={onBodyClick}
          onDoubleClick={onBodyDoubleClick}
          onContextMenu={onBodyContextMenu}
        >
          {items.map((v) => {
            const item = rows[v.index]!;
            return (
              <ItemRow
                key={v.key}
                item={item}
                index={v.index}
                top={v.start - header}
                selected={selected.has(item.id)}
                tabStop={v.index === stop}
                ring={ring && focusedId === item.id}
                columns={visible}
                now={now}
                match={props.titleMatches?.get(item.id) ?? null}
                tags={props.tagsOf?.(item.id) ?? NO_TAGS}
                dragIdsOf={dragIdsOf}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
