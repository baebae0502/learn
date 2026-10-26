import { Folder } from 'lucide-react';
import { formatDate } from '../format';
import { t } from '../strings';
import { PaneEmpty } from '../ui/PaneEmpty';
import { useNow } from '../useNow';

/** The item panel while an empty collection is viewed and nothing is selected (spec 3.6): its name, no items, the day it was made. */
export function EmptyCollectionPanel({ name, createdAt }: { name: string; createdAt: string }) {
  const now = useNow();
  return (
    <PaneEmpty icon={Folder} title={name} testId="inspector-collection">
      <span data-testid="collection-empty-meta">{t.organize.empty.collectionMeta(formatDate(createdAt, now))}</span>
    </PaneEmpty>
  );
}
