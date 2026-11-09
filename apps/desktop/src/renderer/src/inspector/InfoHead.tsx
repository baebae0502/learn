import { FolderSearch } from 'lucide-react';
import { commandById, commandLabel, type CommandId, type LibraryItem } from '@learn/domain';
import { ItemMarks } from '../library/ItemMarks';
import { useCommands } from '../commands/CommandProvider';
import { formatDuration } from '../format';
import { useLibrary } from '../state/library-store';
import { t } from '../strings';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { currentPlatform } from '../ui/platform';
import { ImagePreview } from './ImagePreview';
import { itemIcon } from '../library/itemIcon';
import { useFileFacts } from './useFileFacts';
import { RestoreButton, TrashNote } from './TrashInfo';

/**
 * The panel's head (library.html inspectorItem): kind · pages or length, the title (title3, never above the content's
 * title; user text, so no text-wrap: pretty), "저자 · 연도" when known, and the item's actions through the registry.
 * A missing file: a linked one leads with 다시 연결… and keeps 열기 (it reaches the notice); a managed one leads
 * with 열기; Finder에서 보기 stays in place, disabled with the reason. While the item is being edited 열기 is secondary.
 * A trashed item (the trash view, read-only): 복원 is the head's one action, the trash line under it.
 */
export function InfoHead({ item, probe = true, trashedAt, inReader = false }: { item: LibraryItem; probe?: boolean; trashedAt?: string; inReader?: boolean }) {
  const { env, run, isEnabled } = useCommands();
  const facts = useFileFacts(item, probe);
  const platform = currentPlatform();
  const target = { itemIds: [item.id] };
  const label = (id: CommandId) => commandLabel(commandById(id), platform);
  // The form's 저장 is the panel's one primary button while the editor is open.
  const editing = useLibrary((s) => s.editingId === item.id);
  const relinkFirst = item.availability === 'missing' && item.storageMode === 'linked';
  // An image's kind line carries its pixel size, which the library already knows (no probe).
  const kind =
    item.type === 'pdf'
      ? [t.library.type.pdf, facts.pages === undefined ? '' : t.inspector.pages(facts.pages)]
      : item.type === 'image'
        ? [t.inspector.imageKind(item.imageSize?.width, item.imageSize?.height)]
        : [t.library.type.video, facts.durationMs === undefined ? '' : formatDuration(facts.durationMs)];
  const byline = [item.creators.join(', '), item.year === null ? '' : String(item.year)].filter(Boolean).join(' · ');
  return (
    <header className="item-head" data-testid="inspector-head">
      {/* One image on show in the library: its picture leads the head. Not in the trash, the reader or a several-item selection. */}
      {item.type === 'image' && probe && !inReader && trashedAt === undefined && <ImagePreview item={item} />}
      <div className="kind" data-testid="inspector-kind">
        <Icon icon={itemIcon(item.type)} size="sm" />
        <span className="num">{kind.filter(Boolean).join(' · ')}</span>
      </div>
      <h2>
        {item.title}
        <span className="item-marks">
          <ItemMarks item={item} />
        </span>
      </h2>
      {byline && <div className="authors">{byline}</div>}
      <div className="actions">
        {trashedAt !== undefined ? (
          <RestoreButton target={target} />
        ) : (
          <>
          {relinkFirst && (
            <Button variant={editing ? 'secondary' : 'primary'} testId="inspector-relink" onPress={() => run('item.relink', target)} isDisabled={!isEnabled('item.relink', target)} disabledReason={t.common.busy}>
              {label('item.relink')}
            </Button>
          )}
          {/* The reader is the open item: no 열기 there. */}
          {!inReader && (
          <Button variant={relinkFirst || editing ? 'secondary' : 'primary'} testId="inspector-open" onPress={() => run('item.open', target)} isDisabled={!isEnabled('item.open', target)} disabledReason={t.common.busy}>
            {label('item.open')}
          </Button>
          )}
          <Button
            icon={FolderSearch}
            testId="inspector-reveal"
            onPress={() => run('item.showInFolder', target)}
            isDisabled={!isEnabled('item.showInFolder', target)}
            disabledReason={env.blocked ? t.common.busy : t.reader.needsFile}
          >
            {label('item.showInFolder')}
          </Button>
          </>
        )}
      </div>
      {trashedAt !== undefined && <TrashNote at={trashedAt} />}
    </header>
  );
}
