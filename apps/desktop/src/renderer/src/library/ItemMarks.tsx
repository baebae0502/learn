import { Link, TriangleAlert } from 'lucide-react';
import type { LibraryItem } from '@learn/domain';
import { t } from '../strings';
import { Icon } from '../ui/Icon';

/** The link glyph of a linked original (title cell and item panel head alike). */
export function LinkMark({ item }: { item: LibraryItem }) {
  if (item.storageMode !== 'linked') return null;
  return (
    <span className="linked-mark c-tertiary" title={t.library.linked}>
      <Icon icon={Link} size="sm" label={t.library.linked} />
    </span>
  );
}

/** The 파일 없음 flag of a missing original; `flagTestId` names it where one screen shows it twice. */
export function StatusFlags({ item, flagTestId }: { item: LibraryItem; flagTestId?: string }) {
  if (item.availability !== 'missing') return null;
  return (
    <span className="inline-flag c-warning" title={t.library.missingTitle} data-testid={flagTestId}>
      <Icon icon={TriangleAlert} size="sm" />
      {t.library.missing}
    </span>
  );
}

/**
 * Both, link mark first, as the item panel's head shows them; the table's title cell puts the colour dots between the two
 * (mockup tableRow).
 */
export function ItemMarks({ item, flagTestId }: { item: LibraryItem; flagTestId?: string }) {
  return (
    <>
      <LinkMark item={item} />
      <StatusFlags item={item} flagTestId={flagTestId} />
    </>
  );
}

/** 남김 (M6 spec 5): in 중복 항목, the row that stays when its group is cleaned up — the earliest import. */
export function KeptMark() {
  return (
    <span className="kept-mark" title={t.organize.duplicates.keptTitle} data-testid="kept-mark">
      {t.organize.duplicates.kept}
    </span>
  );
}
