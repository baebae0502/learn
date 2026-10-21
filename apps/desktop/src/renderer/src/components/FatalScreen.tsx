import { useEffect } from 'react';
import { DatabaseZap, MonitorX } from 'lucide-react';
import { api, unwrap } from '../api';
import { homeRelative } from '../format';
import { t } from '../strings';
import { Button } from '../ui/Button';
import { Notice } from '../ui/Notice';
import { currentPlatform } from '../ui/platform';
import { Toasts, showToast } from '../ui/toasts';

/** 설정 열기 failed (main answered !ok): said in a toast like any other failed action; main's message is Korean. */
const openSettings = () =>
  void unwrap(api().ui.openSettings()).catch((e: unknown) =>
    showToast({ kind: 'error', title: t.toast.actionFailed, body: (e as Error).message, testId: 'action-error' }),
  );

export interface FatalScreenProps {
  /** `library`: the library could not be opened; `render`: the main window failed to render (RenderBoundary). */
  kind?: 'library' | 'render';
  code: string;
  libraryRoot?: string | null;
  /** The newest pre-update backup main found in libraryRoot (AppInfo.backupFile), or null. */
  backupFile?: string | null;
  homeDir?: string | null;
}

/**
 * Nothing else can be shown. Only our own copy — main's messages can carry paths or engine text — and the error code
 * in the file line's tooltip (C-8). The file line names a backup that exists, never a pattern; without one the
 * sentence points at no backup (n5). The window can still be moved (52 px drag strip).
 */
export function FatalScreen({ kind = 'library', code, libraryRoot = null, backupFile = null, homeDir = null }: FatalScreenProps) {
  // No library, no registry command can run: only main-owned commands (설정…) stay in the menu bar.
  useEffect(() => {
    void api().ui.reportContext({ view: 'library', blocked: true, textSize: 13 });
  }, []);
  const sep = currentPlatform() === 'win32' ? '\\' : '/';
  const backup = kind === 'library' && libraryRoot && backupFile ? `${libraryRoot}${sep}${backupFile}` : null;
  return (
    <div className="fatal" data-testid="fatal-screen">
      <div className="fatal-drag" />
      <div className="stage-center">
        {kind === 'library' ? (
          <Notice
            icon={DatabaseZap}
            title={t.fatal.title}
            file={backup ? homeRelative(backup, homeDir) : undefined}
            fileTitle={backup ? `${backup} (${code})` : undefined}
            testId="fatal-notice"
            actions={
              // The library's location can still be changed: the settings window is main's (app.settings), not the
              // library's. Secondary: the sentence's own next step (restore the backup, restart) is not this (T10-m3).
              <Button testId="fatal-settings" onPress={openSettings}>
                {t.fatal.openSettings}
              </Button>
            }
          >
            {backup ? t.fatal.backupBody : t.fatal.restartBody}
          </Notice>
        ) : (
          <Notice icon={MonitorX} title={t.fatal.renderTitle} testId="fatal-notice">
            {t.fatal.restartBody}
          </Notice>
        )}
      </div>
      <Toasts />
      <div data-testid="app-ready" hidden />
    </div>
  );
}
