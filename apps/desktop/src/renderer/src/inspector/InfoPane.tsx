import { useEffect, useMemo, type ReactNode } from 'react';
import { Files, MousePointer2 } from 'lucide-react';
import type { LibraryItem, TrashedItem } from '@learn/domain';
import { ApiError } from '../api';
import { useItem, useItemDetail, useItems } from '../data/queries';
import { sortItems } from '../library/sort';
import { useScopeViewContext } from '../library/ScopeViewContext';
import { useLibrarySettings } from '../library/useLibrarySettings';
import { EmptyCollectionPanel } from '../sidebar/EmptyCollectionPanel';
import { useLibrary } from '../state/library-store';
import { useShell } from '../state/shell-store';
import { t } from '../strings';
import { TranslationSection } from '../translation/TranslationSection';
import { useTrash, useViewItems } from '../trash/useTrashSource';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { PaneEmpty } from '../ui/PaneEmpty';
import { Spinner } from '../ui/Spinner';
import { useReader } from '../viewers/pdf/readerStore';
import { AddToCollectionButton } from './AddToCollectionButton';
import { CollectionsSection } from './CollectionsSection';
import { FileSection } from './FileSection';
import { InfoHead } from './InfoHead';
import { InfoSection } from './InfoSection';
import { ReadingSection } from './ReadingSection';
import { TagsSection } from './TagsSection';
import { TrashSelection } from './TrashInfo';
import { itemIcon } from '../library/itemIcon';
import { libraryStats, multiSummary } from './summary';
import { useShownAfter } from './useShownAfter';

const NO_ITEMS: readonly LibraryItem[] = [];
/** Titles a multiple selection lists before "외 N개" (spec §5.4). */
const MULTI_TITLES = 8;
/** A load shorter than this shows nothing (design-spec 6). */
const LOADING_DELAY_MS = 300;

/** Info mode: in the library from the table's selection (spec §5.3–5.4); in the reader the 번역 section, then the opened item (spec 6.2). */
export function InfoPane() {
  const view = useShell((s) => s.view);
  return view.kind === 'reader' ? <ReaderInfo itemId={view.itemId} /> : <LibraryInfo />;
}

/** The reader's panel: 번역 first, then the item that is open, with the library's own sections and editing (the 읽기 section is the library's). */
function ReaderInfo({ itemId }: { itemId: string }) {
  // The list's row names the item before its own read has come: a PDF that is opening shows its info at once (R39).
  const listed = useItems().data?.find((i) => i.id === itemId);
  const item = useItem(itemId).data ?? listed;
  // Until the pages are drawn the 번역 section is there but cannot be used (nothing is selected to translate yet).
  const opening = useReader((s) => s.pdf?.ready !== true);
  const translation = <TranslationSection disabled={opening} />;
  if (!item) return <div className="inspector-scroll">{translation}</div>;
  return <ItemInfo key={item.id} item={item} before={translation} inReader />;
}

/** The library's info mode, from the table's selection; an open edit keeps its item on show until it lets go. */
function LibraryInfo() {
  const list = useViewItems();
  const trash = useTrash().data;
  const items = list ?? NO_ITEMS;
  const { scope, model, scoped, label } = useScopeViewContext();
  const selected = useLibrary((s) => s.selected);
  const editingId = useLibrary((s) => s.editingId);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  // In list order: equal values keep the list order, so the multiple selection lists titles as the table does.
  const chosen = useMemo(() => (selected.size === 0 ? NO_ITEMS : items.filter((i) => selected.has(i.id))), [selected, items]);
  const editing = editingId === null ? undefined : byId.get(editingId);
  useEffect(() => {
    if (editingId !== null && !byId.has(editingId)) useLibrary.getState().setEditing(null); // the item left the library
  }, [editingId, byId]);
  // The trash view (spec 4.3): its rows read-only — one item's panel with 복원, or the rows' summary.
  if (scope.kind === 'trash') {
    const trashed = chosen as readonly TrashedItem[];
    const collections = trash ? trash.collections.filter((c) => selected.has(c.id)) : [];
    if (trashed.length + collections.length === 0) return <NoSelection label={label} items={scoped} collections={trash?.collections.length ?? 0} stats={list !== undefined} />;
    if (trashed.length === 1 && collections.length === 0) return <ItemInfo key={trashed[0]!.id} item={trashed[0]!} trashedAt={trashed[0]!.deletedAt} />;
    return <TrashSelection items={trashed} collections={collections} />;
  }
  if (editing) return <ItemInfo key={editing.id} item={editing} probe={selected.size <= 1} />;
  // An empty collection: its name and the day it was made instead of numbers that would all be zero (spec 3.6). Items only in a
  // sub-collection make it non-empty (scoped counts them).
  const viewed = scope.kind === 'collection' ? model?.node(scope.id) : undefined;
  if (chosen.length === 0 && viewed && scoped.length === 0 && list !== undefined) return <EmptyCollectionPanel name={viewed.name} createdAt={viewed.createdAt} />;
  if (chosen.length === 0) return <NoSelection label={label} items={scoped} stats={list !== undefined} />;
  if (chosen.length > 1) return <MultiSelection items={chosen} />;
  return <ItemInfo key={chosen[0]!.id} item={chosen[0]!} />;
}

