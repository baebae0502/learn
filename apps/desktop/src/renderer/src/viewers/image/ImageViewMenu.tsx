import { commandById, commandLabel, type CommandId } from '@learn/domain';
import { useCommands } from '../../commands/CommandProvider';
import { t } from '../../strings';
import { MENU_SEPARATOR, MenuButton, type MenuEntry } from '../../ui/MenuButton';
import { currentPlatform } from '../../ui/platform';
import { useReader } from '../pdf/readerStore';
import { useImageBackground } from './useImageBackground';

const BACKGROUNDS = [
  ['reader.imageBackgroundLight', 'light'],
  ['reader.imageBackgroundDark', 'dark'],
  ['reader.imageBackgroundChecker', 'checker'],
] as const;

const item = (id: CommandId) => {
  const c = commandById(id);
  return { id, label: commandLabel(c, currentPlatform()), ...(c.accelerator ? { accelerator: c.accelerator } : {}) };
};

/** 보기 ▾: the background (the one in use checked), then the two turns. Every row is a registry command, run as the menu bar runs it. */
export function ImageViewMenu() {
  const ready = useReader((s) => s.image?.status === 'shown' && s.imageHandle !== null);
  const { resolved } = useImageBackground();
  const { run } = useCommands();
  const items: MenuEntry<CommandId>[] = [
    { header: t.reader.imageBackground, items: BACKGROUNDS.map(([id, bg]) => ({ ...item(id), checked: resolved === bg })) },
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
      variant="plain"
      size="small"
      popoverClassName="view-menu"
      isDisabled={!ready}
      disabledReason={t.reader.imageOpening}
      testId="image-view-menu"
    />
  );
}
