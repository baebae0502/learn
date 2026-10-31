import { cx } from './cx';
import { middleParts } from './middleEllipsis';

/** A file name on one line, cut in the middle when it does not fit; the whole name is its tooltip. */
export function MiddleEllipsis({ text, className }: { text: string; className?: string }) {
  const { head, tail } = middleParts(text);
  return (
    <span className={cx('middle-ellipsis', className)} title={text}>
      <span className="me-head">{head}</span>
      {tail !== '' && <span className="me-tail">{tail}</span>}
    </span>
  );
}
