import { useEffect, useState } from 'react';
import type { LibraryItem } from '@learn/domain';
import { knownFacts, rememberFacts, startProbe, type FileFacts } from './fileFacts';
import { PROBE_DELAY_MS, scheduleProbeWhen } from './probeSchedule';

const NONE: FileFacts = {};

/**
 * Page count or length of the selected item, read by the renderer from the file (spec §5.3). Only the item on show is
 * read, and only once the selection has stayed on it for 150 ms (spec 6.4: arrowing down the table does not open a PDF
 * a row), and only while the panel shows one item (`enabled`: not for a several-item selection). Moving on cancels the
 * read. Known revisions answer at once; the head keeps its line meanwhile (the fact joins the end of it, so nothing
 * moves). A missing file is not read.
 */
export function useFileFacts(item: LibraryItem, enabled = true): FileFacts {
  const [facts, setFacts] = useState<FileFacts>(() => knownFacts(item.revisionId) ?? NONE);
  useEffect(() => {
    const hit = knownFacts(item.revisionId);
    setFacts(hit ?? NONE);
    if (hit || item.availability === 'missing') return;
    return scheduleProbeWhen(
      enabled,
      PROBE_DELAY_MS,
      () => startProbe({ type: item.type, assetId: item.assetId }),
      (found) => {
        rememberFacts(item.revisionId, found);
        setFacts(found);
      },
    );
  }, [item.revisionId, item.assetId, item.type, item.availability, enabled]);
  return facts;
}
