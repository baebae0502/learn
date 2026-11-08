import { create } from 'zustand';
import { INSPECTOR, SIDEBAR, type PaneState } from '../shell/layout';
import * as T from './tabs';
import { NO_TABS, type KnownTabItem, type KnownTabItems, type TabId, type TabsState } from './tabs';

export type View = { kind: 'library' } | { kind: 'reader'; itemId: string };

export interface ShellState {
  /** Follows the active tab (the tab actions are its only writers). */
  view: View;
  tabs: TabsState;
  openTab(itemId: string, o?: { background?: boolean }): void;
  openTabs(itemIds: readonly string[], o?: { background?: boolean }): void;
  selectTab(id: TabId): void;
  selectTabAt(index: number): void;
  selectLastTab(): void;
  selectRelativeTab(delta: 1 | -1): void;
  closeTab(id: string): void;
  closeOtherTabs(id: string): void;
  reopenClosedTab(isOpenable: (id: string) => boolean): void;
  moveTab(id: string, toIndex: number): void;
  removeTab(id: string): void;
  restoreTabs(saved: TabsState, known?: KnownTabItems): void;
  /** Each reader tab's last known name and kind: what the strip shows until the item itself is known, and what the session record carries (R38). */
  known: KnownTabItems;
  noteTabItem(itemId: string, item: KnownTabItem): void;
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
  setSidebar(sidebar: PaneState): void;
  setInspector(inspector: PaneState): void;
  /** Opening records the opener; closing forgets it. */
  setPaletteOpen(open: boolean, opener?: Element | null): void;
  setDropOverlay(shown: boolean): void;
}

const viewOf = (tabs: TabsState): View => (tabs.active === 'library' ? { kind: 'library' } : { kind: 'reader', itemId: tabs.active });

export const useShell = create<ShellState>()((set) => {
  // The view is written here and nowhere else, so it cannot disagree with the active tab.
  const change = (fn: (t: TabsState) => TabsState) =>
    set((st) => {
      const tabs = fn(st.tabs);
      return tabs === st.tabs ? st : { tabs, view: viewOf(tabs) };
    });
  return {
    view: { kind: 'library' },
    tabs: NO_TABS,
    openTab: (id, o) => change((t) => T.openTab(t, id, o)),
    openTabs: (ids, o) => change((t) => T.openTabs(t, ids, o)),
    selectTab: (id) => change((t) => T.selectTab(t, id)),
    selectTabAt: (i) => change((t) => T.selectTabAt(t, i)),
    selectLastTab: () => change(T.selectLastTab),
    selectRelativeTab: (d) => change((t) => T.selectRelativeTab(t, d)),
    closeTab: (id) => change((t) => T.closeTab(t, id)),
    closeOtherTabs: (id) => change((t) => T.closeOtherTabs(t, id)),
    reopenClosedTab: (ok) => change((t) => T.reopenClosedTab(t, ok)),
    moveTab: (id, i) => change((t) => T.moveTab(t, id, i)),
    removeTab: (id) => change((t) => T.removeTab(t, id)),
    restoreTabs: (saved, known = {}) => set({ tabs: saved, view: viewOf(saved), known }),
    known: {},
    noteTabItem: (itemId, item) =>
      set((st) => {
        const was = st.known[itemId];
        return was && was.title === item.title && was.type === item.type ? st : { known: { ...st.known, [itemId]: item } };
      }),
    sidebar: { width: SIDEBAR.default, collapsed: false, forceShown: false },
    inspector: { width: INSPECTOR.default, collapsed: false, forceShown: false },
    paletteOpen: false,
    paletteOpener: null,
    dropOverlay: false,
    sheetAsks: 0,
    countSheetAsk: (delta) => set((s) => ({ sheetAsks: Math.max(0, s.sheetAsks + delta) })),
    setSidebar: (sidebar) => set({ sidebar }),
    setInspector: (inspector) => set({ inspector }),
    setPaletteOpen: (paletteOpen, opener = null) => set({ paletteOpen, paletteOpener: paletteOpen ? opener : null }),
    setDropOverlay: (dropOverlay) => set({ dropOverlay }),
  };
});
