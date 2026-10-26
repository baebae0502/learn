import { Link, TriangleAlert } from 'lucide-react';
import type { LibraryItem } from '@learn/domain';
import { t } from '../strings';
import { Icon } from '../ui/Icon';

/**
 * The status marks after an item's title, in the table's title cell and the item panel's head alike: the link glyph of
 * a linked original, the 파일 없음 flag of a missing one. `testId` names the flag where one screen shows it twice.
 */
export function ItemMarks({ item, flagTestId }: { item: LibraryItem; flagTestId?: string }) {
  return (
    <>
      {item.storageMode === 'linked' && (
        <span className="linked-mark c-tertiary" title={t.library.linked}>
          <Icon icon={Link} size="sm" label={t.library.linked} />
        </span>
      )}
      {item.availability === 'missing' && (
        <span className="inline-flag c-warning" title={t.library.missingTitle} data-testid={flagTestId}>
          <Icon icon={TriangleAlert} size="sm" />
          {t.library.missing}
        </span>
      )}
    </>
  );
}
