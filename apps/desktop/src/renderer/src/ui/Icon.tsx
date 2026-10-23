import type { LucideIcon } from 'lucide-react';
import { cx } from './cx';

export type IconSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
// design-spec 5: 16 / stroke 1.5 (1 px at 16), field icons 14, disclosure 12 at stroke 2, media 20, empty states 32 at 1.25.
const PX: Record<IconSize, number> = { xs: 12, sm: 14, md: 16, lg: 20, xl: 32 };
const STROKE: Record<IconSize, number> = { xs: 2, sm: 1.5, md: 1.5, lg: 1.5, xl: 1.25 };

export function Icon({ icon: Glyph, size = 'md', className, label }: { icon: LucideIcon; size?: IconSize; className?: string; label?: string }) {
  return (
    <Glyph
      size={PX[size]}
      strokeWidth={STROKE[size]}
      className={cx('icon', className)}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
      focusable="false"
    />
  );
}
