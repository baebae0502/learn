import { PanelLeft } from 'lucide-react';
import { commandById, commandLabel } from '@learn/domain';
import { useCommands } from '../commands/CommandProvider';
import { IconButton } from '../ui/Button';
import { currentPlatform } from '../ui/platform';
import { TOGGLE_IDS, useSidebarHidden } from './useSidebar';

/**
 * In the sidebar top while it is shown; in the toolbar (after the traffic-light inset) while it is hidden. Both run the
 * registry command, whose handler (useToggleSidebar) hands the focus to the copy that takes over.
 */
export function SidebarToggle({ place }: { place: keyof typeof TOGGLE_IDS }) {
  const hidden = useSidebarHidden();
  const { run } = useCommands();
  const command = commandById('view.toggleSidebar');
  return (
    <IconButton
      id={TOGGLE_IDS[place]}
      icon={PanelLeft}
      // What a press does now, as the 보기 menu says it (design-spec 7.4): 사이드바 가리기 / 사이드바 보기.
      label={commandLabel(command, currentPlatform(), { sidebar: hidden ? 'hidden' : 'shown' })}
      accelerator={command.accelerator}
      onPress={() => run('view.toggleSidebar')}
      aria-expanded={!hidden}
      aria-controls="sidebar"
      testId={TOGGLE_IDS[place]}
    />
  );
}
