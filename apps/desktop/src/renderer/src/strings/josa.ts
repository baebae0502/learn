/** Does each digit's Korean reading end in a final consonant (영 일 이 삼 사 오 육 칠 팔 구)? */
const DIGIT_FINAL = [true, true, false, true, false, false, true, true, true, false];

/**
 * 와 or 과 after `word` (‘증폭’과, ‘효소 억제제’와): 과 when its last syllable has a final consonant. Digits are read as
 * Korean numbers; any other ending (Latin letters, 초성) takes 와, as it is usually read.
 */
export function waGwa(word: string | number): '와' | '과' {
  const text = String(word).normalize('NFC').trim();
  const c = text.charCodeAt(text.length - 1);
  if (c >= 0xac00 && c < 0xd7a4) return (c - 0xac00) % 28 === 0 ? '와' : '과';
  if (c >= 0x30 && c <= 0x39) return DIGIT_FINAL[c - 0x30] ? '과' : '와';
  return '와';
}
