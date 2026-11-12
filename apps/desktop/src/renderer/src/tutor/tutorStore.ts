import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { useReaderScope } from '../viewers/readerScope';
import type { LiveTurn } from './useSessionThread';

/**
 * Where a tab's session is kept while the window lives, so a reload of the window (spec 12: "새로 고침") shows it again: this window's
 * sessionStorage, which a new window — a new run — does not have (a new run starts on a new empty session).
 */
const KEPT = 'learn.tutor.session.';
const storage = (): Storage | null => {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
};
function keptSession(tabId: string): string | null {
  if (tabId === '') return null;
  try {
    return storage()?.getItem(KEPT + tabId) ?? null;
  } catch {
    return null;
  }
}
function keepSession(tabId: string, conversationId: string | null): void {
  if (tabId === '') return;
  try {
    if (conversationId === null) storage()?.removeItem(KEPT + tabId);
    else storage()?.setItem(KEPT + tabId, conversationId);
  } catch {
    // A refused storage only loses the session at a reload; the tab keeps it in memory.
  }
}
/** The tab closed (or its item is gone): the session it showed is not its any more. */
export const forgetTutorTab = (tabId: string): void => keepSession(tabId, null);

/** Where a session's draft is kept in its tab: under the session, or for a new empty one under its item. */
export const draftKey = (conversationId: string | null, itemId: string): string => conversationId ?? `new:${itemId}`;

/**
 * A question sent while another session's answer still came (tutor:ask's { busyWith }; one agent process at a time): it is sent once
 * that answer ends.
 */
export interface WaitingQuestion {
  text: string;
  busyWith: { conversationId: string; messageId: string };
  /** That answer's end notice came while this tab's status read was out: the read's caller sends the question, whatever it read. */
  ended?: true;
}

/**
 * What one reader tab's tutor panel keeps while the tab is open: in memory, but for the session it shows, which also
 * survives a reload of the window. 나중에 is not one of them: it is the run's (tutorRun.ts).
 */
export interface TutorTabStore {
  /** The session this tab's tutor shows; null is a new empty session. */
  conversationId: string | null;
  /** Another session (null: a new empty one): the live answer of the one before goes with it, and a question that waited is let go. */
  setConversation(id: string | null): void;
  /** 에이전트 고르기…: the chooser shows although an agent is chosen, until one is started or the tab closes. */
  choosing: boolean;
  setChoosing(on: boolean): void;
  /** The answer of this tab's session still coming, as the window hears it (tutor:turn); null once the stored thread has it. */
  live: LiveTurn | null;
  setLive(live: LiveTurn | null): void;
  /**
   * The chip the reader was sent to by a press, ringed while the reader shows its page: `key` names the chip (its message and its
   * place there), `shown` turns true once the reader is on the page, and the ring goes when the reader leaves it afterwards.
   */
  currentCite: CurrentCite | null;
  setCurrentCite(c: CurrentCite | null): void;
  /**
   * What the composer holds for each session of the tab, by draftKey: kept while the tab is open, across tabs, modes and
   * sessions, in memory only — a reload or a new run starts without them.
   */
  drafts: Record<string, string>;
  /** An empty text removes the draft. */
  setDraft(key: string, text: string): void;
  /** The question that waits for another session's answer; its text stays in the composer, read only, until then. */
  waiting: WaitingQuestion | null;
  setWaiting(w: WaitingQuestion | null): void;
}

export interface CurrentCite {
  key: string;
  pageIndex: number;
  /** The revision of the document the chip sent the reader to: the ring is drawn only while the tab shows that revision. */
  revisionId: string | null;
  shown: boolean;
}

/** The chip to ring: the current one, while the tab's document is the revision it sent the reader to. */
export function ringedChip(current: CurrentCite | null, revisionId: string | null): string | null {
  return current !== null && revisionId !== null && current.revisionId === revisionId ? current.key : null;
}

/** `tabId`: the tab's item id, under which its session is kept for a reload ('' keeps nothing). */
export function createTutorTabStore(tabId = ''): StoreApi<TutorTabStore> {
  return createStore<TutorTabStore>()((set, get) => ({
    conversationId: keptSession(tabId),
    setConversation: (conversationId) => {
      if (get().conversationId === conversationId) return;
      keepSession(tabId, conversationId);
      set({ conversationId, live: null, currentCite: null, waiting: null });
    },
    choosing: false,
    setChoosing: (choosing) => set({ choosing }),
    live: null,
    setLive: (live) => set({ live }),
    currentCite: null,
    setCurrentCite: (currentCite) => set({ currentCite }),
    drafts: {},
    setDraft: (key, text) =>
      set(({ drafts }) => {
        if ((drafts[key] ?? '') === text) return {};
        const { [key]: _gone, ...rest } = drafts;
        return { drafts: text === '' ? rest : { ...rest, [key]: text } };
      }),
    waiting: null,
    setWaiting: (waiting) => set({ waiting }),
  }));
}

/** The tutor store of the reader around the component; outside any reader, the active tab's. */
export const useTutorTab = <T,>(select: (s: TutorTabStore) => T): T => useStore(useReaderScope().tutor, select);
