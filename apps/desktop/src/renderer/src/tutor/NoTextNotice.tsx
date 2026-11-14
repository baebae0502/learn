import { Info } from 'lucide-react';
import type { BodyTextState } from '@learn/domain';
import { t } from '../strings';
import { Icon } from '../ui/Icon';

/** Why the tutor cannot read the PDF's body text, as the panel says it (spec 8.2, 13): no text, locked, damaged or given up, too large. */
export type NoTextKind = keyof typeof t.tutor.noText;

/** The body text's state as the line names it; null while it is being read or once it is read (there is text to read). */
export function noTextKind(text: BodyTextState | null | undefined): NoTextKind | null {
  if (text?.state === 'empty') return 'empty';
  if (text?.state !== 'failed') return null;
  return text.reason === 'locked' ? 'locked' : text.reason === 'too-large' ? 'large' : 'failed';
}

/**
 * One line over the session — empty or a conversation — when the tutor cannot read the PDF's body text (spec 8.2; mockup
 * ?state=4&text=…): Learn's own words in the secondary colour, its ⓘ tertiary. Asking is not held back.
 */
export function NoTextNotice({ kind }: { kind: NoTextKind }) {
  return (
    <div className="tutor-line" role="status" data-testid="tutor-no-text" data-kind={kind}>
      <Icon icon={Info} size="sm" />
      <span className="l-text">{t.tutor.noText[kind]}</span>
    </div>
  );
}
