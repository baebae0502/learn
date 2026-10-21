import { useEffect } from 'react';
import { DatabaseZap, MonitorX } from 'lucide-react';
import { api } from '../api';
import { t } from '../strings';
import { Notice } from '../ui/Notice';
import { currentPlatform } from '../ui/platform';

/**
 * Nothing else can be shown: the library could not be opened (`library`), or the main window failed to render
 * (`render`, RenderBoundary). Only our own copy — main's messages can carry paths or engine text — and the error code
 * in the file line's tooltip (C-8). The window can still be moved (52 px drag strip).
 */
export function FatalScreen({ code, libraryRoot, kind = 'library' }: { code: string; libraryRoot: string | null; kind?: 'library' | 'render' }) {
  // No library, no registry command can run: only main-owned commands stay in the menu bar.
  useEffect(() => {
    void api().ui.reportContext({ view: 'library', blocked: true });
  }, []);
  // C-8: the backup's file name (with its folder) is the notice's monospace file line; the prose only names it.
  const sep = currentPlatform() === 'win32' ? '\\' : '/';
  const backup = libraryRoot ? `${libraryRoot}${sep}${t.fatal.backupFile}` : t.fatal.backupFile;
  return (
    <div className="fatal" data-testid="fatal-screen">
      <div className="fatal-drag" />
      <div className="stage-center">
        {kind === 'library' ? (
          <Notice icon={DatabaseZap} title={t.fatal.title} file={backup} fileTitle={`${backup} (${code})`} testId="fatal-notice">
            {t.fatal.hint}
          </Notice>
        ) : (
          <Notice icon={MonitorX} title={t.fatal.renderTitle} testId="fatal-notice">
            {t.fatal.renderBody}
          </Notice>
        )}
      </div>
      <div data-testid="app-ready" hidden />
    </div>
  );
}
