import { t } from '../strings/legacy';

/** Placeholder only: no fake chat, no hard-coded memory. Implemented in P3. */
export function TutorPanel({ onClose }: { onClose(): void }) {
  return (
    <aside className="tutor" data-testid="tutor-panel" aria-label={t.tutorTitle}>
      <div className="tutor-head">
        <h2>{t.tutorTitle}</h2>
        <button className="icon" data-testid="tutor-close" aria-label={t.closePanel} onClick={onClose}>×</button>
      </div>
      <p className="muted small">{t.tutorScope}</p>
      <p className="pending">{t.tutorPending}</p>
    </aside>
  );
}
