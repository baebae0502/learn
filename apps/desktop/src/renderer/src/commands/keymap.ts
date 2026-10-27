import { useEffect, useLayoutEffect, useRef } from 'react';
import { setInteractionModality } from 'react-aria-components';
import { COMMANDS, type CommandId, type CommandSpec } from '@learn/domain';
import { noteKey } from '../ui/inputModality';
import { menuTarget, runCommand, type CommandEnv } from './registry';

export type KeyLike = Pick<KeyboardEvent, 'code' | 'key' | 'shiftKey' | 'altKey' | 'ctrlKey' | 'metaKey' | 'isComposing' | 'keyCode'>;

/**
 * Single-key and function-key shortcuts from the registry's `key` (ADR-0005 §3): compared by `event.code` so the
 * Korean input source does not matter; never during an IME composition, never with ⌘/⌃/⌥ (the menu owns those),
 * and letters never while a text field has focus (only keys marked `inText`, such as F6).
 */
export function keyCommand(e: KeyLike, editing: boolean, commands: readonly CommandSpec[] = COMMANDS): CommandId | null {
  if (e.isComposing || e.keyCode === 229) return null;
  if (e.altKey || e.ctrlKey || e.metaKey) return null;
  // The numeric keypad is the same key as the digit row ("Numpad1" is "Digit1"), so an external keyboard tags too.
  const code = e.code.replace(/^Numpad(\d)$/, 'Digit$1');
  const hit = commands.find((c) => c.key !== undefined && c.key.code === code && Boolean(c.key.shift) === e.shiftKey);
  if (!hit) return null;
  if (editing && !hit.key!.inText) return null;
  return hit.id;
}

export function isEditing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  const role = target.getAttribute('role');
  return role === 'textbox' || role === 'combobox' || role === 'searchbox';
}

/**
 * Window-level keydown → registry, in the capture phase on window: ahead of react-aria's LandmarkManager, a document
 * capture listener that takes F6 while a toast is visible (R-1). A key the keymap handles stops here.
 *
 * `active` is false while a modal surface (a sheet, the palette, the drop overlay: MainWindow's one modal predicate,
 * also `env.modal`) owns the keyboard. Its keys then do nothing and still stop here, so that nothing else moves the
 * focus out of that surface either (F6 to a toast). Otherwise the registry decides, an import included: F6 is a
 * `duringWork` command.
 *
 * Because the keys it handles stop before the document, react-aria's focus-visible tracking and ours
 * (ui/inputModality.ts) never see them: both are told the keyboard is in use, as their own keydown would have done,
 * so the focus that F6 moves shows its ring and the sidebar's focus rescue treats it as keyboard navigation.
 */
export function useKeymap(env: CommandEnv, active: boolean): void {
  const envRef = useRef(env);
  const activeRef = useRef(active);
  useLayoutEffect(() => {
    envRef.current = env;
    activeRef.current = active;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const id = keyCommand(e, isEditing(e.target));
      if (id === null) return;
      noteKey(e);
      setInteractionModality('keyboard');
      // An item command (1–8) acts on the table's selection wherever the focus is (spec 4.2); the others take no target.
      if (activeRef.current && !runCommand(id, envRef.current, menuTarget(id, envRef.current))) return; // unavailable now (another view's key): not ours to stop
      e.preventDefault();
      e.stopPropagation();
    };
    addEventListener('keydown', onKey, { capture: true });
    return () => removeEventListener('keydown', onKey, { capture: true });
  }, []);
}
