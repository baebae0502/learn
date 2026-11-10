import { useQuery } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { api, unwrap } from '../api';
import { keys } from '../data/queries';
import { useNow } from '../useNow';
import { t } from '../strings';
import { Icon } from '../ui/Icon';
import { ProgressBar } from '../ui/ProgressBar';
import { readingLine, readingProgressView } from './readingLine';
import { Section } from './Section';

/** 읽기: the furthest point read as the table's progress column gives it, and where reading stopped. None for an item never opened. */
export function ReadingSection({ itemId }: { itemId: string }) {
  const now = useNow();
  // Kept fresh by the always-mounted change handler (data/libraryChange.ts), also while a reader hides this panel.
  const position = useQuery({ queryKey: keys.reading(itemId), queryFn: () => unwrap(api().reader.getPosition({ itemId })) });
  const p = position.data;
  if (!p) return null;
  const view = readingProgressView(p.progress);
  return (
    <Section id="reading" title={t.inspector.sections.reading} testId="reading-section">
      {view.kind === 'bar' && (
        <div className="reading-progress">
          <ProgressBar percent={view.percent} label={t.library.progressLabel} wide thick testId="reading-bar" />
          <span className="pct" data-testid="reading-percent">
            {view.percent}%
          </span>
        </div>
      )}
      {view.kind === 'done' && (
        <div className="reading-progress" data-done="">
          <span className="inline-flag c-success" title={t.library.progressDoneLabel} data-testid="reading-done">
            <Icon icon={Check} size="sm" />
            {t.library.progressDone}
          </span>
        </div>
      )}
      <div className="reading-line" data-testid="reading-line">
        {readingLine(p, now)}
      </div>
    </Section>
  );
}
