import type { MessageStatus } from '@learn/domain';
import { isComposingKey } from '../ui/ime';

/** What a key does in the composer (spec 8.4, 8.11): send, break the line, stop the answer, or nothing of the composer's. */
export type ComposerKey = 'send' | 'newline' | 'stop' | null;

/**
 * ↩ sends while there is text, nothing holds the send back and no answer comes; ⇧↩ breaks the line; esc stops an answer that comes.
 * A key of a Korean composition (`isComposing`, or the keyCode 229 macOS IMEs send) does none of them: it is the IME's.
 */
export function composerKey(
  e: { key: string; shiftKey: boolean; isComposing: boolean; keyCode: number },
  s: { hasText: boolean; streaming: boolean; canSend: boolean },
): ComposerKey {
  if (isComposingKey(e)) return null;
  if (e.key === 'Enter') {
    if (e.shiftKey) return 'newline';
    return s.hasText && s.canSend && !s.streaming ? 'send' : null;
  }
  if (e.key === 'Escape') return s.streaming ? 'stop' : null;
  return null;
}

/**
 * After tutor:ask's { busyWith }: the other answer's status as sessions:get reads it now. That answer may have ended before the
 * busy answer came back, and then no end notice is still to come: the question goes at once. Otherwise it waits for that notice.
 */
export function afterBusy(status: MessageStatus | null): 'wait' | 'send-now' {
  return status === 'streaming' ? 'wait' : 'send-now';
}
