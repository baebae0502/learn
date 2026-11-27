import { describe, expect, it } from 'vitest';
import type { AttachResult } from '@learn/domain';
import { acceptsSubtitleDrag, attachInChunks, splitDroppedPaths } from './subtitleDrop';

const file = (type: string) => ({ kind: 'file', type });

describe('acceptsSubtitleDrag: what a drag over a video tab may carry (spec 5.3)', () => {
  it('takes files whose MIME is a subtitle one, plain text or empty', () => {
    expect(acceptsSubtitleDrag([file('')])).toBe(true);
    expect(acceptsSubtitleDrag([file('text/vtt'), file('application/x-subrip')])).toBe(true);
    expect(acceptsSubtitleDrag([file('text/plain'), file('')])).toBe(true);
  });
  it('refuses a video, a PDF among them, a string item and an empty drag', () => {
    expect(acceptsSubtitleDrag([file('video/mp4')])).toBe(false);
    expect(acceptsSubtitleDrag([file(''), file('application/pdf')])).toBe(false);
    expect(acceptsSubtitleDrag([{ kind: 'string', type: 'text/plain' }])).toBe(false);
    expect(acceptsSubtitleDrag([])).toBe(false);
  });
});

describe('splitDroppedPaths: the drop filters by extension again', () => {
  it('keeps .srt and .vtt (any case) and turns the rest into not-subtitle rows named by file', () => {
    expect(splitDroppedPaths(['/a/x.SRT', '/a/notes.pdf', 'C:\\b\\y.vtt', '/a/z'])).toEqual({
      subtitles: ['/a/x.SRT', 'C:\\b\\y.vtt'],
      rejected: [
        { name: 'notes.pdf', reason: 'not-subtitle' },
        { name: 'z', reason: 'not-subtitle' },
      ],
    });
  });
});

describe('attachInChunks: the attach call takes 50 paths at most', () => {
  it('splits 60 paths into 50 + 10 and merges the results', async () => {
    const paths = Array.from({ length: 60 }, (_, i) => `/a/${i}.srt`);
    const sizes: number[] = [];
    const merged = await attachInChunks(paths, async (chunk) => {
      sizes.push(chunk.length);
      return { added: chunk.map((p) => ({ assetId: p }) as unknown as AttachResult['added'][number]), already: [], failed: chunk.length === 10 ? [{ name: 'x', reason: 'io' }] : [] };
    });
    expect(sizes).toEqual([50, 10]);
    expect(merged.added).toHaveLength(60);
    expect(merged.failed).toEqual([{ name: 'x', reason: 'io' }]);
  });
  it('makes no call for no paths', async () => {
    expect(await attachInChunks([], () => Promise.reject(new Error('called')))).toEqual({ added: [], already: [], failed: [] });
  });
});
