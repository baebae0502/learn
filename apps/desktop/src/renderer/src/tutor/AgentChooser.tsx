import { useEffect, useRef, useState, type KeyboardEvent, type MutableRefObject } from 'react';
import { CircleCheck, CircleDashed, LogIn, Plug, TriangleAlert, type LucideIcon } from 'lucide-react';
import { Radio, RadioGroup } from 'react-aria-components';
import type { AgentId, AgentState } from '@learn/domain';
import { api, unwrap } from '../api';
import { t } from '../strings';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Spinner } from '../ui/Spinner';
import { Tooltip } from '../ui/Tooltip';
import { agentRow, type AgentRowView } from './agentRows';
import { createFocusRestore } from './focusRestore';
import { CommandText } from './CommandText';
import { useAgents } from './useAgents';
import { useTutorPrefs } from './useTutorPrefs';

const { agents } = t.tutor;

/** A flag: an icon, a colour token and the words (the words carry the meaning; the icon and colour only help). The agent button shows it too. */
export const FLAG: Record<AgentState, { icon: LucideIcon; tone: 'c-success' | 'c-warning' | 'c-secondary' }> = {
  ready: { icon: CircleCheck, tone: 'c-success' },
  login: { icon: LogIn, tone: 'c-warning' },
  missing: { icon: CircleDashed, tone: 'c-secondary' },
  old: { icon: TriangleAlert, tone: 'c-warning' },
  adapter: { icon: Plug, tone: 'c-warning' },
};

interface RowProps {
  row: AgentRowView;
  state: AgentState;
  disabled: boolean;
  onRecheck(): void;
}

/**
 * One agent: the radio (name, flag, description) and, beside it, what to do in a terminal and the recheck. The buttons are not inside the
 * radio (an interactive control in a radio's label is a nested control); the grid places them.
 */
function AgentRow({ row, state, disabled, onRecheck }: RowProps) {
  const fake = row.id === 'fake';
  const flag = FLAG[state];
  return (
    <div className="agent-row" data-testid="agent-row" data-agent={row.id} data-state={fake ? 'fake' : state}>
      <Radio value={row.id} isDisabled={!row.selectable || disabled} className="agent-radio" data-testid={`agent-radio-${row.id}`}>
        <span className="radio" aria-hidden="true" />
        <span className="a-name">
          <span className="nobr">{row.name}</span>
          {fake ? (
            <span className="badge-soft warn" data-testid="agent-flag">{row.flag}</span>
          ) : (
            <span className={`inline-flag t-footnote ${flag.tone}`} data-testid="agent-flag">
              <Icon icon={flag.icon} size="sm" />
              {row.flag}
            </span>
          )}
        </span>
        <span className="a-text" data-testid="agent-description">{row.description}</span>
      </Radio>
      {row.recheck && (
        <span className="a-action">
          <Tooltip label={agents.recheckTip(row.name)}>
            <Button size="small" onPress={onRecheck} isDisabled={disabled} testId="agent-recheck">
              {agents.recheck}
            </Button>
          </Tooltip>
        </span>
      )}
      {row.command !== null && (
        <span className="a-cmd">
          <CommandText command={row.command} testId="agent-copy" isDisabled={disabled} />
        </span>
      )}
    </div>
  );
}

/**
 * The first screen after consent, and 에이전트 고르기… (spec 8.7, approved mockup state 3): Claude Code's row in its state, the fake agent in
 * the development group where the build has one, 다시 찾기 and the start. The radio group is the only way to choose; the start is ↩ from it.
 * `visible`: the panel can be seen; a folded one reads nothing (spec 4.3: detection when the chooser is shown).
 * `focusRequest`: after 동의 the focus comes here — onto the chosen (else the first usable) radio, else the region itself until the report
 * is in; read once the chooser is on screen, and cleared when it has landed or the user went elsewhere.
 */
