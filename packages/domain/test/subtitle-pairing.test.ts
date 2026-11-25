import { describe, expect, it } from 'vitest';
import { groupForCalls, pairSubtitles } from '../src/subtitle-pairing';

describe('pairSubtitles', () => {
  it('pairs a stem, a language tail and a regional tail with the one video', () => {
    const r = pairSubtitles(['/a/강의.mp4', '/a/강의.srt', '/a/강의.ko.vtt', '/a/강의.en-US.srt']);
    expect(r.subtitlesOf.get('/a/강의.mp4')).toEqual(['/a/강의.srt', '/a/강의.ko.vtt', '/a/강의.en-US.srt']);
    expect(r.rest).toEqual(['/a/강의.mp4']);
    expect(r.unpaired).toEqual([]);
  });

  it('ignores case and folder', () => {
    const r = pairSubtitles(['/a/Lecture.MP4', '/b/lecture.srt']);
    expect(r.subtitlesOf.get('/a/Lecture.MP4')).toEqual(['/b/lecture.srt']);
  });

  it('pairs a decomposed Hangul name with its composed twin', () => {
    const sub = '/a/가'.normalize('NFD') + '.srt';
    const r = pairSubtitles([sub, '/a/가.mp4']);
    expect(r.subtitlesOf.get('/a/가.mp4')).toEqual([sub]);
  });

  it('leaves a subtitle with no video unpaired, even beside a non-video of the name', () => {
    const r = pairSubtitles(['/a/강의.pdf', '/a/강의.srt']);
    expect(r.unpaired).toEqual(['/a/강의.srt']);
    expect(r.rest).toEqual(['/a/강의.pdf']);
    expect(r.subtitlesOf.size).toBe(0);
  });

  it('prefers the video in the same folder, then the first', () => {
    expect([...pairSubtitles(['/a/x.mp4', '/b/x.mp4', '/b/x.srt']).subtitlesOf]).toEqual([['/b/x.mp4', ['/b/x.srt']]]);
    expect([...pairSubtitles(['/c/x.srt', '/a/x.mp4', '/b/x.mp4']).subtitlesOf]).toEqual([['/a/x.mp4', ['/c/x.srt']]]);
  });

  it('does not take v2 for a language tail', () => {
    const r = pairSubtitles(['/a/강의.v2.srt', '/a/강의.mp4']);
    expect(r.unpaired).toEqual(['/a/강의.v2.srt']);
  });
});

describe('groupForCalls', () => {
  it('keeps every video with its subtitles in calls of at most 500', () => {
    const videos = Array.from({ length: 400 }, (_, i) => `/v/v${i}.mp4`);
    const pdfs = Array.from({ length: 200 }, (_, i) => `/v/p${i}.pdf`);
    const subs = Array.from({ length: 400 }, (_, i) => `/s/v${i}.srt`);
    const calls = groupForCalls([...videos.slice(0, 200), ...pdfs, ...videos.slice(200), ...subs]);
    expect(calls.flat()).toHaveLength(1000);
    expect(new Set(calls.flat()).size).toBe(1000);
    for (const c of calls) expect(c.length).toBeLessThanOrEqual(500);
    const callOf = new Map(calls.flatMap((c, i) => c.map((p) => [p, i] as const)));
    for (let i = 0; i < 400; i++) expect(callOf.get(`/s/v${i}.srt`)).toBe(callOf.get(`/v/v${i}.mp4`));
  });

  it('keeps the order, moving a video\'s subtitles behind it and leaving an unpaired one where it was', () => {
    expect(groupForCalls(['/a/x.srt', '/a/y.pdf', '/a/x.mp4', '/a/z.srt'])).toEqual([['/a/y.pdf', '/a/x.mp4', '/a/x.srt', '/a/z.srt']]);
  });

  it('splits a group bigger than a call, and only then', () => {
    const calls = groupForCalls(['/a/x.mp4', '/a/x.ko.srt', '/a/x.en.srt', '/a/x.ja.srt', '/b/y.pdf'], 2);
    expect(calls).toEqual([['/a/x.mp4', '/a/x.ko.srt'], ['/a/x.en.srt', '/a/x.ja.srt'], ['/b/y.pdf']]);
  });
});
