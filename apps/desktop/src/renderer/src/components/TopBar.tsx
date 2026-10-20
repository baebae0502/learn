import { t } from '../strings';

export type SaveStatus = 'idle' | 'busy' | 'error';

export function TopBar({ status }: { status: SaveStatus }) {
  const label = status === 'busy' ? t.statusBusy : status === 'error' ? t.statusError : t.statusSaved;
  return (
    <header className="topbar">
      <div className="brand">
        <strong>{t.brand}</strong> / {t.brandSub}
      </div>
      <div className={`save-status save-${status}`} role="status" aria-live="polite">
        LOCAL FIRST · {label}
      </div>
    </header>
  );
}
