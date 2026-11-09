import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { ChevronDown, ChevronRight, ListTree, SearchX } from 'lucide-react';
import { Button, ListLayout, Tree, TreeItem, TreeItemContent, Virtualizer, type Key } from 'react-aria-components';
import { usePrefs } from '../../data/queries';
import { defaultDensity, density as ROW_HEIGHT } from '../../design/tokens';
import { t } from '../../strings';
import { Icon } from '../../ui/Icon';
import { Kbd } from '../../ui/Kbd';
import { PaneEmpty } from '../../ui/PaneEmpty';
import { SearchField } from '../../ui/SearchField';
import { currentOutlineId, filterOutline, flattenOutline, OUTLINE_FOLLOW_PAUSE_MS, outlinePages, outlineRows, outlineScrollTarget, type OutlineRow } from './outline';
import { useReader } from './readerStore';

const indent = ({ level }: { level: number }) => ({ '--indent': level - 1 }) as CSSProperties;

type Loaded = { status: 'loading' } | { status: 'ready'; rows: OutlineRow[]; pages: ReadonlyMap<string, number> };
const LOADING: Loaded = { status: 'loading' };
type Held = { doc: PDFDocumentProxy | null; state: Loaded };

/** The entries of a document's outline, loaded once for the open document (and the page each one goes to, a batch at a time). */
function useOutline(): Loaded {
  const handle = useReader((s) => s.handle);
  const doc = handle?.document() ?? null;
  const [held, setHeld] = useState<Held>({ doc, state: { status: 'loading' } });
  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    const put = (state: Loaded) => setHeld({ doc, state });
    put({ status: 'loading' });
    void doc.getOutline().then(
      (nodes) => {
        if (cancelled) return;
        const rows = outlineRows(nodes);
        put({ status: 'ready', rows, pages: new Map() });
        void outlinePages(doc, rows, () => cancelled, (pages) => {
          if (!cancelled) put({ status: 'ready', rows, pages });
        });
      },
      (e: unknown) => {
        // A document that closes under the request is not an outline that failed to load; anything else is "no outline".
        if (cancelled) return;
        console.warn(`[pdf] outline failed: ${(e as Error)?.name ?? 'Error'}`);
        put({ status: 'ready', rows: [], pages: new Map() });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [doc]);
  // What was read from another document is not shown for this one, not even for the render before the effect runs.
  return held.doc === doc ? held.state : LOADING;
}
const ancestorsOf = (id: string): string[] => id.split('.').slice(0, -1).map((_, i, parts) => parts.slice(0, i + 1).join('.'));

/** The outline (spec 4.7): a searchable tree; a row goes to its destination, the one the reader is in is marked. */
export function OutlineTree() {
  const outline = useOutline();
  const handle = useReader((s) => s.handle);
  const page = useReader((s) => s.pdf?.pageNumber ?? 1);
  // Page 1 is where pdf.js starts, not where the reader is: no row is the current one (and none is opened for it) until the saved place has been applied.
  const placed = useReader((s) => s.pdf?.placed === true);
  const [query, setQuery] = useState('');
  const rowHeight = ROW_HEIGHT[usePrefs().data?.density ?? defaultDensity];
  const layoutOptions = useMemo(() => ({ rowHeight }), [rowHeight]);
  const [opened, setOpened] = useState<ReadonlySet<Key>>(new Set());

  const rows = outline.status === 'ready' ? outline.rows : [];
  const pages = outline.status === 'ready' ? outline.pages : new Map<string, number>();
  const current = useMemo(() => (placed ? currentOutlineId(rows, pages, page) : null), [placed, rows, pages, page]);
  const shown = useMemo(() => filterOutline(rows, query), [rows, query]);
  const searching = query.trim() !== '';

  // The reader's place is open in the tree, and stays open when the page moves on.
  useEffect(() => {
    if (current === null) return;
    setOpened((before) => new Set([...before, ...ancestorsOf(current)]));
  }, [current]);
  // A search shows every hit with its way down.
  const expanded = useMemo<ReadonlySet<Key>>(() => (searching ? new Set(flattenOutline(shown).filter((r) => r.children.length > 0).map((r) => r.id)) : opened), [searching, shown, opened]);

  // The rows as the tree lists them (a closed row hides its children): the current row's place in that list is where it is scrolled to.
  const currentIndex = useMemo(() => {
    const order: string[] = [];
    const walk = (list: readonly OutlineRow[]) => {
      for (const row of list) {
        order.push(row.id);
        if (expanded.has(row.id)) walk(row.children);
      }
    };
    walk(shown);
    return current === null ? -1 : order.indexOf(current);
  }, [shown, expanded, current]);
  const treeShown = outline.status === 'ready' && shown.length > 0;
  const tree = useRef<HTMLDivElement>(null);
  /** The time before which the page does not pull the list: the user scrolled it (wheel, keys, the scroll bar) a moment ago. */
  const pausedUntil = useRef(0);
  /** A click on a row moves the page and may leave the current row as it was (a sub-entry of the same page): it still shows the row. */
  const [nudge, setNudge] = useState(0);
  /** Counts the times the list came back from a zero height (a hidden kept tab): it follows the page then. */
  const [revealed, setRevealed] = useState(0);
  /** The current row a follow skipped because the user had just scrolled the list; null when the last follow ran. */
  const [held, setHeld] = useState<string | null>(null);
  useEffect(() => {
    const el = tree.current;
    if (!treeShown || !el) return;
    const pause = () => {
      pausedUntil.current = performance.now() + OUTLINE_FOLLOW_PAUSE_MS;
    };
    let pointerHeld = false;
    const down = () => {
      pointerHeld = true;
    };
    const up = () => {
      pointerHeld = false;
    };
    // A scroll with the pointer held on the list is the scroll bar's drag; the list's own scrolls (set below) happen with no pointer held.
    const scrolled = () => {
      if (pointerHeld) pause();
    };
    let height = el.clientHeight;
    const observer = new ResizeObserver(() => {
      const was = height;
      height = el.clientHeight;
      if (was === 0 && height > 0) setRevealed((n) => n + 1);
    });
    observer.observe(el);
    el.addEventListener('wheel', pause, { passive: true });
    el.addEventListener('keydown', pause);
    el.addEventListener('pointerdown', down);
    el.addEventListener('scroll', scrolled, { passive: true });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      observer.disconnect();
      el.removeEventListener('wheel', pause);
      el.removeEventListener('keydown', pause);
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('scroll', scrolled);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [treeShown]);
  /** What the last run of the follow saw, to tell the page's moves from the user's typing in the search. */
  const last = useRef<{ current: string | null; nudge: number; revealed: number; query: string }>({ current, nudge, revealed, query });
  useEffect(() => {
    const before = last.current;
    last.current = { current, nudge, revealed, query };
    const el = tree.current;
    if (!treeShown || !el || currentIndex < 0) return;
    // Typing in the search moves the current row in the list by the user's own act; clearing it, or a page that moved with it, follows.
    const moved = before.current !== current || before.nudge !== nudge || before.revealed !== revealed;
    if (before.query !== query && query.trim() !== '' && !moved) return;
    let frame = 0;
    let tries = 0;
    const follow = () => {
      // A hidden kept tab has no height to follow into; it follows when it is shown again.
      if (el.clientHeight === 0) return;
      if (performance.now() < pausedUntil.current) {
        setHeld(current);
        return;
      }
      setHeld(null);
      const pad = parseFloat(getComputedStyle(el).paddingTop) || 0;
      const to = outlineScrollTarget({ index: currentIndex, rowHeight, scrollTop: el.scrollTop - pad, viewport: el.clientHeight });
      if (to === null) return;
      el.scrollTop = to + pad;
      // The list's height arrives with its first layout: a target beyond it is asked again for a few frames.
      if (Math.abs(el.scrollTop - (to + pad)) > 1 && ++tries < 10) frame = requestAnimationFrame(follow);
    };
    follow();
    return () => cancelAnimationFrame(frame);
  }, [treeShown, currentIndex, rowHeight, nudge, query, revealed, current]);

  if (outline.status === 'loading') return <div className="outline-wait" data-testid="pdf-outline-loading" />;
  if (rows.length === 0) {
    return (
      <PaneEmpty icon={ListTree} title={t.reader.noOutlineTitle} top testId="reader-sidebar-empty">
        {t.reader.noOutlineLead} <Kbd accelerator="Alt+CmdOrCtrl+G" />
        {t.reader.noOutlineTail}
      </PaneEmpty>
    );
  }

  const go = (row: OutlineRow) => {
    pausedUntil.current = 0;
    setNudge((n) => n + 1);
    if (row.url !== null) window.open(row.url, '_blank', 'noopener');
    else if (row.dest !== null) void handle?.linkService()?.goToDestination(row.dest);
  };
  const byId = new Map(flattenOutline(rows).map((r) => [r.id, r]));

  const item = (row: OutlineRow) => (
    <TreeItem key={row.id} id={row.id} textValue={pages.has(row.id) ? t.reader.outlineRowName(row.title, pages.get(row.id)!) : row.title} className="nav-row" style={indent} data-current-page={row.id === current ? 'true' : undefined} data-testid="pdf-outline-row">
      <TreeItemContent>
        {({ hasChildItems, isExpanded }) => (
          <>
            {hasChildItems && (
              <Button slot="chevron" className="disclosure">
                <Icon icon={isExpanded ? ChevronDown : ChevronRight} size="xs" />
              </Button>
            )}
            <span className="label ellipsis" title={row.title} aria-current={row.id === current ? 'location' : undefined}>
              {row.title}
            </span>
            {pages.has(row.id) && <span className="page num">{pages.get(row.id)}</span>}
          </>
        )}
      </TreeItemContent>
      {row.children.map(item)}
    </TreeItem>
  );

  return (
    <>
      <div className="nav-search">
        <SearchField aria-label={t.reader.outlineSearchLabel} placeholder={t.reader.outlineSearch} size="small" value={query} onChange={setQuery} testId="pdf-outline-search" />
      </div>
      {shown.length === 0 ? (
        <PaneEmpty icon={SearchX} title={t.reader.outlineNoMatch} top testId="reader-sidebar-empty" />
      ) : (
        <Virtualizer layout={ListLayout} layoutOptions={layoutOptions}>
        <Tree
          ref={tree}
          aria-label={t.reader.outlineTree}
          className="nav-list outline"
          data-testid="pdf-outline"
          data-current-id={current ?? undefined}
          data-follow-held={held ?? undefined}
          expandedKeys={expanded}
          onExpandedChange={(keys) => !searching && setOpened(keys)}
          onAction={(key) => {
            const row = byId.get(String(key));
            if (row) go(row);
          }}
        >
          {shown.map(item)}
        </Tree>
        </Virtualizer>
      )}
    </>
  );
}
