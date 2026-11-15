import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { FileText, FlaskConical, MessageSquare } from 'lucide-react';
import { mergeProps, useFocusRing, useHover } from 'react-aria';
import type { SessionSummary } from '@learn/domain';
import { api, unwrap } from '../../api';
import { useCommands } from '../../commands/CommandProvider';
import { runPicked } from '../../commands/registry';
import { formatDayAndTime } from '../../format';
import { t } from '../../strings';
import { Icon } from '../../ui/Icon';
import { isComposingKey } from '../../ui/ime';
import { isContextMenuKey, isKeyMenuEcho, menuPointFor } from '../../ui/contextMenuKey';
import { showActionFailed } from '../../ui/toasts';
import { TooltipText } from '../../ui/Tooltip';
import { useTooltipsBlocked } from '../../ui/tooltipGate';
import { useNow } from '../../useNow';
import { cancelRename, finishRename, startRename, type NextRow } from './sessionActions';
import { titleTooLong, useSessionEdit } from './sessionEdit';

const words = t.tutor.sessions;
/** The hover before a row's tooltip, as every tooltip of the app waits (ui/Tooltip.tsx). */
const TIP_DELAY_MS = 600;
/** The tooltip's distance from the sidebar's edge, and the room it keeps from the window's edges (ui/Tooltip.tsx's offset). */
const TIP_OFFSET = 6;
const TIP_EDGE = 8;

/**
 * A row's tooltip (the app's tooltip, ui/Tooltip.tsx): beside the sidebar, centred on its row's height, so it covers none of the rows
 * and labels around it; kept inside the window; as wide as its longest line. A row of a list is no trigger of its own, so it is placed
 * here.
 */
function RowTip({ row, text }: { row: HTMLElement; text: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const tip = ref.current;
    if (!tip) return;
    // Wrapped, the tooltip keeps its maximum width; its text is narrowed to the longest line (the lines break where they did), so
    // the box is as wide as that line. The span is TooltipText's, which sets no style of its own.
    const label = tip.querySelector<HTMLElement>('.tooltip-label');
    if (label) {
      label.style.width = '';
      const range = document.createRange();
      range.selectNodeContents(label);
      const longest = Math.ceil(range.getBoundingClientRect().width);
      if (longest < label.offsetWidth) label.style.width = `${longest}px`;
    }
    const r = row.getBoundingClientRect();
    const edge = (row.closest('.sidebar') ?? row).getBoundingClientRect().right;
    const left = Math.max(TIP_EDGE, Math.min(edge + TIP_OFFSET, innerWidth - TIP_EDGE - tip.offsetWidth));
    const top = Math.max(TIP_EDGE, Math.min(r.top + r.height / 2 - tip.offsetHeight / 2, innerHeight - TIP_EDGE - tip.offsetHeight));
    setAt({ left, top });
  }, [row, text]);
  return createPortal(
    <div ref={ref} className="tooltip row-tip" role="tooltip" data-testid="session-tip" style={at ? { left: at.left, top: at.top } : { visibility: 'hidden' }}>
      <TooltipText label={text} />
    </div>,
    document.body,
  );
}

/** A group of the tree: a day of the reader's list, or an item of the library's (its line a label that cannot be pressed). */
export interface SessionGroupView {
  key: string;
  label: string;
  item?: true;
  sessions: readonly SessionSummary[];
}

/**
 * The row after the session's own in the tree that holds it (the one before it when it is the last): where the focus goes once the
 * session is deleted — while the focus is still on that tree, or was dropped to nowhere with the row.
 */
export function neighborRow(conversationId: string): NextRow | null {
  const row = document.querySelector<HTMLElement>(`[data-session-row][data-conversation-id="${CSS.escape(conversationId)}"]`);
  const tree = row?.closest('[role="tree"]') ?? null;
  const rows = [...(tree?.querySelectorAll<HTMLElement>('[data-session-row]') ?? [])];
  const at = row ? rows.indexOf(row) : -1;
  const id = at < 0 ? undefined : (rows[at + 1] ?? rows[at - 1])?.dataset['conversationId'];
  if (id === undefined || tree === null) return null;
  return {
    id,
    stillHere: () => {
      const now = document.activeElement;
      return now === null || now === document.body || tree.contains(now);
    },
  };
}

