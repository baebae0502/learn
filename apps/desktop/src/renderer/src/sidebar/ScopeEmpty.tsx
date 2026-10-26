import { Clock, Copy, FolderOpen, Inbox } from 'lucide-react';
import { commandById, commandLabel, type LibraryScope } from '@learn/domain';
import { useCommands } from '../commands/CommandProvider';
import { t } from '../strings';
import { Button } from '../ui/Button';
import { PaneEmpty } from '../ui/PaneEmpty';
import { currentPlatform } from '../ui/platform';

const ICONS = { recent: Clock, unfiled: Inbox, duplicates: Copy } as const;

/**
 * The table body of a view with nothing in it (spec 3.6): an empty collection offers the import into it; the special views
 * only say so (and are on screen only while viewed). Nothing is drawn for 내 라이브러리 — an empty library has its own screen.
 */
export function ScopeEmpty({ scope, name }: { scope: LibraryScope; name: string }) {
  const { run, isEnabled } = useCommands();
  if (scope.kind === 'all') return null;
  if (scope.kind === 'collection') {
    const target = { collectionIds: [scope.id] };
    return (
      <PaneEmpty
        icon={FolderOpen}
        title={t.organize.empty.collectionTitle}
        top
        testId="collection-empty"
        action={
          <Button testId="collection-empty-import" isDisabled={!isEnabled('collection.importInto', target)} onPress={() => void run('collection.importInto', target)}>
            {commandLabel(commandById('collection.importInto'), currentPlatform())}
          </Button>
        }
      >
        {t.organize.empty.collectionBody(name)}
      </PaneEmpty>
    );
  }
  return <PaneEmpty icon={ICONS[scope.kind]} title={t.organize.empty[scope.kind]} top testId={`scope-empty-${scope.kind}`} />;
}
