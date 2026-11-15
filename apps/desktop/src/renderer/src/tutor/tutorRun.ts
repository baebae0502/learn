import { create } from 'zustand';

/** What the tutor keeps for the whole run, in every reader tab alike: memory only, never saved (spec 8.2 "이번 실행 동안"). */
interface TutorRun {
  /** 나중에: the consent card gives way to the off state in every tab; 튜터 켜기… brings the card back in every tab. */
  later: boolean;
  setLater(on: boolean): void;
}

export const useTutorRun = create<TutorRun>()((set) => ({ later: false, setLater: (later) => set({ later }) }));
