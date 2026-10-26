import { create } from 'zustand';

/** What the sidebar is naming: a collection being created (under `parentId`, null = the top) or one being renamed. */
export type Edit =
  | { kind: 'new'; parentId: string | null; text: string; onCreated?: (collectionId: string) => void }
  | { kind: 'rename'; id: string; text: string };

export interface SidebarEditState {
  edit: Edit | null;
  /** What had the focus when the edit began: it gets the focus back when the edit ends. */
  opener: Element | null;
  /** The create or rename call is out: the field is read-only and nothing else finishes the edit. */
  busy: boolean;
  /** Set by `end`: the sidebar gives the focus back (to `opener` when it can) and clears this. */
  restoreTo: { opener: Element | null } | null;
  begin(edit: Edit, opener?: Element | null): void;
  setText(text: string): void;
  setBusy(busy: boolean): void;
  /** Ends the edit. `restore` (default): the sidebar gives the focus back to the opener; not after a click elsewhere, which already put it somewhere. */
  end(restore?: boolean): void;
  clearRestore(): void;
}

export const useSidebarEdit = create<SidebarEditState>()((set, get) => ({
  edit: null,
  opener: null,
  busy: false,
  restoreTo: null,
  begin: (edit, opener = null) => set({ edit, opener, busy: false, restoreTo: null }),
  setText: (text) => {
    const edit = get().edit;
    if (edit && edit.text !== text) set({ edit: { ...edit, text } });
  },
  setBusy: (busy) => set({ busy }),
  end: (restore = true) => {
    const { edit, opener } = get();
    if (edit) set({ edit: null, opener: null, busy: false, restoreTo: restore ? { opener } : null });
  },
  clearRestore: () => set({ restoreTo: null }),
}));
