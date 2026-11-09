import type { RefObject } from 'react';
import { ChevronDown } from 'lucide-react';
import { commandById, commandLabel, type CommandId } from '@learn/domain';
import { useCommands } from '../../commands/CommandProvider';
import { t } from '../../strings';
import { MENU_SEPARATOR, MenuIconButton, type MenuEntry } from '../../ui/MenuButton';
import { currentPlatform } from '../../ui/platform';
import type { ImageZoom } from './imageFit';

/** A command as the picture's menu names it: the fit is 창에 맞춤 here, the steps 확대 · 축소 · 실제 크기. */
const named = (id: CommandId): { id: CommandId; label: string; accelerator?: string } => {
  const c = commandById(id);
  return { id, label: commandLabel(c, currentPlatform(), { view: 'viewer', imageOpen: true }), ...(c.accelerator ? { accelerator: c.accelerator } : {}) };
};

/** The two fits (the one in force checked), the actual size, then a step each way; no percentages (the field takes any). */
function zoomEntries(zoom: ImageZoom): MenuEntry<CommandId>[] {
  return [
    { items: [{ ...named('reader.zoomPageFit'), checked: zoom === 'fit' }, { ...named('reader.zoomPageWidth'), checked: zoom === 'width' }] },
    // Its own section: an action in the fits' group would become one of its radio rows.
    { items: [named('view.textReset')] },
    MENU_SEPARATOR,
    { items: [named('view.textBigger'), named('view.textSmaller')] },
  ];
}

/** The image toolbar's 확대 ▾: every row is a registry command, run as the menu bar runs it. */
export function ImageZoomMenu({ zoom, anchorRef, isDisabled }: { zoom: ImageZoom; anchorRef: RefObject<HTMLDivElement | null>; isDisabled: boolean }) {
  const { run } = useCommands();
  return (
    <MenuIconButton
      icon={ChevronDown}
      label={t.reader.zoomMenu}
      items={zoomEntries(zoom)}
      onAction={(id) => run(id)}
      placement="bottom start"
      anchorRef={anchorRef}
      popoverClassName="zoom-menu"
      isDisabled={isDisabled}
      disabledReason={t.reader.imageOpening}
      testId="image-zoom-menu"
    />
  );
}
