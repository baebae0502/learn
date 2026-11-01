import type { RestoreDoneSheet, RestoreIssue } from '@learn/domain';
import { formatDateTime, homeRelative } from '../format';
import { t } from '../strings';

export interface RestoreIssueView {
  key: 'missing' | 'damaged' | 'records' | 'counts';
  text: string;
  titles: string[];
  more: number;
}

export interface RestoreSheetText {
  tone: 'success' | 'warning';
  title: string;
  when: string;
  items: string;
  files: string;
  location: string;
  reveal: string;
  issues: RestoreIssueView[];
  /** Under the problem lines when a file is missing, damaged or disagrees: what switching means for those items. */
  missingNote: string | null;
  keep: string;
  switch: string;
  later: string;
}

/** The result sheet's words (spec 9.3, dialogs.html?scene=restore, ?scene=restore-issues): problem lines only when there are some. */
export function restoreSheetText(p: RestoreDoneSheet, platform: string): RestoreSheetText {
  const issues: RestoreIssueView[] = [];
  const add = (key: 'missing' | 'damaged' | 'records', issue: RestoreIssue | null, text: (n: number) => string) => {
    if (issue) issues.push({ key, text: text(issue.count), titles: issue.titles, more: issue.more });
  };
  add('missing', p.missing, t.restore.issues.missing);
  add('damaged', p.damaged, t.restore.issues.damaged);
  add('records', p.records, t.restore.issues.records);
  if (!p.countsMatch) issues.push({ key: 'counts', text: t.restore.issues.counts, titles: [], more: 0 });
  const fileIssue = p.missing !== null || p.damaged !== null || p.records !== null;
  return {
    tone: issues.length > 0 ? 'warning' : 'success',
    title: t.restore.doneTitle,
    when: t.restore.madeAt(formatDateTime(p.backupAt)),
    items: t.restore.items(p.items, p.trashed, p.collections, p.tags),
    files: p.files === 0 ? t.restore.noFiles : p.verified === p.files ? t.restore.filesOk(p.files) : t.restore.filesSome(p.files, p.verified),
    location: homeRelative(p.location, p.homeDir),
    reveal: platform === 'darwin' ? t.settings.reveal.darwin : t.settings.reveal.other,
    issues,
    missingNote: fileIssue ? t.restore.missingNote : null,
    keep: t.restore.keep,
    switch: t.restore.switch,
    later: t.restore.later,
  };
}
