import { ERROR_COPY, LearnError, type TranslationFrom, type TranslationLang } from '@learn/domain';
import type { TranslationEngine } from './engine';
import { splitForRequest } from './prepare';

const ENDPOINT = 'https://translate.googleapis.com/translate_a/single';
const OFFLINE_ERRORS = /ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_NETWORK_CHANGED|ERR_ADDRESS_UNREACHABLE/;
const bad = () => new LearnError('TRANSLATION_BAD_RESPONSE', ERROR_COPY.translationBadResponse);

/** The answer is [[[translated, original, ...], ...], null, detectedLanguage, ...] (recorded 2026-11-03, fixtures/translation). */
export function parseGoogleResponse(json: unknown): { text: string; detectedFrom: string | null } {
  if (!Array.isArray(json) || !Array.isArray(json[0])) throw bad();
  let text = '';
  for (const seg of json[0] as unknown[]) {
    if (!Array.isArray(seg) || typeof seg[0] !== 'string') throw bad();
    text += seg[0];
  }
  return { text, detectedFrom: typeof json[2] === 'string' ? json[2] : null };
}

/** The unofficial web endpoint: no key, no retries. A failed request is reported as it is; the user decides to ask again. */
export function createGoogleWebEngine(deps: { fetch(url: string, init: RequestInit): Promise<Response>; isOnline(): boolean; timeoutMs?: number }): TranslationEngine {
  const timeoutMs = deps.timeoutMs ?? 10_000;

  async function request(chunk: string, from: TranslationFrom, to: TranslationLang, signal: AbortSignal): Promise<{ text: string; detectedFrom: string | null }> {
    const cancelled = () => new LearnError('CANCELLED', ERROR_COPY.translationCancelled);
    if (signal.aborted) throw cancelled();
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), timeoutMs);
    try {
      const res = await deps.fetch(`${ENDPOINT}?client=gtx&sl=${from}&tl=${to}&dt=t`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: `q=${encodeURIComponent(chunk)}`,
        signal: AbortSignal.any([signal, timeout.signal]),
      });
      if (res.status === 429) throw new LearnError('TRANSLATION_RATE_LIMITED', ERROR_COPY.translationRateLimited);
      if (res.status >= 400 && res.status < 500) throw new LearnError('TRANSLATION_BLOCKED', ERROR_COPY.translationBlocked);
      if (!res.ok) throw new LearnError('TRANSLATION_UNAVAILABLE', ERROR_COPY.translationUnavailable);
      let json: unknown;
      try {
        json = await res.json();
      } catch (e) {
        if (signal.aborted || timeout.signal.aborted) throw e;
        throw bad();
      }
      return parseGoogleResponse(json);
    } catch (e) {
      if (e instanceof LearnError) throw e;
      if (signal.aborted) throw cancelled();
      if (timeout.signal.aborted) throw new LearnError('TRANSLATION_UNAVAILABLE', ERROR_COPY.translationUnavailable, { cause: e });
      if (!deps.isOnline() || OFFLINE_ERRORS.test(e instanceof Error ? e.message : String(e))) {
        throw new LearnError('TRANSLATION_OFFLINE', ERROR_COPY.translationOffline, { cause: e });
      }
      throw new LearnError('TRANSLATION_UNAVAILABLE', ERROR_COPY.translationUnavailable, { cause: e });
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    id: 'google-web',
    async translate(text, opts, signal) {
      let out = '';
      let detectedFrom: string | null = null;
      let first = true;
      for (const chunk of splitForRequest(text)) {
        const part = await request(chunk, opts.from, opts.to, signal);
        if (first) detectedFrom = part.detectedFrom;
        // The pieces were cut at sentence ends, where the blank between them was dropped.
        out += first || /\s$/.test(out) ? part.text : ` ${part.text}`;
        first = false;
      }
      return { text: out, detectedFrom };
    },
  };
}
