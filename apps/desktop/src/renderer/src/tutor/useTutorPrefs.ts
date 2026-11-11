import { DEFAULT_TUTOR_PREFS, type TutorPrefs } from '@learn/domain';
import { usePrefs } from '../data/queries';

/** The tutor's device prefs as main last pushed them (prefs:get, then prefsChanged). Read only: main writes consent (tutor:consent), never the page (J9). */
export function useTutorPrefs(): TutorPrefs {
  return usePrefs().data?.tutor ?? DEFAULT_TUTOR_PREFS;
}
