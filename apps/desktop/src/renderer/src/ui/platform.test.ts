import { describe, expect, it } from 'vitest';
import { readWindowParams } from './platform';

describe('readWindowParams', () => {
  it('reads the flags main put on the URL', () => {
    expect(readWindowParams('?window=settings&platform=darwin&det=1')).toEqual({ window: 'settings', platform: 'darwin', deterministic: true, vibrancy: false, demo: false, part: 1 });
    expect(readWindowParams('?window=gallery&part=2&platform=linux')).toMatchObject({ window: 'gallery', part: 2 });
  });
  it('falls back to the main window on Linux', () => {
    expect(readWindowParams('')).toEqual({ window: 'main', platform: 'linux', deterministic: false, vibrancy: false, demo: false, part: 1 });
    expect(readWindowParams('?window=evil')).toMatchObject({ window: 'main' });
  });
});
