import { COMMANDS, acceleratorKeys, acceleratorLabel, commandLabel, keySpecKeys, type CommandContext, type CommandId } from '@learn/domain';
import { t } from '../strings';

export interface ShortcutRow {
  label: string;
  keys: string[];
  /** Read by screen readers instead of the decorative keycaps. */
  spoken: string;
  /** The keys are alternatives (↑ or ↓), drawn apart; otherwise they are one chord (⌘ K). */
  alternatives?: true;
}
export interface ShortcutGroup {
  title: string;
  rows: ShortcutRow[];
}

const ORDER: CommandContext[] = ['app', 'library', 'viewer'];
/**
 * The sheet's own order (design-spec 7.4: ⌘, then ⌘K, ⌘/ and ⌃⌘S): these lead their group in this order, the rest
 * follow in registry order. COMMANDS itself keeps app.palette last (R-10).
 */
const SHEET_ORDER: readonly CommandId[] = ['app.settings', 'app.palette', 'app.shortcuts', 'view.toggleSidebar'];
const sheetRank = (id: CommandId) => {
  const i = SHEET_ORDER.indexOf(id);
  return i < 0 ? SHEET_ORDER.length : i;
};
/**
 * design-spec 7.4 팔레트·대화상자: ↑ ↓ move the palette's cursor, ↩ runs it (or a sheet's default button), esc closes.
 * Spelled per platform like the registry keys.
 */
const DIALOG_KEYS = [
  { label: t.sheets.dialogKeys.move, accelerators: ['Up', 'Down'], alternatives: true },
  { label: t.sheets.dialogKeys.run, accelerators: ['Enter'] },
  { label: t.sheets.dialogKeys.close, accelerators: ['Escape'] },
] as const;

/** The ⌘/ sheet: every registry shortcut by its first context (labelled as the menus label it), then the palette and dialog keys. */
export function shortcutGroups(platform: string): ShortcutGroup[] {
  const groups = ORDER.map((ctx) => ({
    title: t.sheets.groups[ctx],
    rows: COMMANDS.filter((c) => c.contexts[0] === ctx && (c.accelerator !== undefined || c.key !== undefined))
      .sort((a, b) => sheetRank(a.id) - sheetRank(b.id)) // stable: the rest keep the registry order
      .map((c): ShortcutRow => {
        const keys = c.accelerator ? acceleratorKeys(c.accelerator, platform) : keySpecKeys(c.key!, platform);
        return { label: commandLabel(c, platform), keys, spoken: c.accelerator ? acceleratorLabel(c.accelerator, platform) : keys.join('+') };
      }),
  })).filter((g) => g.rows.length > 0);
  const dialogs: ShortcutGroup = {
    title: t.sheets.groups.dialogs,
    rows: DIALOG_KEYS.map((r) => ({
      label: r.label,
      keys: r.accelerators.flatMap((a) => acceleratorKeys(a, platform)),
      spoken: r.accelerators.map((a) => acceleratorLabel(a, platform)).join(' '),
      ...('alternatives' in r ? { alternatives: true as const } : {}),
    })),
  };
  return [...groups, dialogs];
}
