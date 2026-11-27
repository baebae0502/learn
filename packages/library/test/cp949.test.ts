import { describe, expect, it } from 'vitest';
import { CP949_TABLE_B64 } from '../src/subtitles/cp949-table';
import { decodeCp949 } from '../src/subtitles/cp949';

const b = (...x: number[]) => Uint8Array.from(x);

describe('CP949 decoder', () => {
  it('decodes two-byte syllables, including the extended ones', () => {
    expect(decodeCp949(b(0xb0, 0xa1))).toBe('가');
    expect(decodeCp949(b(0x81, 0x41))).toBe('갂');
    expect(decodeCp949(b(0x8c, 0x63))).toBe('똠');
    expect(decodeCp949(b(0xc1, 0x64))).toBe('햏');
  });
  it('passes ASCII through', () => {
    expect(decodeCp949(b(0x41, 0xb0, 0xa1, 0x42))).toBe('A가B');
  });
  it('fails on 0x80, a lone lead, a bad trail and an unmapped cell', () => {
    expect(decodeCp949(b(0x80))).toBeNull();
    expect(decodeCp949(b(0xb0))).toBeNull();
    expect(decodeCp949(b(0x81, 0x20))).toBeNull();
    expect(decodeCp949(b(0xa2, 0xe8))).toBeNull();
  });
  it('has 23,940 cells with 17,048 mapped', () => {
    const t = new Uint16Array(Buffer.from(CP949_TABLE_B64, 'base64').buffer.slice(0));
    const raw = Buffer.from(CP949_TABLE_B64, 'base64');
    expect(raw.length / 2).toBe(23_940);
    expect(t.length).toBe(23_940);
    expect(t.filter((v) => v !== 0).length).toBe(17_048);
  });
});
