import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { useReaderScope } from '../viewers/readerScope';

/** What one reader tab's tutor panel keeps while the tab is open: memory only, never written (J44, J48). Later tasks add their fields here. 나중에 is not one: it is the run's (tutorRun.ts). */
export interface TutorTabStore {
  /** The session this tab's tutor shows; null is a new empty session. */
  conversationId: string | null;
  setConversation(id: string | null): void;
}

export function createTutorTabStore(): StoreApi<TutorTabStore> {
  return createStore<TutorTabStore>()((set) => ({
    conversationId: null,
    setConversation: (conversationId) => set({ conversationId }),
  }));
}

/** The tutor store of the reader around the component; outside any reader, the active tab's. */
export const useTutorTab = <T,>(select: (s: TutorTabStore) => T): T => useStore(useReaderScope().tutor, select);
