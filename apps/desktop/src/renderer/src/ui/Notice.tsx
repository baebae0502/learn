import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cx } from './cx';
import { Icon } from './Icon';

export type NoticeTone = 'neutral' | 'warning' | 'accent';

/**
 * Stage notice (design-spec 6): 56 px tile — neutral = error/unavailable, warning = user-fixable,
 * accent = invitation; title2 heading, paragraph, optional file line, one row of actions.
 */
export function Notice(props: {
  tone?: NoticeTone;
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
  file?: string;
  fileTitle?: string;
  actions?: ReactNode;
  testId?: string;
}) {
  const tone = props.tone ?? 'neutral';
  return (
    <div className="notice" role="alert" data-testid={props.testId}>
      <div className={cx('glyph', tone !== 'neutral' && tone)}>
        <Icon icon={props.icon} size="xl" />
      </div>
      <h2 className="ui-balance">{props.title}</h2>
      {props.children && <p className="ui-balance">{props.children}</p>}
      {props.file && (
        <div className="file mono ellipsis" title={props.fileTitle ?? props.file}>
          {props.file}
        </div>
      )}
      {props.actions && <div className="actions">{props.actions}</div>}
    </div>
  );
}
