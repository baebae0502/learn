import { commandById, commandLabel, type CommandId } from '@learn/domain';
import { useCommands } from '../../commands/CommandProvider';
import { t } from '../../strings';
import { MENU_SEPARATOR, MenuButton, type MenuEntry } from '../../ui/MenuButton';
import { currentPlatform } from '../../ui/platform';
import { usePageColor } from './usePageColor';
import { useReader } from './readerStore';

const COLORS = [
  ['reader.pageColorAuto', 'auto'],
  ['reader.pageColorOriginal', 'original'],
  ['reader.pageColorSepia', 'sepia'],
  ['reader.pageColorDark', 'dark'],
] as const;

const item = (id: CommandId) => {
  const c = commandById(id);
  return { id, label: commandLabel(c, currentPlatform()), ...(c.accelerator ? { accelerator: c.accelerator } : {}) };
};

/** 보기 ▾: the page colour (the one in force checked), then the rotation. Every row is a registry command, run as the menu bar runs it. */
export function ViewMenu() {
  const ready = useReader((s) => s.pdf?.ready === true);
  const { setting } = usePageColor();
  const { run } = useCommands();
  const items: MenuEntry<CommandId>[] = [
    { header: t.reader.pageColor, items: COLORS.map(([id, color]) => ({ ...item(id), checked: setting === color })) },
    MENU_SEPARATOR,
    item('reader.rotateCw'),
    item('reader.rotateCcw'),
  ];
  return (
    <MenuButton
      label={t.reader.viewMenu}
      items={items}
      onAction={(id) => run(id)}
      placement="bottom end"
      isDisabled={!ready}
      disabledReason={t.reader.opening}
      testId="pdf-view-menu"
    />
  );
}
