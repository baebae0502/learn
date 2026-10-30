import { create } from 'zustand';

export interface TagEditState {
  /** The tag whose chip is its name field, or null. */
  editingId: string | null;
  text: string;
  /** What had the focus when the edit began (kept for the focus to go back to when no chip can take it). */
  opener: Element | null;
  /** The rename call is out (or the merge sheet is up): the field is read-only and nothing else finishes the edit. */
  busy: boolean;
  /** Set by `end`: the selector gives the focus to this tag's chip (else the opener) and clears it. */
  restoreTo: { tagId: string | null; opener: Element | null } | null;
  begin(tagId: string, text: string, opener?: Element | null): void;
  setText(text: string): void;
  setBusy(busy: boolean): void;
  /** Ends the edit. `restore`: the tag whose chip gets the focus (default: this one; a merge hands it to the tag that remains), false after a click elsewhere, which already put it somewhere. */
  end(restore?: string | false): void;
  clearRestore(): void;
}

export const useTagEdit = create<TagEditState>()((set, get) => ({
  editingId: null,
  text: '',
  opener: null,
  busy: false,
  restoreTo: null,
  begin: (tagId, text, opener = null) => set({ editingId: tagId, text, opener, busy: false, restoreTo: null }),
  setText: (text) => {
    if (get().editingId !== null && get().text !== text) set({ text });
  },
  setBusy: (busy) => set({ busy }),
  end: (restore) => {
    const { editingId, opener } = get();
    if (editingId === null) return;
    set({ editingId: null, text: '', opener: null, busy: false, restoreTo: restore === false ? null : { tagId: restore ?? editingId, opener } });
  },
  clearRestore: () => set({ restoreTo: null }),
}));