export function AgentChooser({ onStarted, focusRequest, visible }: { onStarted(): void; focusRequest: MutableRefObject<boolean>; visible: boolean }) {
  const { report, busy, searching, failed, recheck, research } = useAgents(visible);
  const current = useTutorPrefs().agent;
  const [picked, setPicked] = useState<AgentId | null>(null);
  const starting = useRef(false);
  const region = useRef<HTMLDivElement>(null);

  const rows = report === null ? [] : report.agents.map((s) => ({ s, row: agentRow(s) }));
  const fake = report?.fake ? { s: report.fake, row: agentRow(report.fake) } : null;
  const all = fake ? [...rows, fake] : rows;
  // What is chosen: the user's pick while it is usable, else the agent in use if it is, else the first usable real agent.
  const usable = (id: AgentId | null) => all.find((r) => r.row.id === id && r.row.selectable)?.row.id ?? null;
  const chosen = usable(picked) ?? usable(current) ?? rows.find((r) => r.row.selectable)?.row.id ?? null;
  const chosenRow = all.find((r) => r.row.id === chosen)?.row ?? null;

  useEffect(() => {
    if (!focusRequest.current || !region.current) return;
    const box = region.current;
    const active = document.activeElement;
    // The user already went somewhere in the panel: leave it.
    if (active !== null && active !== document.body && active !== box && !box.contains(active)) {
      focusRequest.current = false;
      return;
    }
    const radio = box.querySelector<HTMLElement>('input[type="radio"]:checked:not(:disabled)') ?? box.querySelector<HTMLElement>('input[type="radio"]:not(:disabled)');
    if (radio) {
      radio.focus();
      focusRequest.current = false;
    } else if ((report !== null || failed) && !searching) {
      (box.parentElement?.querySelector<HTMLElement>('[data-testid="agent-research"]') ?? box).focus();
      focusRequest.current = false;
    } else box.focus();
  }, [focusRequest, report, searching, failed, chosen]);

  // A button that was pressed is disabled while the search shows, which drops its focus: when that search ends the focus is back on it.
  const restore = useRef(createFocusRestore());
  const hold = (selector: string, run: () => void) => () => {
    restore.current.hold(document.activeElement !== null && document.activeElement.matches(selector) ? selector : null);
    run();
  };
  useEffect(() => {
    const selector = restore.current.step(busy, searching);
    if (selector !== null && (document.activeElement === null || document.activeElement === document.body)) {
      region.current?.parentElement?.querySelector<HTMLElement>(selector)?.focus();
    }
  }, [busy, searching]);

  const start = () => {
    if (chosen === null || starting.current || searching) return;
    starting.current = true;
    unwrap(api().tutor.chooseAgent({ agent: chosen }))
      .then(onStarted)
      // main re-checks that the agent is ready (AGENT_NOT_READY after a change since the report): the screen stays; the code only goes to the log.
      .catch((e: unknown) => console.warn(`[tutor] choose agent failed: ${(e as { code?: string }).code ?? 'INTERNAL'}`))
      .finally(() => void (starting.current = false));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    // ↩ on a radio starts; a button keeps its own ↩.
    if (e.key !== 'Enter' || e.nativeEvent.isComposing || !(e.target instanceof HTMLInputElement) || e.target.type !== 'radio') return;
    e.preventDefault();
    start();
  };

  return (
    <>
      <div className="tutor-scroll chooser" ref={region} tabIndex={-1} role="region" aria-label={agents.title} data-testid="tutor-chooser" data-searching={searching ? '' : undefined} onKeyDownCapture={onKeyDown}>
        <div className="tutor-title">
          <h2 className="tutor-section-title">{agents.title}</h2>
        </div>
        <p className="tutor-text" data-testid="tutor-chooser-lead">{agents.lead}</p>
        {searching && (
          <div className="loading tutor-searching" role="status" data-testid="agent-searching">
            <Spinner />
            {agents.searching}
          </div>
        )}
        {failed && (
          <p className="tutor-note" role="status" id="agent-failed-note" data-testid="agent-failed">
            <Icon icon={TriangleAlert} size="sm" />
            {agents.failedLine}
          </p>
        )}
        <RadioGroup aria-label={agents.groupLabel} value={chosen} onChange={(v) => setPicked(v as AgentId)} isDisabled={searching} className="agent-groups" data-searching={searching ? '' : undefined}>
          {rows.length > 0 && (
            <div className="agent-group">
              {rows.map(({ s, row }) => (
                <AgentRow key={row.id} row={row} state={s.state} disabled={searching} onRecheck={hold(`[data-agent="${row.id}"] [data-testid="agent-recheck"]`, () => recheck(row.id))} />
              ))}
            </div>
          )}
          {fake && (
            <div className="agent-dev" data-testid="agent-dev-group" role="group" aria-labelledby="agent-dev-label">
              <div className="group-label" id="agent-dev-label">{agents.devGroup}</div>
              <div className="agent-group dev">
                <AgentRow row={fake.row} state={fake.s.state} disabled={searching} onRecheck={() => undefined} />
              </div>
            </div>
          )}
        </RadioGroup>
      </div>
      <div className="tutor-foot">
        <Tooltip label={agents.researchTip}>
          <Button variant="plain" leading aria-describedby={failed ? 'agent-failed-note' : undefined} onPress={hold('[data-testid="agent-research"]', research)} isDisabled={searching} testId="agent-research">
            {agents.research}
          </Button>
        </Tooltip>
        <span className="spacer" />
        {chosenRow !== null && !searching ? (
          <Tooltip label={agents.startTip}>
            <Button variant="primary" onPress={start} testId="agent-start">
              {agents.startWith(chosenRow.name)}
            </Button>
          </Tooltip>
        ) : (
          <Button variant="primary" isDisabled disabledReason={searching || (report === null && !failed) ? agents.searchingTip : failed && chosenRow === null ? agents.failedTip : agents.notReady} testId="agent-start">
            {agents.start}
          </Button>
        )}
      </div>
    </>
  );
}
