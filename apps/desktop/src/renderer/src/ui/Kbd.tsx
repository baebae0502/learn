import { acceleratorKeys } from '@learn/domain';
import { cx } from './cx';
import { currentPlatform } from './platform';

/**
 * Keycaps (design-spec 6 키캡). Decorative: the surrounding label names the shortcut for screen readers. The keys of a
 * chord touch (⌘ K, 2 px); `alternatives` are keys that each do it (↑ or ↓), drawn apart (6 px, palette.html).
 */
export function Kbd({ accelerator, keys, alternatives = false }: { accelerator?: string; keys?: readonly string[]; alternatives?: boolean }) {
  const list = keys ?? (accelerator ? acceleratorKeys(accelerator, currentPlatform()) : []);
  return (
    <span className={cx('kbd-group', alternatives && 'alternatives')} aria-hidden="true">
      {list.map((k, i) => (
        <kbd className="kbd" key={`${k}-${i}`}>
          {k}
        </kbd>
      ))}
    </span>
  );
}
