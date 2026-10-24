import { InfoPane } from './InfoPane';

/** The right slot's modes (design-spec 2.5): info now; the tutor joins in T1, and no mode switch is drawn before then. */
export type InspectorMode = 'info';

/** The item panel's contents for one mode (its slot, width and folding are the shell's). */
export function Inspector({ mode }: { mode: InspectorMode }) {
  return (
    <div className="inspector-body" data-testid="inspector" data-mode={mode}>
      <InfoPane />
    </div>
  );
}
