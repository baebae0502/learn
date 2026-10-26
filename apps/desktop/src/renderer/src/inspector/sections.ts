import { create } from 'zustand';

export type SectionId = 'info' | 'tags' | 'collections' | 'file';
interface SectionsState {
  open: Readonly<Record<SectionId, boolean>>;
  setOpen(id: SectionId, open: boolean): void;
}

/** Which item-panel sections are open: one choice for every item, kept for the session. 태그 and 컬렉션 serve one item and several alike. */
export const useSections = create<SectionsState>()((set) => ({
  open: { info: true, tags: true, collections: true, file: true },
  setOpen: (id, open) => set((s) => ({ open: { ...s.open, [id]: open } })),
}));
