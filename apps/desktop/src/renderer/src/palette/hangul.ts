// Korean palette matching: NFC substring, 초성 (initial consonant) and mixed queries (ADR-0005 §5).
const S_BASE = 0xac00;
const S_COUNT = 11172;
const N_COUNT = 588; // 21 vowels × 28 finals
const T_COUNT = 28;

export const CHOSEONG = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'] as const;
/** Final consonants (jongseong index) that can also start a syllable, as compatibility jamo. */
const FINAL_AS_INITIAL: Readonly<Record<number, string>> = {
  1: 'ㄱ', 2: 'ㄲ', 4: 'ㄴ', 7: 'ㄷ', 8: 'ㄹ', 16: 'ㅁ', 17: 'ㅂ', 19: 'ㅅ', 20: 'ㅆ', 21: 'ㅇ', 22: 'ㅈ', 23: 'ㅊ', 24: 'ㅋ', 25: 'ㅌ', 26: 'ㅍ', 27: 'ㅎ',
};

export type MatchKind = 'exact' | 'prefix' | 'word' | 'substring' | 'initials';
export interface Match {
  /** Code-point offsets into the NFC text. */
  start: number;
  end: number;
  kind: MatchKind;
}
export const MATCH_RANK: Readonly<Record<MatchKind, number>> = { exact: 0, prefix: 1, word: 2, substring: 3, initials: 4 };

const isSyllable = (c: number) => c >= S_BASE && c < S_BASE + S_COUNT;
export const isChoseong = (ch: string): boolean => (CHOSEONG as readonly string[]).includes(ch);

export function initialOf(ch: string): string {
  const c = ch.codePointAt(0) ?? 0;
  return isSyllable(c) ? CHOSEONG[Math.floor((c - S_BASE) / N_COUNT)]! : ch;
}

/** "갖" → ["가", "ㅈ"] (a syllable still being composed); null when there is no final that can start a syllable. */
export function splitFinal(ch: string): [string, string] | null {
  const c = ch.codePointAt(0) ?? 0;
  if (!isSyllable(c)) return null;
  const t = (c - S_BASE) % T_COUNT;
  const initial = FINAL_AS_INITIAL[t];
  return initial ? [String.fromCodePoint(c - t), initial] : null;
}

const chars = (s: string) => [...s.normalize('NFC').toLocaleLowerCase('ko-KR')];
export const WORD_START = /[\s(‘“/·-]/;

function find(query: readonly string[], text: readonly string[]): { start: number; literal: boolean } | null {
  for (let i = 0; i + query.length <= text.length; i++) {
    let literal = true;
    let ok = true;
    for (let j = 0; j < query.length; j++) {
      const q = query[j]!;
      const t = text[i + j]!;
      if (q === t) continue;
      if (isChoseong(q) && initialOf(t) === q) {
        literal = false;
        continue;
      }
      ok = false;
      break;
    }
    if (ok) return { start: i, literal };
  }
  return null;
}

export function matchKorean(query: string, text: string): Match | null {
  const q = chars(query.trim());
  if (q.length === 0) return null;
  const t = chars(text);
  const last = splitFinal(q.at(-1)!);
  const variants = last ? [q, [...q.slice(0, -1), ...last]] : [q];
  let best: Match | null = null;
  for (const v of variants) {
    const hit = find(v, t);
    if (!hit) continue;
    const end = hit.start + v.length;
    const kind: MatchKind = !hit.literal
      ? 'initials'
      : hit.start === 0 && end === t.length
        ? 'exact'
        : hit.start === 0
          ? 'prefix'
          : WORD_START.test(t[hit.start - 1]!)
            ? 'word'
            : 'substring';
    const m: Match = { start: hit.start, end, kind };
    if (!best || MATCH_RANK[m.kind] < MATCH_RANK[best.kind]) best = m;
  }
  return best;
}
