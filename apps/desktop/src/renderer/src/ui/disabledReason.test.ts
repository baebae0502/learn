import { describe, expect, it } from 'vitest';
import { withoutPresses } from './disabledReason';

const f = () => {};
const INERT = ['onPress', 'onPressStart', 'onPressEnd', 'onPressChange', 'onPressUp', 'onClick', 'onKeyDown', 'onKeyUp', 'onPointerDown', 'onPointerUp', 'onMouseDown', 'onMouseUp'];
// What a soft-disabled control still needs: focus (Tab, tooltip on focus), hover (tooltip), its name and description.
const KEPT = { onFocus: f, onBlur: f, onFocusChange: f, onHoverStart: f, onHoverEnd: f, 'aria-label': '내보내기', 'aria-describedby': 'r1' };

describe('withoutPresses (disabled with a reason, I1)', () => {
  it('leaves every prop alone while the control is not soft-disabled', () => {
    const props = { ...Object.fromEntries(INERT.map((k) => [k, f])), ...KEPT, type: 'submit' };
    expect(withoutPresses(props, false)).toBe(props);
  });

  it('drops press, click, key and pointer handlers and never submits a form', () => {
    const out = withoutPresses({ ...Object.fromEntries(INERT.map((k) => [k, f])), ...KEPT, type: 'submit' }, true) as Record<string, unknown>;
    expect(Object.keys(out).filter((k) => INERT.includes(k))).toEqual([]);
    expect(out).toMatchObject(KEPT);
    expect(out['type']).toBe('button');
    expect(withoutPresses({ type: 'reset' }, true)).toEqual({ type: 'button' });
  });
});
