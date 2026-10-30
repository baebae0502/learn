import { describe, expect, it } from 'vitest';
import { COMMANDS, commandById, inPalette, tagSlot } from '@learn/domain';
import { tagPaletteCommands } from './paletteTags';

const NAMES: Record<number, string> = { 1: '시험 범위', 3: '중요' };

describe('the palette\'s colour keys (spec 4.2)', () => {
  const listed = COMMANDS.filter(inPalette);
  const out = tagPaletteCommands(listed, (slot) => NAMES[slot]);
  it('are named by the tag at their slot — "색 태그 3 · 중요" — and left out where no tag is known', () => {
    expect(out.filter((c) => tagSlot(c.id) !== null).map((c) => [c.id, c.label])).toEqual([['tag.color1', '색 태그 1 · 시험 범위'], ['tag.color3', '색 태그 3 · 중요']]);
  });
  it('keep their ids, so a run, the recent list and the ranking go on as before; every other command passes as it was', () => {
    expect(out.find((c) => c.id === 'tag.color3')!.key).toEqual({ code: 'Digit3' });
    const settings = commandById('app.settings');
    expect(out.find((c) => c.id === 'app.settings')).toBe(settings);
    expect(commandById('tag.color3').label).toBe('색 태그 3'); // the registry itself is not renamed
  });
});
