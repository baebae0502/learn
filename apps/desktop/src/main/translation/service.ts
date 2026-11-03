import { createHash } from 'node:crypto';
import { ERROR_COPY, LearnError, TRANSLATION_MAX_CHARS, nowIso, type Prefs, type TranslateInput, type TranslationResult } from '@learn/domain';
import type { TranslationCacheRepository } from '@learn/db';
import { mainStrings } from '../strings';
import type { TranslationEngine } from './engine';
import { isMostlyHangul, prepareText } from './prepare';

export interface TranslationService {
  translate(input: TranslateInput): Promise<TranslationResult>;
  /** Stops the request in flight: its caller gets CANCELLED. */
  cancel(): void;
}

export function createTranslationService(deps: {
  engine: TranslationEngine;
  cache(): Pick<TranslationCacheRepository, 'get' | 'put'>;
  prefs(): Prefs;
  now?: () => string;
}): TranslationService {
  const now = deps.now ?? nowIso;
  let current: AbortController | null = null;

  return {
    async translate(input) {
      // Nothing leaves the machine before the user has said yes, nor while it is switched off.
      if (deps.prefs().translation.enabled !== true) throw new LearnError('TRANSLATION_DISABLED', ERROR_COPY.translationDisabled);
      const text = prepareText(input.text);
      if (text === '') throw new LearnError('VALIDATION_FAILED', mainStrings.badRequest);
      if (text.length > TRANSLATION_MAX_CHARS) throw new LearnError('TRANSLATION_TOO_LONG', ERROR_COPY.translationTooLong);
      const { engine } = deps;
      if (input.to === 'ko' && isMostlyHangul(text)) return { text, detectedFrom: 'ko', engine: engine.id, cached: false, sameLanguage: true };

      const key = createHash('sha256').update(`${engine.id}\n${input.from}\n${input.to}\n${text}`).digest('hex');
      const hit = deps.cache().get(key, now());
      if (hit) return { text: hit.result, detectedFrom: hit.detected, engine: hit.engine, cached: true, sameLanguage: hit.detected === input.to };

      current?.abort();
      const mine = new AbortController();
      current = mine;
      try {
        const out = await engine.translate(text, { from: input.from, to: input.to }, mine.signal);
        if (mine.signal.aborted) throw new LearnError('CANCELLED', ERROR_COPY.translationCancelled);
        const at = now();
        deps.cache().put({ key, engine: engine.id, from: input.from, to: input.to, detected: out.detectedFrom, result: out.text, createdAt: at, usedAt: at });
        return { text: out.text, detectedFrom: out.detectedFrom, engine: engine.id, cached: false, sameLanguage: out.detectedFrom === input.to };
      } finally {
        if (current === mine) current = null;
      }
    },
    cancel() {
      current?.abort();
      current = null;
    },
  };
}
