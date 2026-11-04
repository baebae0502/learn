import { create } from 'zustand';
import { ERROR_COPY, isTranslationTooLong, type ErrorCode, type TranslationPrefs } from '@learn/domain';
import { ApiError, api, unwrap } from '../api';
import { readTranslationPrefs, saveTranslationPrefs } from './prefs';

export type TranslationView =
  | { kind: 'idle' }
  | { kind: 'consent' }
  | { kind: 'off' }
  | { kind: 'pending' }
  | { kind: 'done'; text: string; detectedFrom: string | null; cached: boolean; sameLanguage: boolean }
  | { kind: 'error'; code: ErrorCode; message: string }
  | { kind: 'tooLong' };

interface TranslationState {
  /** The text in the 원문 box: the last selection, the selections joined (이어 붙이기) or what the user typed. */
  source: string;
  view: TranslationView;
  /** 이어 붙이기: not saved, off at every start. */
  concat: boolean;
  /** From the PDF selection: joined to the source when `concat` is on, else replacing it; then the consent and auto rules. */
  select(text: string): void;
  /** The user edited the source: it is not translated until 번역 is pressed. */
  setSource(text: string): void;
  translate(): Promise<void>;
  /** The consent and 선택하면 번역 rules for the source that is there (a selection brought again by the palette). */
  resume(): void;
  clear(): void;
  setConcat(on: boolean): void;
  /** Saves a change to the translation prefs; a refusal is shown as the error state. True when saved. */
  save(patch: Partial<TranslationPrefs>): Promise<boolean>;
  /** 번역 켜기 / 사용 안 함, from the pop-up and the section alike. */
  enable(): Promise<void>;
  decline(): Promise<void>;
  /** The translation preference changed while the reader is open (the settings window, the other side of a button): off ends what runs; on goes on from the consent. */
  prefsChanged(enabled: boolean | null): void;
  /** The reader closed: whatever is in flight is cancelled and no late reply is kept. */
  reset(): void;
}

/** What main says for a code: the shared sentence, so the pop-up and the section agree whatever the message carried. */
const COPY: Partial<Record<ErrorCode, string>> = {
  TRANSLATION_OFFLINE: ERROR_COPY.translationOffline,
  TRANSLATION_RATE_LIMITED: ERROR_COPY.translationRateLimited,
  TRANSLATION_BLOCKED: ERROR_COPY.translationBlocked,
  TRANSLATION_UNAVAILABLE: ERROR_COPY.translationUnavailable,
  TRANSLATION_BAD_RESPONSE: ERROR_COPY.translationBadResponse,
  TRANSLATION_DISABLED: ERROR_COPY.translationDisabled,
};

/** The request that is current; a reply for any other never touches the view. */
let seq = 0;
let inFlight = false;

/** Ends the request in flight at main; the reply it would have given is dropped by `seq`. */
function cancelInFlight(): void {
  seq += 1;
  if (!inFlight) return;
  inFlight = false;
  void api().translation.cancel();
}

export const useTranslation = create<TranslationState>()((set, get) => {
  const start = async (): Promise<void> => {
    const { source } = get();
    const text = source.trim();
    // A new request: whatever is in flight is superseded (main cancels it too, and the cache is checked after that).
    seq += 1;
    const mine = seq;
    if (text === '') {
      cancelInFlight();
      set({ view: { kind: 'idle' } });
      return;
    }
    if (isTranslationTooLong(text)) {
      cancelInFlight();
      set({ view: { kind: 'tooLong' } });
      return;
    }
    inFlight = true;
    set({ view: { kind: 'pending' } });
    const { from, to } = readTranslationPrefs();
    try {
      const r = await unwrap(api().translation.translate({ text: source, from, to }));
      if (mine !== seq) return;
      inFlight = false;
      set({ view: { kind: 'done', text: r.text, detectedFrom: r.detectedFrom, cached: r.cached, sameLanguage: r.sameLanguage } });
    } catch (e) {
      if (mine !== seq) return;
      inFlight = false;
      const code: ErrorCode = e instanceof ApiError ? e.code : 'INTERNAL';
      if (code === 'CANCELLED') set({ view: { kind: 'idle' } });
      else if (code === 'TRANSLATION_TOO_LONG') set({ view: { kind: 'tooLong' } });
      else set({ view: { kind: 'error', code, message: COPY[code] ?? (e instanceof ApiError ? e.message : ERROR_COPY.unknown) } });
    }
  };

  /** A refusal from the preferences store is said where the control is, as the error state. */
  const savePrefs = async (patch: Partial<TranslationPrefs>): Promise<boolean> => {
    try {
      await saveTranslationPrefs(patch);
      return true;
    } catch (e) {
      cancelInFlight();
      set({ view: { kind: 'error', code: e instanceof ApiError ? e.code : 'INTERNAL', message: e instanceof ApiError ? e.message : ERROR_COPY.unknown } });
      return false;
    }
  };

  /** The consent is given: the selection that is there is translated, or the view waits for one. */
  const proceed = async (): Promise<void> => {
    if (get().source.trim() !== '') await start();
    else set({ view: { kind: 'idle' } });
  };

  return {
    source: '',
    view: { kind: 'idle' },
    concat: false,
    select(text) {
      const { source, concat } = get();
      set({ source: concat && source.trim() !== '' ? `${source}\n${text}` : text });
      get().resume();
    },
    resume() {
      const prefs = readTranslationPrefs();
      if (prefs.enabled === null || prefs.enabled === false) {
        cancelInFlight();
        set({ view: { kind: prefs.enabled === null ? 'consent' : 'off' } });
        return;
      }
      if (prefs.autoOnSelect) void start();
      else {
        cancelInFlight();
        set({ view: { kind: 'idle' } });
      }
    },
    setSource(text) {
      cancelInFlight();
      set({ source: text, view: { kind: 'idle' } });
    },
    translate: start,
    clear() {
      cancelInFlight();
      set({ source: '', view: { kind: 'idle' } });
    },
    setConcat: (concat) => set({ concat }),
    save: savePrefs,
    async enable() {
      if (!(await savePrefs({ enabled: true }))) return;
      await proceed();
    },
    prefsChanged(enabled) {
      const { view } = get();
      if (enabled === false) {
        // The request in flight is ended at main and its late reply dropped; the pop-up has nothing to say while off.
        cancelInFlight();
        if (view.kind !== 'off') set({ view: { kind: 'off' } });
      } else if (enabled === true) {
        if (view.kind === 'consent') void proceed();
        else if (view.kind === 'off') set({ view: { kind: 'idle' } });
      }
    },
    async decline() {
      if (!(await savePrefs({ enabled: false }))) return;
      cancelInFlight();
      set({ view: { kind: 'off' } });
    },
    reset() {
      cancelInFlight();
      set({ source: '', view: { kind: 'idle' }, concat: false });
    },
  };
});
