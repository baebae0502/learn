import { useLayoutEffect, useState, type KeyboardEvent } from 'react';
import { flushSync } from 'react-dom';
import { Search } from 'lucide-react';
import { Autocomplete, Dialog, Header, Input, Menu, MenuItem, MenuSection, Modal, ModalOverlay, TextField } from 'react-aria-components';
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

/** What had the focus when the palette opened (RAC's FocusScope restores it on esc; a picked command runs from it). */
let opener: Element | null = null;

/** ⌘K (`app.palette`): opens the palette, or selects its field when it is already open. */
export function openPalette(): void {
  const shell = useShell.getState();
  if (shell.paletteOpen) {
    const input = document.querySelector<HTMLInputElement>('[data-testid="palette-input"]');
    input?.focus();
    input?.select();
    return;
  }
  opener = document.activeElement;
  shell.setPaletteOpen(true);
}

/**
 * Closes the palette, gives the focus back to its opener at once, then runs `then` (a command picked in the palette,
 * or from the menu bar while it is open). The command thus acts from where the user was, as if the palette had never
 * been up: when it hides the opener (사이드바 가리기 from the sidebar launcher), the sidebar's own focus rescue sees
 * that and moves the focus on (useSidebar keepFocusAcross) — it never falls to <body> with the unmounted opener.
 * RAC's FocusScope would restore the opener only a frame after the palette unmounts, i.e. after the command.
 */
export function closePalette(then?: () => void): void {
  // Synchronously: the overlay is gone, so its focus containment no longer pulls the focus back.
  flushSync(() => useShell.getState().setPaletteOpen(false));
  const target = opener;
  opener = null;
  const active = document.activeElement;
  if ((active === null || active === document.body) && target instanceof HTMLElement && target.isConnected) target.focus({ preventScroll: true });
  then?.();
}

/**
 * A key that belongs to a Korean composition (isComposing, or keyCode 229) must not reach RAC's handlers: the cursor
 * does not move, no command runs and the palette does not close (ADR-0005 §3). RAC checks isComposing itself; the
 * keyCode 229 keys macOS IMEs send without it (the confirming ↩) it does not.
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

/** The dialog itself: mounted with each opening, so the query starts empty. */
function PaletteDialog() {
  const { env, run, isEnabled } = useCommands();
  const [query, setQuery] = useState('');
  const platform = currentPlatform();
  const state = env.sidebar ? { sidebar: env.sidebar } : {};
  // Only what can run now (no fake commands): the registry order, then ranked by the query.
  const ranked = rankCommands(
    COMMANDS.filter((c) => inPalette(c) && isEnabled(c.id)),
    query,
    platform,
    state,
  );
  return (
    <Dialog className="palette" aria-label={t.palette.dialogLabel} data-testid="palette">
      <div className="p-body" onKeyDownCapture={stopWhileComposing}>
        <Autocomplete inputValue={query} onInputChange={setQuery}>
          <TextField className="p-input" aria-label={t.palette.inputLabel} autoFocus>
            <Icon icon={Search} />
            <Input className="p-field" placeholder={t.palette.placeholder} data-testid="palette-input" />
            {/* palette.html p-scope: the esc keycap at the end of the input row (C-7). */}
            <span className="p-scope" data-testid="palette-esc">
              <Kbd accelerator="Escape" />
            </span>
          </TextField>
          <Menu
            className="p-list"
            aria-label={t.palette.group}
            onAction={(key) => closePalette(() => run(String(key) as CommandId))}
            renderEmptyState={() => (
              <div className="p-empty" data-testid="palette-empty">
                <div className="pe-title">{t.palette.emptyTitle(query.trim())}</div>
                <div className="pe-text">{t.palette.emptyBody}</div>
              </div>
            )}
          >
            {ranked.length > 0 && (
              <MenuSection>
                <Header className="p-group">{t.palette.group}</Header>
                {ranked.map(({ command, match }) => {
                  const label = commandLabel(command, platform, state);
                  return (
                    <MenuItem key={command.id} id={command.id} textValue={label} className="p-item" data-testid="palette-item" data-command-id={command.id}>
                      <Icon icon={COMMAND_ICONS[command.id]} />
                      <span className="p-title ellipsis">{highlight(label, match)}</span>
                      {command.accelerator && (
                        <span className="p-meta">
                          <Kbd accelerator={command.accelerator} />
                        </span>
                      )}
                    </MenuItem>
                  );
                })}
              </MenuSection>
            )}
          </Menu>
        </Autocomplete>
      </div>
      {/* Key hints for what the keys do now: with no results only esc does anything (palette.html ?state=none). */}
      <div className="p-foot">
        {ranked.length > 0 && (
          <>
            <span className="row">
              <Kbd keys={['↑', '↓']} />
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
