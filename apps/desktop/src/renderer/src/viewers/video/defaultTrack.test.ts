import { describe, expect, it } from 'vitest';
import type { SubtitleTrack } from '@learn/domain';
import { pickTrack } from './defaultTrack';

const track = (assetId: string, language: string | null, position: number): SubtitleTrack => ({ assetId, language, position, originalName: `${assetId}.srt`, cueCount: 1 });
const en = track('en', 'en', 0);
const ko = track('ko', 'ko', 1);

describe('pickTrack (spec 4.4)', () => {
  it('turns the Korean track on when nothing is remembered, though another comes first', () => {
    expect(pickTrack([en, ko], undefined)).toEqual({ trackId: 'ko', on: true });
  });
  it('keeps what was remembered, off included', () => {
    expect(pickTrack([en, ko], { assetId: 'en', on: false })).toEqual({ trackId: 'en', on: false });
    expect(pickTrack([en, ko], { assetId: 'ko', on: true })).toEqual({ trackId: 'ko', on: true });
  });
  it('goes back to the default when the remembered track is gone', () => {
    expect(pickTrack([en, ko], { assetId: 'gone', on: false })).toEqual({ trackId: 'ko', on: true });
  });
  it('takes the first track when none is Korean', () => {
    expect(pickTrack([en], undefined)).toEqual({ trackId: 'en', on: true });
    expect(pickTrack([track('x', null, 0), en], undefined)).toEqual({ trackId: 'x', on: true });
  });
  it('counts a Korean variant as Korean, and not a code that only starts with the letters', () => {
    expect(pickTrack([en, track('kr', 'ko-KR', 1)], undefined)).toEqual({ trackId: 'kr', on: true });
    expect(pickTrack([track('kok', 'kok', 0), en], undefined)).toEqual({ trackId: 'kok', on: true });
    expect(pickTrack([en, track('kok', 'kok', 1)], undefined)).toEqual({ trackId: 'en', on: true });
  });
  it('is no track and off when there is none', () => {
    expect(pickTrack([], undefined)).toEqual({ trackId: null, on: false });
    expect(pickTrack([], { assetId: 'ko', on: true })).toEqual({ trackId: null, on: false });
  });
});
