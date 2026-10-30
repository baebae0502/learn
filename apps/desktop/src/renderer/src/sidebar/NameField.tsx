import { useLayoutEffect, useRef } from 'react';
import type { TreeState } from 'react-aria-components';
import { t } from '../strings';
import { collectionActions } from './actions';
import { tooLong } from './nameEdit';
import { useSidebarEdit } from './sidebarEdit';

/**
 * The name being typed inside a row (spec 3.4): the whole name selected when it appears. Its keys (↩, esc, and every other
 * key kept from the row) are decided above the tree (SidebarTree.onKeyDownCapture): a row handles Home/End and the arrows in
 * the capture phase, so the field's own handlers would never see them. Leaving it with a click saves the name, as ↩ does; the
 * window going to the background (a blur that is not the user's) does not.
 *
 * React Aria sends the focus back to the tree's focused row whenever it lands on something that is not a row — and while a key
 * was pressed last it does not make the row holding the field the focused one. So the row is made the focused one first, and
 * the tree is already focused when the field takes the focus.
 */
export function NameField({ initial, rowKey, state }: { initial: string; rowKey: string; state: TreeState<unknown> }) {
  const ref = useRef<HTMLInputElement>(null);
  const busy = useSidebarEdit((s) => s.busy);
  const over = useSidebarEdit((s) => (s.edit ? tooLong(s.edit.text) : false));
  useLayoutEffect(() => {
    const input = ref.current;
    if (!input) return;
    state.selectionManager.setFocused(true);
    state.selectionManager.setFocusedKey(rowKey);
    input.focus({ preventScroll: true });
    input.select();
    // Once per field: the row and its state are the ones it was mounted in.
  }, []);
  return (
    <>
      <input
        ref={ref}
        className="name-field"
        data-testid="rename-input"
        data-rename-input=""
        aria-label={t.organize.sidebar.nameLabel}
        aria-invalid={over || undefined}
        defaultValue={initial}
        readOnly={busy}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => useSidebarEdit.getState().setText(e.currentTarget.value)}
        onBlur={(e) => {
          if (!document.hasFocus()) return;
          void collectionActions.finish(e.currentTarget.value, 'blur');
        }}
      />
      {over && (
        <span className="rename-note" role="status" data-testid="rename-note">
          {t.organize.sidebar.nameTooLong}
        </span>
      )}
    </>
  );
}
