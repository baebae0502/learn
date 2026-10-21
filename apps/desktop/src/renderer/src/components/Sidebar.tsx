import { t } from '../strings/legacy';

export function Sidebar({ count, active, onShowLibrary }: { count: number; active: boolean; onShowLibrary(): void }) {
  return (
    <nav className="sidebar" aria-label={t.library}>
      <h2>{t.library}</h2>
      <button className={`nav-item${active ? ' active' : ''}`} onClick={onShowLibrary}>
        {t.allMaterials} <span className="count">{count}</span>
      </button>
      <h2>{t.collections}</h2>
      <p className="muted small">{t.collectionsPending}</p>
    </nav>
  );
}
