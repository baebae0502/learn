import { useId, useLayoutEffect, useState, type KeyboardEvent } from 'react';
import { flushSync } from 'react-dom';
import { Search } from 'lucide-react';
import { Dialog, Modal, ModalOverlay } from 'react-aria-components';
import { COMMANDS, commandLabel, inPalette, type CommandId } from '@learn/domain';
import { useCommands } from '../commands/CommandProvider';
import { COMMAND_ICONS } from '../commands/icons';
import { useShell } from '../state/shell-store';
import { t } from '../strings';
import { Icon } from '../ui/Icon';
import { Kbd } from '../ui/Kbd';
import { currentPlatform } from '../ui/platform';
import { setTooltipBlock } from '../ui/tooltipGate';
import { highlight } from './highlight';
import { rankCommands } from './rank';

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

/** ⌘K command palette (palette.html, design-spec 10.5): available registry commands only, 초성 search, ↩ runs once. */
export function Palette() {
  const open = useShell((s) => s.paletteOpen);
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
        <PaletteDialog />
      </Modal>
    </ModalOverlay>
  );
}

/**
 * The dialog itself, mounted with each opening (the query starts empty). The field is an ARIA combobox over a listbox
 * with one cursor row, kept here (the Raycast / VS Code model): whenever the list has rows the cursor is on one — the
 * first after opening and after every edit (typing, Backspace, paste, undo), the one ↑ ↓ or the pointer moved it to
 * otherwise, as long as that row is listed. ↩ runs it. (RAC's Autocomplete cleared its cursor on delete, paste and undo
 * and set none on open, so ↩ did nothing under a footer that says 실행 — critic T9-M1.)
 */
