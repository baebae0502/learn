import { useId, useLayoutEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { Clapperboard, FileText, ListFilter, Search } from 'lucide-react';
import { Dialog, Modal, ModalOverlay } from 'react-aria-components';
import { COMMANDS, commandById, commandLabel, commandMention, inPalette, type CommandId, type LibraryItem } from '@learn/domain';
import { useCommands } from '../commands/CommandProvider';
import { COMMAND_ICONS } from '../commands/icons';
import { useItems, useSearchTexts } from '../data/queries';
import { search, searchIndexFor } from '../library/search';
import { useShell } from '../state/shell-store';
import { t } from '../strings';
import { Icon } from '../ui/Icon';
import { Kbd } from '../ui/Kbd';
import { currentPlatform } from '../ui/platform';
import { setTooltipBlock } from '../ui/tooltipGate';
import { highlight } from './highlight';
import { initialsExample, itemMeta, rankItems, type RankedItem } from './items';
import { rankCommands, type RankedCommand } from './rank';
import { usePaletteRecent } from './recent';
import { searchLibrary } from './searchRow';

const NO_ITEMS: readonly LibraryItem[] = [];

/** ⌘K (`app.palette`): opens the palette (remembering what had the focus), or selects its field when it is already open. */
export function openPalette(): void {
  const shell = useShell.getState();
  if (shell.paletteOpen) {
    const input = document.querySelector<HTMLInputElement>('[data-testid="palette-input"]');
    input?.focus();
    input?.select();
    return;
  }
  shell.setPaletteOpen(true, document.activeElement);
}

/**
 * Closes the palette, gives the focus back to its opener at once, then runs `then` (a command picked in the palette,
 * or from the menu bar while it is open). The command thus acts from where the user was, as if the palette had never
 * been up: when it hides the opener (사이드바 가리기 from the sidebar launcher), the sidebar's own focus rescue sees
 * that and moves the focus on (useSidebar keepFocusAcross) — it never falls to <body> with the unmounted opener.
 * RAC's FocusScope would restore the opener only a frame after the palette unmounts, i.e. after the command.
 */
export function closePalette(then?: () => void): void {
  const opener = useShell.getState().paletteOpener;
  // Synchronously: the overlay is gone, so its focus containment no longer pulls the focus back. Closing forgets the
  // opener in the store.
  flushSync(() => useShell.getState().setPaletteOpen(false));
  const active = document.activeElement;
  if ((active === null || active === document.body) && opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true });
  then?.();
}

/**
 * A key that belongs to a Korean composition (isComposing, or keyCode 229) must not act: the cursor does not move, no
 * command runs and the palette does not close (ADR-0005 §3). Stopped in the capture phase, so neither the field's own
 * keys nor RAC's esc on the modal see it — including the keyCode 229 keys macOS IMEs send without isComposing (the
 * confirming ↩).
 */
export function stopWhileComposing(e: KeyboardEvent): void {
  if (e.nativeEvent.isComposing || e.keyCode === 229) e.stopPropagation();
}

/** ⌘K palette (palette.html, design-spec 10.5): items and the commands that can run now, 초성 search, ↩ runs once. */
export function Palette() {
  const open = useShell((s) => s.paletteOpen);
  // Read with the window, not on the first ⌘K: the recent commands are in place the first time the palette opens.
  const recent = usePaletteRecent();
  // Opening closes any tooltip and none opens while the palette is up (ui/tooltipGate.ts).
  useLayoutEffect(() => {
    if (!open) return;
    setTooltipBlock('modal', true);
    return () => setTooltipBlock('modal', false);
  }, [open]);
  // Mounted only while open, so it leaves at once when closed (there is no exit animation): a ⌘K right after ↩ gets a
  // fresh palette with an empty query and the focus in its field, not the old one cancelling its exit.
  if (!open) return null;
  return (
    // esc and a click on the scrim (RAC) close it like a picked command, minus the command.
    <ModalOverlay className="palette-scrim" isOpen onOpenChange={(next) => !next && closePalette()} isDismissable>
      <Modal className="palette-modal">
        <PaletteDialog recent={recent.ids} remember={recent.remember} />
      </Modal>
    </ModalOverlay>
  );
}

