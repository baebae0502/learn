import { useRef, type RefObject } from 'react';
import { CircleAlert } from 'lucide-react';
import { t } from '../strings';
import { Button } from '../ui/Button';
import { Notice } from '../ui/Notice';
import { useFocusOnLeave } from './focusOnLeave';

/**
 * The first list read failed: a stage notice where the list goes (main's cause + next step) and 다시 시도. While the
 * read runs again the button is pending (focusable, announced, presses ignored).
 */
export function ListFailed(props: { message: string; retrying: boolean; onRetry(): void; focusOnLeave?: RefObject<boolean> }) {
  const root = useRef<HTMLDivElement>(null);
  useFocusOnLeave(root, props.focusOnLeave);
  return (
    <div className="library-state" ref={root}>
      <Notice
        icon={CircleAlert}
        title={t.library.listFailed}
        testId="list-failed"
        actions={
          <Button variant="primary" testId="list-retry" isPending={props.retrying} onPress={props.onRetry}>
            {t.common.retry}
          </Button>
        }
      >
        {props.message}
      </Notice>
    </div>
  );
}
