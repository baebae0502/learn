import { useEffect, useRef, useState } from 'react';
import { motion } from '../design/tokens';
import { useLearnEvent } from '../events';
import { Kbd } from '../ui/Kbd';
import { currentPlatform } from '../ui/platform';
import { commandPill, keyPill, shortcutPill, type DemoPill, type KeyPlace } from './demoPill';
import { useSidebarHidden } from './useSidebar';

/** How long a pill stays (a new one replaces it at once); a held ⌥ stays until released. */
const PILL_MS = 1900;
/** With the system's own cursor: how long the click ring stays after the button is released, before it fades. */
const RING_AFTER_UP_MS = 250;
/** How long a chapter caption stays when the script names no duration. */
const CAPTION_MS = 3500;
/** Exits run at 0.75 × the base duration (design-spec 8.1), as the CSS does. */
const EXIT_MS = Math.round(motion.base * 0.75);

/**
 * Script-only input for recordings, as window CustomEvents (the overlay exists only in demo builds, so nothing else
 * listens): `learn:demo-caption` (detail: the chapter title, or { text, ms }) shows it as a caption for `ms`;
 * `learn:demo-tag` (detail: a short text, or null) shows it as a lasting tag until cleared ("스크립트로 재현" while a
 * scripted gesture is on screen); `learn:demo-pointer` (detail: { hidden?, mode? }) hides the drawn pointer (the
 * pointer is in another window), or sets what it draws: 'follow', a disc where the pointer is (synthetic input, no
 * cursor on screen), or 'clicks', only a ring at the system's own cursor while a button is down (macOS: the real
 * arrow is the pointer; a second, trailing one was critique mac1 M1).
 */
export const DEMO_CAPTION_EVENT = 'learn:demo-caption';
export const DEMO_TAG_EVENT = 'learn:demo-tag';
export const DEMO_POINTER_EVENT = 'learn:demo-pointer';

type Shown<T> = T & { at: number; leaving: boolean };
export type PointerMode = 'follow' | 'clicks';
interface DrawnPointer {
  x: number;
  y: number;
  down: boolean;
  resize: boolean;
  /** 'clicks': the ring fading out after the button came up. */
  leaving: boolean;
}

/** Where a key was pressed (demoPill KeyPlace): read from the target and what is on screen. */
function placeOf(e: KeyboardEvent): KeyPlace {
  const target = e.target instanceof Element ? e.target : null;
  if (document.querySelector('[data-testid="drop-overlay"]')) return 'dropping';
  if (target?.closest('[data-testid="palette"]')) return 'palette';
  if (target?.closest('[data-testid="open-item"]')) return 'row';
  return 'other';
}

/** Shows `value` for `ms` (forever when null), then lets it fade out for EXIT_MS and removes it. */
function useTransient<T>(): [Shown<T> | null, (value: T, ms: number | null) => void, () => void] {
  const [shown, setShown] = useState<Shown<T> | null>(null);
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const clear = () => {
    for (const timer of timers.current) clearTimeout(timer);
    timers.current = [];
  };
  const leave = () => {
    clear();
    setShown((s) => (s ? { ...s, leaving: true } : s));
    timers.current.push(setTimeout(() => setShown(null), EXIT_MS));
  };
  const show = (value: T, ms: number | null) => {
    clear();
    setShown({ ...value, at: performance.now(), leaving: false });
    if (ms !== null) timers.current.push(setTimeout(leave, ms));
  };
  useEffect(() => clear, []);
  return [shown, show, leave];
}

/**
 * Demo recordings only (LEARN_DEMO_OVERLAY=1, unpackaged; the main and settings windows render it only then): a
 * presentation cursor where the pointer is, a pill for each shortcut and a caption for each chapter, since synthetic
 * input and a screen recording show none of them. It is never part of the window: aria-hidden, no pointer events,
 * nothing in it can take the focus, no tooltip, no data-pane, and nothing in it uses the app's focus colour — the
 * keymap, F6 and the fold rescue behave as without it. Listeners are passive (window capture, nothing is stopped).
 */
