import type { BackupDoneSheet } from '@learn/domain';
import { formatDateTime, formatElapsed, formatSize, homeRelative } from '../format';
import { t } from '../strings';

export interface BackupSheetText {
  title: string;
  when: string;
  items: string;
  files: string;
  location: string;
  linkedNote: string | null;
  missingNote: string | null;
  reveal: string;
  done: string;
}

/** The result sheet's words (spec 8.2, dialogs.html?scene=backup): the notes only when there is something to say. */
export function backupSheetText(p: BackupDoneSheet, platform: string): BackupSheetText {
  return {
    title: t.backup.doneTitle,
    when: t.backup.when(formatDateTime(p.at), formatElapsed(p.tookMs)),
    items: t.backup.items(p.items, p.trashed),
    files: p.files > 0 ? t.backup.files(p.files, formatSize(p.bytes)) : t.backup.noFiles,
    location: homeRelative(p.location, p.homeDir),
    linkedNote: p.linked > 0 ? t.backup.linkedNote(p.linked) : null,
    missingNote: p.missing > 0 ? t.backup.missingNote(p.missing) : null,
    reveal: platform === 'darwin' ? t.settings.reveal.darwin : t.settings.reveal.other,
    done: t.common.done,
  };
}

/**
 * A path in two pieces for a line that must shrink: the folders before the last name (without the separator), and the
 * name with its separator in front — the ellipsis cuts the folders, never the mark that this name is the last step.
 */
export function splitLocation(location: string): { parent: string; name: string } {
  const at = Math.max(location.lastIndexOf('/'), location.lastIndexOf('\\'));
  return at < 0 || at === location.length - 1 ? { parent: '', name: location } : { parent: location.slice(0, at), name: location.slice(at) };
}
