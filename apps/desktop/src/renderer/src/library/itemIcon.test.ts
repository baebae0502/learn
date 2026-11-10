import { Clapperboard, FileText, Image } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { itemIcon } from './itemIcon';

describe('itemIcon (the icon wherever an item is listed)', () => {
  it('gives each kind its own glyph', () => {
    expect(itemIcon('pdf')).toBe(FileText);
    expect(itemIcon('video')).toBe(Clapperboard);
    expect(itemIcon('image')).toBe(Image);
  });
});
