import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cx } from './cx';
import { Icon } from './Icon';

/**
 * A pane's empty state (design-spec 6): a 24 px icon in tertiary colour, a headline title, a footnote (at most 280), at
 * most one action. `top` hangs it under the pane's head instead of centring it (the table's body). A polite status: it
 * replaces the pane's content and says why.
 */
export function PaneEmpty(props: { icon: LucideIcon; title: string; children?: ReactNode; action?: ReactNode; top?: boolean; testId?: string }) {
  return (
    <div className={cx('pane-empty', props.top && 'top')} role="status" data-testid={props.testId}>
      <Icon icon={props.icon} size="lg" />
      <div className="pe-title">{props.title}</div>
      {props.children && <div className="pe-text">{props.children}</div>}
      {props.action}
    </div>
  );
}
