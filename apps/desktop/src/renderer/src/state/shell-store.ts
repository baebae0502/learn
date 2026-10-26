import { create } from 'zustand';
import { INSPECTOR, SIDEBAR, type PaneState } from '../shell/layout';

export type View = { kind: 'library' } | { kind: 'reader'; itemId: string };

export interface ShellState {
  view: View;
  sidebar: PaneState;
  /** The item panel's width and the user's choice (one layout.panes record with the sidebar); its fold by width is layout.ts. */
  inspector: PaneState;
  /** An import (dialog, copy, duplicate questions) is running: commands are disabled. */
  importing: boolean;
  /** How many files the running import brings in, when that is known (a drop); null while a dialog picks them. */
  importCount: number | null;
  /** The ⌘K palette is open (palette/Palette.tsx). */
  paletteOpen: boolean;
  /** What had the focus when this opening of the palette began (a picked command runs from it); null while closed. */
  paletteOpener: Element | null;
  /** Files are being dragged over the window and the drop overlay covers it (shell/DropOverlay.tsx). */
  dropOverlay: boolean;
  setView(view: View): void;
  setSidebar(sidebar: PaneState): void;
  setInspector(inspector: PaneState): void;
  setImporting(importing: boolean, count?: number | null): void;
  /** Opening records the opener; closing forgets it. */
  setPaletteOpen(open: boolean, opener?: Element | null): void;
  setDropOverlay(shown: boolean): void;
}

export const useShell = create<ShellState>()((set) => ({
  view: { kind: 'library' },
  sidebar: { width: SIDEBAR.default, collapsed: false, forceShown: false },
  inspector: { width: INSPECTOR.default, collapsed: false, forceShown: false },
  importing: false,
  importCount: null,
  paletteOpen: false,
  paletteOpener: null,
  dropOverlay: false,
  setView: (view) => set({ view }),
  setSidebar: (sidebar) => set({ sidebar }),
  setInspector: (inspector) => set({ inspector }),
  setImporting: (importing, count = null) => set({ importing, importCount: importing ? count : null }),
  setPaletteOpen: (paletteOpen, opener = null) => set({ paletteOpen, paletteOpener: paletteOpen ? opener : null }),
  setDropOverlay: (dropOverlay) => set({ dropOverlay }),
}));
