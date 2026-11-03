import { defaultRangeExtractor, useVirtualizer, type Range } from '@tanstack/react-virtual';
import { ChevronDown, ChevronUp, Clapperboard, FileText, Folder } from 'lucide-react';
import {
  memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
  type CSSProperties, type FocusEvent, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode, type WheelEvent,
} from 'react';
import { COLUMN_WIDTH_MAX, type ColumnConfig, type LibraryColumnId, type LibraryColumnSpec, type LibraryItem, type OrganizeTag, type TrashedCollection, type TrashedItem } from '@learn/domain';
import { api, unwrap } from '../api';
import { usePrefs } from '../data/queries';
import { defaultDensity, density as ROW_HEIGHT } from '../design/tokens';
import { formatDate, formatSize } from '../format';
import type { Match } from '../palette/hangul';
import { highlight } from '../palette/highlight';
import { useLibrary } from '../state/library-store';
import { t } from '../strings';
import { cx } from '../ui/cx';
import { Icon } from '../ui/Icon';
import { ProgressBar } from '../ui/ProgressBar';
import { isNavigationKey, lastInput } from '../ui/inputModality';
import { isContextMenuKey, isKeyMenuEcho, menuPointFor } from '../ui/contextMenuKey';
import { currentPlatform } from '../ui/platform';
import { showToast } from '../ui/toasts';
import { collectionMatch } from '../trash/trashRows';
import { useNow } from '../useNow';
import { columnTemplates, defaultColumns, fixedWidths, toggleColumn, tradeWidths, visibleColumns, withWidths } from './columns';
import { useRowDnd } from '../dnd/rowDnd';
import { gridKey } from './gridKeys';
import { wheelSteps } from './columnDrag';
import { useColumnReorder } from './useColumnReorder';
import { TagDots } from '../tags/TagDots';
import { tagsDescription } from '../tags/dotTags';
import { KeptMark, LinkMark, StatusFlags } from './ItemMarks';
import type { DuplicateMarks } from '../organize/duplicates';
import { inOrder, openTarget, reduceSelection, rowOrder, type SelectAction, type SelectionState } from './selectionModel';
import { useRevealRow } from './tableDom';
import { firstDirection, type LibrarySort, type LibrarySortColumn } from './sort';

export interface LibraryTableProps {
  rows: readonly LibraryItem[];
  /** The trash view's collection rows (spec 4.3, P-9): drawn above `rows`, in the same selection and keys; no other view has them. */
  collectionRows?: readonly TrashedCollection[];
  /** The quick search's (deferred) query, for the collection rows' <mark>. */
  collectionQuery?: string;
  /** Rows are dragged and take tag drops; the trash view's are not live items and do neither. Default true. */
  draggable?: boolean;
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
  /** 중복 항목 (M6 spec 5): the rows that stay (남김) and the first row of each group after the first (a line above it). */
  duplicateMarks?: DuplicateMarks | null;
}

/** design-spec 6 표 (M3 .table-body): the first row starts 4 px under the header; the scroll ends 8 px past the last. */
const BODY_TOP = 4;
const BODY_BOTTOM = 8;
/** 중복 항목: the space above a group's first row — the mockup's 1 px line with 4 px above and below it (.table-group-sep). */
const GROUP_GAP = 9;
const NO_IDS: ReadonlySet<string> = new Set();
/** Rows drawn beyond each edge of the view, so a fast scroll does not show empty slots. */
const OVERSCAN = 8;
/** ← / → on a focused column edge. */
const RESIZE_STEP = 8;
const NO_COLUMNS: readonly LibraryColumnId[] = [];
/** Tabular figures (design-spec 6 표: 숫자는 tabular). */
const NUMERIC: ReadonlySet<LibraryColumnId> = new Set<LibraryColumnId>(['year', 'createdAt', 'updatedAt', 'openedAt', 'size', 'deletedAt']);
/** Every body row, an item's or (in the trash) a collection's: the selection, the keys and the focus go by its `data-row-id`. */
const ROW = '[role="row"][data-row-id]';
const NO_COLLECTIONS: readonly TrashedCollection[] = [];
const NO_TAGS: readonly OrganizeTag[] = [];
const tagsDescriptionId = (itemId: string) => `row-tags-${itemId}`;
const rowIdOf = (target: EventTarget): string | null =>
  target instanceof Element ? (target.closest<HTMLElement>(ROW)?.dataset['rowId'] ?? null) : null;
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
    case 'deletedAt':
      return 'deletedAt' in item ? formatDate((item as TrashedItem).deletedAt, now) : '';
    case 'progress':
      return item.progress === null ? '' : `${Math.round(item.progress * 100)}%`;
  }
}

