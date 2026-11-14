import { useEffect, useId, useRef } from 'react';
import { TextQuote, X } from 'lucide-react';
import { Button as AriaButton, Focusable } from 'react-aria-components';
import { useItem } from '../data/queries';
import { t } from '../strings';
import { Icon } from '../ui/Icon';
import { Tooltip } from '../ui/Tooltip';
import { attachableSelection, type AttachableSelection } from '../viewers/pdf/selectionAnchor';
import { useReaderScope, type ReaderScope } from '../viewers/readerScope';
import { questionOnTheWay } from './useSend';

const { attached: words } = t.tutor;

/**
 * The rules useAttachSelection follows, apart from React: every new selection range of the tab's reader (a pointer's at once, a
 * keyboard's after 300 ms) is made into an attachable passage and replaces the chip; when several are being made, the latest wins. A
 * range that goes leaves the chip. While the tab's question waits for another answer or is on its way, the chip goes with it: a
 * selection made then is not taken, then or later — the reader selects again. Answers the unsubscribe.
 */
export function watchSelections(scope: ReaderScope, revisionId: string, make: typeof attachableSelection = attachableSelection): () => void {
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
    make({ doc, viewer, revisionId, range }).then(
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
}

/** While the composer can be seen (spec 8.4), the reader's selections attach themselves to the next question (watchSelections). */
export function useAttachSelection(visible: boolean): void {
  const scope = useReaderScope();
  const revisionId = useItem(scope.id).data?.revisionId ?? null;
  useEffect(() => {
    if (!visible || revisionId === null) return;
    return watchSelections(scope, revisionId);
  }, [visible, scope, revisionId]);
}

/**
 * The passage attached to the next question, over the composer's text area (spec 8.4; approved mockup .attach): "42쪽 · <글>" on one
 * line, cut with an ellipsis; its tooltip says it goes with the question — and, on a second line, when only the first page's text or
 * only the first 4,000 characters go. × (구간 떼기) takes it off; it is the chip's one Tab stop, and its tooltip carries the same second
 * line, so the keyboard sees it too. Both tooltips stand 6 above the chip: its own centred on it, ×'s ending at its right edge, over ×.
 * `held`: the question it goes with waits for another answer or is on its way — the chip is part of it, read only like its text, and ×
 * is off until the composer is the reader's again.
 */
export function AttachedChip({ attached, held = false, onRemove }: { attached: AttachableSelection; held?: boolean; onRemove(): void }) {
  const n = attached.pageIndex + 1;
  const tip = words.tip(n);
  const notes = [attached.multipage ? words.multipage : null, attached.long ? words.long : null].filter((x) => x !== null).join(' ');
  const note = notes === '' ? undefined : notes;
  const described = useId();
  const chip = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={chip}
      className={held ? 'tutor-attach is-held' : 'tutor-attach'}
      data-testid="tutor-attached"
      data-page={n}
      data-multipage={attached.multipage ? '' : undefined}
      data-long={attached.long ? '' : undefined}
      data-held={held ? '' : undefined}
    >
      <Tooltip label={tip} note={note} placement="top" anchorRef={chip}>
        <Focusable>
          {/* Not a Tab stop (the × is the chip's): focusable only for its tooltip; a press keeps the focus where it was. */}
          <span className="attach-label" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} data-testid="tutor-attached-label">
            <Icon icon={TextQuote} size="sm" />
            <span className="ellipsis">{words.chip(n, attached.text)}</span>
          </span>
        </Focusable>
      </Tooltip>
      <Tooltip label={words.remove} note={note} placement="top end" anchorRef={chip} isDisabled={held}>
        <AriaButton className="x" aria-label={words.remove} aria-describedby={described} isDisabled={held} onPress={onRemove} data-testid="tutor-attached-remove">
          <Icon icon={X} size="xs" />
        </AriaButton>
      </Tooltip>
      <span id={described} hidden>
        {note === undefined ? tip : `${tip} ${note}`}
      </span>
    </div>
  );
}
