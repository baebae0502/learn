import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { t } from '../../strings';
import { Icon } from '../../ui/Icon';
import { visibleOutline, type OutlineRow } from './outline';

/** A guess for a row's height before it is measured (--row-height: regular). */
const ROW_ESTIMATE = 28; /* local: --row-height-regular */

const indent = (level: number) => ({ '--indent': level - 1 }) as CSSProperties;
const rowId = (id: string) => `pdf-outline-${id}`;

/**
 * A long outline (spec 4.7): only the rows of open entries are listed, and only the ones in view are drawn. react-aria's Tree
 * draws every row it is given, so the tree's semantics are kept here by hand: role=tree/treeitem with level, size, position and
 * state, one tab stop on the tree with the cursor named by aria-activedescendant, and the same keys as the Tree (↑ ↓, → opens or
 * enters, ← closes or leaves, Home, End, ↩ and space go to the entry).
 */
export function VirtualOutline({
  rows,
  open,
  locked,
  current,
  pages,
  onToggle,
  onGo,
}: {
  rows: readonly OutlineRow[];
  open: ReadonlySet<string>;
  /** A search shows every hit with its way down: the rows cannot be opened or closed. */
  locked: boolean;
  current: string | null;
  pages: ReadonlyMap<string, number>;
  onToggle: (id: string, open: boolean) => void;
  onGo: (row: OutlineRow) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const flat = useMemo(() => visibleOutline(rows, open), [rows, open]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [keyboard, setKeyboard] = useState(false);
  const [focused, setFocused] = useState(false);

  const virtualizer = useVirtualizer({
    count: flat.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_ESTIMATE,
    getItemKey: (i) => flat[i]!.row.id,
    overscan: 8,
  });
  const items = virtualizer.getVirtualItems();
  const indexOf = (id: string | null) => (id === null ? -1 : flat.findIndex((f) => f.row.id === id));

  // The cursor starts where the reader is, and moves to the first row when its row is gone (a closed parent, a new search).
  const at = indexOf(cursor);
  const cursorRow = at >= 0 ? flat[at]! : null;
  useEffect(() => {
    if (cursor !== null && at < 0) setCursor(null);
  }, [cursor, at]);

  // The row that is current comes into view when the page moves it.
  useLayoutEffect(() => {
    const index = flat.findIndex((f) => f.row.id === current);
    if (index >= 0) virtualizer.scrollToIndex(index, { align: 'auto' });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a change of the current entry scrolls the list
  }, [current]);

  const moveTo = (index: number) => {
    const target = flat[Math.max(0, Math.min(flat.length - 1, index))];
    if (!target) return;
    setCursor(target.row.id);
    virtualizer.scrollToIndex(flat.indexOf(target), { align: 'auto' });
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    setKeyboard(true);
    const here = at >= 0 ? at : Math.max(0, indexOf(current));
    const row = flat[here];
    if (!row) return;
    if (e.key === 'ArrowDown') moveTo(here + 1);
    else if (e.key === 'ArrowUp') moveTo(here - 1);
    else if (e.key === 'Home') moveTo(0);
    else if (e.key === 'End') moveTo(flat.length - 1);
    else if (e.key === 'ArrowRight') {
      if (row.expanded === false) {
        if (!locked) onToggle(row.row.id, true);
      } else if (row.expanded === true) moveTo(here + 1);
    } else if (e.key === 'ArrowLeft') {
      if (row.expanded === true) {
        if (!locked) onToggle(row.row.id, false);
      } else if (row.parent !== null) moveTo(indexOf(row.parent));
    } else if (e.key === 'Enter' || e.key === ' ') onGo(row.row);
    else return;
    e.preventDefault();
  };

  // The cursor row is named only while it is drawn: the list keeps no row outside the view.
  const named = cursorRow !== null && items.some((i) => i.index === at) ? rowId(cursorRow.row.id) : undefined;

  return (
    <div
      ref={scrollRef}
      className="nav-list outline outline-virtual"
      role="tree"
      tabIndex={0}
      aria-label={t.reader.outlineTree}
      aria-activedescendant={named}
      data-testid="pdf-outline"
      data-virtual="true"
      data-rows={flat.length}
      onKeyDown={onKeyDown}
      onPointerDown={() => setKeyboard(false)}
      onFocus={(e) => {
        setFocused(true);
        // A click on a row sets the cursor itself; a tab or a focus by script starts at the reader's place.
        if (e.target === e.currentTarget && cursor === null) {
          const index = Math.max(0, indexOf(current));
          if (flat[index]) setCursor(flat[index].row.id);
        }
      }}
      onBlur={() => setFocused(false)}
    >
      <div className="outline-virtual-inner" style={{ height: virtualizer.getTotalSize() }}>
        {items.map((item) => {
          const f = flat[item.index]!;
          const isCursor = focused && f.row.id === cursor;
          return (
            <div
              key={item.key}
              id={rowId(f.row.id)}
              ref={virtualizer.measureElement}
              data-index={item.index}
              role="treeitem"
              aria-level={f.level}
              aria-setsize={f.setSize}
              aria-posinset={f.posInSet}
              aria-expanded={f.expanded}
              aria-label={f.row.title}
              className="nav-row"
              style={{ ...indent(f.level), transform: `translateY(${item.start}px)` }}
              data-testid="pdf-outline-row"
              data-current-page={f.row.id === current ? 'true' : undefined}
              data-focus-visible={isCursor && keyboard ? 'true' : undefined}
              onClick={() => {
                setCursor(f.row.id);
                onGo(f.row);
              }}
            >
              {f.expanded !== undefined && (
                <span
                  className="disclosure"
                  aria-hidden="true"
                  onClick={(e) => {
                    e.stopPropagation();
                    setCursor(f.row.id);
                    if (!locked) onToggle(f.row.id, !f.expanded);
                  }}
                >
                  <Icon icon={f.expanded ? ChevronDown : ChevronRight} size="xs" />
                </span>
              )}
              <span className="label ellipsis" title={f.row.title}>
                {f.row.title}
              </span>
              {pages.has(f.row.id) && <span className="page num">{pages.get(f.row.id)}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
