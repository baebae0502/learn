import { CircleHelp } from 'lucide-react';
import { t } from '../strings';
import { SendingButton, TutorNotice } from './TurnFailure';

const { unverified: words } = t.tutor;

/**
 * Under an answer that cited pages it did not read in its turn (spec 7, 8.3; mockup ?state=6): "인용 n개를 확인하지 못했습니다", what that
 * means, and 원문 근거로 다시 묻기 — drawn only when it can ask again (`onReground`: a finished answer with such a page inside the document).
 * Without it, or once the asked-again turn follows the answer, the title line alone: the fact stays, the chips keep
 * their 출처 없음.
 */
export function UnverifiedNotice({ count, onReground }: { count: number; onReground: (() => void) | null }) {
  return (
    <TutorNotice icon={CircleHelp} tone="warning" title={words.title(count)} brief={onReground === null} testId="tutor-unverified">
      <div className="nt-text">{words.body}</div>
      <div className="nt-actions">
        <SendingButton label={words.reground} onPress={onReground ?? undefined} testId="tutor-reground" />
      </div>
    </TutorNotice>
  );
}
