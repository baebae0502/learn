import { useEffect, useRef } from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { commandById } from '@learn/domain';
import { t } from '../../strings';
import { IconButton } from '../../ui/Button';
import { isComposingKey } from '../../ui/ime';
import { SearchField } from '../../ui/SearchField';
import { dispatchFind } from './findControl';
import { useFind } from './findStore';
import { useReader } from './readerStore';
import { useReaderScope } from '../readerScope';

/** How long a wrap past the last match is told before the count is the count again. */
const WRAP_NOTE_MS = 2000;

/**
 * The find bar (spec 4.5), over the stage's top right: the field with "3 / 17" at its end, previous, next, close. The search itself is the
 * pdf.js find controller's; this only asks (events on the viewer's bus) and shows what it answers (findStore).
 */
export function FindBar({ onClose }: { onClose(): void }) {
  const scope = useReaderScope();
  const query = useFind((s) => s.query);
  const status = useFind((s) => s.status);
  const matches = useFind((s) => s.matches);
  const reports = useFind((s) => s.reports);
  const focusSeq = useFind((s) => s.focusSeq);
  const bus = useReader((s) => s.handle?.eventBus() ?? null);
  const input = useRef<HTMLInputElement>(null);

  // The bar opens with the query it kept (closing it cleared the marks in the pages, not the query): the search runs again, so the
  // marks and the count agree. Once per opening.
  useEffect(() => {
    if (bus && scope.find.getState().query.trim() !== '') dispatchFind(bus, scope.find.getState().query, '');
  }, [bus, scope]);

  // ⌘F again, or ⌘E: the field takes the focus with its text selected.
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [focusSeq]);

  useEffect(() => {
    if (status !== 'wrapped') return;
    const timer = setTimeout(() => scope.find.getState().report('found', scope.find.getState().matches), WRAP_NOTE_MS);
    return () => clearTimeout(timer);
  }, [status, reports]);

  const change = (value: string) => {
    scope.find.getState().setQuery(value);
    if (bus) dispatchFind(bus, value, '');
    if (value.trim() === '') scope.find.getState().report('idle', null);
  };
  const again = (previous: boolean) => {
    if (bus && query.trim() !== '') dispatchFind(bus, query, 'again', previous);
  };

  const visible =
    status === 'notFound' ? t.reader.findNone : matches ? (status === 'wrapped' ? t.reader.findWrapped(matches.current, matches.total) : t.reader.findCount(matches.current, matches.total)) : '';
  const cannotMove = query.trim() === '' || status === 'notFound';
  const prev = commandById('reader.findPrevious');
  const next = commandById('reader.findNext');

  return (
    // esc closes the bar, and the field does not empty first: the query stays for ⌘G.
    <div
      className="find-bar"
      role="search"
      aria-label={t.reader.find}
      data-testid="pdf-find-bar"
      onKeyDownCapture={(e) => {
        if (e.key !== 'Escape' || isComposingKey(e.nativeEvent)) return;
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }}
    >
      <SearchField
        aria-label={t.reader.findField}
        value={query}
        onChange={change}
        inputRef={input}
        testId="pdf-find-field"
        className="find-field"
        clearable={false}
        trailing={
          <span className="find-count num" data-testid="pdf-find-count" data-status={status} aria-hidden="true">
            {visible}
          </span>
        }
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          again(e.shiftKey);
        }}
      />
      {/* What is read out: a miss and a wrap, not the count at every key. */}
      <span className="visually-hidden" aria-live="polite">
        {status === 'wrapped' ? t.reader.findWrappedSpoken : status === 'notFound' ? t.reader.findNone : ''}
      </span>
      <IconButton icon={ChevronUp} size="small" label={t.reader.findPrev} accelerator={prev.accelerator} testId="pdf-find-prev" isDisabled={cannotMove} onPress={() => again(true)} />
      <IconButton icon={ChevronDown} size="small" label={t.reader.findNext} accelerator={next.accelerator} testId="pdf-find-next" isDisabled={cannotMove} onPress={() => again(false)} />
      <IconButton icon={X} size="small" label={t.reader.findClose} accelerator="Escape" testId="pdf-find-close" onPress={onClose} />
    </div>
  );
}
