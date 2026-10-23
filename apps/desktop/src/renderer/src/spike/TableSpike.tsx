// M4 Task 1 spike — branch m4-spike only, never merged. RAC Table + Virtualizer + TableLayout over 10,000 synthetic
// rows, driven and timed by tests/evidence/table-spike.evidence.ts through window.__spike (probe.ts). Its answer goes
// to ADR-0004 "M4 표". URL: ?window=spike[&rows=N][&stripes=index][&selection=copy].
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  Cell, Column, ColumnResizer, ResizableTableContainer, Row, Table, TableBody, TableHeader, TableLayout, Virtualizer,
  type Key, type ResizableTableContainerProps, type Selection, type SortDescriptor,
} from 'react-aria-components';
import { ChevronDown, ChevronUp, Clapperboard, FileText, Link, TriangleAlert } from 'lucide-react';
import { afterPaint } from '../ui/afterPaint';
import { Icon } from '../ui/Icon';
import type { SpikeProbe } from './probe';
import { makeRows, sortRows, type SpikeRow, type SpikeSortColumn } from './rows';

const params = new URLSearchParams(location.search);
const TOTAL = Number(params.get('rows') ?? 10_000);
/**
 * Where a row's stripe parity comes from. `class` (default): RAC's className render prop reads the row's index in
 * the collection. `index`: data-index from an index map, which needs TableBody `dependencies` (P-16 as written), so
 * every rows change rebuilds every row element.
 */
const STRIPES: 'class' | 'index' = params.get('stripes') === 'index' ? 'index' : 'class';
/**
 * `keep` (default): the Selection object RAC hands over is kept as is. `copy`: copied into a new Set, as a store that
 * holds plain ids would — which drops RAC's range anchor (Selection.anchorKey), so ⇧click no longer extends.
 */
const SELECTION: 'keep' | 'copy' = params.get('selection') === 'copy' ? 'copy' : 'keep';
const IS_MAC = document.documentElement.dataset['platform'] === 'darwin';
const HEADING = 28;

const COLUMNS: ReadonlyArray<{ id: SpikeSortColumn; label: string; width: number | null; min: number }> = [
  { id: 'title', label: '제목', width: null, min: 200 },
  { id: 'creators', label: '저자', width: 180, min: 96 },
  { id: 'year', label: '연도', width: 64, min: 56 },
  { id: 'type', label: '종류', width: 88, min: 72 },
  { id: 'createdAt', label: '추가일', width: 132, min: 112 },
];

const probe: SpikeProbe = {
  impl: 'rac', total: TOTAL, marks: [], inputAt: 0, opened: [], menus: [], resizeEnds: [], resizeMoves: 0, cellRenders: 0, rowElements: 0, sortComputeMs: [],
  guardTypeAhead: false, globalHomeEnd: false, setRows: () => 0, setRowHeight: () => 0, selectedIds: () => [],
};
window.__spike = probe;
for (const type of ['pointerdown', 'keydown'] as const) window.addEventListener(type, () => (probe.inputAt = performance.now()), true);

function mark(name: string): void {
  probe.marks.push({ name, at: performance.now(), rows: document.querySelectorAll('[data-testid="item-row"]').length });
}

/** Marks `name` once the frame showing the commit in which `dep` changed has been painted. */
function usePaintMark(name: string, dep: unknown): void {
  useLayoutEffect(() => afterPaint(() => mark(name)), [dep]);
}

type Widths = Parameters<NonNullable<ResizableTableContainerProps['onResizeEnd']>>[0];

const TitleCell = memo(function TitleCell({ item }: { item: SpikeRow }) {
  probe.cellRenders++;
  return (
    <>
      <Icon icon={item.type === 'video' ? Clapperboard : FileText} />
      <span className="ellipsis">{item.title}</span>
      {item.storageMode === 'linked' && <Icon icon={Link} size="sm" />}
      {item.availability === 'missing' && (
        <span className="spike-flag">
          <Icon icon={TriangleAlert} size="sm" />
          파일 없음
        </span>
      )}
    </>
  );
});

const TextCell = memo(function TextCell({ item, column }: { item: SpikeRow; column: Exclude<SpikeSortColumn, 'title'> }) {
  probe.cellRenders++;
  const text =
    column === 'creators' ? item.creators.join(', ') : column === 'year' ? (item.year ?? '') : column === 'type' ? (item.type === 'pdf' ? 'PDF' : '동영상') : item.createdAt.slice(0, 10);
  return <span className="ellipsis">{text}</span>;
});

