import { useEffect, useRef } from 'react';
import { api } from '../api';

/** The session on screen: this material and this session (null: a new empty one). */
export interface TutorViewKey {
  itemId: string;
  conversationId: string | null;
}

/** Whether two values name the same session: null with null is a window that shows none. */
export const sameTutorView = (a: TutorViewKey | null, b: TutorViewKey | null): boolean =>
  a === b || (a !== null && b !== null && a.itemId === b.itemId && a.conversationId === b.conversationId);

/**
 * Tells main which session is on screen (tutor:view), so an agent process for a session nobody looks at can close. Called once, in
 * MainWindow, with the active tab's value — the panel of each tab sending its own would let a hidden tab's null arrive after the new tab's
 * value. `null`: the tutor shows no session (the card, the off state, the chooser, 정보 mode, the library). Sent when the value changes,
 * so nothing is sent while it stays null: a window that never shows a session never calls main.
 */
export function useTutorView(key: TutorViewKey | null): void {
  const sent = useRef<TutorViewKey | null>(null);
  const itemId = key?.itemId ?? null;
  const conversationId = key?.conversationId ?? null;
  useEffect(() => {
    const next = itemId === null ? null : { itemId, conversationId };
    if (sameTutorView(sent.current, next)) return;
    sent.current = next;
    // A lost call only leaves main's idea of the view one step behind; log the code only.
    api().tutor.view({ view: next }).then(
      (r) => {
        if (!r.ok) console.warn(`[tutor] view failed: ${r.code}`);
      },
      () => console.warn('[tutor] view failed: INTERNAL'),
    );
  }, [itemId, conversationId]);
}
