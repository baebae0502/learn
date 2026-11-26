import type { ReactNode } from 'react';
import { Switch as AriaSwitch } from 'react-aria-components';

/**
 * A switch with its words (design-spec 6, mockup .switch): the track and its knob, then the label; the whole is one target. React Aria's
 * Switch wires the hidden input, so Space turns it and a screen reader says "on" or "off".
 */
export function Switch(props: { isSelected: boolean; onChange(selected: boolean): void; children: ReactNode; testId?: string; isDisabled?: boolean }) {
  return (
    <AriaSwitch isSelected={props.isSelected} onChange={props.onChange} isDisabled={props.isDisabled} className="switch" data-testid={props.testId}>
      <span className="switch-track" aria-hidden="true" />
      <span className="switch-label">{props.children}</span>
    </AriaSwitch>
  );
}
