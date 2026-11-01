import { useId, useState } from 'react';
import { FolderSearch } from 'lucide-react';
import { commandById, commandLabel } from '@learn/domain';
import { api, unwrap } from '../api';
import { useCommands } from '../commands/CommandProvider';
import { useLearnEvent } from '../events';
import { formatDateTime } from '../format';
import { t } from '../strings';
import { Button } from '../ui/Button';
import { currentPlatform } from '../ui/platform';
import { showActionFailed } from '../ui/toasts';
import { useEditedCopies } from './useEditedCopies';

/**
 * 다른 앱에서 고친 수정본 N개 (M6 spec 6, mockup library.html?state=edited): the 파일 section's last part, drawn only while
 * the item has one. Each copy: its name (whole as the tooltip), when it was saved, 새 자료로 가져오기 (the import queue;
 * the copy goes once its import committed with its bytes unchanged) and Finder에서 보기 with it selected. The page names a
 * copy by its file name only; main finds it.
 */
export function EditedCopies({ itemId }: { itemId: string }) {
  const copies = useEditedCopies(itemId);
  const { env } = useCommands();
  const headId = useId();
  /** Copies put in the queue from here, until the run's report: their import is under way. */
  const [sent, setSent] = useState<ReadonlySet<string>>(() => new Set());
  useLearnEvent('import:finished', () => setSent(new Set()));
  const list = copies.data ?? [];
  if (list.length === 0) return null;
  const failed = (e: unknown) => {
    showActionFailed(e);
    void copies.refetch();
  };
  const importCopy = (name: string) => {
    setSent((s) => new Set(s).add(name));
    unwrap(api().library.importEditedCopy({ itemId, name })).catch((e: unknown) => {
      setSent((s) => new Set([...s].filter((n) => n !== name)));
      failed(e);
    });
  };
  const reveal = (name: string) => void unwrap(api().library.revealEditedCopy({ itemId, name })).catch(failed);
  const revealLabel = commandLabel(commandById('item.showInFolder'), currentPlatform());
  return (
    <div className="edited-copies" role="group" aria-labelledby={headId} data-testid="edited-copies">
      <div className="ec-head" id={headId} data-testid="edited-copies-head">
        {t.inspector.editedCopies.head(list.length)}
      </div>
      {list.map((c) => (
        <div key={c.name} className="ec-item" data-testid="edited-copy" data-name={c.name}>
          <div className="ec-name ellipsis" title={c.name}>
            {c.name}
          </div>
          <div className="ec-meta num">{formatDateTime(c.modifiedAt)}</div>
          <div className="ec-actions">
            <Button
              size="small"
              testId="edited-copy-import"
              isDisabled={env.blocked || sent.has(c.name)}
              disabledReason={env.blocked ? t.common.busy : t.inspector.editedCopies.importing}
              onPress={() => importCopy(c.name)}
            >
              {t.inspector.editedCopies.importNew}
            </Button>
            <Button size="small" icon={FolderSearch} testId="edited-copy-reveal" isDisabled={env.blocked} disabledReason={t.common.busy} onPress={() => reveal(c.name)}>
              {revealLabel}
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
