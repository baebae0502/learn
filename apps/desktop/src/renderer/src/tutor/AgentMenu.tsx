import { Check, ChevronDown, FlaskConical } from 'lucide-react';
import { Button as AriaButton, Menu, MenuItem, MenuSection, MenuTrigger, Popover, Separator, Text } from 'react-aria-components';
import { commandById, type AgentId, type AgentStatus } from '@learn/domain';
import { api, unwrap } from '../api';
import { useCommands } from '../commands/CommandProvider';
import { t } from '../strings';
import { cx } from '../ui/cx';
import { Icon } from '../ui/Icon';
import { Tooltip } from '../ui/Tooltip';
import { FLAG } from './agentRows';
import { useAgents } from './useAgents';
import { useTutorPrefs } from './useTutorPrefs';

const { agentMenu: words, agents } = t.tutor;

/** One row of the menu: an agent, or 에이전트 고르기…. */
interface Row {
  id: AgentId | 'choose';
  label: string;
  disabled: boolean;
  /** Why a row is off (its tooltip and its description), or what the fake row is. */
  tip?: string;
  fake?: boolean;
}

/** The menu's rows (spec 8.7, approved mockup ?menu=agent): each detected agent — off as "이름 — 상태" while not ready — the fake where the build has one, then 고르기. */
function rowsOf(report: { agents: AgentStatus[]; fake: AgentStatus | null } | null): Row[] {
  const agentRows: Row[] = (report?.agents ?? []).map((s) =>
    s.state === 'ready'
      ? { id: s.id, label: t.tutor.agentName(s.id), disabled: false }
      : { id: s.id, label: words.disabled(t.tutor.agentName(s.id), agents.flag[s.state]), disabled: true, tip: words.why[s.state] },
  );
  const fake: Row[] = report?.fake ? [{ id: 'fake', label: t.tutor.agentName('fake'), disabled: report.fake.state !== 'ready', tip: words.fakeRowTip, fake: true }] : [];
  return [...agentRows, ...fake];
}

/**
 * The composer's agent button and its menu (spec 8.4, 8.7; design-spec 7.3): the chosen agent's name and ▾ when it is ready, its state
 * too in the warning colour when it is not ("Claude Code · 로그인 필요 ▾"), "가짜 에이전트 ▾" with its flask for the fake. Narrow, the label
 * gives way from its state end (the tooltip keeps all of it), so the foot's other controls stay in the composer. The menu: the agents
 * (the chosen one ✓, kept on its row when that row is off), a separator, 에이전트 고르기… (the registry's command). Another agent is
 * chosen through main, which checks it is ready (the next question of this session goes to it). It opens 4 px below the button, or
 * above it when there is no room below. `visible`: the panel can be seen (the agents report is read only then). `disabled`: the
 * composer is off (the item still opens).
 */
export function AgentMenu({ visible, disabled = false }: { visible: boolean; disabled?: boolean }) {
  const current = useTutorPrefs().agent;
  const { report } = useAgents(visible);
  const { run } = useCommands();
  if (current === null) return null;
  const name = t.tutor.agentName(current);
  const status = current === 'fake' ? report?.fake : report?.agents.find((a) => a.id === current);
  // Not known yet (the report is still being read, or the read failed): the name alone, as for a ready agent.
  const state = status?.state ?? 'ready';
  const fake = current === 'fake';
  const flag = fake ? FlaskConical : state === 'ready' ? null : FLAG[state].icon;
  const label = fake || state === 'ready' ? name : words.withState(name, agents.flag[state]);
  const tip = fake ? words.fakeTip : words.tip(name, agents.flag[state]);
  const rows = rowsOf(report);
  const choose = commandById('tutor.chooseAgent').label;

  const onAction = (key: Row['id']) => {
    if (key === 'choose') return run('tutor.chooseAgent');
    if (key === current) return;
    // main checks the agent is ready and writes the choice; a refusal (it changed since the report) leaves the button as it is.
    unwrap(api().tutor.chooseAgent({ agent: key })).catch((e: unknown) => console.warn(`[tutor] choose agent failed: ${(e as { code?: string }).code ?? 'INTERNAL'}`));
  };

  return (
    <MenuTrigger>
      <Tooltip label={tip}>
        <AriaButton
          className={cx('btn', 'btn-plain', 'btn-small', 'has-menu', 'tutor-agent', flag !== null && 'has-icon', (fake || state !== 'ready') && 'warn')}
          isDisabled={disabled}
          data-testid="tutor-agent"
          data-state={fake ? 'fake' : state}
        >
          {flag !== null && <Icon icon={flag} size="sm" />}
          <span className="ellipsis">{label}</span>
          <Icon icon={ChevronDown} size="xs" />
        </AriaButton>
      </Tooltip>
      <Popover className="menu-popover agent-menu" placement="bottom start" offset={4} data-testid="tutor-agent-menu">
        <Menu className="menu" shouldCloseOnSelect onAction={(key) => onAction(key as Row['id'])}>
          {/* The agents are one choice (the chosen one checked); 에이전트 고르기… is an action of its own. */}
          <MenuSection shouldCloseOnSelect selectionMode="single" selectedKeys={[current]} onSelectionChange={() => {}}>
            {rows.map((row) => (
              <MenuItem key={row.id} id={row.id} textValue={row.label} isDisabled={row.disabled} className="mi" data-testid="tutor-agent-row" data-agent={row.id}>
                {/* A row's tooltip (the mockup's): the reason it is off, or what the fake is. Its words are also the row's description. */}
                <span className="mi-row" title={row.tip}>
                  <span className="check" aria-hidden="true">
                    {row.id === current && <Icon icon={Check} size="sm" />}
                  </span>
                  <Text slot="label" className="mi-label">
                    {row.label}
                  </Text>
                  {row.fake && <Icon icon={FlaskConical} size="sm" />}
                </span>
                {row.tip !== undefined && (
                  <Text slot="description" className="visually-hidden">
                    {row.tip}
                  </Text>
                )}
              </MenuItem>
            ))}
          </MenuSection>
          {rows.length > 0 && <Separator className="msep" />}
          <MenuItem key="choose" id="choose" textValue={choose} className="mi" data-testid="tutor-agent-choose">
            <span className="mi-row">
              <span className="check" aria-hidden="true" />
              <span className="mi-label">{choose}</span>
            </span>
          </MenuItem>
        </Menu>
      </Popover>
    </MenuTrigger>
  );
}
