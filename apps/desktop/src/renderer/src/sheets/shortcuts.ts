import { COMMANDS, acceleratorKeys, acceleratorLabel, commandLabel, keySpecKeys, tagSlot, type CommandId } from '@learn/domain';
import { t } from '../strings';

export interface ShortcutRow {
  label: string;
  keys: string[];
  /** Read by screen readers instead of the decorative keycaps. */
  spoken: string;
  /** The keys are alternatives (↑ or ↓), drawn apart; otherwise they are one chord (⌘ K). */
  alternatives?: true;
  /** Not a registry command: a system item the menu bar carries (전체 화면). */
  system?: true;
  /** A pair line of the design-spec 7.4 table ("A / B"): the second chord, drawn after a slash; `keys` is the first. */
  pairKeys?: string[];
}
export interface ShortcutGroup {
  title: string;
  rows: ShortcutRow[];
}

/**
 * Groups by a command's first context; the selected item's commands follow the library's (design-spec 7.4 ⇧⌘R). 정리 holds
 * the collection and tag commands whatever their context (M5 spec 9.3), then the colour keys.
 */
const ORDER = ['app', 'library', 'item', 'organize', 'tabs', 'viewer'] as const;
const groupOf = (c: (typeof COMMANDS)[number], view?: 'library' | 'viewer'): (typeof ORDER)[number] =>
  /^(collection|tags?)\./.test(c.id)
    ? 'organize'
    : c.id.startsWith('tab.')
      ? 'tabs'
      : // A key the library and the reader share (named by the view: stateLabels.view) is listed once, under the view the sheet was opened from.
      view === 'viewer' && c.stateLabels?.view
      ? 'viewer'
      : (c.contexts[0] as (typeof ORDER)[number]);
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

/**
 * design-spec 7.4 앱: ⌃⌘F 전체 화면(시스템). Main builds the item outside the registry (a plain item on macOS, Electron's
 * togglefullscreen role on F11 elsewhere: main/menu/app-menu.ts), so it is a static row here, marked `system`, after the
 * registry's app rows. The registry stays the only source of commands and their keys.
 */
const SYSTEM_APP_ROWS = (platform: string): ShortcutRow[] => {
  const accelerator = platform === 'darwin' ? 'Ctrl+Cmd+F' : 'F11';
  return [{ label: t.sheets.fullScreen, keys: acceleratorKeys(accelerator, platform), spoken: acceleratorLabel(accelerator, platform), system: true }];
};

/** The colour keys as one line (spec 4.2): the first and last slot's key, spelled the way the platform spells a key. */
function colorKeysRow(platform: string): ShortcutRow {
  const slots = COMMANDS.filter((c) => tagSlot(c.id) !== null && c.key !== undefined);
  const first = keySpecKeys(slots[0]!.key!, platform).at(-1)!;
  const last = keySpecKeys(slots.at(-1)!.key!, platform).at(-1)!;
  return { label: t.sheets.colorKeys.label, keys: [`${first}–${last}`], spoken: t.sheets.colorKeys.spoken(first, last) };
}

/**
 * The lines of design-spec 7.4 that name two keys ("⌘G / ⇧⌘G"): one row for the pair, at the place of its `anchor` in the registry
 * order, standing for the commands it `takes`. `view`: the label by the view the sheet was opened from.
 */
interface PairSpec {
  anchor: CommandId;
  takes: readonly [CommandId, ...CommandId[]];
  label: (view?: 'library' | 'viewer') => string;
  /** The commands whose keys are the two chords. */
  a: CommandId;
  b: CommandId;
}
const spec = (id: CommandId) => COMMANDS.find((c) => c.id === id)!;
const accelOf = (id: CommandId): string => spec(id).accelerator!;
/** A command's key as keycaps and as read aloud: its accelerator, or its single key (F6). */
function chordOf(id: CommandId, platform: string): { keys: string[]; spoken: string } {
  const c = spec(id);
  const keys = c.accelerator ? acceleratorKeys(c.accelerator, platform) : keySpecKeys(c.key!, platform);
  return { keys, spoken: c.accelerator ? acceleratorLabel(c.accelerator, platform) : keys.join(platform === 'darwin' ? '' : '+') };
}
const pair = (anchor: CommandId, other: CommandId, label: PairSpec['label']): PairSpec => ({ anchor, takes: [anchor, other], label, a: anchor, b: other });
const TAB_NUMBER_IDS = COMMANDS.filter((c) => c.menu?.hidden).map((c) => c.id);
const PAIRS: readonly PairSpec[] = [
  pair('file.importManaged', 'file.importLinked', () => t.sheets.pairs.import),
  pair('view.nextPane', 'view.previousPane', () => t.sheets.pairs.panes),
  pair('view.textBigger', 'view.textSmaller', (view) => (view === 'viewer' ? t.sheets.pairs.zoom : t.sheets.pairs.text)),
  pair('tab.close', 'tab.reopenClosed', () => t.sheets.pairs.tabClose),
  pair('tab.next', 'tab.previous', () => t.sheets.pairs.tabStep),
  pair('reader.findNext', 'reader.findPrevious', () => t.sheets.pairs.find),
  pair('reader.rotateCw', 'reader.rotateCcw', () => t.sheets.pairs.rotate),
  pair('reader.showThumbnails', 'reader.showOutline', () => t.sheets.pairs.nav),
  pair('nav.historyBack', 'nav.historyForward', () => t.sheets.pairs.history),
  // ⌘1 is the library tab, ⌘2…⌘8 the numbered ones, ⌘9 the last: "⌘1…⌘8 / ⌘9" (the chords below are spelled by tabNumbersRow).
  { anchor: 'tab.goTo2', takes: ['nav.back', ...TAB_NUMBER_IDS] as unknown as PairSpec['takes'], label: () => t.sheets.pairs.tabNumbers, a: 'nav.back', b: 'tab.last' },
];
const PAIR_BY_ANCHOR = new Map(PAIRS.map((p) => [p.anchor, p]));
/** Every command a pair row stands for (its anchor included): none of them is also a row of its own. */
const PAIR_TAKEN = new Set<CommandId>(PAIRS.flatMap((p) => p.takes));

