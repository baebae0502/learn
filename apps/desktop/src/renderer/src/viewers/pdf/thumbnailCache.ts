export interface ThumbnailCache {
  get(page: number): ImageBitmap | undefined;
  set(page: number, bitmap: ImageBitmap): void;
  clear(): void;
}

/**
 * The drawn thumbnails, least recently used out first. An ImageBitmap holds decoded pixels outside the JS heap until it is
 * closed, so every bitmap that leaves the cache is closed here, and only here.
 */
export function createThumbnailCache(max = 60): ThumbnailCache {
  // A Map keeps insertion order: the first key is the least recently used, a read moves its key to the end.
  const held = new Map<number, ImageBitmap>();
  return {
    get(page) {
      const bitmap = held.get(page);
      if (bitmap) {
        held.delete(page);
        held.set(page, bitmap);
      }
      return bitmap;
    },
    set(page, bitmap) {
      const before = held.get(page);
      if (before && before !== bitmap) before.close();
      held.delete(page);
      held.set(page, bitmap);
      while (held.size > max) {
        const [oldest, evicted] = held.entries().next().value as [number, ImageBitmap];
        held.delete(oldest);
        evicted.close();
      }
    },
    clear() {
      for (const bitmap of held.values()) bitmap.close();
      held.clear();
    },
  };
}
