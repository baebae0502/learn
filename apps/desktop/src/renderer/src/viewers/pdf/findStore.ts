import { create } from 'zustand';

/** Where the search stands (pdf.js FindState): a wrap is told once, for a moment. */
export type FindStatus = 'idle' | 'found' | 'notFound' | 'wrapped';
export interface FindMatches {
  current: number;
  total: number;
}

interface FindStore {
  open: boolean;
  status: FindStatus;
  /** Counts up with every report, so two wraps in a row each get their own two seconds. */
  reports: number;
  matches: FindMatches | null;
  report(status: FindStatus, matches: FindMatches | null): void;
  /** What the field holds; ⌘G with the bar closed goes on with it. */
  query: string;
  /** Counts up whenever the bar asks for the field's focus (⌘F again, ⌘E): the field takes it and selects its text. */
  focusSeq: number;
  /** Opens the bar (and, with `query`, puts a text in the field). */
  openBar(query?: string): void;
  closeBar(): void;
  setQuery(query: string): void;
  reset(): void;
}

export const useFind = create<FindStore>()((set) => ({
  open: false,
  status: 'idle',
  reports: 0,
  matches: null,
  report: (status, matches) => set((s) => ({ status, matches, reports: s.reports + 1 })),
  query: '',
  focusSeq: 0,
  openBar: (query) => set((s) => ({ open: true, focusSeq: s.focusSeq + 1, ...(query === undefined ? {} : { query }) })),
  closeBar: () => set({ open: false }),
  setQuery: (query) => set({ query }),
  reset: () => set({ open: false, query: '', status: 'idle', matches: null }),
}));
