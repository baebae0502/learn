import { ExternalLink, FileX, FolderSearch, Link2Off, VideoOff } from 'lucide-react';
import { commandById, commandLabel, type LibraryItem } from '@learn/domain';
import { useCommands } from '../commands/CommandProvider';
import { useAppInfo } from '../data/queries';
import { formatSize, homeRelative } from '../format';
import { t } from '../strings';
import { Button } from '../ui/Button';
import { Notice } from '../ui/Notice';
import { currentPlatform } from '../ui/platform';

/*
 * Final states (design-spec 6): no reader controls that cannot work, only the notice on the stage. Each sits directly
 * under the 52 px unified toolbar, which carries the title and kind · size while there is no tab strip (spec 2.1
 * "내용 열의 패널 머리는 생략한다"); M7 brings the 44 px pane header back together with the tab strip.
 */

/** "seminar-0915.avi · 1.3 GB": the file a final state is about. */
const fileOf = (item: LibraryItem) => `${item.originalName} · ${formatSize(item.size)}`;

/** Original missing (design-spec 10.3 "원본 없음", M3 design): warning tile, the last known path, 다시 연결… for linked files. */
export function MissingNotice({ item, externalPath }: { item: LibraryItem; externalPath: string | null }) {
  const { run, isEnabled } = useCommands();
  const homeDir = useAppInfo().data?.homeDir;
  const target = { itemIds: [item.id] };
  const linked = item.storageMode === 'linked';
  const path = linked ? externalPath : null;
  return (
    <div className="reader-stage">
      <div className="stage-center">
        <Notice
          tone="warning"
          icon={Link2Off}
          title={t.reader.missingTitle}
          file={path ? homeRelative(path, homeDir) : undefined}
          fileTitle={path ?? undefined}
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
  );
}

/**
 * Finder에서 보기 · 기본 앱으로 열기 for a file the reader cannot show (unplayable video, PDF that cannot be opened):
 * registry commands, disabled with the reason while a sheet holds the window or the file went missing (M-2).
 * 기본 앱으로 열기 is a notice button only, never a context-menu item (C-1 as amended).
 */
function FileButtons({ item, testIds }: { item: LibraryItem; testIds: { reveal: string; open: string } }) {
  const { env, run, isEnabled } = useCommands();
  const target = { itemIds: [item.id] };
  const reason = env.blocked ? t.common.busy : t.reader.needsFile;
  return (
    <>
      <Button icon={FolderSearch} testId={testIds.reveal} isDisabled={!isEnabled('item.showInFolder', target)} disabledReason={reason} onPress={() => run('item.showInFolder', target)}>
        {commandLabel(commandById('item.showInFolder'), currentPlatform())}
      </Button>
      <Button icon={ExternalLink} testId={testIds.open} isDisabled={!isEnabled('item.openExternally', target)} disabledReason={reason} onPress={() => run('item.openExternally', target)}>
        {commandById('item.openExternally').label}
      </Button>
    </>
  );
}

/** A PDF pdf.js cannot open (mockup reader-pdf ?state=error): neutral tile, one cause, the file, open it elsewhere. */
export function PdfErrorNotice({ item }: { item: LibraryItem }) {
  return (
    <div className="reader-stage">
      <div className="stage-center">
        <Notice icon={FileX} title={t.reader.pdfErrorTitle} fileName={fileOf(item)} testId="pdf-error" actions={<FileButtons item={item} testIds={{ reveal: 'pdf-reveal', open: 'pdf-open' }} />}>
          {t.reader.pdfErrorBody}
        </Notice>
      </div>
    </div>
  );
}

/**
 * Unplayable video (dialogs.html?scene=codec): the shared notice on the always-dark video stage (critic T14-m1: one
 * notice, 56 px tile, 440 wide, the same file line as the PDF error); Finder에서 보기 · 기본 앱으로 열기.
 */
export function CodecNotice({ item, unsupported }: { item: LibraryItem; unsupported: boolean }) {
  return (
    <Notice
      stage="dark"
      icon={VideoOff}
      title={unsupported ? t.reader.videoUnsupportedTitle : t.reader.videoErrorTitle}
      fileName={fileOf(item)}
      testId="video-error"
      actions={<FileButtons item={item} testIds={{ reveal: 'codec-reveal', open: 'codec-open' }} />}
    >
      {unsupported ? t.reader.videoUnsupportedBody : t.reader.videoErrorBody}
    </Notice>
  );
}
