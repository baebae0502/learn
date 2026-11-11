import { Fragment, useEffect, useState } from 'react';
import { Copy } from 'lucide-react';
import { t } from '../strings';
import { IconButton } from '../ui/Button';
import { showToast } from '../ui/toasts';
import { COPIED_MS } from '../inspector/FileSection';
import { commandParts } from './agentRows';

/**
 * A shell command to run in a terminal, in code, with its copy button at the end. The words never break inside; a line breaks after a
 * space and after a "/" (agentRows.commandParts). The button copies the command itself and says 복사했습니다 in its tooltip for 1.5 s,
 * with no toast (as the item panel's SHA-256 does).
 */
export function CommandText({ command, testId }: { command: string; testId: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);
  const copy = () =>
    navigator.clipboard.writeText(command).then(
      () => setCopied(true),
      (e: unknown) => {
        console.warn(`[tutor] copy failed: ${(e as Error)?.name ?? 'Error'}`);
        showToast({ kind: 'error', title: t.inspector.copyFailedTitle, body: t.inspector.copyFailedBody, testId: 'copy-failed' });
      },
    );
  const parts = commandParts(command);
  return (
    <span className="tutor-cmd-row">
      <code className="tutor-cmd mono" data-testid={`${testId}-text`}>
        {parts.map((part, i) => (
          <Fragment key={i}>
            <span className="nobr">{part}</span>
            {part.endsWith('/') && i < parts.length - 1 && <wbr />}
          </Fragment>
        ))}
      </code>
      <IconButton icon={Copy} size="small" label={copied ? t.tutor.agents.copied : t.tutor.agents.copy} tooltipOpen={copied} onPress={() => void copy()} testId={testId} />
      <span className="visually-hidden" role="status">
        {copied ? t.tutor.agents.copied : ''}
      </span>
    </span>
  );
}