/**
 * library.html?state=none: the empty-state format (design-spec 6; PaneEmpty on .pane-empty) and the
 * library's numbers in tertiary, last, in the slot after the text (no button there). Before the first list has come
 * there are no numbers to give (`stats` false): the text alone.
 */
function NoSelection({ label, items, collections = 0, stats: withStats }: { label: string; items: readonly LibraryItem[]; collections?: number; stats: boolean }) {
  const stats = useMemo(() => libraryStats(label, items, collections), [label, items, collections]);
  return (
    <PaneEmpty
      icon={MousePointer2}
      title={t.inspector.noneTitle}
      testId="inspector-none"
      action={
        withStats ? (
          <div className="pe-text pe-stats" data-testid="inspector-stats">
            {stats}
          </div>
        ) : undefined
      }
    >
      {t.inspector.noneBody}
    </PaneEmpty>
  );
}

/** library.html?state=multi without its M7 part (the tabs button): the kinds, the count, the titles, 컬렉션에 추가 ▾, the common tag and collection sections. */
function MultiSelection({ items }: { items: readonly LibraryItem[] }) {
  const { sort } = useLibrarySettings();
  // The table's own sort over the selected rows, which come in list order (ties keep it): the table's relative order.
  const shown = useMemo(() => sortItems(items, sort).slice(0, MULTI_TITLES), [items, sort]);
  const summary = useMemo(() => multiSummary(items), [items]);
  const ids = useMemo(() => items.map((i) => i.id), [items]);
  return (
    <div className="inspector-scroll" data-testid="inspector-multi">
      <header className="item-head">
        <div className="kind" data-testid="inspector-kind">
          <Icon icon={Files} size="sm" />
          <span className="num">{summary}</span>
        </div>
        <h2>{t.inspector.multiTitle(items.length)}</h2>
        <ul className="multi-list">
          {shown.map((i) => (
            <li key={i.id} className="multi-row" data-testid="multi-row">
              <Icon icon={itemIcon(i.type)} size="sm" />
              <span className="ellipsis" title={i.title}>
                {i.title}
              </span>
            </li>
          ))}
          {items.length > MULTI_TITLES && <li className="multi-more">{t.inspector.more(items.length - MULTI_TITLES)}</li>}
        </ul>
        <AddToCollectionButton ids={ids} />
      </header>
      <TagsSection ids={ids} />
      <CollectionsSection ids={ids} />
    </div>
  );
}

/** One item: the head at once from the list row, the sections when the item's detail has come (300 ms rule meanwhile). */
export function ItemInfo({ item, probe = true, trashedAt, before, inReader = false }: { item: LibraryItem; probe?: boolean; trashedAt?: string; before?: ReactNode; inReader?: boolean }) {
  const detail = useItemDetail(item.id);
  const ids = useMemo(() => [item.id], [item.id]);
  const loading = useShownAfter(detail.isPending, LOADING_DELAY_MS);
  useEffect(() => {
    if (detail.isError) console.warn(`[inspector] detail failed: ${detail.error instanceof ApiError ? detail.error.code : 'INTERNAL'}`);
  }, [detail.isError, detail.error]);
  return (
    <div className="inspector-scroll" data-testid="inspector-item" data-item-id={item.id}>
      {before}
      <InfoHead item={item} probe={probe} trashedAt={trashedAt} inReader={inReader} />
      {detail.data ? (
        <>
          {!inReader && trashedAt === undefined && <ReadingSection itemId={item.id} />}
          <InfoSection item={item} detail={detail.data} readOnly={trashedAt !== undefined} />
          <TagsSection ids={ids} readOnly={trashedAt !== undefined} />
          <CollectionsSection ids={ids} />
          <FileSection detail={detail.data} />
        </>
      ) : detail.isError ? (
        <div className="pane-empty top" data-testid="inspector-failed">
          <div className="pe-title">{t.inspector.detailFailed}</div>
          <div className="pe-text">{t.inspector.detailFailedBody}</div>
          <Button size="small" isPending={detail.isFetching} onPress={() => void detail.refetch()}>
            {t.common.retry}
          </Button>
        </div>
      ) : loading ? (
        <div className="pane-empty top" data-testid="inspector-loading">
          <div className="loading">
            <Spinner />
            {t.inspector.loading}
          </div>
        </div>
      ) : null}
    </div>
  );
}
