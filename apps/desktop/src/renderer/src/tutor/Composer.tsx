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
import { AttachedChip, useAttachSelection } from './AttachedChip';
import { composerKey } from './composerKeys';
import { draftKey, useTutorTab } from './tutorStore';
import { useAgents } from './useAgents';
import { useQuestionOnTheWay, useSend } from './useSend';
import { useAnswerComing } from './useSessionThread';

const { composer: words, agents } = t.tutor;

/**
 * 보내기 and 중지 are one button, one stop of the Tab order (spec 8.11): it changes its face and its press when an answer starts or ends,
 * so a focus on it stays on it. 보내기 is the accent square with its arrow, named 보내기, its tooltip "보내기 ↩" — or, off, the reason
 * (still focusable). 중지 is the plain button with its 14 px glyph and its word, its tooltip "중지 esc".
 */
function SendStopButton({ streaming, onSend, onStop, reason }: { streaming: boolean; onSend(): void; onStop(): void; reason: string | null }) {
  const off = !streaming && reason !== null;
  const disabled = useDisabledReason(off, off ? reason : undefined);
  return (
    <>
      <Tooltip label={streaming ? words.stop : words.send} accelerator={streaming ? 'Escape' : 'Enter'} reason={off ? reason : undefined}>
        <SoftDisabled>
          <AriaButton
            {...withoutPresses({ onPress: streaming ? onStop : onSend }, disabled.soft)}
            {...disabled.controlProps}
            aria-label={streaming ? undefined : words.send}
            className={cx('btn', streaming ? 'btn-secondary has-icon tutor-stop' : 'btn-primary tutor-send')}
            data-testid={streaming ? 'tutor-stop' : 'tutor-send'}
          >
            <Icon icon={streaming ? CircleStop : ArrowUp} size={streaming ? 'sm' : 'md'} />
            {streaming && words.stop}
          </AriaButton>
        </SoftDisabled>
      </Tooltip>
      {disabled.description}
    </>
  );
}

/**
 * The composer under the conversation (spec 8.4, 8.11; approved mockup .tu-composer): the passage attached by the reader's last
 * selection, as a chip over the text area (× takes it off); the text area — two lines high at rest, growing to eight, then scrolling —
 * and its foot: the agent button, the status of the moment ("답하는 중…" while an answer comes, "에이전트를 찾는
 * 중…" while a send waits for the agent's check past 300 ms, as the chooser says it) and 보내기 / 중지. ↩ sends and ⇧↩ breaks the line,
 * never during a Korean composition. While an answer comes, or a send is on its way, the text area is read only; while the item opens
 * it is off. A question waiting for another session's answer stays in it, read only, under the line that says so with 보내지 않기. The
 * text is this session's draft. The text area's name is the approved placeholder whatever its state says. The focus here starts the
 * agent ahead of the question (tutor:warm — main decides whether it can). F6 and ⌃⌘2 land in the text area. `visible`: the panel can
 * be seen.
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
  // The agent checked again before a send (the window's one check): shown as the chooser shows a search, once it has run 300 ms.
  const { searching } = useAgents(visible);
  const checking = onTheWay && searching;
  const { send, stop, cancelWaiting, disabledReason } = useSend();
  const input = useRef<HTMLTextAreaElement>(null);
  useAttachSelection(visible);
  const attached = useTutorTab((s) => s.attached);
  const setAttached = useTutorTab((s) => s.setAttached);

  const opening = disabledReason === 'opening';
  const held = waiting !== null;
  const readOnly = streaming || held || onTheWay;
  const reason = opening ? words.sendOpening : held ? words.sendWaiting : checking ? agents.searchingTip : disabledReason === 'empty' ? words.sendEmpty : null;
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
  const detach = () => {
    setAttached(null);
    // The × goes with its chip: the focus goes to the text, where the question is written.
    input.current?.focus();
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
        {attached !== null && <AttachedChip attached={attached} onRemove={detach} />}
        <textarea
          ref={input}
          className="tutor-input"
          value={draft}
          onChange={(e) => setDraft(key, e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={warm}
          aria-label={words.placeholder}
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
          {streaming ? (
            <span className="tutor-status t-footnote c-secondary" data-testid="tutor-answering">
              {words.answering}
            </span>
          ) : (
            checking && (
              <span className="tutor-status t-footnote c-secondary" role="status" data-testid="tutor-checking">
                <Spinner />
                {agents.searching}
              </span>
            )
          )}
          <SendStopButton streaming={streaming} onSend={() => void send(draft)} onStop={stop} reason={reason} />
        </div>
      </div>
    </div>
  );
}
