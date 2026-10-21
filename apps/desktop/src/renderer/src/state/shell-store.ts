import { create } from 'zustand';
import { SIDEBAR, type SidebarState } from '../shell/layout';

export type View = { kind: 'library' } | { kind: 'reader'; itemId: string };

export interface ShellState {
  view: View;
  sidebar: SidebarState;
  /** An import (dialog, copy, duplicate questions) is running: commands are disabled. */
  importing: boolean;
  /** The ⌘K palette is open (palette/Palette.tsx). */
  paletteOpen: boolean;
  /** What had the focus when this opening of the palette began (a picked command runs from it); null while closed. */
  paletteOpener: Element | null;
  setView(view: View): void;
  setSidebar(sidebar: SidebarState): void;
  setImporting(importing: boolean): void;
  /** Opening records the opener; closing forgets it. */
  setPaletteOpen(open: boolean, opener?: Element | null): void;
}

export const useShell = create<ShellState>()((set) => ({
  view: { kind: 'library' },
  sidebar: { width: SIDEBAR.default, collapsed: false, forceShown: false },
  importing: false,
  paletteOpen: false,
  paletteOpener: null,
  setView: (view) => set({ view }),
  setSidebar: (sidebar) => set({ sidebar }),
  setImporting: (importing) => set({ importing }),
  setPaletteOpen: (paletteOpen, opener = null) => set({ paletteOpen, paletteOpener: paletteOpen ? opener : null }),
}));
