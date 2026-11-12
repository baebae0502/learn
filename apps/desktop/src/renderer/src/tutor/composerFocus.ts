import { FOCUS_REQUEST_MS } from '../shell/panelFocus';

/** The tutor panel's states, as useTutorPanelState names them. */
type PanelState = 'consent' | 'off' | 'chooser' | 'ready';

/**
 * The focus owed to the composer after 시작 was pressed in the chooser (the focus was in it): asked for once the same tab shows its
 * session — at once when main's prefs notice came before 시작 resolved, else at that state change. It is let go when another tab is
 * shown, when the panel goes another way than the session, or when the session has not come within the panel focus request's own bound:
 * a later session of this mount never takes the focus unasked.
 */
export function createComposerFocus(now: () => number = Date.now): { owe(tabId: string): void; step(state: PanelState, tabId: string): boolean } {
  let owed: { tabId: string; until: number } | null = null;
  return {
    owe: (tabId) => void (owed = { tabId, until: now() + FOCUS_REQUEST_MS }),
    /** Called whenever the panel's state or its tab changes; true when the panel is to ask for the composer's focus now. */
    step(state, tabId) {
      if (owed === null) return false;
      if (owed.tabId !== tabId || now() > owed.until) {
        owed = null;
        return false;
      }
      // main's notice that an agent is chosen is still to come.
      if (state === 'chooser') return false;
      owed = null;
      return state === 'ready';
    },
  };
}
