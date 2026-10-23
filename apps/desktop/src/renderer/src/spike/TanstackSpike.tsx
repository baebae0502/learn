// M4 Task 1 spike, the fallback (branch m4-spike only, never merged): TanStack Virtual rows in a hand-made
// role="grid", for the budgets only — spec 3.4: with this fallback Task 3 builds the behaviours of 3.3 by hand.
// URL: ?window=spike&impl=tanstack. Same probe (window.__spike) and test ids as TableSpike.
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronDown, ChevronUp, Clapperboard, FileText, Link, TriangleAlert } from 'lucide-react';
import { afterPaint } from '../ui/afterPaint';
import { Icon } from '../ui/Icon';
import type { SpikeProbe } from './probe';
import { makeRows, sortRows, type SpikeRow, type SpikeSortColumn } from './rows';

const TOTAL = Number(new URLSearchParams(location.search).get('rows') ?? 10_000);
const ROW = 28;
const COLUMNS: ReadonlyArray<{ id: SpikeSortColumn; label: string; width: number | null }> = [
  { id: 'title', label: '제목', width: null },
  { id: 'creators', label: '저자', width: 180 },
  { id: 'year', label: '연도', width: 64 },
  { id: 'type', label: '종류', width: 88 },
  { id: 'createdAt', label: '추가일', width: 132 },
];
const widthStyle = (w: number | null) => (w === null ? { flex: '1 1 0', minWidth: 200 } : { flex: `0 0 ${w}px` });

const probe: SpikeProbe = {
  impl: 'tanstack', total: TOTAL, marks: [], inputAt: 0, opened: [], menus: [], resizeEnds: [], resizeMoves: 0, cellRenders: 0, rowElements: 0, sortComputeMs: [],
  guardTypeAhead: false, globalHomeEnd: false, setRows: () => 0, setRowHeight: () => 0, selectedIds: () => [],
};
window.__spike = probe;
for (const type of ['pointerdown', 'keydown'] as const) window.addEventListener(type, () => (probe.inputAt = performance.now()), true);

function mark(name: string): void {
  probe.marks.push({ name, at: performance.now(), rows: document.querySelectorAll('[data-testid="item-row"]').length });
}
function usePaintMark(name: string, dep: unknown): void {
  useLayoutEffect(() => afterPaint(() => mark(name)), [dep]);
}

const Cells = memo(function Cells({ item }: { item: SpikeRow }) {
  probe.cellRenders += 5;
  return (
    <>
      <div role="gridcell" className="td" data-col="title" style={widthStyle(null)}>
        <Icon icon={item.type === 'video' ? Clapperboard : FileText} />
        <span className="ellipsis">{item.title}</span>
        {item.storageMode === 'linked' && <Icon icon={Link} size="sm" />}
        {item.availability === 'missing' && (
          <span className="spike-flag">
            <Icon icon={TriangleAlert} size="sm" />
            파일 없음
          </span>
        )}
      </div>
      <div role="gridcell" className="td" data-col="creators" style={widthStyle(180)}>
        <span className="ellipsis">{item.creators.join(', ')}</span>
      </div>
      <div role="gridcell" className="td num" data-col="year" style={widthStyle(64)}>
        {item.year ?? ''}
      </div>
      <div role="gridcell" className="td" data-col="type" style={widthStyle(88)}>
        {item.type === 'pdf' ? 'PDF' : '동영상'}
      </div>
      <div role="gridcell" className="td num" data-col="createdAt" style={widthStyle(132)}>
        {item.createdAt.slice(0, 10)}
      </div>
    </>
  );
});

export function TanstackSpike() {
  const all = useRef<readonly SpikeRow[]>([]);
  const [rows, setRows] = useState<readonly SpikeRow[] | null>(null);
  const [sort, setSort] = useState<{ column: SpikeSortColumn; direction: 'ascending' | 'descending' } | null>(null);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({ count: rows?.length ?? 0, getScrollElement: () => scrollRef.current, estimateSize: () => ROW, overscan: 8, getItemKey: (i) => rowsRef.current![i]!.id });

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
    mark('rows:set');
    setRows(made);
    const watch = (): number => (document.querySelector('[data-testid="item-row"]') ? requestAnimationFrame(() => mark('first-row')) : requestAnimationFrame(watch));
    requestAnimationFrame(watch);
  }, []);

  usePaintMark('rows', rows);
  usePaintMark('sort', sort);

  const sortBy = (column: SpikeSortColumn) => {
    const direction = sort?.column === column && sort.direction === 'ascending' ? 'descending' : 'ascending';
    const t0 = performance.now();
    const next = sortRows(all.current, column, direction);
    probe.sortComputeMs.push(performance.now() - t0);
    setSort({ column, direction });
    setRows(next);
  };

  if (!rows) return <div className="spike" data-testid="spike" />;
  return (
    <div className="spike" data-testid="spike">
      <div className="spike-bar">TanStack Virtual · {rows.length}</div>
      <div className="spike-wrap">
        <div ref={scrollRef} className="spike-table" role="grid" aria-label="자료" aria-rowcount={rows.length + 1} aria-multiselectable="true" tabIndex={0} data-testid="library-table">
          <div role="row" aria-rowindex={1} className="spike-head">
            {COLUMNS.map((c) => (
              <div
                key={c.id}
                role="columnheader"
                className="th"
                data-testid="column-header"
                data-col={c.id}
                aria-sort={sort?.column === c.id ? sort.direction : undefined}
                style={widthStyle(c.width)}
                onClick={() => sortBy(c.id)}
              >
                <span className="ellipsis">{c.label}</span>
                {sort?.column === c.id && <Icon icon={sort.direction === 'ascending' ? ChevronUp : ChevronDown} size="xs" />}
              </div>
            ))}
          </div>
          <div className="spike-body" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((v) => {
              const item = rows[v.index]!;
              return (
                <div
                  key={v.key}
                  role="row"
                  aria-rowindex={v.index + 2}
                  className={v.index % 2 === 1 ? 'row is-odd' : 'row'}
                  data-testid="item-row"
                  data-title={item.title}
                  data-item-id={item.id}
                  style={{ transform: `translateY(${v.start}px)` }}
                >
                  <Cells item={item} />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
