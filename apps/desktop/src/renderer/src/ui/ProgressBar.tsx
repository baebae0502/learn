import { cx } from './cx';

/**
 * design-spec 6 진행 막대 (mockup .progress, .t-progress): the --bg-track track and the --meter fill; only its width moves
 * (160 ms). `percent` is a whole number the caller floors, so the bar never reads 100 before the work has ended.
 */
export function ProgressBar({ percent, label, valueText, wide = false, testId }: { percent: number; label: string; valueText?: string; wide?: boolean; testId?: string }) {
  const value = Math.min(100, Math.max(0, Math.round(percent)));
  return (
    <span className={cx('progress', wide && 'wide')} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} aria-valuetext={valueText} data-testid={testId}>
      <i style={{ width: `${value}%` }} />
    </span>
  );
}
