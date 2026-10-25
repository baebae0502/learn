import { useEffect, useMemo } from 'react';
import { Clapperboard, FileText, Files, MousePointer2 } from 'lucide-react';
import type { LibraryItem } from '@learn/domain';
import { ApiError } from '../api';
import { useItemDetail, useItems } from '../data/queries';
import { sortItems } from '../library/sort';
import { useLibrarySettings } from '../library/useLibrarySettings';
import { useLibrary } from '../state/library-store';
import { t } from '../strings';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { PaneEmpty } from '../ui/PaneEmpty';
import { Spinner } from '../ui/Spinner';
import { FileSection } from './FileSection';
import { InfoHead } from './InfoHead';
import { InfoSection } from './InfoSection';
import { libraryStats, multiSummary } from './summary';
import { useShownAfter } from './useShownAfter';

const NO_ITEMS: readonly LibraryItem[] = [];
/** Titles a multiple selection lists before "외 N개" (spec §5.4). */
const MULTI_TITLES = 8;
/** A load shorter than this shows nothing (design-spec 6). */
const LOADING_DELAY_MS = 300;

/** Info mode (spec §5.3–5.4), from the table's selection; an open edit keeps its item on show until it lets go. */
export function InfoPane() {
  const list = useItems().data;
  const items = list ?? NO_ITEMS;
  const selected = useLibrary((s) => s.selected);
  const editingId = useLibrary((s) => s.editingId);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  // In list order: equal values keep the list order, so the multiple selection lists titles as the table does.
  const chosen = useMemo(() => (selected.size === 0 ? NO_ITEMS : items.filter((i) => selected.has(i.id))), [selected, items]);
  const editing = editingId === null ? undefined : byId.get(editingId);
  useEffect(() => {
    if (editingId !== null && !byId.has(editingId)) useLibrary.getState().setEditing(null); // the item left the library
  }, [editingId, byId]);
  if (editing) return <ItemInfo key={editing.id} item={editing} />;
  if (chosen.length === 0) return <NoSelection items={items} stats={list !== undefined} />;
  if (chosen.length > 1) return <MultiSelection items={chosen} />;
  return <ItemInfo key={chosen[0]!.id} item={chosen[0]!} />;
}

/**
 * library.html?state=none: the empty-state format (design-spec 6; PaneEmpty on .pane-empty) and the
 * library's numbers in tertiary, last, in the slot after the text (no button there). Before the first list has come
 * there are no numbers to give (`stats` false): the text alone.
 */
function NoSelection({ items, stats: withStats }: { items: readonly LibraryItem[]; stats: boolean }) {
  const stats = useMemo(() => libraryStats(items), [items]);
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

/** library.html?state=multi without its M5/M7 parts (no action buttons, no common sections): the kinds, the count, the titles. */
function MultiSelection({ items }: { items: readonly LibraryItem[] }) {
  const { sort } = useLibrarySettings();
  // The table's own sort over the selected rows, which come in list order (ties keep it): the table's relative order.
  const shown = useMemo(() => sortItems(items, sort).slice(0, MULTI_TITLES), [items, sort]);
  const summary = useMemo(() => multiSummary(items), [items]);
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
              <Icon icon={i.type === 'video' ? Clapperboard : FileText} size="sm" />
              <span className="ellipsis" title={i.title}>
                {i.title}
              </span>
            </li>
          ))}
          {items.length > MULTI_TITLES && <li className="multi-more">{t.inspector.more(items.length - MULTI_TITLES)}</li>}
        </ul>
      </header>
    </div>
  );
}

/** One item: the head at once from the list row, the sections when the item's detail has come (300 ms rule meanwhile). */
export function ItemInfo({ item }: { item: LibraryItem }) {
  const detail = useItemDetail(item.id);
  const loading = useShownAfter(detail.isPending, LOADING_DELAY_MS);
  useEffect(() => {
    if (detail.isError) console.warn(`[inspector] detail failed: ${detail.error instanceof ApiError ? detail.error.code : 'INTERNAL'}`);
  }, [detail.isError, detail.error]);
  return (
    <div className="inspector-scroll" data-testid="inspector-item" data-item-id={item.id}>
      <InfoHead item={item} />
      {detail.data ? (
        <>
          <InfoSection item={item} detail={detail.data} />
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
