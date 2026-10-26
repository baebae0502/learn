import { useLayoutEffect, useRef, type KeyboardEvent } from 'react';
import type { OrganizeTag } from '@learn/domain';
import { t } from '../strings';
import { tagActions } from './actions';
import { tagColorVar } from './tagColor';
import { useTagEdit } from './tagEdit';

/** A key that belongs to a Korean composition: isComposing, or the keyCode 229 macOS IMEs send without it. */
const composing = (e: KeyboardEvent<HTMLInputElement>): boolean => e.nativeEvent.isComposing || e.keyCode === 229;

/**
 * The name being typed inside a tag chip (spec 4.1, 4.3): the whole name selected when it appears. ↩ saves, esc cancels, a
 * click elsewhere saves (as for a collection's name); a key a composition owns only finishes the syllable. The window
 * going to the background (a blur that is not the user's) does not save.
 */
export function TagNameField({ tag, invalid }: { tag: OrganizeTag; invalid?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const busy = useTagEdit((s) => s.busy);
  useLayoutEffect(() => {
    const input = ref.current;
    if (!input) return;
    input.focus({ preventScroll: true });
    input.select();
  }, []);
  return (
    <>
      {tag.position !== null && <i className="dot" style={{ background: tagColorVar(tag.position) }} aria-hidden="true" />}
      <input
        ref={ref}
        className="chip-input"
        data-testid="tag-rename-input"
        aria-label={t.organize.tags.nameLabel}
        aria-invalid={invalid || undefined}
        defaultValue={tag.name}
        readOnly={busy}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => useTagEdit.getState().setText(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (composing(e)) return;
          if (e.key === 'Enter') {
            e.preventDefault();
            void tagActions.finishRename(e.currentTarget.value, 'enter');
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            tagActions.cancelRename();
          }
        }}
        onBlur={(e) => {
          if (!document.hasFocus()) return;
          void tagActions.finishRename(e.currentTarget.value, 'blur');
        }}
      />
    </>
  );
}
