import { PanelLeft } from 'lucide-react';
import { commandById } from '@learn/domain';
import { useCommands } from '../commands/CommandProvider';
import { t } from '../strings';
import { IconButton } from '../ui/Button';
import { TOGGLE_IDS, useSidebarHidden } from './useSidebar';

/**
 * In the sidebar top while it is shown; in the toolbar (after the traffic-light inset) while it is hidden. Both run the
 * registry command, whose handler (useToggleSidebar) hands the focus to the copy that takes over.
 */
export function SidebarToggle({ place }: { place: keyof typeof TOGGLE_IDS }) {
  const hidden = useSidebarHidden();
  const { run } = useCommands();
  return (
    <IconButton
      id={TOGGLE_IDS[place]}
      icon={PanelLeft}
      label={t.shell.toggleSidebar}
      accelerator={commandById('view.toggleSidebar').accelerator}
      onPress={() => run('view.toggleSidebar')}
      aria-expanded={!hidden}
      aria-controls="sidebar"
      testId={TOGGLE_IDS[place]}
    />
  );
}
