import { Clapperboard, FileText } from 'lucide-react';
import { t } from '../strings';
import { Icon } from '../ui/Icon';
import type { PreviewFacts } from './previewFacts';

/**
 * What follows the pointer while rows are dragged (spec 8.2): the first row's kind icon and title (cut at 240 px) and, from
 * two rows on, a "자료 N개" badge. The browser takes a picture of it at the start of the drag (rowPreview.tsx); the state
 * board and the tour draw it in place.
 */
export function DragPreview({ title, type, count }: PreviewFacts) {
  return (
    <div className="dnd-preview" data-testid="drag-preview">
      <Icon icon={type === 'video' ? Clapperboard : FileText} />
      <span className="dnd-preview-title ellipsis">{title}</span>
      {count >= 2 && <span className="dnd-preview-badge num">{t.organize.dnd.badge(count)}</span>}
    </div>
  );
}
