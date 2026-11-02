import { describe, expect, it } from 'vitest';
import { middleParts } from './middleParts';

describe('a file name cut in the middle (spec 3.3)', () => {
  it('keeps the extension and the few characters before it whole; only the head gives way', () => {
    expect(middleParts('강의 08 · 효소 조절.mp4')).toEqual({ head: '강의 08', tail: ' · 효소 조절.mp4' });
    expect(middleParts('molbio_ch06_signaling_pathway_review.pdf')).toEqual({ head: 'molbio_ch06_signaling_pathwa', tail: 'y_review.pdf' });
  });
  it('a short name, or one with no extension, is whole or keeps its last characters; the parts always make the name', () => {
    expect(middleParts('a.pdf')).toEqual({ head: 'a.pdf', tail: '' });
    expect(middleParts('README-그대로-두는-파일')).toEqual({ head: 'README-그', tail: '대로-두는-파일' });
    for (const name of ['x', '.hidden', '세포생물학 3장.pdf', 'archive.tar.gz', '🎬 강의 영상 녹화본 마지막.mov']) {
      const { head, tail } = middleParts(name);
      expect(head + tail).toBe(name);
    }
  });
});
