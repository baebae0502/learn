import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cx } from './cx';
import { Icon } from './Icon';

export type NoticeTone = 'neutral' | 'warning' | 'accent';

/**
 * A file line's two parts: the folder (up to the last separator) and the file name. On a line too narrow for the
 * whole path the folder is cut (…) and the name stays whole, like Finder's middle truncation: the name is what the
 * user looks for (the missing original, the backup to restore from).
 */
export function splitPath(file: string): { dir: string; base: string } {
  const cut = Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\')) + 1;
  return { dir: file.slice(0, cut), base: file.slice(cut) };
}

/**
 * Stage notice (design-spec 6): 56 px tile — neutral = error/unavailable, warning = user-fixable,
 * accent = invitation; title2 heading, paragraph, optional file line, one row of actions.
 * A polite status, not an alert: it replaces a screen's content and stays (role=alert is for transient failures).
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
    <div className="notice" role="status" data-testid={props.testId}>
      <div className={cx('glyph', tone !== 'neutral' && tone)}>
        <Icon icon={props.icon} size="xl" />
      </div>
      <h2 className="ui-balance">{props.title}</h2>
      {props.children && <p className="ui-balance">{props.children}</p>}
      {props.file && <FileLine file={props.file} title={props.fileTitle ?? props.file} />}
      {props.actions && <div className="actions">{props.actions}</div>}
    </div>
  );
}

function FileLine({ file, title }: { file: string; title: string }) {
  const { dir, base } = splitPath(file);
  return (
    <div className="file mono" title={title}>
      {dir && <span className="file-dir">{dir}</span>}
      <span className="file-base">{base}</span>
    </div>
  );
}
