import { Plus } from 'lucide-react';
import { commandById, type CommandId } from '@learn/domain';
import { useCommands } from '../commands/CommandProvider';
import { t } from '../strings';
import { MenuButton } from '../ui/MenuButton';

const IDS = ['file.importManaged', 'file.importLinked'] as const satisfies readonly CommandId[];
const TEST_IDS = { 'file.importManaged': 'import-menu-managed', 'file.importLinked': 'import-menu-linked' } as const;

/** 가져오기 ▾ (design-spec 7.3): 파일 가져오기… ⌘O · 외부 파일 연결… ⌥⌘O — the registry's own items. */
export function ImportMenuButton() {
  const { run, isEnabled } = useCommands();
  return (
    <MenuButton
      label={t.library.importButton}
      icon={Plus}
      testId="import-menu"
      isDisabled={!IDS.some((id) => isEnabled(id))}
      disabledReason={t.common.busy}
      items={IDS.map((id) => ({ id, label: commandById(id).label, accelerator: commandById(id).accelerator, testId: TEST_IDS[id], isDisabled: !isEnabled(id) }))}
      onAction={(id) => run(id)}
    />
  );
}
