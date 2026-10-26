import { describe, expect, it } from 'vitest';
import { COMMAND_IDS, type CommandId } from '@learn/domain';
import { RECENT_MAX, parseRecent, withRecent } from './recent';

describe('palette.recent (spec §4.4)', () => {
  it('reads known command ids only, once each, twenty at most; anything else is no history', () => {
    expect(parseRecent(['app.settings', 'app.nope', 'app.settings', 3, 'view.textBigger'])).toEqual(['app.settings', 'view.textBigger']);
    expect(parseRecent(null)).toEqual([]);
    expect(parseRecent({ 0: 'app.settings' })).toEqual([]);
    expect(parseRecent([...COMMAND_IDS, ...COMMAND_IDS])).toHaveLength(Math.min(RECENT_MAX, COMMAND_IDS.length));
  });

  it('puts the command just run first, once, and keeps the twenty newest', () => {
    expect(withRecent(['view.textBigger', 'app.settings'], 'app.settings')).toEqual(['app.settings', 'view.textBigger']);
    expect(withRecent([], 'app.shortcuts')).toEqual(['app.shortcuts']);
    const many = Array.from({ length: 25 }, (_, i) => `x.${i}` as CommandId);
    const next = withRecent(many, 'app.settings');
    expect(next).toHaveLength(RECENT_MAX);
    expect(next[0]).toBe('app.settings');
    expect(next.at(-1)).toBe('x.18');
  });
});
