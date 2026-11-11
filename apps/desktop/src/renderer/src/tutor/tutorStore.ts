import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { useReaderScope } from '../viewers/readerScope';

/** What one reader tab's tutor panel keeps while the tab is open: memory only, never written (J44, J48). Later tasks add their fields here. 나중에 is not one: it is the run's (tutorRun.ts). */
export interface TutorTabStore {
  /** The session this tab's tutor shows; null is a new empty session. */
  conversationId: string | null;
  setConversation(id: string | null): void;
  /** 에이전트 고르기…: the chooser shows although an agent is chosen, until one is started or the tab closes. */
  choosing: boolean;
  setChoosing(on: boolean): void;
}

export function createTutorTabStore(): StoreApi<TutorTabStore> {
  return createStore<TutorTabStore>()((set) => ({
    conversationId: null,
    setConversation: (conversationId) => set({ conversationId }),
    choosing: false,
    setChoosing: (choosing) => set({ choosing }),
  }));
}

/** The tutor store of the reader around the component; outside any reader, the active tab's. */
export const useTutorTab = <T,>(select: (s: TutorTabStore) => T): T => useStore(useReaderScope().tutor, select);
