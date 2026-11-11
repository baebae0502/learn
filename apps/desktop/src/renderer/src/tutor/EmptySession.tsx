import { FileText } from 'lucide-react';
import { t } from '../strings';
import { PaneEmpty } from '../ui/PaneEmpty';

/**
 * A new empty session (spec 8.2, 13, mockup state 4): the item's title over what the tutor can do with it. `text` is the one place its
 * words are chosen: the readable text now; a PDF without readable body text gets its own (approval ⑥ — Task 20 passes it).
 */
export function EmptySession({ title, text = t.tutor.empty.readable }: { title: string; text?: string }) {
  return (
    <div className="tutor-empty">
      <PaneEmpty icon={FileText} title={title} testId="tutor-empty">
        {text}
      </PaneEmpty>
    </div>
  );
}
