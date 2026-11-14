import { useEffect, useState } from 'react';
import { focusedSessionRow } from './SessionRow';

const isRow = (el: EventTarget | null): boolean => el instanceof HTMLElement && el.matches('[data-session-row]');

/**
 * Whether a session row of the sidebar has the focus (its name field does not count): the context ⌘⌫ is named and enabled by.
 * A row that leaves the page with the focus in it (its session deleted, the list gone) sends no blur, so while one has it the page
 * is watched for that.
 */
export function useSessionRowFocused(): boolean {
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    const onIn = (e: FocusEvent) => setFocused(isRow(e.target));
    // From one row to the next is no change; the focus in's own event says where it went.
    const onOut = (e: FocusEvent) => {
      if (!isRow(e.relatedTarget)) setFocused(false);
    };
    document.addEventListener('focusin', onIn);
    document.addEventListener('focusout', onOut);
    return () => {
      document.removeEventListener('focusin', onIn);
      document.removeEventListener('focusout', onOut);
    };
  }, []);
  useEffect(() => {
    if (!focused) return;
    const gone = new MutationObserver(() => {
      if (focusedSessionRow() === null) setFocused(false);
    });
    gone.observe(document.body, { childList: true, subtree: true });
    return () => gone.disconnect();
  }, [focused]);
  return focused;
}
