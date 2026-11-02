import { Trash2 } from 'lucide-react';
import { commandById } from '@learn/domain';
import { useCommands } from '../commands/CommandProvider';
import { t } from '../strings';
import { trashActions } from '../trash/actions';
import { Button } from '../ui/Button';
import { Notice } from '../ui/Notice';

/**
 * The item went to the trash while open (spec 4.6, reader-pdf.html?state=trashed): a neutral notice on the stage — nothing is
 * broken, the user moved it. 복원 opens it here again (quietly: the reader coming back says it); or back to the library.
 */
export function TrashedNotice({ itemId }: { itemId: string }) {
  const { env, run, isEnabled } = useCommands();
  return (
    <div className="reader-stage">
      <div className="stage-center">
        <Notice
          icon={Trash2}
          title={t.trash.reader.title}
          testId="reader-trashed"
          actions={
            <>
              <Button variant="primary" testId="reader-trashed-restore" isDisabled={env.blocked} disabledReason={t.common.busy} onPress={() => void trashActions.restore({ itemIds: [itemId], collectionIds: [] }, { quiet: true })}>
                {commandById('item.restore').label}
              </Button>
              <Button testId="reader-trashed-back" isDisabled={!isEnabled('nav.back')} disabledReason={t.common.busy} onPress={() => run('nav.back')}>
                {commandById('nav.back').label}
              </Button>
            </>
          }
        >
          {t.trash.reader.body}
        </Notice>
      </div>
    </div>
  );
}
