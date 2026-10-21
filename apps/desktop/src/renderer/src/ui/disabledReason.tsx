import { useId, type ReactNode } from 'react';

/**
 * design-spec 6 "비활성 이유는 툴팁으로 알리고 레이블에 넣지 않는다" (M-2, fix round I1).
 *
 * A control disabled *with a reason* must tell keyboard and screen-reader users why, so it is not natively disabled
 * (that would drop it from the Tab order and swallow pointer events, and RAC tooltips never open on it). Instead it is
 * `aria-disabled`, ignores presses and form submission, shows the reason as its tooltip (hover and keyboard focus) and
 * keeps a persistent `aria-describedby` to a visually hidden copy of the reason. CSS draws it like a disabled control
 * from `[aria-disabled='true']` (RAC's own `data-disabled` follows `isDisabled` only).
 *
 * Without a reason a disabled control stays natively disabled, as before. Call sites that pass a reason always get the
 * same element tree, so toggling `isDisabled` never remounts (and blurs) the control.
 */
export interface DisabledReasonState {
  /** Disabled with a reason: focusable, aria-disabled, inert to presses. */
  soft: boolean;
  /** Spread on the RAC Button (after the caller's props). */
  controlProps: { isDisabled?: boolean; 'aria-disabled'?: true; 'aria-describedby'?: string };
  /** Render next to the control, never inside it (inside, it would join the accessible name). */
  description: ReactNode;
}

export function useDisabledReason(isDisabled: boolean | undefined, reason: string | undefined, describedBy?: string): DisabledReasonState {
  const id = useId();
  const soft = Boolean(isDisabled) && reason !== undefined;
  if (!soft) return { soft, controlProps: { isDisabled }, description: null };
  return {
    soft,
    controlProps: { isDisabled: false, 'aria-disabled': true, 'aria-describedby': [describedBy, id].filter(Boolean).join(' ') },
    description: (
      <span id={id} className="visually-hidden">
        {reason}
      </span>
    ),
  };
}

const PRESS_HANDLERS = ['onPress', 'onPressStart', 'onPressEnd', 'onPressChange', 'onPressUp', 'onClick'] as const;

/** The caller's RAC Button props without press handlers (and without form submission) while soft-disabled. */
export function withoutPresses<P extends object>(props: P, soft: boolean): P {
  if (!soft) return props;
  const out: Record<string, unknown> = { ...(props as Record<string, unknown>) };
  for (const key of PRESS_HANDLERS) delete out[key];
  if (out['type'] === 'submit' || out['type'] === 'reset') out['type'] = 'button';
  return out as P;
}
