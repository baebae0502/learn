import { useEffect } from 'react';
import { api } from '../api';
import { t } from '../strings/legacy';

export function FatalScreen({ code, message, libraryRoot }: { code: string; message: string; libraryRoot: string | null }) {
  // No library, no registry command can run: only main-owned commands stay in the menu bar.
  useEffect(() => {
    void api().ui.reportContext({ view: 'library', blocked: true });
  }, []);
  return (
    <main className="fatal" role="alert">
      <h1>{t.fatalTitle}</h1>
      <p>{message}</p>
      <p className="muted small">({code})</p>
      <p>{t.fatalHint}</p>
      {libraryRoot !== null && <p className="muted small">{t.libraryPath}: {libraryRoot}</p>}
      <div data-testid="app-ready" hidden />
    </main>
  );
}
