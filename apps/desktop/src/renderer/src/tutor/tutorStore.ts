import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { useReaderScope } from '../viewers/readerScope';

/** What one reader tab's tutor panel keeps while the tab is open: memory only, never written (J44, J48). Later tasks add their fields here. */
export interface TutorTabStore {
  /** The session this tab's tutor shows; null is a new empty session. */
  conversationId: string | null;
  /** 나중에 this run: the consent card gives way to the off state, and 튜터 켜기… brings the card back. */
  later: boolean;
  setConversation(id: string | null): void;
  setLater(on: boolean): void;
}

export function createTutorTabStore(): StoreApi<TutorTabStore> {
  return createStore<TutorTabStore>()((set) => ({
    conversationId: null,
    later: false,
    setConversation: (conversationId) => set({ conversationId }),
    setLater: (later) => set({ later }),
  }));
}

/** The tutor store of the reader around the component; outside any reader, the active tab's. */
export const useTutorTab = <T,>(select: (s: TutorTabStore) => T): T => useStore(useReaderScope().tutor, select);
