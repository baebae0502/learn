import { CircleHelp } from 'lucide-react';
import { t } from '../strings';
import { SendingButton, TutorNotice } from './TurnFailure';

const { unverified: words } = t.tutor;

/**
 * Under an answer that cited pages it did not read in its turn (spec 7, 8.3; mockup ?state=6): "인용 n개를 확인하지 못했습니다", what that
 * means, and 원문 근거로 다시 묻기 (`full`: the thread's last answer, with such a page inside the document — failureCopy.unverifiedForm).
 * Otherwise (`title`: an older answer, the asked-again turn after it, only pages past the last) the title line alone: the fact stays, the
 * chips keep their 출처 없음.
 */
export function UnverifiedNotice({ count, form, onReground }: { count: number; form: 'title' | 'full'; onReground(): void }) {
  return (
    <TutorNotice icon={CircleHelp} tone="warning" title={words.title(count)} brief={form === 'title'} testId="tutor-unverified">
      <div className="nt-text">{words.body}</div>
      <div className="nt-actions">
        <SendingButton label={words.reground} onPress={onReground} testId="tutor-reground" />
      </div>
    </TutorNotice>
  );
}
