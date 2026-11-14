import type { ReactNode } from 'react';
import { FileText } from 'lucide-react';
import { t } from '../strings';
import { PaneEmpty } from '../ui/PaneEmpty';
import type { NoTextKind } from './NoTextNotice';

const { empty: words } = t.tutor;

/**
 * A new empty session (spec 8.2, 13, mockup state 4): the item's title over what the tutor can do with it — the one place its words are
 * chosen. A PDF without readable body text gets its own, saying only what is true: with no text at all the tutor answers
 * from what it knows; with a text Learn could not read a selection still goes with the question; either way no page is verified.
 * `notice`: a failure of the question just asked here, in the turn's place over it (the question is back in the composer).
 */
export function EmptySession({ title, noText = null, notice = null }: { title: string; noText?: NoTextKind | null; notice?: ReactNode }) {
  const text = noText === null ? words.readable : noText === 'empty' ? words.noText : words.unread;
  return (
    <div className="tutor-empty">
      {notice !== null && <div className="tutor-empty-notice">{notice}</div>}
      <PaneEmpty icon={FileText} title={title} testId="tutor-empty">
        {text}
      </PaneEmpty>
    </div>
  );
}
