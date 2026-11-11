import { Fragment } from 'react';
import { Copy } from 'lucide-react';
import { t } from '../strings';
import { IconButton } from '../ui/Button';
import { useCopyFeedback } from '../ui/useCopyFeedback';
import { commandParts } from './agentRows';

/**
 * A shell command to run in a terminal, in code, with its copy button at the end. A line breaks at a space between arguments and after a
 * "/" (agentRows.commandParts); a part that fits the line never breaks inside, and one wider than the line breaks at its edge, so the
 * panel never scrolls sideways. The separating space is a plain space between the parts (a nowrap part would not let a line end there).
 * The button copies the command itself and says 복사했습니다 in its tooltip for 1.5 s, with no toast.
 */
export function CommandText({ command, testId, isDisabled = false }: { command: string; testId: string; isDisabled?: boolean }) {
  const { copied, copy } = useCopyFeedback('tutor');
  const parts = commandParts(command);
  return (
    <span className="tutor-cmd-row">
      <code className="tutor-cmd mono" data-testid={`${testId}-text`}>
        {parts.map((part, i) => {
          const space = part.endsWith(' ');
          return (
            <Fragment key={i}>
              <span className="cmd-part">{space ? part.slice(0, -1) : part}</span>
              {space ? ' ' : (part.endsWith('/') || part.endsWith('=')) && i < parts.length - 1 ? <wbr /> : null}
            </Fragment>
          );
        })}
      </code>
      <IconButton icon={Copy} size="small" label={copied ? t.tutor.agents.copied : t.tutor.agents.copy} tooltipOpen={copied} isDisabled={isDisabled} onPress={() => copy(command)} testId={testId} />
      <span className="visually-hidden" role="status">
        {copied ? t.tutor.agents.copied : ''}
      </span>
    </span>
  );
}