export function TableSpike() {
  const all = useRef<readonly SpikeRow[]>([]);
  const [rows, setRows] = useState<readonly SpikeRow[] | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<Key>>(() => new Set());
  const [sort, setSort] = useState<SortDescriptor | undefined>(undefined);
  const [rowHeight, setRowHeight] = useState(28);
  // Handlers on cached row elements read these, never a render's closure.
  const rowsRef = useRef(rows);
  const selectedRef = useRef(selected);
  rowsRef.current = rows;
  selectedRef.current = selected;

  useEffect(() => {
    const made = makeRows(TOTAL);
    all.current = made;
    probe.setRows = (kind) => {
      const current = rowsRef.current ?? made;
      const next = kind === 'all' ? made : kind === 'filter' ? made.filter((r) => r.title.startsWith('세포')) : current.map((r, i) => (i === 2 ? { ...r, title: `${r.title} (고침)` } : r));
      const at = performance.now();
      setRows(next);
      return at;
    };
    probe.setRowHeight = (px) => {
      const at = performance.now();
      setRowHeight(px);
      return at;
    };
    probe.selectedIds = () => (rowsRef.current ?? []).filter((r) => selectedRef.current.has(r.id)).map((r) => r.id);
    mark('rows:set');
    setRows(made);
    // The first painted frame with a row in it: rAF runs before that frame's paint, the next one just after it.
    const watch = (): number => (document.querySelector('[data-testid="item-row"]') ? requestAnimationFrame(() => mark('first-row')) : requestAnimationFrame(watch));
    requestAnimationFrame(watch);
  }, []);

  usePaintMark('rows', rows);
  usePaintMark('sort', sort);
  usePaintMark('selection', selected);
  usePaintMark('density', rowHeight);

  const indexOf = useMemo(() => (STRIPES === 'index' ? new Map((rows ?? []).map((r, i) => [r.id, i])) : null), [rows]);
  const layoutOptions = useMemo(() => ({ rowHeight, headingHeight: HEADING }), [rowHeight]);

  const onSortChange = (d: SortDescriptor) => {
    const t0 = performance.now();
    const next = sortRows(all.current, d.column as SpikeSortColumn, d.direction);
    probe.sortComputeMs.push(performance.now() - t0);
    setSort(d);
    setRows(next);
  };
  const onSelectionChange = (keys: Selection) =>
    setSelected(keys === 'all' ? new Set((rowsRef.current ?? []).map((r) => r.id)) : SELECTION === 'copy' ? new Set(keys) : keys);
  const onResizeEnd = (widths: Widths) => {
    probe.resizeEnds.push(Object.fromEntries([...widths].map(([k, v]) => [String(k), v])));
  };
  const guardKeys = (e: KeyboardEvent) => {
    const plain = !e.metaKey && !e.ctrlKey && !e.altKey;
    if (probe.guardTypeAhead && plain && e.key.length === 1 && e.key !== ' ') e.stopPropagation();
    // A click focuses a cell, and from a cell RAC's Home / End stay in the row; the ⌘/Ctrl form goes to the first / last row.
    if (probe.globalHomeEnd && plain && (e.key === 'Home' || e.key === 'End')) {
      e.preventDefault();
      e.stopPropagation();
      e.target.dispatchEvent(new globalThis.KeyboardEvent('keydown', { key: e.key, code: e.code, shiftKey: e.shiftKey, metaKey: IS_MAC, ctrlKey: !IS_MAC, bubbles: true, cancelable: true }));
    }
  };

  if (!rows) return <div className="spike" data-testid="spike" />;
  return (
    <div className="spike" data-testid="spike">
      <div className="spike-bar">
        RAC Table + Virtualizer · {rows.length} · stripes={STRIPES} · selection={SELECTION}
      </div>
      <div className="spike-wrap" onKeyDownCapture={guardKeys}>
        <ResizableTableContainer className="spike-resize" onResize={() => void probe.resizeMoves++} onResizeEnd={onResizeEnd}>
          <Virtualizer layout={TableLayout} layoutOptions={layoutOptions}>
            <Table
              aria-label="자료"
              className="spike-table"
              data-testid="library-table"
              selectionMode="multiple"
              selectionBehavior="replace"
              selectedKeys={selected}
              onSelectionChange={onSelectionChange}
              sortDescriptor={sort}
              onSortChange={onSortChange}
              onRowAction={(key) => void probe.opened.push(String(key))}
            >
              <TableHeader>
                {COLUMNS.map((c, i) => (
                  <Column
                    key={c.id}
                    id={c.id}
                    isRowHeader={c.id === 'title'}
                    allowsSorting
                    defaultWidth={c.width ?? '1fr'}
                    minWidth={c.min}
                    className="th"
                    data-testid="column-header"
                    data-col={c.id}
                  >
                    {({ sortDirection }) => (
                      <>
                        <span className="ellipsis">{c.label}</span>
                        {sortDirection && <Icon icon={sortDirection === 'ascending' ? ChevronUp : ChevronDown} size="xs" />}
                        {i < COLUMNS.length - 1 && <ColumnResizer className="spike-resizer" data-testid="column-resizer" data-col={c.id} />}
                      </>
                    )}
                  </Column>
                ))}
              </TableHeader>
              <TableBody items={rows} dependencies={indexOf ? [indexOf] : undefined}>
                {(item) => {
                  probe.rowElements++;
                  return (
                    <Row
                      id={item.id}
                      textValue={item.title}
                      className={({ id, state }) => ((state.collection.getItem(id!)?.index ?? 0) % 2 === 1 ? 'row is-odd' : 'row')}
                      data-testid="item-row"
                      data-title={item.title}
                      data-item-id={item.id}
                      data-index={indexOf?.get(item.id)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        const current = selectedRef.current;
                        const next = current.has(item.id) ? current : new Set<Key>([item.id]);
                        if (next !== current) setSelected(next);
                        probe.menus.push((rowsRef.current ?? []).filter((r) => next.has(r.id)).map((r) => r.id));
                      }}
                    >
                      <Cell className="td" data-col="title">
                        <TitleCell item={item} />
                      </Cell>
                      <Cell className="td" data-col="creators">
                        <TextCell item={item} column="creators" />
                      </Cell>
                      <Cell className="td num" data-col="year">
                        <TextCell item={item} column="year" />
                      </Cell>
                      <Cell className="td" data-col="type">
                        <TextCell item={item} column="type" />
                      </Cell>
                      <Cell className="td num" data-col="createdAt">
                        <TextCell item={item} column="createdAt" />
                      </Cell>
                    </Row>
                  );
                }}
              </TableBody>
            </Table>
          </Virtualizer>
        </ResizableTableContainer>
      </div>
    </div>
  );
}
