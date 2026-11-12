import { useRef, type KeyboardEvent } from 'react';
import { ArrowUp, CircleStop } from 'lucide-react';
import { Button as AriaButton } from 'react-aria-components';
import { TUTOR_LIMITS } from '@learn/domain';
import { api } from '../api';
import { t } from '../strings';
import { Button, SoftDisabled } from '../ui/Button';
import { cx } from '../ui/cx';
import { useDisabledReason, withoutPresses } from '../ui/disabledReason';
import { Icon } from '../ui/Icon';
import { isComposingKey } from '../ui/ime';
import { Spinner } from '../ui/Spinner';
import { Tooltip } from '../ui/Tooltip';
import { useReaderScope } from '../viewers/readerScope';
import { AgentMenu } from './AgentMenu';
import { composerKey } from './composerKeys';
import { draftKey, useTutorTab } from './tutorStore';
import { useQuestionOnTheWay, useSend } from './useSend';
import { useAnswerComing } from './useSessionThread';

const { composer: words } = t.tutor;

/** 보내기: the accent square with its arrow, named 보내기; its tooltip says ↩, or why it is off (still focusable then). */
function SendButton({ onPress, reason }: { onPress(): void; reason: string | null }) {
  const disabled = useDisabledReason(reason !== null, reason ?? undefined);
  return (
    <>
      <Tooltip label={words.send} accelerator="Enter" reason={reason ?? undefined}>
        <SoftDisabled>
          <AriaButton {...withoutPresses({ onPress }, disabled.soft)} {...disabled.controlProps} aria-label={words.send} className="btn btn-primary tutor-send" data-testid="tutor-send">
            <Icon icon={ArrowUp} />
          </AriaButton>
        </SoftDisabled>
      </Tooltip>
      {disabled.description}
    </>
  );
}

/**
 * The composer under the conversation (spec 8.4, 8.11; approved mockup .tu-composer): the text area — two lines high at rest, growing
 * to eight, then scrolling — and its foot: the agent button, "답하는 중…" while an answer comes, and 보내기, which 중지 replaces then.
 * ↩ sends and ⇧↩ breaks the line, never during a Korean composition. While an answer comes the text area is read only; while the item
 * opens it is off. A question waiting for another session's answer stays in it, read only, under the line that says so with 보내지 않기
 * (J17). The text is this session's draft (J48). The focus here starts the agent ahead of the question (tutor:warm — main decides
 * whether it can). F6 and ⌃⌘2 land in the text area. `visible`: the panel can be seen.
 */
export function Composer({ visible }: { visible: boolean }) {
  const scope = useReaderScope();
  const conversationId = useTutorTab((s) => s.conversationId);
  const key = draftKey(conversationId, scope.id);
  const draft = useTutorTab((s) => s.drafts[key] ?? '');
  const setDraft = useTutorTab((s) => s.setDraft);
  const waiting = useTutorTab((s) => s.waiting);
  const streaming = useAnswerComing(conversationId) !== null;
  const onTheWay = useQuestionOnTheWay();
  const { send, stop, cancelWaiting, disabledReason } = useSend();
  const input = useRef<HTMLTextAreaElement>(null);

  const opening = disabledReason === 'opening';
  const held = waiting !== null;
  const readOnly = streaming || held || onTheWay;
  const reason = opening ? words.sendOpening : held ? words.sendWaiting : disabledReason === 'empty' ? words.sendEmpty : null;
  const placeholder = streaming ? words.receiving : opening ? words.opening : words.placeholder;

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const k = composerKey(
      { key: e.key, shiftKey: e.shiftKey, isComposing: e.nativeEvent.isComposing, keyCode: e.keyCode },
      { hasText: disabledReason !== 'empty', streaming, canSend: reason === null && !onTheWay },
    );
    // ↩ never breaks the line (⇧↩ does); a composition's ↩ is the IME's, so it is left alone.
    if (e.key === 'Enter' && !e.shiftKey && !isComposingKey(e)) e.preventDefault();
    if (k === 'send') void send(draft);
  };
  const letGo = () => {
    cancelWaiting();
    // The line and its button go: the focus goes to the text, now a draft to edit, at its end.
    const el = input.current;
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  };
  const warm = () => {
    // A guess at the next question: main starts the agent when it can, and never answers with an error that matters here.
    api().tutor.warm({ itemId: scope.id, conversationId }).catch(() => {});
  };

  return (
    <div className="tutor-compose">
      {held && (
        <div className="tutor-wait" data-testid="tutor-waiting">
          <Spinner />
          <span className="w-text" role="status">
            {words.waiting}
          </span>
          <Button size="small" onPress={letGo} testId="tutor-dont-send">
            {words.dontSend}
          </Button>
        </div>
      )}
      <div className={cx('tutor-composer', opening && 'is-disabled', held && 'is-readonly')} data-testid="tutor-composer">
        <textarea
          ref={input}
          className="tutor-input"
          value={draft}
          onChange={(e) => setDraft(key, e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={warm}
          placeholder={placeholder}
          readOnly={readOnly}
          disabled={opening}
          maxLength={TUTOR_LIMITS.questionChars}
          rows={2}
          data-pane-landing=""
          data-testid="tutor-input"
        />
        <div className="foot">
          <AgentMenu visible={visible} disabled={opening} />
          <span className="spacer" />
          {streaming && (
            <span className="t-footnote c-secondary" data-testid="tutor-answering">
              {words.answering}
            </span>
          )}
          {streaming ? (
            <Tooltip label={words.stop} accelerator="Escape">
              <Button icon={CircleStop} onPress={stop} testId="tutor-stop">
                {words.stop}
              </Button>
            </Tooltip>
          ) : (
            <SendButton onPress={() => void send(draft)} reason={reason} />
          )}
        </div>
      </div>
    </div>
  );
}
