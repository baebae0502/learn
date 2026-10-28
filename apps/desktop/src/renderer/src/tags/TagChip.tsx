import { X } from 'lucide-react';
import { useRef, type FocusEvent, type HTMLAttributes, type KeyboardEvent, type MouseEvent } from 'react';
import type { OrganizeTag } from '@learn/domain';
import { t } from '../strings';
import type { ForcedState } from '../ui/Button';
import { cx } from '../ui/cx';
import { Icon } from '../ui/Icon';
import { isContextMenuKey, isKeyMenuEcho, menuPointFor } from '../ui/contextMenuKey';
import { useChipStop } from './ChipGroup';
import { chipKeyAction, type ChipRole } from './chipKeys';
import { TagNameField } from './TagNameField';
import { tagColorVar } from './tagColor';
import { tooLongTagName } from './tagName';
import { useTagEdit } from './tagEdit';

export interface TagChipProps {
  tag: OrganizeTag;
  /** 'filter': the tag selector's chip (press / Space toggles the filter). 'assigned': a chip on an item (× / ⌫ removes). */
  role: ChipRole;
  on?: boolean;
  dim?: boolean;
  onToggle?: () => void;
  onRemove?: () => void;
  /** The drag and drop code passes RAC useDrag props here (hasDragButton: true); the keys it wants are composed with ours. */
  dragProps?: Record<string, unknown>;
  /** The chip is its name field (a filter chip being renamed). */
  editing?: boolean;
  /** ↩ on a filter chip. */
  onRename?: () => void;
  /** Right click, the menu key or ⇧F10 on a filter chip: where to open the tag's menu. */
  onMenu?: (at: { x: number; y: number }) => void;
  /** State board only. */
  force?: ForcedState[];
}

type DragSlot = Pick<HTMLAttributes<HTMLElement>, 'onKeyDown' | 'onFocus'> & Record<string, unknown>;

/** The chip while its name is typed: the pill is the field, the "too long" note under it (it takes a line of the cloud). */
function EditingChip({ tag, role }: { tag: OrganizeTag; role: ChipRole }) {
  const over = useTagEdit((s) => tooLongTagName(s.text));
  return (
    <>
      <span className="chip is-editing" data-role={role} data-testid={`tag-chip-editing-${tag.id}`}>
        <TagNameField tag={tag} invalid={over} />
      </span>
      {over && (
        <span className="chip-note" role="status" data-testid="tag-rename-note">
          {t.organize.tags.nameTooLong}
        </span>
      )}
    </>
  );
}

/**
 * A tag chip (design-spec 6 태그 칩; mockup .chip): a 22 px pill with the 8 px colour dot of a coloured tag and the name.
 * The pill holds the one control that is the chip — a button for a filter chip (aria-pressed), a focusable list item for an
 * assigned one, which does nothing when pressed and has × beside it. Both are stops of their ChipGroup (`data-chip-id`).
 */
export function TagChip(props: TagChipProps) {
  const { tag, role, on, dim, onToggle, onRemove, onRename, onMenu, editing, force, dragProps } = props;
  const stop = useChipStop(tag.id);
  const keyMenuAt = useRef<number | null>(null);
  if (editing) return <EditingChip tag={tag} role={role} />;

  const drag = (dragProps ?? {}) as DragSlot;
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    drag.onKeyDown?.(e);
    if (e.defaultPrevented) return;
    if (role === 'filter' && isContextMenuKey(e)) {
      e.preventDefault(); // not the browser's own menu event for the key (it would open the menu twice)
      keyMenuAt.current = performance.now();
      onMenu?.(menuPointFor(e.currentTarget));
      return;
    }
    const action = chipKeyAction(e, role);
    if (action?.kind === 'rename') {
      e.preventDefault(); // ↩ on a button would also press it
      onRename?.();
    } else if (action?.kind === 'remove') {
      e.preventDefault();
      onRemove?.();
    }
  };
  const common = {
    ...drag,
    className: 'chip-main',
    'data-testid': `tag-chip-${tag.id}`,
    'data-chip-id': tag.id,
    tabIndex: stop.tabIndex,
    onFocus: (e: FocusEvent<HTMLElement>) => {
      drag.onFocus?.(e);
      stop.onFocus();
    },
    onKeyDown,
  };
  const inner = (
    <>
      {tag.position !== null && <i className="dot" style={{ background: tagColorVar(tag.position) }} aria-hidden="true" />}
      <span className="chip-label ellipsis" title={tag.name}>
        {tag.name}
      </span>
      {/* The leading space keeps the name and the note from running together in the accessible name. */}
      {dim && <span className="visually-hidden">{` ${t.organize.tags.notInView}`}</span>}
    </>
  );
  return (
    <span className={cx('chip', on && 'is-on', dim && 'is-dim')} data-role={role} data-force={force?.join(' ')}>
      {role === 'filter' ? (
        <button
          type="button"
          {...common}
          aria-pressed={Boolean(on)}
          data-on={on ? '' : undefined}
          data-dim={dim ? '' : undefined}
          onClick={onToggle}
          onContextMenu={(e: MouseEvent<HTMLButtonElement>) => {
            e.preventDefault();
            if (isKeyMenuEcho(performance.now(), keyMenuAt.current)) return;
            onMenu?.({ x: e.clientX, y: e.clientY });
          }}
        >
          {inner}
        </button>
      ) : (
        <span role="listitem" {...common}>
          {inner}
        </span>
      )}
      {role === 'assigned' && (
        <button type="button" className="x" tabIndex={-1} aria-label={t.organize.tags.removeLabel(tag.name)} data-testid="tag-chip-remove" onClick={onRemove}>
          <Icon icon={X} size="xs" />
        </button>
      )}
    </span>
  );
}
