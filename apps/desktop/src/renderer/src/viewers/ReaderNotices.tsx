import { ExternalLink, FolderSearch, Link2Off, VideoOff } from 'lucide-react';
import { commandById, commandLabel, type LibraryItem } from '@learn/domain';
import { useCommands } from '../commands/CommandProvider';
import { formatSize } from '../format';
import { t } from '../strings';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Notice } from '../ui/Notice';
import { currentPlatform } from '../ui/platform';
import { readerMeta } from './ReaderToolbar';

/**
 * A final state's 44 px row (design-spec 6 "리더 도구 막대 대신 44px 제목 줄", C-2, N-1): no reader controls that
 * cannot work, only the title and kind · size, as on the unplayable-video screen (mockup reader-pdf ?state=error|missing).
 */
export function ReaderTitleRow({ item }: { item: LibraryItem }) {
  return (
    <div className="reader-toolbar title-row" data-testid="reader-title-row">
      <span className="t-headline ellipsis" title={item.title}>
        {item.title}
      </span>
      <span className="c-tertiary t-footnote ellipsis">{readerMeta(item)}</span>
    </div>
  );
}

/** Original missing (design-spec 10.3 "원본 없음", M3 design): warning tile, the path, 다시 연결… for linked files. */
export function MissingNotice({ item, externalPath }: { item: LibraryItem; externalPath: string | null }) {
  const { run, isEnabled } = useCommands();
  const target = { itemIds: [item.id] };
  const linked = item.storageMode === 'linked';
  return (
    <div className="reader">
      <ReaderTitleRow item={item} />
      <div className="reader-stage">
        <div className="stage-center">
          <Notice
            tone="warning"
            icon={Link2Off}
            title={t.reader.missingTitle}
            file={linked ? (externalPath ?? undefined) : undefined}
            testId="missing-notice"
            actions={
              <>
                {linked && (
                  <Button variant="primary" testId="relink" isDisabled={!isEnabled('item.relink', target)} disabledReason={t.common.busy} onPress={() => run('item.relink', target)}>
                    {commandById('item.relink').label}
                  </Button>
                )}
                <Button testId="missing-back" isDisabled={!isEnabled('nav.back')} disabledReason={t.common.busy} onPress={() => run('nav.back')}>
                  {t.reader.showLibrary}
                </Button>
              </>
            }
          >
            {linked ? t.reader.missingLinkedBody : t.reader.missingManagedBody}
          </Notice>
        </div>
      </div>
    </div>
  );
}

/** Unplayable video (dialogs.html?scene=codec): the stage stays dark; Finder에서 보기 · 기본 앱으로 열기. */
export function CodecNotice({ item, unsupported }: { item: LibraryItem; unsupported: boolean }) {
  const { env, run, isEnabled } = useCommands();
  const target = { itemIds: [item.id] };
  const platform = currentPlatform();
  /** M-2: a sheet holds the window, or the file went missing after the notice appeared. */
  const reason = env.blocked ? t.common.busy : t.reader.needsFile;
  return (
    <div className="codec-notice" role="alert" data-testid="video-error">
      <div className="glyph">
        <Icon icon={VideoOff} size="xl" />
      </div>
      <h2 className="ui-balance">{unsupported ? t.reader.videoUnsupportedTitle : t.reader.videoErrorTitle}</h2>
      <p className="ui-balance">{unsupported ? t.reader.videoUnsupportedBody : t.reader.videoErrorBody}</p>
      <div className="file">
        {item.originalName} · {formatSize(item.size)}
      </div>
      <div className="actions">
        <Button icon={FolderSearch} testId="codec-reveal" isDisabled={!isEnabled('item.showInFolder', target)} disabledReason={reason} onPress={() => run('item.showInFolder', target)}>
          {commandLabel(commandById('item.showInFolder'), platform)}
        </Button>
        <Button icon={ExternalLink} testId="codec-open" isDisabled={!isEnabled('item.openExternally', target)} disabledReason={reason} onPress={() => run('item.openExternally', target)}>
          {commandById('item.openExternally').label}
        </Button>
      </div>
    </div>
  );
}
