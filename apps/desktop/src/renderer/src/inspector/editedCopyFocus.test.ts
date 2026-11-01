import { describe, expect, it } from 'vitest';
import { focusRegained } from './editedCopyFocus';

describe('when the panel reads the edited copies again (M6 spec 6)', () => {
  it('on the window getting the focus back — not on the first state it hears, nor while it stays focused or away', () => {
    expect(focusRegained(false, true)).toBe(true);
    expect(focusRegained(null, true)).toBe(false);
    expect(focusRegained(true, true)).toBe(false);
    expect(focusRegained(true, false)).toBe(false);
    expect(focusRegained(false, false)).toBe(false);
  });
});
