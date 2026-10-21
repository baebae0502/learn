import { acceleratorKeys } from '@learn/domain';
import { currentPlatform } from './platform';

/** Keycaps (design-spec 6 키캡). Decorative: the surrounding label names the shortcut for screen readers. */
export function Kbd({ accelerator, keys }: { accelerator?: string; keys?: readonly string[] }) {
  const list = keys ?? (accelerator ? acceleratorKeys(accelerator, currentPlatform()) : []);
  return (
    <span className="kbd-group" aria-hidden="true">
      {list.map((k, i) => (
        <kbd className="kbd" key={`${k}-${i}`}>
          {k}
        </kbd>
      ))}
    </span>
  );
}
