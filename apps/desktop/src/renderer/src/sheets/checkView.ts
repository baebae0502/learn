import type { CheckRow, CheckRowKind, LibraryCheckPayload } from '@learn/domain';
import { formatSize, homeRelative } from '../format';
import { t } from '../strings';

export type CheckTone = 'warning' | 'info' | 'success';
/** A row button: an action main runs (sheet:act), or `askClean`, which asks in the row first. */
export type CheckActKey = 'cleanStaging' | 'revive' | 'askClean' | 'revealCorrupt' | 'importOrphanEdits' | 'revealOrphanEdit';
export interface CheckButtonView {
  key: CheckActKey;
  label: string;
}
export interface CheckEntryView {
  key: string;
  label: string;
  /** A linked original's location on screen (home-relative, mono) and in full as its tooltip. */
  path: string | null;
  pathTitle: string | null;
  /** The item this line's 다시 연결… acts on; null for a line with no button. */
  relinkItemId: string | null;
}
export interface CheckRowView {
  kind: CheckRowKind;
  /** What is left (0 on a done row): the 정리… question names it. */
  count: number;
  state: CheckRow['state'];
  tone: CheckTone;
  title: string;
  text: string;
  /** The footnote line: a size, or the first copy's name and the size. */
  meta: string | null;
  /** The end of `meta` that stays whole when the line is short of room (" · 3.1 KB"): the name before it gives way. */
  metaTail: string | null;
  buttons: CheckButtonView[];
  entries: CheckEntryView[];
  /** 외 N개 after the names. */
  more: number;
}

/** Rows that tell, with nothing for the app to fix (the user removes a corrupt copy; an edited copy is theirs). */
const INFO: ReadonlySet<CheckRowKind> = new Set<CheckRowKind>(['corrupt', 'orphanEdits']);

const reveal = (platform: string) => (platform === 'darwin' ? t.check.actions.reveal.darwin : t.check.actions.reveal.other);

function buttonsOf(kind: CheckRowKind, platform: string): CheckButtonView[] {
  const a = t.check.actions;
  if (kind === 'staging') return [{ key: 'cleanStaging', label: a.cleanStaging }];
  if (kind === 'unreferenced') return [{ key: 'revive', label: a.revive }, { key: 'askClean', label: a.clean }];
  if (kind === 'corrupt') return [{ key: 'revealCorrupt', label: reveal(platform) }];
  if (kind === 'orphanEdits') return [{ key: 'importOrphanEdits', label: a.importNew }, { key: 'revealOrphanEdit', label: reveal(platform) }];
  return []; // the item rows: one 다시 연결… per name
}

function metaOf(row: CheckRow): string | null {
  if (row.kind === 'staging' || row.kind === 'unreferenced') return formatSize(row.bytes);
  if (row.kind !== 'corrupt' && row.kind !== 'orphanEdits') return null;
  const first = row.entries[0];
  if (!first) return formatSize(row.bytes);
  const name = row.count > 1 ? t.check.withMore(first.label, row.count - 1) : first.label;
  return `${name} · ${formatSize(row.bytes)}`;
}

function metaTailOf(row: CheckRow): string | null {
  if ((row.kind !== 'corrupt' && row.kind !== 'orphanEdits') || !row.entries[0]) return null;
  return ` · ${formatSize(row.bytes)}`;
}

/** One row as the sheet draws it (mockup recoverySheet `ci`): status, title, sentence, footnote, buttons, names. */
export function checkRowView(row: CheckRow, homeDir: string, platform: string): CheckRowView {
  const copy = t.check.rows[row.kind];
  if (row.state === 'done') {
    return { kind: row.kind, count: 0, state: 'done', tone: 'success', title: copy.name, text: t.check.fixed[row.fix ?? 'none'], meta: null, metaTail: null, buttons: [], entries: [], more: 0 };
  }
  const items = row.kind === 'missingManaged' || row.kind === 'missingLinked';
  const entries: CheckEntryView[] = items
    ? row.entries.map((e) => ({
        key: e.itemId ?? e.label,
        label: e.label,
        path: e.path === null ? null : homeRelative(e.path, homeDir),
        pathTitle: e.path,
        relinkItemId: e.itemId,
      }))
    : [];
  return {
    kind: row.kind,
    count: row.count,
    state: 'todo',
    tone: INFO.has(row.kind) ? 'info' : 'warning',
    title: copy.title(row.count),
    text: copy.text,
    meta: metaOf(row),
    metaTail: metaTailOf(row),
    buttons: buttonsOf(row.kind, platform),
    entries,
    more: items ? Math.max(0, row.count - entries.length) : 0,
  };
}

/** The sentence under the title: what was found, never a cause the app did not record (spec 7.2, Task 1 ruling 3). */
export function checkIntro(p: LibraryCheckPayload): string {
  if (p.rows.length === 0) return t.check.intro.fine;
  return p.mode === 'auto' ? t.check.intro.auto : t.check.intro.manual;
}
/** The badge: warning while something is left to do, success when nothing was found or all of it is fixed. */
export const checkBadge = (p: LibraryCheckPayload): 'warning' | 'success' => (p.rows.some((r) => r.state === 'todo') ? 'warning' : 'success');
/** The pointer to 파일 › 라이브러리 점검: on the sheet that opened by itself only (from the menu it was just used). */
export const checkHintShown = (p: LibraryCheckPayload): boolean => p.mode === 'auto' && p.rows.length > 0;
