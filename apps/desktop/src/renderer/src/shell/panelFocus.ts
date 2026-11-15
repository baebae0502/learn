import { create } from 'zustand';
import { useShell } from '../state/shell-store';

/** How long a request waits for the panel to be able to take the focus: a slot that is opening takes a few frames, not seconds. */
export const FOCUS_REQUEST_MS = 2000;
let expiry: ReturnType<typeof setTimeout> | undefined;

/**
 * ⌃⌘2 asks the tutor's panel for the focus. The panel may not be on screen yet (a folded slot opens a frame later, a mode switch
 * redraws), so the ask waits as a request that the panel takes when it can be focused. It ends when the panel answers (`done`), when the
 * panel goes away (`done` on unmount), when another tab is shown, or — as a backstop — when it has waited FOCUS_REQUEST_MS: a request that
 * can never land (a window too narrow for the panel) must not wait for a later mount of the panel and take the focus unasked.
 */
export const usePanelFocusRequest = create<{ pending: boolean; request(): void; done(): void }>()((set) => ({
  pending: false,
  request: () => {
    clearTimeout(expiry);
    expiry = setTimeout(() => set({ pending: false }), FOCUS_REQUEST_MS);
    set({ pending: true });
  },
  done: () => {
    clearTimeout(expiry);
    set({ pending: false });
  },
}));

// The request was made for the tab that was shown: another tab's panel is not what it asked for.
useShell.subscribe((state, previous) => {
  if (state.tabs.active !== previous.tabs.active) usePanelFocusRequest.getState().done();
});
