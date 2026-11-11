import { create } from 'zustand';

/**
 * ⌃⌘2 asks the tutor's panel for the focus. The panel may not be on screen yet (a folded slot opens a frame later, a mode switch
 * redraws), so the ask waits as a request that the panel takes when it can be focused, however long that takes.
 */
export const usePanelFocusRequest = create<{ pending: boolean; request(): void; done(): void }>()((set) => ({
  pending: false,
  request: () => set({ pending: true }),
  done: () => set({ pending: false }),
}));
