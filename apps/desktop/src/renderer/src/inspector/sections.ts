import { create } from 'zustand';

export type SectionId = 'info' | 'file';
interface SectionsState {
  open: Readonly<Record<SectionId, boolean>>;
  setOpen(id: SectionId, open: boolean): void;
}

/** Which item-panel sections are open: one choice for every item, kept for the session. */
export const useSections = create<SectionsState>()((set) => ({
  open: { info: true, file: true },
  setOpen: (id, open) => set((s) => ({ open: { ...s.open, [id]: open } })),
}));
