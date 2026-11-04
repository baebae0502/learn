import { useRef, useState, type KeyboardEvent } from 'react';
import { ChevronDown } from 'lucide-react';
import { commandById, commandLabel, type CommandId } from '@learn/domain';
import { useCommands } from '../../commands/CommandProvider';
import { t } from '../../strings';
import { isComposingKey } from '../../ui/ime';
import { MENU_SEPARATOR, MenuIconButton, type MenuEntry } from '../../ui/MenuButton';
import { currentPlatform } from '../../ui/platform';
import { useReader, type ZoomValue } from './readerStore';
import { parseZoomInput, zoomPercent } from './zoom';

/** The percentages the menu offers beside the fit modes (design-spec 7.3). */
const PRESETS = [0.75, 1, 1.25, 1.5, 2] as const;
type ZoomAction = CommandId | `preset:${number}`;

const named = (id: CommandId): { id: CommandId; label: string; accelerator?: string } => {
  const c = commandById(id);
  return { id, label: commandLabel(c, currentPlatform(), { view: 'viewer' }), ...(c.accelerator ? { accelerator: c.accelerator } : {}) };
};

/** 확대 메뉴 (design-spec 7.3): the fit modes, the actual size, five percentages, then a step each way; the mode in force is checked. */
function zoomEntries(zoom: ZoomValue): MenuEntry<ZoomAction>[] {
  const fit = (id: 'reader.zoomAuto' | 'reader.zoomPageWidth' | 'reader.zoomPageFit', mode: ZoomValue) => ({ ...named(id), checked: zoom === mode });
  return [
    { items: [fit('reader.zoomAuto', 'auto'), fit('reader.zoomPageWidth', 'page-width'), fit('reader.zoomPageFit', 'page-fit')] },
    // Its own section: an action in the fit modes' group would become one of its radio rows.
    { items: [named('view.textReset')] },
    MENU_SEPARATOR,
    { items: PRESETS.map((p) => ({ id: `preset:${p}` as const, label: zoomPercent(p), checked: typeof zoom === 'number' && Math.abs(zoom - p) < 0.005 })) },
    MENU_SEPARATOR,
    { items: [named('view.textBigger'), named('view.textSmaller')] },
  ];
}

/**
 * The scale in percent, as a field (↩ zooms to a typed percent, esc gives the value back and the focus to the stage), with
 * its menu beside it. A fit mode shows the percent it comes to, and the menu checks the mode.
 */
export function ZoomField({ onEscape }: { onEscape(): void }) {
  const pdf = useReader((s) => s.pdf);
  const handle = useReader((s) => s.handle);
  const { run } = useCommands();
  const [draft, setDraft] = useState<string | null>(null);
  const group = useRef<HTMLDivElement>(null);
  const ready = pdf?.ready === true && handle !== null;
  const shown = draft ?? (ready ? zoomPercent(pdf.scale) : '');
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (isComposingKey(e)) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      const zoom = parseZoomInput(draft ?? '');
      if (zoom !== null) handle?.setZoom(zoom);
      setDraft(null);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setDraft(null);
      onEscape();
    }
  };
  const onAction = (id: ZoomAction) => {
    if (id.startsWith('preset:')) handle?.setZoom(Number(id.slice('preset:'.length)));
    else run(id as CommandId);
  };
  return (
    <div ref={group} className="zoom-field">
      <input
        className="zoom-input num"
        autoComplete="off"
        spellCheck={false}
        aria-label={t.reader.zoomField}
        placeholder="…"
        disabled={!ready}
        value={shown}
        data-testid="pdf-zoom-field"
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.target.select()}
        onBlur={() => setDraft(null)}
        onKeyDown={onKeyDown}
      />
      <MenuIconButton
        icon={ChevronDown}
        label={t.reader.zoomMenu}
        items={zoomEntries(pdf?.zoom ?? 'auto')}
        onAction={onAction}
        placement="bottom start"
        anchorRef={group}
        popoverClassName="zoom-menu"
        isDisabled={!ready}
        disabledReason={t.reader.opening}
        testId="pdf-zoom-menu"
      />
    </div>
  );
}
