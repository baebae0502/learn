import { t } from '../strings';

export function FatalScreen({ code, message, libraryRoot }: { code: string; message: string; libraryRoot: string | null }) {
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
