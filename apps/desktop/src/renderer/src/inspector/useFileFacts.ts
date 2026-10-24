import { useEffect, useState } from 'react';
import type { LibraryItem } from '@learn/domain';
import { knownFacts, probePdf, probeVideo, rememberFacts, type FileFacts } from './fileFacts';

const NONE: FileFacts = {};

/**
 * Page count or length of the selected item, read by the renderer from the file (spec §5.3). Only the item on show is
 * read: moving on cancels the read. Known revisions answer at once; the head keeps its line meanwhile (the fact joins
 * the end of it, so nothing moves). A missing file is not read.
 */
export function useFileFacts(item: LibraryItem): FileFacts {
  const [facts, setFacts] = useState<FileFacts>(() => knownFacts(item.revisionId) ?? NONE);
  useEffect(() => {
    const hit = knownFacts(item.revisionId);
    setFacts(hit ?? NONE);
    if (hit || item.availability === 'missing') return;
    const probe = item.type === 'pdf' ? probePdf(item.assetId) : probeVideo(item.assetId);
    let live = true;
    void probe.done.then((found) => {
      if (!live) return;
      rememberFacts(item.revisionId, found);
      setFacts(found);
    });
    return () => {
      live = false;
      probe.cancel();
    };
  }, [item.revisionId, item.assetId, item.type, item.availability]);
  return facts;
}
