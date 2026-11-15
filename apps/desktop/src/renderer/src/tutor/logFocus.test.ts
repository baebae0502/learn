import { describe, expect, it } from 'vitest';
import { createLogFocus } from './logFocus';

const at = (s: Partial<{ owed: boolean; drawn: boolean; visible: boolean; failed: boolean }>) => ({ owed: true, drawn: false, visible: false, failed: false, ...s });

describe('the focus owed to the conversation column after a session row\'s click opened the folded panel', () => {
  it('is taken once the column is drawn and can be seen, whichever comes first', () => {
    const f = createLogFocus();
    expect(f.step(at({ visible: true }))).toBe('wait'); // the thread is still being read
    expect(f.step(at({ visible: true, drawn: true }))).toBe('take');
    const g = createLogFocus();
    expect(g.step(at({ drawn: true }))).toBe('wait'); // the panel is not shown yet
    expect(g.step(at({ drawn: true, visible: true }))).toBe('take');
  });
  it('is let go when the thread\'s read fails, seen or not', () => {
    expect(createLogFocus().step(at({ visible: true, failed: true }))).toBe('drop');
    expect(createLogFocus().step(at({ failed: true }))).toBe('drop');
  });
  it('is let go when the panel is folded again before the column is drawn: a later drawing never takes it', () => {
    const f = createLogFocus();
    expect(f.step(at({ visible: true }))).toBe('wait');
    expect(f.step(at({ visible: false }))).toBe('drop');
  });
  it('starts afresh for the next press: nothing owed forgets what was seen', () => {
    const f = createLogFocus();
    expect(f.step(at({ visible: true }))).toBe('wait');
    expect(f.step(at({ owed: false }))).toBe('none'); // dropped or taken: the store has cleared it
    // The next press, before its panel shows: waiting, not dropped for the panel the last one saw.
    expect(f.step(at({ visible: false }))).toBe('wait');
    expect(f.step(at({ visible: true, drawn: true }))).toBe('take');
  });
  it('is nothing to do while nothing is owed', () => {
    expect(createLogFocus().step(at({ owed: false, visible: true, drawn: true }))).toBe('none');
  });
});
