import { useId } from 'react';
import { CircleHelp } from 'lucide-react';
import { Focusable, Link } from 'react-aria-components';
import { t } from '../strings';
import { Icon } from '../ui/Icon';
import { Tooltip } from '../ui/Tooltip';

const { cite } = t.tutor;

/**
 * What a cite chip can do (spec 7, 8.3): `go` — the page is verified and its revision is the document open in this tab, a press
 * goes there; `checking` — the answer is still coming and no tool of this turn has returned the page yet; `none` — the turn ended and
 * the page was not read (or is past the last page: `outside`); `lost` — verified, but the anchor or its revision is not this document's.
 */
export type CiteState = { kind: 'go'; onPress(): void } | { kind: 'checking' } | { kind: 'none'; outside: boolean } | { kind: 'lost' };

/**
 * A citation of one page as a chip: "42쪽", a link that says "42쪽으로 이동" in its tooltip and its description. Its name is the words it
 * shows (label in name, WCAG 2.5.3 — a name of "42쪽으로 이동" alone does not hold the word "42쪽"); the description is a hidden element, so
 * reading the answer through does not say it twice. The chips that cannot be pressed stay in the Tab order with their reason as the
 * tooltip (a link that is disabled): "확인 중" while the answer comes, "출처 없음" once it ended unverified, the page dimmed when its
 * revision is gone. `current`: the reader was sent here by this chip and still shows its page (a ring). `pageIndex` is 0-based.
 */
export function CitationChip({ pageIndex, state, current = false }: { pageIndex: number; state: CiteState; current?: boolean }) {
  const n = pageIndex + 1;
  const described = useId();
  if (state.kind === 'go') {
    return (
      <>
        <Tooltip label={cite.go(n)}>
          <Link
            className={current ? 'cite is-current' : 'cite'}
            aria-describedby={described}
            onPress={state.onPress}
            data-testid="cite-chip"
            data-cite="go"
            data-page={n}
            data-current={current ? '' : undefined}
          >
            {cite.page(n)}
          </Link>
        </Tooltip>
        <span id={described} hidden>
          {cite.go(n)}
        </span>
      </>
    );
  }
  const tip = state.kind === 'checking' ? cite.checkingTip : state.kind === 'lost' ? cite.lostTip : state.outside ? cite.outsideTip(n) : cite.noneTip(n);
  return (
    <Tooltip label={tip}>
      <Focusable>
        <span
          className={state.kind === 'none' ? 'cite is-unverified' : state.kind === 'lost' ? 'cite is-disabled' : 'cite is-checking'}
          role="link"
          aria-disabled="true"
          tabIndex={0}
          data-testid="cite-chip"
          data-cite={state.kind}
          data-page={n}
        >
          {state.kind === 'none' && <Icon icon={CircleHelp} size="xs" />}
          {state.kind === 'none' ? cite.none : state.kind === 'checking' ? cite.checking : cite.page(n)}
        </span>
      </Focusable>
    </Tooltip>
  );
}
