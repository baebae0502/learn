import { ERROR_COPY, LearnError } from '@learn/domain';
import { mainStrings } from '../strings';
import type { TranslationEngine } from './engine';
import { isMostlyHangul, splitSentences } from './prepare';

export type FakeMode = 'ok' | 'offline' | 'rateLimited' | 'blocked' | 'unavailable' | 'badResponse' | 'slow';

const CANNED = new Map<string, string>(mainStrings.fakeTranslation.pairs);
const SLOW_MS = 1500;

const failure = (mode: FakeMode): LearnError | null => {
  switch (mode) {
    case 'offline': return new LearnError('TRANSLATION_OFFLINE', ERROR_COPY.translationOffline);
    case 'rateLimited': return new LearnError('TRANSLATION_RATE_LIMITED', ERROR_COPY.translationRateLimited);
    case 'blocked': return new LearnError('TRANSLATION_BLOCKED', ERROR_COPY.translationBlocked);
    case 'unavailable': return new LearnError('TRANSLATION_UNAVAILABLE', ERROR_COPY.translationUnavailable);
    case 'badResponse': return new LearnError('TRANSLATION_BAD_RESPONSE', ERROR_COPY.translationBadResponse);
    default: return null;
  }
};

/** The engine E2E runs on: no network, answers from a table, fails on request, and can be slow enough to cancel. */
export function createFakeEngine(): TranslationEngine & { setMode(mode: FakeMode): void; calls(): number } {
  let mode: FakeMode = 'ok';
  let calls = 0;
  return {
    id: 'fake',
    setMode: (m) => void (mode = m),
    calls: () => calls,
    async translate(text, opts, signal) {
      calls += 1;
      const failed = failure(mode);
      if (failed) throw failed;
      if (mode === 'slow') {
        await new Promise<void>((resolve, reject) => {
          const cancelled = () => reject(new LearnError('CANCELLED', ERROR_COPY.translationCancelled));
          if (signal.aborted) return cancelled();
          const timer = setTimeout(() => {
            signal.removeEventListener('abort', onAbort);
            resolve();
          }, SLOW_MS);
          const onAbort = () => {
            clearTimeout(timer);
            cancelled();
          };
          signal.addEventListener('abort', onAbort, { once: true });
        });
      }
      const translated = splitSentences(text).map((s) => CANNED.get(s) ?? `${mainStrings.fakeTranslation.unknownPrefix}${s}`).join(' ');
      return { text: translated, detectedFrom: opts.from === 'auto' ? (isMostlyHangul(text) ? 'ko' : 'en') : opts.from };
    },
  };
}
