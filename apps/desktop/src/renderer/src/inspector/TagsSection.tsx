import { useMemo, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button as AriaButton } from 'react-aria-components';
import type { OrganizeTag } from '@learn/domain';
import { commonTags } from '../organize/common';
import { attachTag, detachTag, type TagPick } from '../organize/itemTags';
import { useOrganize } from '../organize/useOrganize';
import { t } from '../strings';
import { ChipGroup } from '../tags/ChipGroup';
import { TagAddField } from '../tags/TagAddField';
import { TagChip } from '../tags/TagChip';
import { IconButton } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { showToast } from '../ui/toasts';
import { Section } from './Section';
import { useSections } from './sections';

const failed = (e: unknown) => showToast({ kind: 'error', title: t.toast.actionFailed, body: e instanceof Error ? e.message : undefined, testId: 'action-error' });

/** Gives the keyboard to the chip of `tagId`, or to the add chip when there is none: a removed chip must not leave the focus on <body>. */
function focusAfterRemoval(root: HTMLElement | null, tagId: string | null): void {
  const chip = tagId === null ? null : root?.querySelector<HTMLElement>(`[data-testid="tag-chip-${tagId}"]`);
  const target = chip ?? root?.querySelector<HTMLElement>('[data-testid="tag-add-chip"]');
  (target?.matches('[tabindex]') ? target : (target?.querySelector<HTMLElement>('[tabindex]') ?? target))?.focus();
}

/**
 * 태그 (spec 6.1) for one item, 공통 태그 (spec 6.2) for several: the chips (coloured slots first, then by name), × and ⌫
 * take one off (from all of a selection), and the trailing outlined chip — or the plus beside the title, for one item —
 * opens the add field. Reads the snapshot only; a change is patched into it at once (organize/itemTags).
 */
export function TagsSection({ ids }: { ids: readonly string[] }) {
  const { model } = useOrganize();
  const [adding, setAdding] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const multi = ids.length > 1;
  const tags = useMemo<OrganizeTag[]>(() => (!model ? [] : multi ? commonTags(model, ids) : [...model.tagsOfItem(ids[0]!)]), [model, ids, multi]);
  const have = useMemo(() => new Set(tags.map((tag) => tag.id)), [tags]);
  // Without a snapshot (the read failed) there is nothing true to draw, and no control that cannot work.
  if (!model) return null;

  const open = () => {
    useSections.getState().setOpen('tags', true);
    setAdding(true);
  };
  const attach = async (pick: TagPick): Promise<boolean> => {
    try {
      await attachTag(ids, pick);
      return true;
    } catch (e) {
      failed(e);
      return false;
    }
  };
  const remove = (tag: OrganizeTag) => {
    const i = tags.findIndex((x) => x.id === tag.id);
    const neighbour = (tags[i + 1] ?? tags[i - 1])?.id ?? null;
    detachTag(ids, tag.id).then(() => requestAnimationFrame(() => focusAfterRemoval(root.current, neighbour)), failed);
  };
  const close = (by: 'key' | 'blur') => {
    setAdding(false);
    if (by === 'key') requestAnimationFrame(() => focusAfterRemoval(root.current, null));
  };
  const plus = multi ? undefined : <IconButton icon={Plus} size="small" label={t.organize.panel.tags.add} onPress={open} testId="tags-add" />;

  return (
    <Section id="tags" title={multi ? t.organize.panel.tags.commonTitle : t.organize.panel.tags.title} testId="tags-section" extra={plus}>
      <div ref={root}>
        {multi && tags.length === 0 && (
          <p className="info-hint" data-testid="tags-common-none">
            {t.organize.panel.tags.noCommon}
          </p>
        )}
        <div className="tag-line">
          {tags.length > 0 && (
            <ChipGroup role="list" label={t.organize.panel.tags.group}>
              {tags.map((tag) => (
                <TagChip key={tag.id} tag={tag} role="assigned" onRemove={() => remove(tag)} />
              ))}
            </ChipGroup>
          )}
          {!adding && (
            <AriaButton className="tag-add" data-testid="tag-add-chip" onPress={open}>
              <Icon icon={Plus} size="xs" />
              {multi ? t.organize.panel.tags.addAll : t.organize.panel.tags.add}
            </AriaButton>
          )}
        </div>
        {adding && <TagAddField tags={model.tags} exclude={have} label={multi ? t.organize.panel.tags.addAll : t.organize.panel.tags.add} onAttach={attach} onClose={close} />}
      </div>
    </Section>
  );
}
