import { Radio, RadioGroup } from 'react-aria-components';
import type { ForcedState } from './Button';
import { cx } from './cx';

export interface SegmentOption<V extends string> {
  value: V;
  label: string;
  /** Shown on hover (the system tooltip), e.g. a size label's value in pt (settings.html 글자 크기). */
  title?: string;
  testId?: string;
}

/** Segmented control = radio group (design-spec 6 세그먼트). */
export function Segmented<V extends string>(props: {
  value: V;
  options: readonly SegmentOption<V>[];
  onChange(value: V): void;
  fill?: boolean;
  isDisabled?: boolean;
  force?: ForcedState[];
  'aria-label'?: string;
  'aria-labelledby'?: string;
}) {
  return (
    <RadioGroup
      aria-label={props['aria-label']}
      aria-labelledby={props['aria-labelledby']}
      value={props.value}
      onChange={(v) => props.onChange(v as V)}
      orientation="horizontal"
      isDisabled={props.isDisabled}
      className={cx('segmented', props.fill && 'fill')}
      data-force={props.force?.join(' ')}
    >
      {props.options.map((o) => {
        const segment = (
          <Radio key={o.value} value={o.value} className="seg" data-testid={o.testId}>
            {o.label}
          </Radio>
        );
        // RAC passes no `title` to the segment: a box-less wrapper carries the system tooltip (settings.html title="12pt").
        return o.title ? (
          <span key={o.value} className="seg-tip" title={o.title}>
            {segment}
          </span>
        ) : (
          segment
        );
      })}
    </RadioGroup>
  );
}
