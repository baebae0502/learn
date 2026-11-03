import type { TranslationFrom, TranslationLang } from '@learn/domain';

/** Something that turns text into another language. The service knows no engine by name: it asks this. */
export interface TranslationEngine {
  readonly id: string;
  translate(text: string, opts: { from: TranslationFrom; to: TranslationLang }, signal: AbortSignal): Promise<{ text: string; detectedFrom: string | null }>;
}
