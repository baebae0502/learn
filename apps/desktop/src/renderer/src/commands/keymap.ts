import { useEffect, useLayoutEffect, useRef } from 'react';
import { setInteractionModality } from 'react-aria-components';
import { COMMANDS, type CommandId, type CommandSpec, type KeySpec } from '@learn/domain';
import { isComposingKey } from '../ui/ime';
import { noteKey } from '../ui/inputModality';
import { focusOwnsKey, inOpenPopup } from './focusOwnsKey';
import { isCommandEnabled, menuTarget, runCommand, type CommandEnv } from './registry';

export type KeyLike = Pick<KeyboardEvent, 'code' | 'key' | 'shiftKey' | 'altKey' | 'ctrlKey' | 'metaKey' | 'isComposing' | 'keyCode'> & { repeat?: boolean };

/**
 * Single-key and function-key shortcuts from the registry's `key` (ADR-0005 §3): compared by `event.code` so the
 * Korean input source does not matter; never during an IME composition, never with ⌘/⌃/⌥ (the menu owns those),
 * and letters never while a text field has focus (only keys marked `inText`, such as F6). A key marked `yields` is left to the
 * focused control when that control uses the key itself (focusOwnsKey).
 */
export function keyCommand(e: KeyLike, editing: boolean, commands: readonly CommandSpec[] = COMMANDS, owns: (code: string) => boolean = () => false): CommandId | null {
  if (isComposingKey(e)) return null;
  if (e.altKey || e.ctrlKey || e.metaKey) return null;
  // The numeric keypad is the same key as the digit row ("Numpad1" is "Digit1"), so an external keyboard tags too.
  const code = e.code.replace(/^Numpad(\d)$/, 'Digit$1');
  const matches = (k: KeySpec | undefined): k is KeySpec => k !== undefined && k.code === code && Boolean(k.shift) === e.shiftKey;
  const hit = commands.find((c) => matches(c.key) || matches(c.alsoKey));
  if (!hit) return null;
  const spec = matches(hit.key) ? hit.key : hit.alsoKey!;
  if (editing && !spec.inText) return null;
  // The focused control's own use of the key comes first (Space on a button, the arrows on a slider): the key is left to it.
  if (spec.yields && owns(code)) return null;
  return hit.id;
}

/** A held key that must not run its command again (a toggle: `noRepeat`): the key is still the command's, so it is swallowed, not run. */
export function heldToggle(e: KeyLike, commands: readonly CommandSpec[] = COMMANDS): boolean {
  if (e.repeat !== true) return false;
  const code = e.code.replace(/^Numpad(\d)$/, 'Digit$1');
  return commands.some((c) => [c.key, c.alsoKey].some((k) => k?.noRepeat === true && k.code === code && Boolean(k.shift) === e.shiftKey));
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
      // An open menu's or list's typeahead is a text entry too: only the keys marked `inText` (F6) go through it.
      const id = keyCommand(e, isEditing(e.target) || inOpenPopup(e.target), COMMANDS, (code) => focusOwnsKey(e.target, code));
      if (id === null) return;
      // Esc belongs to whatever modal surface is open (a sheet, the palette): a key that is only sometimes a command is not taken for them.
      if (!activeRef.current && e.code === 'Escape') return;
      noteKey(e);
      setInteractionModality('keyboard');
      // An item command (1–8) acts on the table's selection wherever the focus is (spec 4.2); the others take no target.
      // Holding a toggle's key is not a second press: the first one ran, the repeats are taken and do nothing.
      if (activeRef.current && heldToggle(e)) {
        if (!isCommandEnabled(id, envRef.current, menuTarget(id, envRef.current))) return;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (activeRef.current && !runCommand(id, envRef.current, menuTarget(id, envRef.current))) return; // unavailable now (another view's key): not ours to stop
      e.preventDefault();
      e.stopPropagation();
    };
    addEventListener('keydown', onKey, { capture: true });
    return () => removeEventListener('keydown', onKey, { capture: true });
  }, []);
}
