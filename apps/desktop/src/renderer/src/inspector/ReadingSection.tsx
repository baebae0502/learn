import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { api, unwrap } from '../api';
import { useLearnEvent } from '../events';
import { progressShown } from '../library/columns';
import { useNow } from '../useNow';
import { t } from '../strings';
import { Icon } from '../ui/Icon';
import { ProgressBar } from '../ui/ProgressBar';
import { readingLine } from './readingLine';
import { Section } from './Section';

const readingKey = (itemId: string) => ['reading', itemId] as const;

/** 읽기: the furthest point read as the table's progress column gives it, and where reading stopped. None for an item never opened. */
export function ReadingSection({ itemId }: { itemId: string }) {
  const client = useQueryClient();
  const now = useNow();
  const position = useQuery({ queryKey: readingKey(itemId), queryFn: () => unwrap(api().reader.getPosition({ itemId })) });
  useLearnEvent('libraryChanged', ({ reason, itemIds }) => {
    if ((reason === 'position' || reason === 'opened') && (itemIds === undefined || itemIds.includes(itemId))) void client.invalidateQueries({ queryKey: readingKey(itemId) });
  });
  const p = position.data;
  if (!p) return null;
  const percent = p.progress === null ? null : progressShown(p.progress);
  return (
    <Section id="reading" title={t.inspector.sections.reading} testId="reading-section">
      {percent !== null && (
        <div className="reading-progress">
          <ProgressBar percent={percent === 'done' ? 100 : percent} label={t.library.progressLabel} wide thick testId="reading-bar" />
          {percent === 'done' ? (
            <span className="inline-flag c-success" title={t.library.progressDoneLabel} data-testid="reading-done">
              <Icon icon={Check} size="sm" />
              {t.library.progressDone}
            </span>
          ) : (
            <span className="pct" data-testid="reading-percent">
              {percent}%
            </span>
          )}
        </div>
      )}
      <div className="reading-line" data-testid="reading-line">
        {readingLine(p, now)}
      </div>
    </Section>
  );
}
