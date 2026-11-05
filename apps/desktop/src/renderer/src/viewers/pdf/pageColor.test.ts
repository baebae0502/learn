import { describe, expect, it } from 'vitest';
import { parsePageColor, resolvePageColor } from './pageColor';

describe('page colour', () => {
  it('reads the stored value, and auto when there is none', () => {
    for (const c of ['auto', 'original', 'sepia', 'dark'] as const) expect(parsePageColor(c)).toBe(c);
    for (const raw of [null, undefined, '', 'blue', 3, {}]) expect(parsePageColor(raw)).toBe('auto');
  });
  it('lets auto follow the theme and keeps a chosen colour in either theme', () => {
    expect(resolvePageColor('auto', 'light')).toBe('original');
    expect(resolvePageColor('auto', 'dark')).toBe('dark');
    expect(resolvePageColor('sepia', 'dark')).toBe('sepia');
    expect(resolvePageColor('original', 'dark')).toBe('original');
    expect(resolvePageColor('dark', 'light')).toBe('dark');
  });
});