/** A row under the one cursor: an item (↩ opens it), a command (↩ runs it), or the hand-off to the quick search. */
type Row =
  | { kind: 'item'; key: string; ranked: RankedItem }
  | { kind: 'command'; key: string; ranked: RankedCommand }
  | { kind: 'search'; key: 'search' };

/**
 * The dialog itself, mounted with each opening (the query starts empty). The field is an ARIA combobox over a listbox
 * with one cursor row, kept here (the Raycast / VS Code model): whenever the list has rows the cursor is on one — the
 * first after opening and after every edit (typing, Backspace, paste, undo), the one ↑ ↓ or the pointer moved it to
 * otherwise, as long as that row is listed. ↩ runs it. (RAC's Autocomplete cleared its cursor on delete, paste and undo
 * and set none on open, so ↩ did nothing under a footer that says 실행.)
 */
function PaletteDialog({ recent, remember }: { recent: readonly CommandId[]; remember(id: CommandId): void }) {
  const { env, run, isEnabled } = useCommands();
  const [query, setQuery] = useState('');
  /** The row the user moved the cursor to; null puts it on the first row. */
  const [cursorKey, setCursorKey] = useState<string | null>(null);
  const ids = useId();
  const platform = currentPlatform();
  const q = query.trim();
  /** 설정 as the hints name it: ㅅㅈ → 설정, when no title gives an example. */
  const settingsName = commandMention(commandById('app.settings'), platform);
  // The pane states the toggles' names follow (사이드바 가리기 / 사이드바 보기), as the menu bar has them.
  const state = { sidebar: env.sidebar, inspector: env.inspector };
  // Item commands (Finder에서 보기, 기본 앱으로 열기, 사본 내보내기… and 정보 편집) are judged and run on the table
  // selection, which only the library view shows. Judged once per env rather than on every keystroke: a selection can
  // hold every row (⌘A).
  const itemTarget = useMemo(() => ({ itemIds: env.view === 'library' ? env.selection() : [] }), [env]);
  const itemCommands = useMemo(
    () => new Set(COMMANDS.filter((c) => c.contexts.includes('item') && inPalette(c) && isEnabled(c.id, itemTarget)).map((c) => c.id)),
    [isEnabled, itemTarget],
  );
  const targetOf = (id: CommandId) => (commandById(id).contexts.includes('item') ? itemTarget : {});
  // Only what can run now (no fake commands), exactly as the registry says, re-read on every render: the list follows
  // availability while open. While an import or a sheet holds the window that is the main-owned 설정… alone, under the
  // notice that says why the rest is missing.
  const commands = rankCommands(
    COMMANDS.filter((c) => inPalette(c) && (c.contexts.includes('item') ? itemCommands.has(c.id) : isEnabled(c.id))),
    query,
    platform,
    state,
    recent,
  );

  const list = useItems().data ?? NO_ITEMS;
  // The quick search's long fields, read once a query is typed: the same read as the toolbar's.
  const texts = useSearchTexts(q !== '').data;
  // The toolbar's own index of this list (one per list array and long-field read). search, not searchCached: that keeps
  // one answer per index, the toolbar's, which the palette's query must not push out.
  const found = useMemo(() => {
    if (q === '') return [];
    const result = search(searchIndexFor(list, texts), q);
    return result ? rankItems(list, result) : [];
  }, [q, list, texts]);
  // An item row runs 열기 on that item: listed only while it can run (never while the window is held).
  const items = found.filter((r) => isEnabled('item.open', { itemIds: [r.item.id] }));
  // 라이브러리에서 ‘…’ 검색: only where the quick search is (a library with items) and nothing holds the window.
  const searchRow = q !== '' && !env.blocked && env.libraryCount > 0;
  const rows: Row[] = [
    ...items.map((ranked): Row => ({ kind: 'item', key: `item:${ranked.item.id}`, ranked })),
    ...commands.map((ranked): Row => ({ kind: 'command', key: `command:${ranked.command.id}`, ranked })),
    ...(searchRow ? [{ kind: 'search', key: 'search' } as const] : []),
  ];
  /** Nothing matched (the search row may still be there: palette.html ?state=none). */
  const none = items.length === 0 && commands.length === 0;
  const cursor = rows.length === 0 ? -1 : Math.max(0, rows.findIndex((r) => r.key === cursorKey));
  const listId = `${ids}-list`;
  const optionId = (index: number) => `${ids}-option-${index}`;
  /** The 초성 example of the hints: a word from the library's titles, else ㅅㅈ → 설정. */
  const example = useMemo(() => {
    const e = initialsExample(list);
    return e ? t.palette.example(e.initials, e.word) : t.palette.example('ㅅㅈ', settingsName);
  }, [list, settingsName]);

  // Read out politely when the result changes (the counts, or the notice that replaces the list); a cursor move or an
  // edit that leaves the same counts changes nothing here, so nothing is re-announced.
  const status = env.blocked
    ? commands.length > 0
      ? t.palette.busyStatus(commands.length)
      : t.palette.busyTitle
    : none
      ? t.palette.emptyTitle(q)
      : t.palette.resultCount(items.length, commands.length + (searchRow ? 1 : 0));
  // An import or a sheet holds the window (not "no match"). Alone when nothing is listed: nothing can run until it ends.
  // Above the commands that still run (설정…): a header — not an option, never under the cursor — that says the others
  // come back when the work ends.
  // Defensive: nothing holds the window under an open palette in the app's own flows. ⌘K and the launcher are refused
  // while it is held, every command closes the palette before it runs, and a file drag closes it before its drop starts
  // an import (shell/DropOverlay.tsx). An import that does not start in this window would reach it.
  const busy = env.blocked && (
    <div className="p-empty" data-testid="palette-busy">
      <div className="pe-title">{commands.length > 0 ? t.palette.busyHeaderTitle : t.palette.busyTitle}</div>
      <div className="pe-text">{commands.length > 0 ? t.palette.busyHeaderBody : t.palette.busyBody}</div>
    </div>
  );
  const empty = !env.blocked && none && (
    <div className="p-empty" data-testid="palette-empty">
      <div className="pe-title">{t.palette.emptyTitle(q)}</div>
      <div className="pe-text">{t.palette.emptyBody(example)}</div>
    </div>
  );
  const cursorElementId = cursor >= 0 ? optionId(cursor) : null;
  // Keep the cursor row in view when ↑ ↓ move it past the list's edge.
  useLayoutEffect(() => {
    if (cursorElementId) document.getElementById(cursorElementId)?.scrollIntoView({ block: 'nearest' });
  }, [cursorElementId]);

  const execute = (row: Row) => {
    if (row.kind === 'item') closePalette(() => run('item.open', { itemIds: [row.ranked.item.id] }));
    else if (row.kind === 'search') closePalette(() => searchLibrary(q, run, env.view));
    else {
      const { command } = row.ranked;
      closePalette(() => {
        // palette.recent keeps what was picked here and ran, not the item and search rows.
        if (run(command.id, targetOf(command.id))) remember(command.id);
      });
    }
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); // not the caret's start/end
      if (cursor < 0) return;
      const next = Math.min(rows.length - 1, Math.max(0, cursor + (e.key === 'ArrowDown' ? 1 : -1)));
      setCursorKey(rows[next]!.key);
    } else if (e.key === 'Enter' && !(e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) && cursor >= 0) {
      e.preventDefault(); // no keypress for the opener, which has the focus again by then
      execute(rows[cursor]!);
    }
  };

  /** One option: the cursor follows the pointer (only when it moves), the field keeps the focus, a click runs the row. */
  const option = (row: Row, index: number, testIds: Record<string, string>, children: ReactNode) => (
    <div
      key={row.key}
      id={optionId(index)}
      role="option"
      aria-selected={index === cursor}
      className="p-item"
      data-focused={index === cursor ? 'true' : undefined}
      {...testIds}
      onPointerMove={() => index !== cursor && setCursorKey(row.key)}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => execute(row)}
    >
      {children}
    </div>
  );
  const renderRow = (row: Row, index: number) => {
    if (row.kind === 'item') {
      const { item, match } = row.ranked;
      return option(row, index, { 'data-testid': 'palette-result', 'data-item-id': item.id }, (
        <>
          <Icon icon={item.type === 'video' ? Clapperboard : FileText} />
          <span className="p-title ellipsis">{highlight(item.title, match)}</span>
          <span className="p-meta">
            <span className="p-sub ellipsis">{itemMeta(item)}</span>
            {/* palette.html: ↩ on the row under the cursor only. */}
            {index === cursor && <Kbd accelerator="Enter" />}
          </span>
        </>
      ));
    }
    if (row.kind === 'search') {
      return option(row, index, { 'data-testid': 'palette-search-library' }, (
        <>
          <Icon icon={ListFilter} />
          <span className="p-title ellipsis">{t.palette.searchLibrary(q)}</span>
          <span className="p-meta">
            <Kbd accelerator={commandById('library.find').accelerator} />
          </span>
        </>
      ));
    }
    const { command, match } = row.ranked;
    return option(row, index, { 'data-testid': 'palette-item', 'data-command-id': command.id }, (
      <>
        <Icon icon={COMMAND_ICONS[command.id]} />
        <span className="p-title ellipsis">{highlight(commandLabel(command, platform, state), match)}</span>
        {command.accelerator && (
          <span className="p-meta">
            <Kbd accelerator={command.accelerator} />
          </span>
        )}
      </>
    ));
  };

  return (
    <Dialog className="palette" aria-label={t.palette.dialogLabel} data-testid="palette">
      <div className="p-body" onKeyDownCapture={stopWhileComposing}>
        <div className="p-input">
          <Icon icon={Search} />
          <input
            className="p-field"
            role="combobox"
            aria-label={t.palette.inputLabel}
            aria-autocomplete="list"
            aria-expanded={rows.length > 0}
            aria-controls={rows.length > 0 ? listId : undefined}
            aria-activedescendant={cursor >= 0 ? optionId(cursor) : undefined}
            placeholder={t.palette.placeholder}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCursorKey(null); // every edit puts the cursor back on the first row
            }}
            onKeyDown={onKeyDown}
            autoFocus
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            data-testid="palette-input"
          />
          {/* palette.html p-scope: the esc keycap at the end of the input row. */}
          <span className="p-scope" data-testid="palette-esc">
            <Kbd accelerator="Escape" />
          </span>
        </div>
        <div className="p-list">
          {rows.length > 0 && (busy || empty)}
          {rows.length > 0 ? (
            <div role="listbox" id={listId} aria-label={t.palette.listLabel} className="p-options">
              {/* A listbox holds options and groups only: a heading names its group and is no element of its own (role
                  presentation, as RAC's ListBoxSection draws it; axe aria-required-children). */}
              {items.length > 0 && (
                <section role="group" aria-labelledby={`${ids}-items`}>
                  <header className="p-group" id={`${ids}-items`} role="presentation">
                    {t.palette.groups.items}
                  </header>
                  {rows.slice(0, items.length).map((row, i) => renderRow(row, i))}
                </section>
              )}
              {rows.length > items.length && (
                <section role="group" aria-labelledby={`${ids}-commands`}>
                  <header className="p-group" id={`${ids}-commands`} role="presentation">
                    {t.palette.groups.commands}
                  </header>
                  {rows.slice(items.length).map((row, i) => renderRow(row, items.length + i))}
                </section>
              )}
            </div>
          ) : (
            busy || empty
          )}
        </div>
      </div>
      <div role="status" className="visually-hidden" data-testid="palette-status">
        {status}
      </div>
      {/* Key hints for what the keys do now: ↩ names what the cursor row does; with no match (only the search row, or
          nothing) there is nothing to move to (palette.html ?state=none). */}
      <div className="p-foot">
        {rows.length > 0 && !none && (
          <span className="row">
            <Kbd keys={['↑', '↓']} alternatives />
            {t.palette.footMove}
          </span>
        )}
        {cursor >= 0 && (
          <span className="row">
            <Kbd accelerator="Enter" />
            {rows[cursor]!.kind === 'item' ? t.palette.footOpen : t.palette.footRun}
          </span>
        )}
        <span className="row">
          <Kbd accelerator="Escape" />
          {t.palette.footClose}
        </span>
        {rows.length > 0 && !none && (
          <>
            <span className="spacer" />
            <span className="row">{t.palette.footHint(example)}</span>
          </>
        )}
      </div>
    </Dialog>
  );
}
