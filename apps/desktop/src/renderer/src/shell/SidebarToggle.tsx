import { PanelLeft } from 'lucide-react';
import { commandById } from '@learn/domain';
import { useCommands } from '../commands/CommandProvider';
import { t } from '../strings';
import { IconButton } from '../ui/Button';
import { useSidebarHidden } from './useSidebar';

type ToggleId = 'sidebar-toggle' | 'toolbar-sidebar-toggle';
/** The copy that takes over when this one goes away (into the folded, inert sidebar, or out of the toolbar). */
const OTHER: Record<ToggleId, ToggleId> = { 'sidebar-toggle': 'toolbar-sidebar-toggle', 'toolbar-sidebar-toggle': 'sidebar-toggle' };

/** In the sidebar top while it is shown; in the toolbar (after the traffic-light inset) while it is hidden. */
export function SidebarToggle({ testId }: { testId: ToggleId }) {
  const hidden = useSidebarHidden();
  const { run } = useCommands();
  const toggle = () => {
    const hadFocus = document.activeElement?.id === testId;
    // Focus must not fall to <body> with the button that had it: hand it to the other copy once it is there.
    if (run('view.toggleSidebar') && hadFocus) requestAnimationFrame(() => document.getElementById(OTHER[testId])?.focus());
  };
  return (
    <IconButton
      id={testId}
      icon={PanelLeft}
      label={t.shell.toggleSidebar}
      accelerator={commandById('view.toggleSidebar').accelerator}
      onPress={toggle}
      aria-expanded={!hidden}
      aria-controls="sidebar"
      testId={testId}
    />
  );
}
