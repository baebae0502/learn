import { BookOpenText, CircleAlert, ListTree, Locate, ShieldX, TextSelect, type LucideIcon } from 'lucide-react';
import { Focusable } from 'react-aria-components';
import type { ToolChip } from '@learn/domain';
import { t } from '../strings';
import { Icon } from '../ui/Icon';
import { Spinner } from '../ui/Spinner';
import { Tooltip } from '../ui/Tooltip';
import { mergeToolChips, type ChipView } from './toolChips';

const { tools } = t.tutor;

/** A chip's words, its tooltip (spec 13), its glyph and its tone; pages are 0-based in the view, 1-based on screen. */
function describe(v: ChipView): { label: string; tip: string | null; icon: LucideIcon | null; tone?: 'warning' | 'danger' } {
  switch (v.kind) {
    case 'selection':
      return { label: tools.selection, tip: tools.selectionTip, icon: TextSelect };
    case 'position':
      return { label: tools.position, tip: tools.positionTip, icon: Locate };
    case 'outline':
      return { label: tools.outline, tip: tools.outlineTip, icon: ListTree };
    case 'read':
      return { label: tools.read(v.from + 1, v.to + 1), tip: tools.readTip(v.from + 1, v.to + 1), icon: BookOpenText };
    case 'reading':
      return { label: tools.reading(v.from + 1, v.to + 1), tip: null, icon: null };
    case 'refused':
      return { label: tools.refused, tip: tools.refusedTip, icon: ShieldX, tone: 'warning' };
    case 'unread':
      return { label: tools.unread, tip: tools.unreadTip, icon: CircleAlert, tone: 'danger' };
  }
}

/** One chip: a status, not a button — in the Tab order for its tooltip, named by its words. */
function Chip({ view }: { view: ChipView }) {
  const d = describe(view);
  const chip = (
    <span className="tool" role="img" aria-label={d.label} tabIndex={0} data-tone={d.tone} data-testid="tool-chip" data-kind={view.kind}>
      {d.icon === null ? <Spinner /> : <Icon icon={d.icon} size="sm" />}
      {d.label}
    </span>
  );
  if (d.tip === null) return chip;
  return (
    <Tooltip label={d.tip}>
      <Focusable>{chip}</Focusable>
    </Tooltip>
  );
}

/** Over a tutor bubble (spec 8.3, P-12): what Learn's tools did in this turn, the call still running last. */
export function ToolChips({ tools: chips, running = null }: { tools: readonly ToolChip[]; running?: ToolChip | null }) {
  const views = mergeToolChips(chips, running);
  if (views.length === 0) return null;
  return (
    <div className="tutor-tools" data-testid="tool-chips">
      {views.map((v, k) => (
        <Chip key={`${v.kind}-${k}`} view={v} />
      ))}
    </div>
  );
}