/** The keycaps of a pair's two chords; "⌘1…⌘8 / ⌘9" spells the first as a range. */
function pairRow(p: PairSpec, platform: string, view?: 'library' | 'viewer'): ShortcutRow {
  const range = p.anchor === 'tab.goTo2';
  const first = chordOf(p.a, platform);
  const second = chordOf(p.b, platform);
  const last = acceleratorKeys(accelOf('tab.goTo8'), platform).at(-1)!;
  const keys = range ? [...first.keys.slice(0, -1), `${first.keys.at(-1)!}–${last}`] : first.keys;
  const spokenA = range ? `${first.spoken}${t.sheets.tabNumbersTo}${acceleratorLabel(accelOf('tab.goTo8'), platform)}` : first.spoken;
  return { label: p.label(view), keys, pairKeys: second.keys, spoken: `${spokenA} / ${second.spoken}` };
}

/**
 * The ⌘/ sheet: every registry shortcut by its first context (labelled as the menus label it), the system's 전체 화면
 * after the app rows, then the palette and dialog keys. `view`: ⌘F ⌘+ ⌘− ⌘0 are named as that view's menu names them, and from
 * the reader they are listed under 리더 (moved from 라이브러리, not repeated).
 */
export function shortcutGroups(platform: string, view?: 'library' | 'viewer'): ShortcutGroup[] {
  const groups = ORDER.map((ctx) => ({
    title: t.sheets.groups[ctx],
    rows: COMMANDS.filter((c) => groupOf(c, view) === ctx)
      .sort((a, b) => sheetRank(a.id) - sheetRank(b.id)) // stable: the rest keep the registry order
      .flatMap((c): ShortcutRow[] => {
        const stands = PAIR_BY_ANCHOR.get(c.id);
        if (stands) return [pairRow(stands, platform, view)];
        if (PAIR_TAKEN.has(c.id) || (c.accelerator === undefined && c.key === undefined) || tagSlot(c.id) !== null || c.menu?.hidden) return [];
        const keys = c.accelerator ? acceleratorKeys(c.accelerator, platform) : keySpecKeys(c.key!, platform);
        // A single key is spoken like an accelerator: ⇧F6 on macOS, Shift+F6 elsewhere.
        const spoken = c.accelerator ? acceleratorLabel(c.accelerator, platform) : keys.join(platform === 'darwin' ? '' : '+');
        return [{ label: commandLabel(c, platform, view ? { view } : {}), keys, spoken }];
      }),
  }))
    .map((g, i) => (ORDER[i] === 'app' ? { ...g, rows: [...g.rows, ...SYSTEM_APP_ROWS(platform)] } : g))
    // The eight colour keys are one line, last in 정리 (spec 4.2).
    .map((g, i) => (ORDER[i] === 'organize' ? { ...g, rows: [...g.rows, colorKeysRow(platform)] } : g))
    .filter((g) => g.rows.length > 0);
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

/** A group's height as sheet.css draws it: its label (16 + 8), the card (4 + 4) and 28 px rows with 1 px between. */
const groupHeight = (g: ShortcutGroup): number => 31 + 29 * g.rows.length;
const GROUP_GAP = 16;
const columnHeight = (groups: readonly ShortcutGroup[]): number => groups.reduce((h, g, i) => h + groupHeight(g) + (i > 0 ? GROUP_GAP : 0), 0);

/**
 * The wide sheet's two columns (design-spec 6 시트, 넓게): the groups in ORDER, read down the first column and then
 * the second, never split; cut where the taller column is shortest, so the sheet stays short as commands are added.
 */
export function shortcutColumns(groups: readonly ShortcutGroup[]): [ShortcutGroup[], ShortcutGroup[]] {
  if (groups.length < 2) return [[...groups], []];
  let cut = 1;
  let best = Infinity;
  for (let k = 1; k < groups.length; k++) {
    const taller = Math.max(columnHeight(groups.slice(0, k)), columnHeight(groups.slice(k)));
    if (taller < best) {
      best = taller;
      cut = k;
    }
  }
  return [groups.slice(0, cut), groups.slice(cut)];
}
