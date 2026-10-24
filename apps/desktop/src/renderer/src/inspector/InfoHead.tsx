import { Clapperboard, FileText, FolderSearch } from 'lucide-react';
import { commandById, commandLabel, type CommandId, type LibraryItem } from '@learn/domain';
import { useCommands } from '../commands/CommandProvider';
import { formatDuration } from '../format';
import { t } from '../strings';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { currentPlatform } from '../ui/platform';
import { useFileFacts } from './useFileFacts';

/**
 * The panel's head (library.html inspectorItem): kind · pages or length, the title (title3, never above the content's
 * title; user text, so no text-wrap: pretty), "저자 · 연도" when known, and the item's actions through the registry.
 * A missing file: a linked one leads with 다시 연결… and keeps 열기 (it reaches the notice); a managed one leads
 * with 열기; Finder에서 보기 stays in place, disabled with the reason.
 */
export function InfoHead({ item }: { item: LibraryItem }) {
  const { env, run, isEnabled } = useCommands();
  const facts = useFileFacts(item);
  const platform = currentPlatform();
  const target = { itemIds: [item.id] };
  const label = (id: CommandId) => commandLabel(commandById(id), platform);
  const relinkFirst = item.availability === 'missing' && item.storageMode === 'linked';
  const kind =
    item.type === 'pdf'
      ? [t.library.type.pdf, facts.pages === undefined ? '' : t.inspector.pages(facts.pages)]
      : [t.library.type.video, facts.durationMs === undefined ? '' : formatDuration(facts.durationMs)];
  const byline = [item.creators.join(', '), item.year === null ? '' : String(item.year)].filter(Boolean).join(' · ');
  return (
    <header className="item-head" data-testid="inspector-head">
      <div className="kind" data-testid="inspector-kind">
        <Icon icon={item.type === 'video' ? Clapperboard : FileText} size="sm" />
        <span className="num">{kind.filter(Boolean).join(' · ')}</span>
      </div>
      <h2>{item.title}</h2>
      {byline && <div className="authors">{byline}</div>}
      <div className="actions">
        {relinkFirst && (
          <Button variant="primary" testId="inspector-relink" onPress={() => run('item.relink', target)} isDisabled={!isEnabled('item.relink', target)} disabledReason={t.common.busy}>
            {label('item.relink')}
          </Button>
        )}
        <Button variant={relinkFirst ? 'secondary' : 'primary'} testId="inspector-open" onPress={() => run('item.open', target)} isDisabled={!isEnabled('item.open', target)} disabledReason={t.common.busy}>
          {label('item.open')}
        </Button>
        <Button
          icon={FolderSearch}
          testId="inspector-reveal"
          onPress={() => run('item.showInFolder', target)}
          isDisabled={!isEnabled('item.showInFolder', target)}
          disabledReason={env.blocked ? t.common.busy : t.reader.needsFile}
        >
          {label('item.showInFolder')}
        </Button>
      </div>
    </header>
  );
}
