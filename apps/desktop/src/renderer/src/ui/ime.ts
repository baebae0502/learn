/** What a key event offers about an IME composition: a DOM event has `isComposing`, a React one has it on its native event. */
export interface CompositionKey {
  keyCode: number;
  isComposing?: boolean;
  nativeEvent?: { isComposing: boolean };
}

/**
 * Whether a key belongs to a Korean composition and must not act: `isComposing`, or the keyCode 229 macOS IMEs send
 * without it (the ↩ that confirms a syllable). The one place that knows this; every key handler asks here.
 */
export function isComposingKey(e: CompositionKey): boolean {
  return (e.isComposing ?? e.nativeEvent?.isComposing ?? false) || e.keyCode === 229;
}