/** The furthest point read: the narrow bar and the percent; nothing for an item never read. */
function ProgressCell({ progress }: { progress: number | null }) {
  if (progress === null) return null;
  const percent = Math.round(progress * 100);
  return (
    <>
      <ProgressBar percent={percent} label={t.library.progressLabel} testId="progress-cell" />
      <span className="pct">{percent}%</span>
    </>
  );
}

/** Kind icon 16 + 8 + the title (its full text as the tooltip: the cell truncates), then its marks and the colour dots. */
function TitleCell({ item, match, tags, kept }: { item: LibraryItem; match: Match | null; tags: readonly OrganizeTag[]; kept: boolean }) {
  return (
    <>
      <Icon icon={item.type === 'video' ? Clapperboard : FileText} />
      <span className="item-title ellipsis" title={item.title}>
        {highlight(item.title, match)}
      </span>
      {/* The mockup's order: title, link mark, dots, status flags, 남김 (중복 항목). */}
      <LinkMark item={item} />
      <TagDots tags={tags} />
      <StatusFlags item={item} flagTestId="missing-flag" />
      {kept && <KeptMark />}
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
  /** Dragged and a tag-drop target (false in the trash view). */
  draggable: boolean;
  /** 중복 항목: this row stays when its group is cleaned up (남김). */
  kept: boolean;
  /** 중복 항목: the first row of a group after another group (the line in the gap above it). */
  groupStart: boolean;
}

/**
 * One row (spec §3.4): it redraws only when its item, its place or its state changed — a re-read list redraws the rows
 * whose items changed, a click the two rows whose selection changed. Widths are not a prop: the grid tracks come from
 * the table's CSS variables, so a column drag redraws no row.
 */
const ItemRow = memo(function ItemRow({ item, index, top, selected, tabStop, ring, columns, now, match, tags, dragIdsOf, draggable, kept, groupStart }: ItemRowProps) {
  const last = columns.length - 1;
  const rowRef = useRef<HTMLDivElement>(null);
  const { rowProps, isDropTarget } = useRowDnd(rowRef, item.id, dragIdsOf, draggable);
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
      data-row-id={item.id}
      data-item-id={item.id}
      data-title={item.title}
      data-index={index}
      data-selected={selected || undefined}
      data-focus-visible={ring || undefined}
      data-missing={item.availability === 'missing' || undefined}
      data-drop-target={isDropTarget || undefined}
      data-group-start={groupStart || undefined}
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
            <TitleCell item={item} match={match} tags={tags} kept={kept} />
          ) : c.id === 'progress' ? (
            <ProgressCell progress={item.progress} />
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

interface CollectionRowProps {
  collection: TrashedCollection;
  index: number;
  top: number;
  selected: boolean;
  tabStop: boolean;
  ring: boolean;
  columns: readonly LibraryColumnSpec[];
  now: Date;
  match: Match | null;
}

/**
 * A collection row of the trash view (spec 4.3, library.html?state=trash): the folder and the name, the items it still has
 * where the author goes, the day it was trashed; the other cells empty. Not dragged; takes no drop.
 */
const CollectionRow = memo(function CollectionRow({ collection, index, top, selected, tabStop, ring, columns, now, match }: CollectionRowProps) {
  const last = columns.length - 1;
  return (
    <div
      role="row"
      aria-rowindex={index + 2}
      aria-selected={selected}
      tabIndex={tabStop ? 0 : -1}
      className="table-row is-collection"
      style={{ transform: `translateY(${top}px)` }}
      data-testid="trash-collection-row"
      data-row-id={collection.id}
      data-collection-id={collection.id}
      data-title={collection.name}
      data-index={index}
      data-selected={selected || undefined}
      data-focus-visible={ring || undefined}
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
            <>
              <Icon icon={Folder} />
              <span className="item-title ellipsis" title={collection.name}>
                {highlight(collection.name, match)}
              </span>
            </>
          ) : c.id === 'creators' ? (
            <span className="row-meta num ellipsis">{t.trash.collectionItems(collection.itemCount)}</span>
          ) : c.id === 'deletedAt' ? (
            <span className="ellipsis">{formatDate(collection.deletedAt, now)}</span>
          ) : null}
        </div>
      ))}
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
  const groups = props.collectionRows ?? NO_COLLECTIONS;
  const draggable = props.draggable ?? true;
  /** Collection rows first (trash only), then the items: index i < nc is groups[i], else rows[i − nc]. */
  const nc = groups.length;
  const count = nc + rows.length;
  useRevealRow(rows, props.revealId);
  const now = useNow(); // 오늘/어제 move on at midnight
  const selected = useLibrary((s) => s.selected);
  const cursorId = useLibrary((s) => s.cursorId);
  const rowHeight = ROW_HEIGHT[usePrefs().data?.density ?? defaultDensity];
  const kept = props.duplicateMarks?.kept ?? NO_IDS;
  const starts = props.duplicateMarks?.starts ?? NO_IDS;
  const forced = props.forced ?? NO_COLUMNS;
  const visible = useMemo(() => visibleColumns(columns, forced), [columns, forced]);
  const last = visible.length - 1;
  const order = useMemo(() => rowOrder([...groups.map((c) => c.id), ...rows.map((r) => r.id)]), [groups, rows]);
  const cursorIndex = order.indexOf(cursorId);
  // The one stop: the cursor row; before there is one, the first selected row, else the first row.
  const stop = cursorIndex >= 0 ? cursorIndex : Math.max(0, order.ids.findIndex((id) => selected.has(id)));

  const grid = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const headClip = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const getItemKey = useCallback((i: number) => order.ids[i]!, [order]);
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
    count,
    getScrollElement: () => scroller.current,
    estimateSize: (i) => rowHeight + (starts.has(rows[i - nc]?.id ?? '') ? GROUP_GAP : 0),
    overscan: OVERSCAN,
    getItemKey,
    rangeExtractor,
    paddingStart: BODY_TOP,
    paddingEnd: BODY_BOTTOM,
    // The header sits above the scroller, not in it: a row brought into view clears the top edge by the 4 px inset.
    scrollPaddingStart: BODY_TOP,
    scrollPaddingEnd: BODY_BOTTOM,
  });
  // Rows have one height, the density's, and a group's first row in 중복 항목 the gap above it: a new density or new
  // groups measure every row again (spec §3.4).
  useLayoutEffect(() => virtualizer.measure(), [virtualizer, rowHeight, starts]);

  // A classic scroll bar takes a column from the scroller; the header band keeps that column free. The width goes onto
  // the grid at once (no frame with a header wider than the rows) and into state for the title edge's size below.
  const [gutter, setGutter] = useState(0);
  const measureGutter = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    const view = scroller.current;
    const root = grid.current;
    if (!view || !root) return;
    const measure = () => {
      const w = view.offsetWidth - view.clientWidth;
      root.style.setProperty('--scrollbar-w', `${w}px`);
      setGutter(w);
    };
    measure();
    measureGutter.current = measure;
    const observer = new ResizeObserver(measure);
    observer.observe(view);
    return () => {
      measureGutter.current = null;
      observer.disconnect();
    };
  }, []);
  // Rows added or removed bring the bar or take it away in the commit that draws them; the observer would only report it at the
  // next frame, and a read in between (a test's, a handler's) would find the header over the bar's column.
  useLayoutEffect(() => measureGutter.current?.(), [count, rowHeight]);
  // The header follows the body sideways (the body's scroll event comes before the frame that paints it).
  const onScrollerScroll = useCallback(() => {
    if (headClip.current && scroller.current) headClip.current.scrollLeft = scroller.current.scrollLeft;
  }, []);
  // A wheel or sweep over the header, which no longer scrolls, goes to the body.
  const onHeadWheel = useCallback((e: WheelEvent<HTMLDivElement>) => {
    const view = scroller.current;
    if (!view) return;
    const step = wheelSteps(e, { width: view.clientWidth, height: view.clientHeight });
    view.scrollBy(step.x, step.y);
  }, []);
  const reorder = useColumnReorder({ head, clip: headClip, scroller, visible, forced, columns, onColumnsChange: props.onColumnsChange });
  const dragged = reorder.drag ? visible.find((c) => c.id === reorder.drag?.id) : undefined;

  // The title takes what the other columns leave (at least its minimum): its width, for its edge, is computed.
  const viewWidth = Math.max(0, (virtualizer.scrollRect?.width ?? 0) - gutter);
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
    if (count > 0 && document.activeElement === grid.current) focusStop();
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
        const view = scroller.current?.clientHeight ?? 0;
        const page = Math.floor((view - BODY_TOP) / latest.current.rowHeight);
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
  }, [apply]);

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
  const showEmpty = count === 0 && props.empty !== undefined && props.empty !== null;
  const vars = { '--head-cols': tracks.head, '--row-cols': tracks.row, '--table-min-width': `${tracks.minWidth}px` } as CSSProperties;
  return (
    <div
      ref={grid}
      role="grid"
      aria-label={t.library.table}
      aria-multiselectable="true"
      aria-rowcount={count + (showEmpty ? 2 : 1)}
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
      <div className="table-head-wrap">
        <div ref={headClip} className="table-head-clip" data-testid="table-head-clip" onWheel={onHeadWheel}>
          <div ref={head} role="row" aria-rowindex={1} className="table-head" data-reordering={reorder.drag ? '' : undefined} onContextMenu={onHeaderMenu} onPointerDown={reorder.onPointerDown} onClickCapture={reorder.onClickCapture}>
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
                  data-dragging={reorder.drag?.id === c.id || undefined}
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
            {dragged && reorder.drag && (
              <div
                ref={reorder.ghostRef}
                className={cx('col-drag-ghost', dragged.align === 'end' && 'end')}
                data-testid="column-drag-ghost"
                data-sorted={sort.column === dragged.id || undefined}
                aria-hidden="true"
                style={{ width: reorder.drag.width }}
              >
                <span className="ellipsis">{dragged.label}</span>
                {sort.column === dragged.id && <Icon icon={sort.direction === 'asc' ? ChevronUp : ChevronDown} size="xs" />}
              </div>
            )}
            {reorder.drag?.lineX != null && <div className="col-drop-line" data-testid="column-drop-line" aria-hidden="true" style={{ left: reorder.drag.lineX }} />}
          </div>
        </div>
      </div>
      <div ref={scroller} className="table-scroller" data-testid="library-scroller" data-empty={showEmpty || undefined} onScroll={onScrollerScroll}>
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
              if (v.index < nc) {
                const c = groups[v.index]!;
                return (
                  <CollectionRow
                    key={v.key}
                    collection={c}
                    index={v.index}
                    top={v.start}
                    selected={selected.has(c.id)}
                    tabStop={v.index === stop}
                    ring={ring && focusedId === c.id}
                    columns={visible}
                    now={now}
                    match={collectionMatch(c.name, props.collectionQuery ?? '')}
                  />
                );
              }
              const item = rows[v.index - nc]!;
              return (
                <ItemRow
                  key={v.key}
                  item={item}
                  index={v.index}
                  top={v.start + (starts.has(item.id) ? GROUP_GAP : 0)}
                  selected={selected.has(item.id)}
                  tabStop={v.index === stop}
                  ring={ring && focusedId === item.id}
                  columns={visible}
                  now={now}
                  match={props.titleMatches?.get(item.id) ?? null}
                  tags={props.tagsOf?.(item.id) ?? NO_TAGS}
                  dragIdsOf={dragIdsOf}
                  draggable={draggable}
                  kept={kept.has(item.id)}
                  groupStart={starts.has(item.id)}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
