import { useRef, type KeyboardEvent } from 'react';
import { acceleratorLabel, commandById } from '@learn/domain';
import { chooseInspectorMode } from '../shell/inspectorMode';
import type { InspectorMode } from '../shell/layout';
import { t } from '../strings';
import { TutorPanel } from '../tutor/TutorPanel';
import { currentPlatform } from '../ui/platform';
import { perfMarkLatest } from '../ui/perfMarks';
import { usePaintedOnce } from '../ui/usePaintedOnce';
import { InfoPane } from './InfoPane';

export type { InspectorMode } from '../shell/layout';

/** The tablist's tabs, in order: the segment's names, and the commands whose keys its tooltips name. */
const TABS = [
  { mode: 'info', label: t.tutor.mode.info, command: 'view.inspectorInfo' },
  { mode: 'tutor', label: t.tutor.mode.tutor, command: 'view.inspectorTutor' },
] as const satisfies ReadonlyArray<{ mode: InspectorMode; label: string; command: 'view.inspectorInfo' | 'view.inspectorTutor' }>;

const tabId = (mode: InspectorMode): string => `inspector-tab-${mode}`;
const PANEL_ID = 'inspector-tabpanel';

/** The reader's head (44): the mode segment, 정보 | 튜터. One tab stop, the arrow keys move between the two. */
function ModeHead({ mode }: { mode: InspectorMode }) {
  const refs = useRef<Partial<Record<InspectorMode, HTMLButtonElement | null>>>({});
  const pick = (next: InspectorMode, focus: boolean) => {
    chooseInspectorMode(next);
    if (focus) refs.current[next]?.focus();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const at = TABS.findIndex((x) => x.mode === mode);
    const to = e.key === 'ArrowRight' ? (at + 1) % TABS.length : e.key === 'ArrowLeft' ? (at + TABS.length - 1) % TABS.length : e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : -1;
    if (to === -1 || e.nativeEvent.isComposing) return;
    e.preventDefault();
    pick(TABS[to]!.mode, true);
  };
  return (
    <div className="inspector-head" data-testid="inspector-head">
      <div className="segmented mode" role="tablist" aria-label={t.tutor.mode.label} data-testid="inspector-modes" onKeyDown={onKeyDown}>
        {TABS.map((x) => {
          const accelerator = commandById(x.command).accelerator;
          const selected = x.mode === mode;
          return (
            <button
              key={x.mode}
              ref={(el) => void (refs.current[x.mode] = el)}
              type="button"
              role="tab"
              id={tabId(x.mode)}
              className="seg"
              aria-selected={selected}
              aria-controls={PANEL_ID}
              data-selected={selected ? '' : undefined}
              tabIndex={selected ? 0 : -1}
              title={`${x.label} ${accelerator ? acceleratorLabel(accelerator, currentPlatform()) : ''}`.trim()}
              data-testid={`inspector-mode-${x.mode}`}
              onClick={() => pick(x.mode, false)}
            >
              {x.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The right panel's contents for one mode (its slot, width and folding are the shell's). The reader's has the 정보 | 튜터 segment in
 * its head (`switchable`); the library's is the info panel alone (spec 8.1).
 */
export function Inspector({ mode, switchable = false }: { mode: InspectorMode; switchable?: boolean }) {
  // Where a long frame's script time goes (the drop stall profile): the item panel's render began here.
  perfMarkLatest('inspector:render');
  // The panel's frame comes with the rows; its content one painted frame later, so a first drop's rows and the panel's
  // statistics are not one long frame (spec 8, the drop stall).
  const painted = usePaintedOnce();
  const content = mode === 'tutor' ? <TutorPanel /> : painted ? <InfoPane /> : null;
  return (
    <div className="inspector-body" data-testid="inspector" data-mode={mode}>
      {switchable && <ModeHead mode={mode} />}
      {switchable ? (
        <div className="inspector-modepane" id={PANEL_ID} role="tabpanel" aria-labelledby={tabId(mode)}>
          {content}
        </div>
      ) : (
        content
      )}
    </div>
  );
}