export function DemoOverlay() {
  const [pill, showPill, endPill] = useTransient<DemoPill>();
  const [caption, showCaption] = useTransient<{ text: string }>();
  const [pointer, setPointer] = useState<DrawnPointer | null>(null);
  const [pointerHidden, setPointerHidden] = useState(false);
  const [mode, setMode] = useState<PointerMode>('follow');
  const modeRef = useRef(mode);
  useEffect(() => {
    modeRef.current = mode;
  });
  const [tag, setTag] = useState<string | null>(null);
  // A sheet hangs over the middle of this window: a pill shown now starts bottom-left, where the sheet leaves room.
  const sheetOpen = useRef(false);
  useLearnEvent('windowState', (state) => void (sheetOpen.current = state.sheetOpen));
  const lastPointer = useRef<{ x: number; y: number } | null>(null);
  const ringTimers = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  // The sidebar state as last drawn, i.e. before a ⌃⌘S that is arriving now: the pill names what the command did.
  const hidden = useSidebarHidden();
  const drawnHidden = useRef(hidden);
  useEffect(() => {
    drawnHidden.current = hidden;
  });
  // Its place is fixed here, when it appears (aside under a sheet, or for a command that opens one): a pill on screen
  // never moves (critique round 3 m1).
  const pillFor = (p: DemoPill | null) => {
    if (p) showPill(sheetOpen.current && !p.aside ? { ...p, aside: true } : p, p.held ? null : PILL_MS);
  };
  useLearnEvent('menuCommand', ({ commandId }) => pillFor(commandPill(commandId, currentPlatform(), drawnHidden.current ? 'hidden' : 'shown')));
  useLearnEvent('demoShortcut', (item) => pillFor(shortcutPill(item, currentPlatform())));
  // The latest pill, for the key-up of a held modifier (the listeners below are installed once).
  const pillRef = useRef(pill);
  useEffect(() => {
    pillRef.current = pill;
  });
  useEffect(() => {
    const down = (e: KeyboardEvent) => pillFor(keyPill(e, currentPlatform(), placeOf(e)));
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Alt' && pillRef.current?.held && !pillRef.current.leaving) endPill();
    };
    const clearRing = () => {
      for (const timer of ringTimers.current) clearTimeout(timer);
      ringTimers.current = [];
    };
    const move = (e: PointerEvent) => {
      const cursor = e.target instanceof Element ? getComputedStyle(e.target).cursor : '';
      const next: DrawnPointer = { x: e.clientX, y: e.clientY, down: e.buttons > 0, resize: cursor === 'col-resize' || cursor === 'ew-resize', leaving: false };
      if (modeRef.current === 'clicks') {
        // The system's arrow is the pointer: a ring only while a button is down (a drag included), fading once it is up.
        if (e.type === 'pointerdown') {
          clearRing();
          setPointer(next);
        } else if (e.type === 'pointermove') {
          if (e.buttons > 0) setPointer((p) => (p ? next : p));
        } else {
          setPointer((p) => (p ? { ...p, down: false } : p));
          clearRing();
          ringTimers.current.push(
            setTimeout(() => {
              setPointer((p) => (p ? { ...p, leaving: true } : p));
              ringTimers.current.push(setTimeout(() => setPointer(null), EXIT_MS));
            }, RING_AFTER_UP_MS),
          );
        }
        return;
      }
      // Synthetic input: a move to somewhere else with no movement is one the platform made up when a window over this
      // one moved or closed (Chromium on Linux: the window's middle, movement 0); the pointer never went there. Real
      // moves of the system cursor can come without movement (macOS, posted events): that mode never gets here.
      const last = lastPointer.current;
      if (e.type === 'pointermove' && e.movementX === 0 && e.movementY === 0 && last && (last.x !== e.clientX || last.y !== e.clientY)) return;
      lastPointer.current = next;
      setPointer(next);
    };
    // The pointer left the window, or another window took the focus: no pointer here until it really moves in again.
    const gone = () => {
      clearRing();
      setPointer(null);
    };
    const onCaption = (e: Event) => {
      const detail = (e as CustomEvent<unknown>).detail;
      const { text, ms } = typeof detail === 'object' && detail !== null ? (detail as { text?: unknown; ms?: unknown }) : { text: detail, ms: undefined };
      showCaption({ text: String(text ?? '') }, typeof ms === 'number' && ms > 0 ? ms : CAPTION_MS);
    };
    const onTag = (e: Event) => {
      const detail = (e as CustomEvent<unknown>).detail;
      setTag(typeof detail === 'string' && detail ? detail : null);
    };
    const onPointer = (e: Event) => {
      const detail = (e as CustomEvent<{ hidden?: boolean; mode?: PointerMode } | null>).detail ?? {};
      if (detail.hidden !== undefined) setPointerHidden(Boolean(detail.hidden));
      if (detail.mode === 'follow' || detail.mode === 'clicks') {
        modeRef.current = detail.mode;
        setMode(detail.mode);
        gone();
      }
    };
    const types = ['pointermove', 'pointerdown', 'pointerup'] as const;
    const opts = { capture: true, passive: true } as const;
    addEventListener('keydown', down, opts);
    addEventListener('keyup', up, opts);
    for (const type of types) addEventListener(type, move, opts);
    document.documentElement.addEventListener('pointerleave', gone, { passive: true });
    addEventListener('blur', gone);
    addEventListener(DEMO_CAPTION_EVENT, onCaption);
    addEventListener(DEMO_TAG_EVENT, onTag);
    addEventListener(DEMO_POINTER_EVENT, onPointer);
    return () => {
      removeEventListener('keydown', down, { capture: true });
      removeEventListener('keyup', up, { capture: true });
      for (const type of types) removeEventListener(type, move, { capture: true });
      document.documentElement.removeEventListener('pointerleave', gone);
      removeEventListener('blur', gone);
      clearRing();
      removeEventListener(DEMO_CAPTION_EVENT, onCaption);
      removeEventListener(DEMO_TAG_EVENT, onTag);
      removeEventListener(DEMO_POINTER_EVENT, onPointer);
    };
    // Installed once: the handlers only reach state setters and refs.
  }, []);
  return (
    <div className="demo-overlay" aria-hidden="true" data-testid="demo-overlay" data-pointer-mode={mode}>
      {pointer && !pointerHidden && (
        <span
          className="demo-pointer"
          data-testid="demo-pointer"
          data-down={pointer.down ? '' : undefined}
          data-resize={pointer.resize && mode === 'follow' ? '' : undefined}
          data-leaving={pointer.leaving ? '' : undefined}
          style={{ left: pointer.x, top: pointer.y }}
        />
      )}
      {tag && (
        <div className="demo-hud demo-tag" data-testid="demo-tag">
          {tag}
        </div>
      )}
      {caption && caption.text && (
        <div className="demo-hud demo-caption" key={caption.at} data-leaving={caption.leaving ? '' : undefined} data-testid="demo-caption">
          {caption.text}
        </div>
      )}
      {pill && (
        <div
          className="demo-hud demo-pill"
          key={pill.at}
          data-aside={pill.aside ? '' : undefined}
          data-leaving={pill.leaving ? '' : undefined}
          data-testid="demo-pill"
        >
          <Kbd keys={pill.keys} />
          {pill.label && <span>{pill.label}</span>}
        </div>
      )}
    </div>
  );
}
