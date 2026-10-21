import { create } from 'zustand';
import { SIDEBAR, type SidebarState } from '../shell/layout';

export type View = { kind: 'library' } | { kind: 'reader'; itemId: string };

export interface ShellState {
  view: View;
  sidebar: SidebarState;
  /** An import (dialog, copy, duplicate questions) is running: commands are disabled. */
  importing: boolean;
  setView(view: View): void;
  setSidebar(sidebar: SidebarState): void;
  setImporting(importing: boolean): void;
}

export const useShell = create<ShellState>()((set) => ({
  view: { kind: 'library' },
  sidebar: { width: SIDEBAR.default, collapsed: false, forceShown: false },
  importing: false,
  setView: (view) => set({ view }),
  setSidebar: (sidebar) => set({ sidebar }),
  setImporting: (importing) => set({ importing }),
}));
