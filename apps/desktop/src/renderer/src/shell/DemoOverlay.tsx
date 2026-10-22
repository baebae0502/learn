import { useEffect, useRef, useState } from 'react';
import { motion } from '../design/tokens';
import { useLearnEvent } from '../events';
import { Kbd } from '../ui/Kbd';
import { currentPlatform } from '../ui/platform';
import { commandPill, keyPill, shortcutPill, type DemoPill, type KeyPlace } from './demoPill';
import { useSidebarHidden } from './useSidebar';

/** How long a pill stays (a new one replaces it at once); a held ⌥ stays until released. */
const PILL_MS = 1900;
/** How long a chapter caption stays. */
const CAPTION_MS = 3500;
/** Exits run at 0.75 × the base duration (design-spec 8.1), as the CSS does. */
const EXIT_MS = Math.round(motion.base * 0.75);

/**
 * Script-only input for recordings, as window CustomEvents (the overlay exists only in demo builds, so nothing else
 * listens): `learn:demo-caption` (detail: the chapter title) shows it as a caption; `learn:demo-pointer` (detail:
 * { hidden }) hides the drawn pointer when the recording shows the system's own cursor instead (macOS fallback).
 */
export const DEMO_CAPTION_EVENT = 'learn:demo-caption';
export const DEMO_POINTER_EVENT = 'learn:demo-pointer';

type Shown<T> = T & { at: number; leaving: boolean };

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
  const [pointer, setPointer] = useState<{ x: number; y: number; down: boolean; resize: boolean } | null>(null);
  const [pointerHidden, setPointerHidden] = useState(false);
  // The sidebar state as last drawn, i.e. before a ⌃⌘S that is arriving now: the pill names what the command did.
  const hidden = useSidebarHidden();
  const drawnHidden = useRef(hidden);
  useEffect(() => {
    drawnHidden.current = hidden;
  });
  const pillFor = (p: DemoPill | null) => {
    if (p) showPill(p, p.held ? null : PILL_MS);
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
    const move = (e: PointerEvent) => {
      const cursor = e.target instanceof Element ? getComputedStyle(e.target).cursor : '';
      setPointer({ x: e.clientX, y: e.clientY, down: e.buttons > 0, resize: cursor === 'col-resize' || cursor === 'ew-resize' });
    };
    const onCaption = (e: Event) => showCaption({ text: String((e as CustomEvent<unknown>).detail ?? '') }, CAPTION_MS);
    const onPointer = (e: Event) => setPointerHidden(Boolean((e as CustomEvent<{ hidden?: boolean }>).detail?.hidden));
    const types = ['pointermove', 'pointerdown', 'pointerup'] as const;
    const opts = { capture: true, passive: true } as const;
    addEventListener('keydown', down, opts);
    addEventListener('keyup', up, opts);
    for (const type of types) addEventListener(type, move, opts);
    addEventListener(DEMO_CAPTION_EVENT, onCaption);
    addEventListener(DEMO_POINTER_EVENT, onPointer);
    return () => {
      removeEventListener('keydown', down, { capture: true });
      removeEventListener('keyup', up, { capture: true });
      for (const type of types) removeEventListener(type, move, { capture: true });
      removeEventListener(DEMO_CAPTION_EVENT, onCaption);
      removeEventListener(DEMO_POINTER_EVENT, onPointer);
    };
    // Installed once: the handlers only reach state setters and refs.
  }, []);
  return (
    <div className="demo-overlay" aria-hidden="true" data-testid="demo-overlay">
      {pointer && !pointerHidden && (
        <span
          className="demo-pointer"
          data-down={pointer.down ? '' : undefined}
          data-resize={pointer.resize ? '' : undefined}
          style={{ left: pointer.x, top: pointer.y }}
        />
      )}
      {caption && caption.text && (
        <div className="demo-hud demo-caption" key={caption.at} data-leaving={caption.leaving ? '' : undefined} data-testid="demo-caption">
          {caption.text}
        </div>
      )}
      {pill && (
        <div className="demo-hud demo-pill" key={pill.at} data-leaving={pill.leaving ? '' : undefined} data-testid="demo-pill">
          <Kbd keys={pill.keys} />
          {pill.label && <span>{pill.label}</span>}
        </div>
      )}
    </div>
  );
}
