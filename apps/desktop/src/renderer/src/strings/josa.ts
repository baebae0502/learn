/** Does each digit's Korean reading end in a final consonant (영 일 이 삼 사 오 육 칠 팔 구)? */
const DIGIT_FINAL = [true, true, false, true, false, false, true, true, true, false];
/** Which of those end in ㄹ (일 칠 팔): 으로 is 로 after it. */
const DIGIT_RIEUL = [false, true, false, false, false, false, false, true, true, false];

/**
 * What a particle after `word` depends on: whether its last letter ends in a final consonant, and whether that is ㄹ.
 * Closing quotes, brackets and other punctuation are read past (‘논문 (모음)’ ends in 음); digits are read as Korean
 * numbers; any other ending (Latin letters, 초성) has no final consonant, as it is usually read.
 */
function ending(word: string | number): { final: boolean; rieul: boolean } {
  const text = String(word).normalize('NFC').trim().replace(/[^\p{L}\p{N}]+$/u, '');
  const c = text.charCodeAt(text.length - 1);
  if (c >= 0xac00 && c < 0xd7a4) {
    const jong = (c - 0xac00) % 28;
    return { final: jong !== 0, rieul: jong === 8 };
  }
  if (c >= 0x30 && c <= 0x39) return { final: DIGIT_FINAL[c - 0x30]!, rieul: DIGIT_RIEUL[c - 0x30]! };
  return { final: false, rieul: false };
}

/** 와 or 과 after `word` (‘증폭’과, ‘효소 억제제’와): 과 when its last syllable has a final consonant. */
export function waGwa(word: string | number): '와' | '과' {
  return ending(word).final ? '과' : '와';
}
/** 을 or 를 (‘학회 준비’를). */
export function eulReul(word: string | number): '을' | '를' {
  return ending(word).final ? '을' : '를';
}
/** 이 or 가. */
export function iGa(word: string | number): '이' | '가' {
  return ending(word).final ? '이' : '가';
}
/** 으로 or 로 — 로 after a vowel and after ㄹ (‘연구실’로, ‘논문’으로). */
export function euroRo(word: string | number): '으로' | '로' {
  const e = ending(word);
  return e.final && !e.rieul ? '으로' : '로';
}
