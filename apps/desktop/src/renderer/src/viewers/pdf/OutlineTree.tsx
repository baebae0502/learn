import { useEffect, useMemo, useState, type CSSProperties } from 'react';
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
import { currentOutlineId, filterOutline, flattenOutline, outlinePages, outlineRows, type OutlineRow } from './outline';
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
          aria-label={t.reader.outlineTree}
          className="nav-list outline"
          data-testid="pdf-outline"
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
