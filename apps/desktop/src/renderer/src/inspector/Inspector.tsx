import { perfMarkLatest } from '../ui/perfMarks';
import { usePaintedOnce } from '../ui/usePaintedOnce';
import { InfoPane } from './InfoPane';

/** The right slot's modes (design-spec 2.5): info now; the tutor joins in T1, and no mode switch is drawn before then. */
export type InspectorMode = 'info';

/** The item panel's contents for one mode (its slot, width and folding are the shell's). */
export function Inspector({ mode }: { mode: InspectorMode }) {
  // Where a long frame's script time goes (the drop stall profile): the item panel's render began here.
  perfMarkLatest('inspector:render');
  // The panel's frame comes with the rows; its content one painted frame later, so a first drop's rows and the panel's
  // statistics are not one long frame (spec 8, the drop stall).
  const painted = usePaintedOnce();
  return (
    <div className="inspector-body" data-testid="inspector" data-mode={mode}>
      {painted ? <InfoPane /> : null}
    </div>
  );
}