function PaletteDialog() {
  const { env, run, isEnabled } = useCommands();
  const [query, setQuery] = useState('');
  /** The command the user moved the cursor to; null puts it on the first row. */
  const [cursorId, setCursorId] = useState<CommandId | null>(null);
  const ids = useId();
  const platform = currentPlatform();
  const state = env.sidebar ? { sidebar: env.sidebar } : {};
  // Only what can run now (no fake commands), exactly as the registry says, re-read on every render: the list follows
  // availability while open. While an import or a sheet holds the window that is the main-owned 설정… alone, under the
  // notice that says why the rest is missing (review minor 1).
  const ranked = rankCommands(
    COMMANDS.filter((c) => inPalette(c) && isEnabled(c.id)),
    query,
    platform,
    state,
  );
  const cursor = ranked.length === 0 ? -1 : Math.max(0, ranked.findIndex((r) => r.command.id === cursorId));
  const listId = `${ids}-list`;
  const optionId = (index: number) => `${ids}-option-${index}`;

  // Keep the cursor row in view when ↑ ↓ move it past the list's edge.
  // Read out politely when the result changes (the count, or the notice that replaces the list); a cursor move or an
  // edit that leaves the same count changes nothing here, so nothing is re-announced.
  const status =
    ranked.length > 0
      ? env.blocked
        ? t.palette.busyStatus(ranked.length)
        : t.palette.resultCount(ranked.length)
      : env.blocked
        ? t.palette.busyTitle
        : t.palette.emptyTitle(query.trim());
  // An import or a sheet holds the window (not "no match"). Alone when nothing is listed: nothing can run until it ends.
  // Above the commands that still run (설정…): a header — not an option, never under the cursor — that says the others
  // come back when the work ends.
  // Defensive in M3: nothing holds the window under an open palette. ⌘K and the launcher are refused while it is held,
  // every command closes the palette before it runs, and a file drag closes it before its drop starts an import
  // (shell/DropOverlay.tsx). An import that does not start in this window would reach it: the Dock's open-file (not
  // built yet), later background work.
  const busy = env.blocked && (
    <div className="p-empty" data-testid="palette-busy">
      <div className="pe-title">{ranked.length > 0 ? t.palette.busyHeaderTitle : t.palette.busyTitle}</div>
      <div className="pe-text">{ranked.length > 0 ? t.palette.busyHeaderBody : t.palette.busyBody}</div>
    </div>
  );
  const cursorElementId = cursor >= 0 ? optionId(cursor) : null;
  useLayoutEffect(() => {
    if (cursorElementId) document.getElementById(cursorElementId)?.scrollIntoView({ block: 'nearest' });
  }, [cursorElementId]);

  const execute = (id: CommandId) => closePalette(() => run(id));
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); // not the caret's start/end
      if (cursor < 0) return;
      const next = Math.min(ranked.length - 1, Math.max(0, cursor + (e.key === 'ArrowDown' ? 1 : -1)));
      setCursorId(ranked[next]!.command.id);
    } else if (e.key === 'Enter' && !(e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) && cursor >= 0) {
      e.preventDefault(); // no keypress for the opener, which has the focus again by then
      execute(ranked[cursor]!.command.id);
    }
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
            aria-expanded={ranked.length > 0}
            aria-controls={ranked.length > 0 ? listId : undefined}
            aria-activedescendant={cursor >= 0 ? optionId(cursor) : undefined}
            placeholder={t.palette.placeholder}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCursorId(null); // every edit puts the cursor back on the first row
            }}
            onKeyDown={onKeyDown}
            autoFocus
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            data-testid="palette-input"
          />
          {/* palette.html p-scope: the esc keycap at the end of the input row (C-7). */}
          <span className="p-scope" data-testid="palette-esc">
            <Kbd accelerator="Escape" />
          </span>
        </div>
        <div className="p-list">
          {ranked.length > 0 && busy}
          {ranked.length > 0 ? (
            <div role="listbox" id={listId} aria-label={t.palette.group}>
              <section role="group" aria-labelledby={`${ids}-group`}>
                {/* A listbox holds options and groups only: the heading names the group and is no element of its own
                    (role presentation, as RAC's ListBoxSection draws it; axe aria-required-children). */}
                <header className="p-group" id={`${ids}-group`} role="presentation">
                  {t.palette.group}
                </header>
                {ranked.map(({ command, match }, index) => {
                  const label = commandLabel(command, platform, state);
                  return (
                    <div
                      key={command.id}
                      id={optionId(index)}
                      role="option"
                      aria-selected={index === cursor}
                      className="p-item"
                      data-focused={index === cursor ? 'true' : undefined}
                      data-testid="palette-item"
                      data-command-id={command.id}
                      // The pointer moves the cursor (only when it moves: rows sliding under a resting pointer do not).
                      onPointerMove={() => index !== cursor && setCursorId(command.id)}
                      onMouseDown={(e) => e.preventDefault()} // the field keeps the focus
                      onClick={() => execute(command.id)}
                    >
                      <Icon icon={COMMAND_ICONS[command.id]} />
                      <span className="p-title ellipsis">{highlight(label, match)}</span>
                      {command.accelerator && (
                        <span className="p-meta">
                          <Kbd accelerator={command.accelerator} />
                        </span>
                      )}
                    </div>
                  );
                })}
              </section>
            </div>
          ) : (
            (busy || (
              <div className="p-empty" data-testid="palette-empty">
                <div className="pe-title">{t.palette.emptyTitle(query.trim())}</div>
                <div className="pe-text">{t.palette.emptyBody}</div>
              </div>
            ))
          )}
        </div>
      </div>
      <div role="status" className="visually-hidden" data-testid="palette-status">
        {status}
      </div>
      {/* Key hints for what the keys do now: with no rows only esc does anything (palette.html ?state=none). */}
      <div className="p-foot">
        {ranked.length > 0 && (
          <>
            <span className="row">
              <Kbd keys={['↑', '↓']} alternatives />
              {t.palette.footMove}
            </span>
            <span className="row">
              <Kbd accelerator="Enter" />
              {t.palette.footRun}
            </span>
          </>
        )}
        <span className="row">
          <Kbd accelerator="Escape" />
          {t.palette.footClose}
        </span>
        {ranked.length > 0 && (
          <>
            <span className="spacer" />
            <span className="row">{t.palette.footHint}</span>
          </>
        )}
      </div>
    </Dialog>
  );
}
