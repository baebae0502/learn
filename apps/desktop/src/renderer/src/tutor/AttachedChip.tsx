import { useEffect, useId } from 'react';
import { TextQuote, X } from 'lucide-react';
import { Button as AriaButton, Focusable } from 'react-aria-components';
import { useItem } from '../data/queries';
import { t } from '../strings';
import { Icon } from '../ui/Icon';
import { Tooltip } from '../ui/Tooltip';
import { attachableSelection, type AttachableSelection } from '../viewers/pdf/selectionAnchor';
import { useReaderScope } from '../viewers/readerScope';
import { questionOnTheWay } from './useSend';

const { attached: words } = t.tutor;

/**
 * While the composer can be seen, a selection that settles in the reader (scope.selection's range: a pointer's at once, a keyboard's
 * after 300 ms) is attached to the next question — a new one replaces the one before (spec 8.4, J46). A selection that goes leaves the
 * chip. The question that waits for another answer, or is on its way, keeps the chip it was sent with: a selection meanwhile is not taken.
 */
export function useAttachSelection(visible: boolean): void {
  const scope = useReaderScope();
  const revisionId = useItem(scope.id).data?.revisionId ?? null;
  useEffect(() => {
    if (!visible || revisionId === null) return;
    const held = () => scope.tutor.getState().waiting !== null || questionOnTheWay(scope.id);
    let last = 0;
    const stop = scope.selection.subscribe((now, before) => {
      const range = now.range;
      if (range === before.range || range === null || held()) return;
      const handle = scope.reader.getState().handle;
      const doc = handle?.document() ?? null;
      const viewer = handle?.viewer() ?? null;
      if (doc === null || viewer === null) return;
      const mine = ++last;
      attachableSelection({ doc, viewer, revisionId, range }).then(
        (a) => {
          if (mine === last && a !== null && !held()) scope.tutor.getState().setAttached(a);
        },
        (e: unknown) => console.warn(`[tutor] selection not attached: ${(e as Error)?.name ?? 'Error'}`),
      );
    });
    return () => {
      last += 1;
      stop();
    };
  }, [visible, scope, revisionId]);
}

/** The passage's words on one line: its line ends and runs of white space are one space each. */
const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();

/**
 * The passage attached to the next question, over the composer's text area (spec 8.4; approved mockup .attach): "42쪽 · <글>" on one
 * line, cut with an ellipsis; its tooltip says it goes with the question — and, on a second line, when only the first page's text or
 * only the first 4,000 characters go. × (구간 떼기) takes it off; it is the chip's one Tab stop, and says what it takes off.
 */
export function AttachedChip({ attached, onRemove }: { attached: AttachableSelection; onRemove(): void }) {
  const n = attached.pageIndex + 1;
  const tip = words.tip(n);
  const notes = [attached.multipage ? words.multipage : null, attached.long ? words.long : null].filter((x) => x !== null).join(' ');
  const described = useId();
  return (
    <div className="tutor-attach" data-testid="tutor-attached" data-page={n} data-multipage={attached.multipage ? '' : undefined} data-long={attached.long ? '' : undefined}>
      <Tooltip label={tip} note={notes === '' ? undefined : notes} placement="top">
        <Focusable>
          {/* Not a Tab stop (the × is the chip's): focusable only for its tooltip; a press keeps the focus where it was. */}
          <span className="attach-label" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} data-testid="tutor-attached-label">
            <Icon icon={TextQuote} size="sm" />
            <span className="ellipsis">{words.chip(n, oneLine(attached.text))}</span>
          </span>
        </Focusable>
      </Tooltip>
      <Tooltip label={words.remove} placement="top">
        <AriaButton className="x" aria-label={words.remove} aria-describedby={described} onPress={onRemove} data-testid="tutor-attached-remove">
          <Icon icon={X} size="xs" />
        </AriaButton>
      </Tooltip>
      <span id={described} hidden>
        {notes === '' ? tip : `${tip} ${notes}`}
      </span>
    </div>
  );
}
