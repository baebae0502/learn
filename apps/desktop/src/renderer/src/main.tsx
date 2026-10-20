import { createRoot } from 'react-dom/client';
import type { AppInfo, LearnApi } from '@learn/domain';

declare global {
  interface Window {
    learn: LearnApi;
  }
}

function Boot({ info }: { info: AppInfo }) {
  return (
    <main>
      <h1>Learn</h1>
      <p>스키마 v{info.schemaVersion}</p>
      <div data-testid="app-ready" hidden />
    </main>
  );
}

void window.learn.appInfo().then((r) => {
  if (!r.ok) throw new Error(r.message);
  createRoot(document.getElementById('root')!).render(<Boot info={r.data} />);
});
