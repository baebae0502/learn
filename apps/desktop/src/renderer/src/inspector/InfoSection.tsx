import { useLayoutEffect, useRef, useState } from 'react';
import type { ItemDetail, LibraryItem } from '@learn/domain';
import { t } from '../strings';
import { Button } from '../ui/Button';
import { cx } from '../ui/cx';
import { useNow } from '../useNow';
import { hasInfo, infoRows, type InfoRow } from './infoRows';
import { Section } from './Section';

/** 정보 (spec §5.3): the rows that have a value, then 추가일 · 수정일; with no info yet, what writing it gives. */
export function InfoSection({ item, detail }: { item: LibraryItem; detail: ItemDetail }) {
  const now = useNow();
  return (
    <Section id="info" title={t.inspector.sections.info} testId="info-section">
      {!hasInfo(detail.metadata) && (
        <p className="info-hint" data-testid="info-empty">
          {t.inspector.noInfo}
        </p>
      )}
      <dl className="kv">
        {infoRows(detail.metadata, item, now).map((row) => (
          <div key={row.field} className="kv-row" data-testid="info-row" data-field={row.field}>
            <dt>{row.label}</dt>
            <dd>
              <RowValue row={row} />
            </dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}

function RowValue({ row }: { row: InfoRow }) {
  // target=_blank: the window-open handler hands http(s) to shell.openExternal in main (security.ts); never a navigation here.
  if (row.kind === 'link')
    return (
      <a className="link" href={row.value} target="_blank" rel="noreferrer">
        {row.value}
      </a>
    );
  if (row.kind === 'long') return <LongText text={row.value} />;
  return (
    <span className={cx(row.kind === 'note' && 'note', row.kind === 'time' && 'num')} title={row.title}>
      {row.value}
    </span>
  );
}

/** The abstract: four lines, then 더 보기 / 접기 while it is longer than that (spec §5.3). */
function LongText({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setOverflows(el.scrollHeight > el.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure); // the panel's width changes the line count
    observer.observe(el);
    return () => observer.disconnect();
  }, [text, open]);
  return (
    <>
      <span ref={ref} className={cx('long', !open && 'clamp')}>
        {text}
      </span>
      {(overflows || open) && (
        <div className="more-row">
          <Button variant="plain-accent" size="small" testId="info-more" onPress={() => setOpen(!open)}>
            {open ? t.inspector.showLess : t.inspector.showMore}
          </Button>
        </div>
      )}
    </>
  );
}
