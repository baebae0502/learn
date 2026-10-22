import { useEffect, useRef, useState } from 'react';
import { useLearnEvent } from '../events';
import { Kbd } from '../ui/Kbd';
import { currentPlatform } from '../ui/platform';
import { commandPill, keyPill, shortcutPill, type DemoPill } from './demoPill';
import { useSidebarHidden } from './useSidebar';

/** How long a pill stays (a new one replaces it at once). */
const PILL_MS = 1400;

/**
 * Demo recordings only (LEARN_DEMO_OVERLAY=1, unpackaged; MainWindow renders it only then): a ring where the pointer
 * is and a pill for each shortcut, since synthetic input and the screen recording show neither. It is never part of
 * the window: aria-hidden, no pointer events, nothing in it can take the focus, no tooltip, no data-pane — the keymap,
 * F6 and the fold rescue behave as without it. Listeners are passive (window capture, nothing is stopped).
 */
export function DemoOverlay() {
  const [pill, setPill] = useState<(DemoPill & { at: number }) | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number; down: boolean } | null>(null);
  // The sidebar state as last drawn, i.e. before a ⌃⌘S that is arriving now: the pill names what the command did.
  const hidden = useSidebarHidden();
  const drawnHidden = useRef(hidden);
  useEffect(() => {
    drawnHidden.current = hidden;
  });
  const show = (p: DemoPill | null) => {
    if (p) setPill({ ...p, at: performance.now() });
  };
  useLearnEvent('menuCommand', ({ commandId }) => show(commandPill(commandId, currentPlatform(), drawnHidden.current ? 'hidden' : 'shown')));
  useLearnEvent('demoShortcut', (item) => show(shortcutPill(item, currentPlatform())));
  useEffect(() => {
    const key = (e: KeyboardEvent) => show(keyPill(e, currentPlatform()));
    const move = (e: PointerEvent) => setPointer({ x: e.clientX, y: e.clientY, down: e.buttons > 0 });
    const types = ['pointermove', 'pointerdown', 'pointerup'] as const;
    addEventListener('keydown', key, { capture: true, passive: true });
    for (const type of types) addEventListener(type, move, { capture: true, passive: true });
    return () => {
      removeEventListener('keydown', key, { capture: true });
      for (const type of types) removeEventListener(type, move, { capture: true });
    };
  }, []);
  useEffect(() => {
    if (!pill) return;
    const timer = setTimeout(() => setPill(null), PILL_MS);
    return () => clearTimeout(timer);
  }, [pill]);
  return (
    <div className="demo-overlay" aria-hidden="true" data-testid="demo-overlay">
      {pointer && <span className="demo-pointer" data-down={pointer.down ? '' : undefined} style={{ left: pointer.x, top: pointer.y }} />}
      {pill && (
        <div className="demo-pill" key={pill.at} data-testid="demo-pill">
          <Kbd keys={pill.keys} />
          {pill.label && <span>{pill.label}</span>}
        </div>
      )}
    </div>
  );
}
