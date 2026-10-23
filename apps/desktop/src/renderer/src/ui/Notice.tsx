import { Fragment, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cx } from './cx';
import { Icon } from './Icon';

export type NoticeTone = 'neutral' | 'warning' | 'accent';

/**
 * A file line's parts: each folder with its trailing separator, then the file name. On screen every part is an
 * unbreakable unit, so a long path wraps only after a separator and no character is lost (design-spec 4: no
 * middle elision); only a part wider than the whole line breaks inside.
 */
export function pathParts(file: string): { folders: string[]; base: string } {
  const parts = file.split(/(?<=[\\/])/);
  const base = parts.pop() ?? '';
  return { folders: parts, base };
}

/** The notice's 56 px tile alone (the component board shows the three meanings side by side). */
export function NoticeGlyph({ tone = 'neutral', icon }: { tone?: NoticeTone; icon: LucideIcon }) {
  return (
    <div className={cx('glyph', tone !== 'neutral' && tone)}>
      <Icon icon={icon} size="xl" />
    </div>
  );
}

/**
 * Stage notice (design-spec 6): 56 px tile — neutral = error/unavailable, warning = user-fixable,
 * accent = invitation; title2 heading, paragraph, optional file line, one row of actions.
 * A polite status, not an alert: it replaces a screen's content and stays (role=alert is for transient failures).
 *
 * The file line is either a path (`file`: mono, wrapping only after a separator) or the file's name and size
 * (`fileName`, "seminar-0915.avi · 1.3 GB": footnote with tabular figures). Mono is for paths only (spec 6).
 * `stage="dark"` is the unplayable video's always-dark stage: the same notice, only its colours change.
 */
export function Notice(props: {
  tone?: NoticeTone;
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
  file?: string;
  fileTitle?: string;
  fileName?: string;
  actions?: ReactNode;
  stage?: 'dark';
  testId?: string;
}) {
  return (
    <div className={cx('notice', props.stage === 'dark' && 'stage-dark')} role="status" data-testid={props.testId}>
      <NoticeGlyph tone={props.tone} icon={props.icon} />
      <h2 className="ui-balance">{props.title}</h2>
      {props.children && <p className="ui-balance">{props.children}</p>}
      {props.file && <FileLine file={props.file} title={props.fileTitle ?? props.file} />}
      {props.fileName && (
        <div className="file file-name" title={props.fileName}>
          {props.fileName}
        </div>
      )}
      {props.actions && <div className="actions">{props.actions}</div>}
    </div>
  );
}

function FileLine({ file, title }: { file: string; title: string }) {
  const { folders, base } = pathParts(file);
  return (
    <div className="file mono" title={title}>
      {folders.length > 0 && (
        <span className="file-dir">
          {folders.map((f, i) => (
            <Fragment key={i}>
              <span className="file-part">{f}</span>
              <wbr />
            </Fragment>
          ))}
        </span>
      )}
      <span className="file-part file-base">{base}</span>
    </div>
  );
}