/** The session row that has the focus (not its name field): what ⌘⌫ deletes. */
export function focusedSessionRow(): string | null {
  const at = document.activeElement;
  return at instanceof HTMLElement && at.matches('[data-session-row]') ? (at.dataset['conversationId'] ?? null) : null;
}

/**
 * The name being typed inside a session row (spec 8.9): the whole name selected when it appears. ↩ keeps it, esc leaves it; leaving
 * it with a click keeps it, as ↩ does — the window going to the background (a blur that is not the user's) does not.
 */
function SessionNameField({ session }: { session: SessionSummary }) {
  const ref = useRef<HTMLInputElement>(null);
  const busy = useSessionEdit((s) => s.busy);
  const over = useSessionEdit((s) => titleTooLong(s.text));
  useLayoutEffect(() => {
    ref.current?.focus({ preventScroll: true });
    ref.current?.select();
  }, []);
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // The field's keys are its own: none of them moves the tree's cursor.
    e.stopPropagation();
    if (isComposingKey(e)) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      void finishRename(session, e.currentTarget.value, 'enter');
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelRename();
    }
  };
  return (
    <>
      <input
        ref={ref}
        className="name-field"
        data-testid="session-name-input"
        aria-label={words.nameLabel}
        aria-invalid={over || undefined}
        defaultValue={session.title}
        readOnly={busy}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => useSessionEdit.getState().setText(e.currentTarget.value)}
        onKeyDown={onKeyDown}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onBlur={(e) => {
          if (!document.hasFocus()) return;
          void finishRename(session, e.currentTarget.value, 'blur');
        }}
      />
      {over && (
        <span className="rename-note" role="status" data-testid="session-name-note">
          {words.nameTooLong}
        </span>
      )}
    </>
  );
}

interface RowProps {
  session: SessionSummary;
  /** When it was last talked in, and whose agent it was when that is the fake: the row's description and its tooltip's second part. */
  when: string;
  indent: number;
  /** In the reader: whether it is the session the tab's tutor shows. Undefined in the library, whose rows are actions. */
  selected: boolean | undefined;
  tabStop: boolean;
  renaming: boolean;
  register(id: string, el: HTMLElement | null): void;
  onPress(session: SessionSummary): void;
  onDoubleClick(session: SessionSummary): void;
  onMenu(session: SessionSummary, at: { x: number; y: number }): void;
  /** The pointer, or a keyboard focus, has come to rest on the row (or left it: null). */
  onRest(session: SessionSummary, el: HTMLElement | null): void;
}

/**
 * A session row (spec 8.9 — the collection rows' grammar): `message-square` (a fake agent's session `flask-conical`) and the name
 * on one line; no time (the day group says the day), no hover buttons.
 */
export function SessionRow({ session, when, indent, selected, tabStop, renaming, register, onPress, onDoubleClick, onMenu, onRest }: RowProps) {
  const fake = session.agent === 'fake';
  const described = useId();
  const own = useRef<HTMLDivElement | null>(null);
  const { focusProps, isFocusVisible } = useFocusRing();
  const { hoverProps, isHovered } = useHover({ onHoverStart: (e) => onRest(session, e.target as HTMLElement), onHoverEnd: () => onRest(session, null) });
  // A keyboard cursor that stays on the row gets its tooltip too, after the same rest (an arrow press moves it on first).
  const focusVisible = isFocusVisible && !renaming;
  useEffect(() => {
    if (!focusVisible) return;
    onRest(session, own.current);
    return () => onRest(session, null);
    // The session's identity is the row's: its fields changing do not restart the rest.
  }, [focusVisible]);
  const handlers = {
    onClick: (e: MouseEvent) => {
      if (e.button === 0) onPress(session);
    },
    onDoubleClick: () => onDoubleClick(session),
    onContextMenu: (e: MouseEvent) => {
      e.preventDefault();
      onMenu(session, { x: e.clientX, y: e.clientY });
    },
  };
  return (
    <>
      <div
        {...mergeProps(focusProps, hoverProps, handlers)}
        ref={(el) => {
          own.current = el;
          register(session.id, el);
        }}
        role="treeitem"
        aria-selected={selected}
        aria-describedby={described}
        tabIndex={tabStop ? 0 : -1}
        className="nav-row session-row"
        style={{ '--indent': indent } as CSSProperties}
        data-session-row=""
        data-conversation-id={session.id}
        data-selected={selected === true || undefined}
        data-hovered={(isHovered && !renaming) || undefined}
        data-focus-visible={isFocusVisible || undefined}
        data-fake={fake || undefined}
        data-testid="session-row"
      >
        <Icon icon={fake ? FlaskConical : MessageSquare} />
        {renaming ? <SessionNameField session={session} /> : <span className="label ellipsis">{session.title}</span>}
      </div>
      {/* Beside the row, not in it: the row's text is its name alone. */}
      <span id={described} hidden>
        {when}
      </span>
    </>
  );
}

