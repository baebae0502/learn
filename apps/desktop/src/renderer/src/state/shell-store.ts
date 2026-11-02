import { create } from 'zustand';
import { INSPECTOR, SIDEBAR, type PaneState } from '../shell/layout';

export type View = { kind: 'library' } | { kind: 'reader'; itemId: string };

export interface ShellState {
  view: View;
  sidebar: PaneState;
  /** The item panel's width and the user's choice (one layout.panes record with the sidebar); its fold by width is layout.ts. */
  inspector: PaneState;
  /** The ⌘K palette is open (palette/Palette.tsx). */
  paletteOpen: boolean;
  /** What had the focus when this opening of the palette began (a picked command runs from it); null while closed. */
  paletteOpener: Element | null;
  /** Files are being dragged over the window and the drop overlay covers it (shell/DropOverlay.tsx). */
  dropOverlay: boolean;
  /** Questions main is asking in one of our sheets (the purge sheet): the window is held as for ⌘/ (ui/sheetAsk.ts). */
  sheetAsks: number;
  countSheetAsk(delta: 1 | -1): void;
  setView(view: View): void;
  setSidebar(sidebar: PaneState): void;
  setInspector(inspector: PaneState): void;
  /** Opening records the opener; closing forgets it. */
  setPaletteOpen(open: boolean, opener?: Element | null): void;
  setDropOverlay(shown: boolean): void;
}

export const useShell = create<ShellState>()((set) => ({
  view: { kind: 'library' },
  sidebar: { width: SIDEBAR.default, collapsed: false, forceShown: false },
  inspector: { width: INSPECTOR.default, collapsed: false, forceShown: false },
  paletteOpen: false,
  paletteOpener: null,
  dropOverlay: false,
  sheetAsks: 0,
  countSheetAsk: (delta) => set((s) => ({ sheetAsks: Math.max(0, s.sheetAsks + delta) })),
  setView: (view) => set({ view }),
  setSidebar: (sidebar) => set({ sidebar }),
  setInspector: (inspector) => set({ inspector }),
  setPaletteOpen: (paletteOpen, opener = null) => set({ paletteOpen, paletteOpener: paletteOpen ? opener : null }),
  setDropOverlay: (dropOverlay) => set({ dropOverlay }),
}));
