import { Channels, nowIso, subtitlesAttachInput, subtitlesItemInput, subtitlesRestoreInput, subtitlesTrackInput, type AttachResult } from '@learn/domain';
import { attachSubtitleFiles } from '@learn/library';
import { broadcast } from '../events';
import { mainStrings } from '../strings';
import { showOpen } from './library';
import type { Handle, IpcDeps } from './register';

const NOTHING_PICKED: AttachResult = { added: [], already: [], failed: [] };

/** A video's subtitles (spec 5, 11): reads, the attach through the file panel or by path, remove and restore. Each change is announced once its rows are committed. */
export function registerSubtitlesIpc(handle: Handle, deps: IpcDeps): void {
  const announce = (itemId: string): void => broadcast('subtitles:changed', { itemId });
  /** The attach, announced only when a track was really added (a refused or already attached file changes nothing). */
  const attach = async (itemId: string, paths: readonly string[]): Promise<AttachResult> => {
    const ctx = deps.getContext();
    const result = await attachSubtitleFiles({ repo: ctx.repo, subtitles: ctx.subtitles, importer: ctx.importer }, itemId, paths);
    if (result.added.length > 0) announce(itemId);
    return result;
  };

  handle(Channels.subtitles.list, subtitlesItemInput, ({ itemId }) => ({ tracks: deps.getContext().subtitles.list(itemId) }));
  handle(Channels.subtitles.cues, subtitlesTrackInput, ({ itemId, assetId }) => ({ cues: deps.getContext().subtitles.cues(itemId, assetId) }));
  handle(Channels.subtitles.attach, subtitlesAttachInput, ({ itemId, paths }) => attach(itemId, paths));

  handle(Channels.subtitles.pick, subtitlesItemInput, async ({ itemId }, event) => {
    deps.getContext(); // no library (the fatal screen): refused before any panel opens
    const paths = await showOpen(deps, event, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: mainStrings.importFilters.subtitles, extensions: ['srt', 'vtt'] }, { name: mainStrings.importFilters.all, extensions: ['*'] }],
    });
    return paths.length === 0 ? NOTHING_PICKED : attach(itemId, paths);
  });

  handle(Channels.subtitles.remove, subtitlesTrackInput, ({ itemId, assetId }) => {
    const removed = deps.getContext().subtitles.remove(itemId, assetId);
    announce(itemId);
    return removed;
  });

  handle(Channels.subtitles.restore, subtitlesRestoreInput, ({ itemId, assetId, position, language }) => {
    const track = deps.getContext().subtitles.restore(itemId, assetId, { position, language }, nowIso());
    announce(itemId);
    return track;
  });
}
