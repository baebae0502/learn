import { TRANSLATION_CHUNK_CHARS } from '@learn/domain';

/** What a PDF selection becomes before it is sent (and cached under): a word broken at a line end is joined, the rest is one line. */
export function prepareText(raw: string): string {
  return raw
    .normalize('NFC')
    .replace(/(?<=\p{L})-\r?\n(?=\p{L})/gu, '')
    .replace(/\r?\n/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

const SENTENCE_END = /(?<=[.!?。！？])\s+/;

/** The sentences of a prepared text. */
export function splitSentences(text: string): string[] {
  return text.split(SENTENCE_END).filter((s) => s !== '');
}

/** Whole sentences gathered into pieces of at most `max`; a sentence longer than that is cut at `max`. */
export function splitForRequest(text: string, max: number = TRANSLATION_CHUNK_CHARS): string[] {
  const pieces: string[] = [];
  let current = '';
  const flush = () => {
    if (current !== '') pieces.push(current);
    current = '';
  };
  for (const sentence of splitSentences(text)) {
    if (sentence.length > max) {
      flush();
      for (let i = 0; i < sentence.length; i += max) pieces.push(sentence.slice(i, i + max));
    } else if (current === '') current = sentence;
    else if (current.length + 1 + sentence.length <= max) current += ` ${sentence}`;
    else {
      flush();
      current = sentence;
    }
  }
  flush();
  return pieces;
}

/** Korean already: 60 percent or more of the letters are Hangul. */
export function isMostlyHangul(text: string): boolean {
  const letters = text.match(/\p{L}/gu)?.length ?? 0;
  if (letters === 0) return false;
  const hangul = text.match(/\p{Script=Hangul}/gu)?.length ?? 0;
  return hangul / letters >= 0.6;
}
