import { describe, expect, it, vi } from 'vitest';
import { createThumbnailCache } from './thumbnailCache';

const bitmap = () => ({ close: vi.fn(), width: 1, height: 1 }) as unknown as ImageBitmap & { close: ReturnType<typeof vi.fn> };

describe('thumbnail cache', () => {
  it('returns what was set', () => {
    const cache = createThumbnailCache(3);
    const a = bitmap();
    cache.set(1, a);
    expect(cache.get(1)).toBe(a);
    expect(cache.get(2)).toBeUndefined();
  });

  it('drops the least recently used bitmap past its size and closes it', () => {
    const cache = createThumbnailCache(2);
    const [a, b, c] = [bitmap(), bitmap(), bitmap()];
    cache.set(1, a);
    cache.set(2, b);
    cache.get(1); // 2 is now the oldest
    cache.set(3, c);
    expect(b.close).toHaveBeenCalledTimes(1);
    expect(a.close).not.toHaveBeenCalled();
    expect(cache.get(2)).toBeUndefined();
    expect(cache.get(1)).toBe(a);
    expect(cache.get(3)).toBe(c);
  });

  it('closes the bitmap a page had before, but not the one it is given again', () => {
    const cache = createThumbnailCache(2);
    const [a, b] = [bitmap(), bitmap()];
    cache.set(1, a);
    cache.set(1, b);
    expect(a.close).toHaveBeenCalledTimes(1);
    cache.set(1, b);
    expect(b.close).not.toHaveBeenCalled();
  });

  it('closes everything it holds when cleared, and holds 60 by default', () => {
    const cache = createThumbnailCache();
    const all = Array.from({ length: 61 }, bitmap);
    all.forEach((b, i) => cache.set(i + 1, b));
    expect(all[0]!.close).toHaveBeenCalledTimes(1);
    cache.clear();
    for (const b of all.slice(1)) expect(b.close).toHaveBeenCalledTimes(1);
    expect(cache.get(2)).toBeUndefined();
  });
});
