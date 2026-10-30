import { useEffect, useRef, useState } from 'react';
import { motion } from '../design/tokens';
import { useLearnEvent } from '../events';
import { afterPaint, type Pending } from '../ui/afterPaint';
import { Kbd } from '../ui/Kbd';
import { currentPlatform } from '../ui/platform';
import { commandPill, keyPill, shortcutPill, type DemoPill, type KeyPlace } from './demoPill';
import { useSidebarHidden } from './useSidebar';

/** How long a pill stays (a new one replaces it at once); a held ⌥ stays until released. */
const PILL_MS = 1900;
/** With the system's own cursor: how long the click ring stays after the button is released, before it fades. */
const RING_AFTER_UP_MS = 250;
/** A ring waiting for the pointer to move away leaves this long after its first painted frame anyway (a keyboard chapter next). */
const RING_REST_MAX_MS = 1500;
/** How long a chapter caption stays when the script names no duration. */
const CAPTION_MS = 3500;
/** A bottom caption's distance from the window's bottom in demo.css: above the pill band (40 + 52) and 16 more. */
const CAPTION_BOTTOM = 108;
/** Exits run at 0.75 × the base duration (design-spec 8.1), as the CSS does. */
const EXIT_MS = Math.round(motion.base * 0.75);

/**
 * Script-only input for recordings, as window CustomEvents (the overlay exists only in demo builds, so nothing else
 * listens): `learn:demo-caption` (detail: the chapter title, or { text, ms, place, top, bottom, maxWidth }) shows it as a
 * caption for `ms`, bottom-left (`bottom` px up: above the tag selector once it has grown; at most `maxWidth` wide: beside a
 * settings window) or (place 'top', `top` px down) at the top, where the bottom holds the page's own text (the settings window);
 * `learn:demo-tag` (detail: a short text, or null) shows it as a lasting tag until cleared ("스크립트로 재현" while a
 * scripted gesture is on screen), at the content area's top-left, under the table's header: the sidebar's launcher and
 * labels stay clear; `learn:demo-pointer` (detail: { hidden?, mode? }) hides the drawn pointer (the
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
  if (target?.closest('[data-testid="item-row"]')) return 'row'; // ↩ on a table row opens it
  return 'other';
}

const later = (fn: () => void, ms: number): Pending => {
  const id = setTimeout(fn, ms);
  return () => clearTimeout(id);
};

/** Shows `value` for `ms` of painted time (forever when null), then lets it fade out for EXIT_MS and removes it. */
function useTransient<T>(): [Shown<T> | null, (value: T, ms: number | null) => void, () => void] {
  const [shown, setShown] = useState<Shown<T> | null>(null);
  const pending = useRef<Pending[]>([]);
  const clear = () => {
    for (const cancel of pending.current) cancel();
    pending.current = [];
  };
  const leave = () => {
    clear();
    setShown((s) => (s ? { ...s, leaving: true } : s));
    pending.current.push(later(() => setShown(null), EXIT_MS));
  };
  const show = (value: T, ms: number | null) => {
    clear();
    setShown({ ...value, at: performance.now(), leaving: false });
    if (ms !== null) pending.current.push(afterPaint(() => pending.current.push(later(leave, ms))));
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
  const [caption, showCaption] = useTransient<{ text: string; place: 'bottom' | 'top'; top?: number; bottom?: number; maxWidth?: number }>();
  // While a bottom caption shows, the sidebar's tag selector may grow under it (a chapter that makes tags): it stays 16 above
  // the selector's top — clear even while it rises in from 8 lower — over whatever bottom the script gave.
  const [tagLift, setTagLift] = useState(0);
  const captionAtBottom = caption !== null && caption.place === 'bottom';
  useEffect(() => {
    const selector = captionAtBottom ? document.querySelector('.sidebar .tag-selector') : null;
    if (!selector) return setTagLift(0);
    const measure = () => {
      const r = selector.getBoundingClientRect();
      setTagLift(r.height > 0 ? Math.ceil(innerHeight - r.top + 16) : 0);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(selector);
    return () => observer.disconnect();
  }, [captionAtBottom]);
  const [pointer, setPointer] = useState<DrawnPointer | null>(null);
  const [pointerHidden, setPointerHidden] = useState(false);
  const [mode, setMode] = useState<PointerMode>('follow');
  const modeRef = useRef(mode);
  useEffect(() => {
    modeRef.current = mode;
  });
  const [tag, setTag] = useState<{ text: string; left?: number; top?: number } | null>(null);
  // A sheet hangs over the middle of this window: a pill shown now starts bottom-left, where the sheet leaves room.
  const sheetOpen = useRef(false);
  /** Drops the drawn pointer until the next real move (set by the listeners' effect). */
  const dropPointer = useRef<() => void>(() => {});
  useLearnEvent('windowState', (state) => {
    sheetOpen.current = state.sheetOpen;
    // Another window took the focus (a sheet, the settings window, another app): main says so even where the page's own
    // blur never comes (a Playwright-driven page keeps its focus emulated).
    if (!state.focused) dropPointer.current();
  });
  const lastPointer = useRef<{ x: number; y: number } | null>(null);
  const ringTimers = useRef<Pending[]>([]);
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
    /** Set while a ring waits for the pointer to move away (clicks mode, after the button came up). */
    let ringMoved: ((x: number, y: number) => void) | null = null;
    const clearRing = () => {
      for (const cancel of ringTimers.current) cancel();
      ringTimers.current = [];
      ringMoved = null;
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
          else ringMoved?.(e.clientX, e.clientY);
        } else {
          setPointer((p) => (p ? { ...p, down: false } : p));
          clearRing();
          // The ring leaves at the later of RING_AFTER_UP_MS after its first painted frame and the pointer's next move
          // away (Mac run 3, critique n3): a press whose work kept the frame off screen (the PDF's next page) showed its
          // ring for one presented frame, since a page cannot see presentation; it stays while the arrow rests on it.
          const from = { x: e.clientX, y: e.clientY };
          let timeUp = false;
          let moved = false;
          const leave = () => {
            ringMoved = null;
            setPointer((p) => (p ? { ...p, leaving: true } : p));
            ringTimers.current.push(later(() => setPointer(null), EXIT_MS));
          };
          ringMoved = (x, y) => {
            if (moved || Math.hypot(x - from.x, y - from.y) < 2) return; // a made-up move in place is no move
            moved = true;
            if (timeUp) leave();
          };
          ringTimers.current.push(
            afterPaint(() =>
              ringTimers.current.push(
                later(() => {
                  timeUp = true;
                  if (moved) leave();
                }, RING_AFTER_UP_MS),
                later(() => {
                  if (ringMoved) leave();
                }, RING_REST_MAX_MS),
              ),
            ),
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
    dropPointer.current = gone;
    const onCaption = (e: Event) => {
      const detail = (e as CustomEvent<unknown>).detail;
      const d: { text?: unknown; ms?: unknown; place?: unknown; top?: unknown; bottom?: unknown; maxWidth?: unknown } = typeof detail === 'object' && detail !== null ? detail : { text: detail };
      const px = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : undefined);
      const top = px(d.top);
      const bottom = px(d.bottom);
      const maxWidth = px(d.maxWidth);
      showCaption(
        {
          text: String(d.text ?? ''),
          place: d.place === 'top' ? 'top' : 'bottom',
          ...(top !== undefined ? { top } : {}),
          ...(bottom !== undefined ? { bottom } : {}),
          ...(maxWidth !== undefined ? { maxWidth } : {}),
        },
        typeof d.ms === 'number' && d.ms > 0 ? d.ms : CAPTION_MS,
      );
    };
    const onTag = (e: Event) => {
      const detail = (e as CustomEvent<unknown>).detail;
      if (typeof detail !== 'string' || !detail) return setTag(null);
      // The content area's top-left, under the table's header band (where the drop overlay the tag comes with lies), with or
      // without a table: a window-anchored tag sat on the sidebar's launcher and 라이브러리 label (round 2 minor 4).
      const content = document.querySelector('[data-testid="content"]')?.getBoundingClientRect();
      const band = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--table-header-height')) || 0;
      setTag(content && content.width > 0 ? { text: detail, left: Math.round(content.left + 16), top: Math.round(content.top + band + 12) } : { text: detail });
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
        <div className="demo-hud demo-tag" data-testid="demo-tag" style={tag.left !== undefined ? { left: tag.left, top: tag.top } : undefined}>
          {tag.text}
        </div>
      )}
      {caption && caption.text && (
        <div
          className="demo-hud demo-caption"
          key={caption.at}
          data-place={caption.place}
          data-leaving={caption.leaving ? '' : undefined}
          data-testid="demo-caption"
          style={{
            ...(caption.top !== undefined ? { top: caption.top } : {}),
            ...(caption.place === 'bottom' && (caption.bottom !== undefined || tagLift > CAPTION_BOTTOM) ? { bottom: Math.max(caption.bottom ?? CAPTION_BOTTOM, tagLift) } : {}),
            ...(caption.maxWidth !== undefined ? { maxWidth: caption.maxWidth } : {}),
          }}
        >
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
