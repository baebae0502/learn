import { useMemo } from 'react';
import { Clapperboard, FileText, Files, Folder, Trash2 } from 'lucide-react';
import { commandById, type TrashedCollection, type TrashedItem } from '@learn/domain';
import { useCommands } from '../commands/CommandProvider';
import type { CommandTarget } from '../commands/registry';
import { formatDate } from '../format';
import { sortItems } from '../library/sort';
import { useLibrarySettings } from '../library/useLibrarySettings';
import { t } from '../strings';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { useNow } from '../useNow';
import { multiSummary } from './summary';

/** Titles a multiple selection lists before "외 N개" (as InfoPane's). */
const MULTI_TITLES = 8;

/** 복원 in the panel head (the approved mockup: the default button, in 열기's place). */
export function RestoreButton({ target }: { target: CommandTarget }) {
  const { run, isEnabled } = useCommands();
  return (
    <Button variant="primary" testId="inspector-restore" isDisabled={!isEnabled('item.restore', target)} disabledReason={t.common.busy} onPress={() => run('item.restore', target)}>
      {commandById('item.restore').label}
    </Button>
  );
}

/** Under 복원: where the row is and since when; rows trashed at different times say only where. */
export function TrashNote({ at }: { at: string | null }) {
  const now = useNow();
  const text = at === null ? t.trash.panel.noteMixed : t.trash.panel.note(formatDate(at, now));
  return (
    <div className="trash-note" data-testid="trash-note">
      <Icon icon={Trash2} size="sm" />
      <span className="ellipsis" title={text}>
        {text}
      </span>
    </div>
  );
}

/**
 * Several trash rows, or one trashed collection (spec 4.3, dialogs.html?scene=purge's panel): read-only — the kinds and the
 * count, the titles, 복원 and the trash line; no tag or collection sections.
 */
export function TrashSelection({ items, collections }: { items: readonly TrashedItem[]; collections: readonly TrashedCollection[] }) {
  const { sort } = useLibrarySettings();
  const one = items.length === 0 && collections.length === 1 ? collections[0]! : undefined;
  const target = useMemo<CommandTarget>(() => ({ itemIds: items.map((i) => i.id), collectionIds: collections.map((c) => c.id) }), [items, collections]);
  const titles = useMemo(
    () => [
      ...collections.map((c) => ({ id: c.id, title: c.name, icon: Folder })),
      ...sortItems(items, sort).map((i) => ({ id: i.id, title: i.title, icon: i.type === 'video' ? Clapperboard : FileText })),
    ],
    [items, collections, sort],
  );
  const times = new Set([...items.map((i) => i.deletedAt), ...collections.map((c) => c.deletedAt)]);
  const kind = one
    ? t.trash.panel.collectionKind(one.itemCount)
    : [items.length > 0 ? multiSummary(items) : '', collections.length > 0 ? t.trash.panel.collections(collections.length) : ''].filter(Boolean).join(' · ');
  return (
    <div className="inspector-scroll" data-testid="inspector-trash">
      <header className="item-head">
        <div className="kind" data-testid="inspector-kind">
          <Icon icon={one ? Folder : Files} size="sm" />
          <span className="num">{kind}</span>
        </div>
        <h2>{one ? one.name : t.trash.panel.selected(items.length, collections.length)}</h2>
        {!one && (
          <ul className="multi-list">
            {titles.slice(0, MULTI_TITLES).map((row) => (
              <li key={row.id} className="multi-row" data-testid="multi-row">
                <Icon icon={row.icon} size="sm" />
                <span className="ellipsis" title={row.title}>
                  {row.title}
                </span>
              </li>
            ))}
            {titles.length > MULTI_TITLES && <li className="multi-more">{t.inspector.more(titles.length - MULTI_TITLES)}</li>}
          </ul>
        )}
        <div className="actions">
          <RestoreButton target={target} />
        </div>
        <TrashNote at={times.size === 1 ? [...times][0]! : null} />
      </header>
    </div>
  );
}
