import { describe, expect, it } from 'vitest';
import { acceptsSubtitleDrag, splitDroppedPaths } from './subtitleDrop';

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
