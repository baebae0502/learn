import { describe, expect, it } from 'vitest';
import { PREVIEW_MAX_PIXELS, previewMode } from './imagePreview';

const item = (imageSize: { width: number; height: number } | null | undefined, availability: 'available' | 'missing' = 'available') => ({ imageSize, availability });

describe('previewMode (what the item panel shows for one image)', () => {
  it('draws the picture when its size is known and within fifty megapixels', () => {
    expect(PREVIEW_MAX_PIXELS).toBe(50_000_000);
    expect(previewMode(item({ width: 64, height: 48 }))).toBe('picture');
    expect(previewMode(item({ width: 10_000, height: 5_000 }))).toBe('picture');
  });
  it('shows the icon box past fifty megapixels, for an unknown size and for a missing original', () => {
    expect(previewMode(item({ width: 10_001, height: 5_000 }))).toBe('icon');
    expect(previewMode(item(null))).toBe('icon');
    expect(previewMode(item(undefined))).toBe('icon');
    expect(previewMode(item({ width: 64, height: 48 }, 'missing'))).toBe('icon');
  });
});
