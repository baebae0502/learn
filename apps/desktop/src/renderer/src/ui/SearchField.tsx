import type { Ref } from 'react';
import { CircleX, Search } from 'lucide-react';
import { Input, SearchField as AriaSearchField, type KeyboardEvent } from 'react-aria-components';
import { t } from '../strings';
import type { ForcedState } from './Button';
import { IconButton } from './Button';
import { cx } from './cx';
import { Icon } from './Icon';
import { isComposingKey } from './ime';

/**
 * Search field (design-spec 6 검색 필드): 28 (small 24, footnote), 14 px magnifier and placeholder in tertiary colour,
 * a clear button (circle-x) only while there is a value. RAC wires the clear button: it empties the field and puts
 * focus back in it, and is skipped by Tab (Escape clears from the keyboard). Keys a Korean composition owns never act
 * (design-spec 7.4): RAC's own esc (clear) and ↩ (submit) stop before they run, and `onKeyDown` never sees them.
 */
export function SearchField(props: {
  'aria-label': string;
  'aria-keyshortcuts'?: string;
  placeholder?: string;
  value?: string;
  defaultValue?: string;
  onChange?(value: string): void;
  onSubmit?(value: string): void;
  /** Esc or the clear button emptied the field. */
  onClear?(): void;
  /** Keys after the field's own (RAC has emptied it on esc by then), never those of a composition. */
  onKeyDown?(e: KeyboardEvent): void;
  onFocus?(): void;
  autoFocus?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  size?: 'regular' | 'small';
  className?: string;
  testId?: string;
  force?: ForcedState[];
  /**
   * Drawn disabled (aria-disabled, content at 45 %) while something holds the window; the field keeps its focus and
   * text but takes no input, as the launcher does (a real `disabled` would drop a focus the field has).
   */
  isDisabled?: boolean;
}) {
  return (
    <AriaSearchField
      aria-label={props['aria-label']}
      value={props.value}
      defaultValue={props.defaultValue}
      onChange={props.onChange}
      onSubmit={props.onSubmit}
      onClear={props.onClear}
      onKeyDown={(e) => {
        if (!isComposingKey(e)) props.onKeyDown?.(e);
      }}
      onFocus={props.onFocus && (() => props.onFocus!())}
      autoFocus={props.autoFocus}
      isReadOnly={props.isDisabled}
      className={cx('field', props.size === 'small' && 'small', props.isDisabled && 'is-disabled', props.className)}
      data-testid={props.testId}
      data-force={props.force?.join(' ')}
    >
      {({ isEmpty }) => (
        <>
          <Icon icon={Search} size="sm" />
          <Input
            ref={props.inputRef}
            className="field-input"
            placeholder={props.placeholder}
            aria-keyshortcuts={props['aria-keyshortcuts']}
            aria-disabled={props.isDisabled || undefined}
            // RAC clears on esc and submits on ↩ without asking whether a composition owns the key.
            // Chromium's own type=search also empties on esc, as the key's default: held back too.
            onKeyDownCapture={(e) => {
              if (!isComposingKey(e) || (e.key !== 'Escape' && e.key !== 'Enter')) return;
              e.stopPropagation();
              e.preventDefault();
            }}
          />
          {!isEmpty && <IconButton icon={CircleX} label={t.common.clear} size="small" isDisabled={props.isDisabled} testId={props.testId && `${props.testId}-clear`} />}
        </>
      )}
    </AriaSearchField>
  );
}
