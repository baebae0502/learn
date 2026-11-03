import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { ChevronDown, ChevronRight, ListTree, SearchX } from 'lucide-react';
import { Button, Tree, TreeItem, TreeItemContent, type Key } from 'react-aria-components';
import { t } from '../../strings';
import { Icon } from '../../ui/Icon';
import { Kbd } from '../../ui/Kbd';
import { PaneEmpty } from '../../ui/PaneEmpty';
import { SearchField } from '../../ui/SearchField';
import { currentOutlineId, filterOutline, flattenOutline, outlinePages, outlineRows, type OutlineRow } from './outline';
import { useReader } from './readerStore';

const indent = ({ level }: { level: number }) => ({ '--indent': level - 1 }) as CSSProperties;

type Loaded = { status: 'loading' } | { status: 'ready'; rows: OutlineRow[]; pages: ReadonlyMap<string, number> };

/** The entries of a document's outline, loaded once for the open document (and the page each one goes to, a little later). */
function useOutline(): Loaded {
  const handle = useReader((s) => s.handle);
  const doc = handle?.document() ?? null;
  const [state, setState] = useState<Loaded>({ status: 'loading' });
  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    setState({ status: 'loading' });
    void doc.getOutline().then(
      (nodes) => {
        if (cancelled) return;
        const rows = outlineRows(nodes);
        setState({ status: 'ready', rows, pages: new Map() });
        void outlinePages(doc, rows, () => cancelled).then((pages) => {
          if (!cancelled) setState({ status: 'ready', rows, pages });
        });
      },
      (e: unknown) => {
        // A document that closes under the request is not an outline that failed to load; anything else is "no outline".
        if (cancelled) return;
        console.warn(`[pdf] outline failed: ${(e as Error)?.name ?? 'Error'}`);
        setState({ status: 'ready', rows: [], pages: new Map() });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [doc]);
  return state;
}

const ancestorsOf = (id: string): string[] => id.split('.').slice(0, -1).map((_, i, parts) => parts.slice(0, i + 1).join('.'));

/** The outline (spec 4.7): a searchable tree; a row goes to its destination, the one the reader is in is marked. */
export function OutlineTree() {
  const outline = useOutline();
  const handle = useReader((s) => s.handle);
  const page = useReader((s) => s.pdf?.pageNumber ?? 1);
  const [query, setQuery] = useState('');
  const [opened, setOpened] = useState<ReadonlySet<Key>>(new Set());

  const rows = outline.status === 'ready' ? outline.rows : [];
  const pages = outline.status === 'ready' ? outline.pages : new Map<string, number>();
  const current = useMemo(() => currentOutlineId(rows, pages, page), [rows, pages, page]);
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
    <TreeItem key={row.id} id={row.id} textValue={row.title} className="nav-row" style={indent} data-current-page={row.id === current ? 'true' : undefined} data-testid="pdf-outline-row">
      <TreeItemContent>
        {({ hasChildItems, isExpanded }) => (
          <>
            {hasChildItems && (
              <Button slot="chevron" className="disclosure">
                <Icon icon={isExpanded ? ChevronDown : ChevronRight} size="xs" />
              </Button>
            )}
            <span className="label ellipsis" title={row.title}>
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
      )}
    </>
  );
}
