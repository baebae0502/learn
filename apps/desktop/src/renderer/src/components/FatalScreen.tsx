import type { AppInfo } from '@learn/domain';
import { t } from '../strings';

export function FatalScreen({ info }: { info: AppInfo }) {
  return (
    <main className="fatal" role="alert">
      <h1>{t.fatalTitle}</h1>
      <p>{info.libraryError?.message}</p>
      <p className="muted small">({info.libraryError?.code})</p>
      <p>{t.fatalHint}</p>
      <p className="muted small">{t.libraryPath}: {info.libraryRoot}</p>
      <div data-testid="app-ready" hidden />
    </main>
  );
}
