import { CircleX, Search } from 'lucide-react';
import { Input, SearchField as AriaSearchField } from 'react-aria-components';
import { t } from '../strings';
import type { ForcedState } from './Button';
import { IconButton } from './Button';
import { cx } from './cx';
import { Icon } from './Icon';

/**
 * Search field (design-spec 6 검색 필드): 28 (small 24, footnote), 14 px magnifier and placeholder in tertiary colour,
 * a clear button (circle-x) only while there is a value. RAC wires the clear button: it empties the field and puts
 * focus back in it, and is skipped by Tab (Escape clears from the keyboard).
 */
export function SearchField(props: {
  'aria-label': string;
  placeholder?: string;
  value?: string;
  defaultValue?: string;
  onChange?(value: string): void;
  onSubmit?(value: string): void;
  size?: 'regular' | 'small';
  className?: string;
  testId?: string;
  force?: ForcedState[];
}) {
  return (
    <AriaSearchField
      aria-label={props['aria-label']}
      value={props.value}
      defaultValue={props.defaultValue}
      onChange={props.onChange}
      onSubmit={props.onSubmit}
      className={cx('field', props.size === 'small' && 'small', props.className)}
      data-testid={props.testId}
      data-force={props.force?.join(' ')}
    >
      {({ isEmpty }) => (
        <>
          <Icon icon={Search} size="sm" />
          <Input className="field-input" placeholder={props.placeholder} />
          {!isEmpty && <IconButton icon={CircleX} label={t.common.clear} size="small" testId={props.testId && `${props.testId}-clear`} />}
        </>
      )}
    </AriaSearchField>
  );
}