/**
 * A session list as a tree (spec 8.9): its groups — the reader's days, the library's items — and their rows, one Tab stop, ↑ ↓ Home End
 * between the rows, ↩ and a double-click to the row's action, ⇧F10 and the menu key to its native menu, a tooltip of its name and time
 * once the pointer or the keyboard cursor rests on a row (the time is the row's description too). `select` (the reader): a click or an arrow selects the row, which the tab's tutor shows; ↩ and a double-click name it.
 * `open` (the library): a click or ↩ opens the row's session in its item's tab.
 */
export function SessionTree(props: {
  groups: readonly SessionGroupView[];
  mode: 'select' | 'open';
  selectedId?: string | null;
  /** `browse`: the arrows, or a right click before its menu — the sidebar is never folded for it; `press`: a click. */
  onSelect?(session: SessionSummary, how: 'browse' | 'press'): void;
  onOpen?(session: SessionSummary): void;
  className: string;
  testId: string;
}) {
  const { groups, mode, selectedId = null } = props;
  const { env } = useCommands();
  const now = useNow();
  const rows = groups.flatMap((g) => g.sessions);
  const when = (s: SessionSummary) => words.when(formatDayAndTime(s.updatedAt, now), s.agent === 'fake');
  const indent = (g: SessionGroupView) => (g.item ? 1 : 0);
  const renaming = useSessionEdit((s) => s.renaming);
  const focusRow = useSessionEdit((s) => s.focusRow);
  const elements = useRef(new Map<string, HTMLElement>());
  const register = (id: string, el: HTMLElement | null) => {
    if (el) elements.current.set(id, el);
    else elements.current.delete(id);
  };
  // A list that goes (another segment, its item's sessions all deleted) takes an open edit of its rows with it.
  const shown = useRef<string[]>([]);
  shown.current = rows.map((s) => s.id);
  useEffect(() => () => useSessionEdit.getState().releaseRows(shown.current), []);
  // The keyboard's place: the row it was last on while that row is listed, else the selected row, else the first.
  const [cursor, setCursor] = useState<string | null>(null);
  const listed = (id: string | null) => id !== null && rows.some((s) => s.id === id);
  const tabStop = listed(cursor) ? cursor : listed(selectedId) ? selectedId : (rows[0]?.id ?? null);
  const focus = (id: string) => {
    setCursor(id);
    elements.current.get(id)?.focus();
  };
  // A rename that ended with ↩ or esc, or a delete, hands the focus to a row once it is drawn.
  useEffect(() => {
    if (focusRow === null || !elements.current.has(focusRow)) return;
    useSessionEdit.getState().focus(null);
    focus(focusRow);
  });

  const [tip, setTip] = useState<{ session: SessionSummary; el: HTMLElement } | null>(null);
  const tipTimer = useRef<number | undefined>(undefined);
  const blocked = useTooltipsBlocked();
  useEffect(() => () => window.clearTimeout(tipTimer.current), []);
  const onRest = (session: SessionSummary, el: HTMLElement | null) => {
    window.clearTimeout(tipTimer.current);
    if (el === null) return setTip((now) => (now?.session.id === session.id ? null : now));
    tipTimer.current = window.setTimeout(() => setTip({ session, el }), TIP_DELAY_MS);
  };
  const hideTip = () => {
    window.clearTimeout(tipTimer.current);
    setTip(null);
  };
  // Whatever scrolls under a shown tip (the list, or the sidebar it scrolls in) takes it away.
  const tipShown = tip !== null;
  useEffect(() => {
    if (!tipShown) return;
    const hide = () => setTip(null);
    addEventListener('scroll', hide, { capture: true });
    return () => removeEventListener('scroll', hide, { capture: true });
  }, [tipShown]);

  const menuAt = useRef<number | null>(null);
  const openMenu = async (session: SessionSummary, at: { x: number; y: number }) => {
    hideTip();
    try {
      const picked = await unwrap(api().ui.showContextMenu({ kind: 'session', conversationId: session.id, x: at.x, y: at.y }));
      if (picked) runPicked(picked, env, { conversationIds: [session.id] });
    } catch (e) {
      showActionFailed(e);
    }
  };
  const press = (session: SessionSummary) => {
    hideTip();
    setCursor(session.id);
    if (mode === 'select') props.onSelect?.(session, 'press');
    else props.onOpen?.(session);
  };
  const menu = (session: SessionSummary, at: { x: number; y: number }) => {
    if (isKeyMenuEcho(performance.now(), menuAt.current)) return;
    // A right click selects first in the reader (design-spec 7.1) and takes the focus, as the menu's ⌘⌫ acts on the focused row.
    if (mode === 'select' && session.id !== selectedId) props.onSelect?.(session, 'browse');
    focus(session.id);
    void openMenu(session, at);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('[data-session-row]');
    if (!row || e.target !== row || isComposingKey(e)) return;
    const id = row.dataset['conversationId']!;
    const at = rows.findIndex((s) => s.id === id);
    if (isContextMenuKey(e)) {
      e.preventDefault();
      menuAt.current = performance.now();
      void openMenu(rows[at]!, menuPointFor(row));
      return;
    }
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const to = (k: number) => {
      const s = rows[Math.max(0, Math.min(rows.length - 1, k))];
      if (!s) return;
      e.preventDefault();
      hideTip();
      focus(s.id);
      if (mode === 'select' && s.id !== selectedId) props.onSelect?.(s, 'browse');
    };
    if (e.key === 'ArrowDown') to(at + 1);
    else if (e.key === 'ArrowUp') to(at - 1);
    else if (e.key === 'Home') to(0);
    else if (e.key === 'End') to(rows.length - 1);
    else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      hideTip();
      if (mode === 'select') startRename(id);
      else props.onOpen?.(rows[at]!);
    }
  };

  const tipSession = tip && tip.session.id !== renaming && !blocked && tip.el.isConnected ? tip : null;
  return (
    <div className={props.className} role="tree" aria-label={words.tree} onKeyDown={onKeyDown} data-testid={props.testId}>
      {groups.map((g) => (
        <div key={g.key} role="group" aria-label={g.label} className="session-group" data-testid="session-group" data-label={g.label}>
          {g.item ? (
            <div className="nav-row session-item-line" aria-hidden="true" data-testid="session-item-line">
              <Icon icon={FileText} />
              <span className="label ellipsis">{g.label}</span>
            </div>
          ) : (
            <div className="section-label" aria-hidden="true">
              {g.label}
            </div>
          )}
          {g.sessions.map((s) => (
            <SessionRow
              key={s.id}
              session={s}
              when={when(s)}
              indent={indent(g)}
              selected={mode === 'select' ? s.id === selectedId : undefined}
              tabStop={s.id === tabStop}
              renaming={s.id === renaming}
              register={register}
              onPress={press}
              onDoubleClick={(session) => {
                if (mode === 'select') startRename(session.id);
              }}
              onMenu={menu}
              onRest={onRest}
            />
          ))}
        </div>
      ))}
      {tipSession && <RowTip row={tipSession.el} text={words.tip(tipSession.session.title, when(tipSession.session))} />}
    </div>
  );
}
