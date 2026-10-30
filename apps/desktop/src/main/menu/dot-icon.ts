import { nativeImage, type NativeImage } from 'electron';
import { DOT_SCALE, dotPng } from './dot-png';

const cache = new Map<string, NativeImage>();

/** The native image of a colour dot for a menu row; one per colour. */
export function dotIcon(hex: string): NativeImage {
  let icon = cache.get(hex);
  if (!icon) {
    icon = nativeImage.createFromBuffer(dotPng(hex), { scaleFactor: DOT_SCALE });
    cache.set(hex, icon);
  }
  return icon;
}
