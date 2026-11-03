import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { LibraryItem } from '@learn/domain';
import { isEditing } from '../../commands/keymap';
import { t } from '../../strings';
import { IconButton } from '../../ui/Button';
import { isComposingKey } from '../../ui/ime';
import { ratio, restorePageIndex } from '../positionSaver';
import { PdfErrorNotice } from '../ReaderNotices';
import { usePosition } from '../usePosition';
import { parsePage } from './parsePage';
import { PasswordPrompt } from './PasswordPrompt';
import { pageFieldRef } from './pageField';
import { PdfDocumentView } from './PdfDocumentView';
import { useReader } from './readerStore';
import { stageKeyAction } from './stageKeys';
import { usePdfDocument } from './usePdfDocument';
import { ViewMenu } from './ViewMenu';
import { ZoomField } from './ZoomField';

const PAGE_SAVE = { kind: 'debounce', ms: 300 } as const;

/** A screen's scroll by the space bar leaves a tenth of it in view, so the eye keeps its place. */
const SCREEN_STEP = 0.9;

/** The PDF reader: the 44 px toolbar (page field and page turns) over the stage that the pdf.js viewer fills. */
export function PdfReader({ item }: { item: LibraryItem }) {
  const open = usePdfDocument(item.assetId);
  const pos = usePosition(item, PAGE_SAVE);
  const pdf = useReader((s) => s.pdf);
  const handle = useReader((s) => s.handle);
  const [restored, setRestored] = useState(false);
  /** The document opened but the viewer could not show it. */
  const [viewFailed, setViewFailed] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const ready = pdf?.ready === true && handle !== null;

  // The saved page is applied once, as soon as the pages exist and the stored position is known; the stage stays
  // hidden until then, so the reader never shows page 1 first.
  useEffect(() => {
    if (!ready || !pos.loaded || restored || !pdf) return;
    const index = restorePageIndex(pos.saved?.locator, pdf.pagesCount);
    pos.markRestored({ kind: 'pdf', pageIndex: index });
    if (index > 0) {
      handle.goToPage(index + 1);
      useReader.getState().setPdf({ pageNumber: index + 1 });
    }
    setRestored(true);
  }, [ready, pos.loaded, pos.saved, pos.markRestored, restored, pdf, handle]);

  useEffect(() => {
    if (!restored || !pdf) return;
    pos.update({ kind: 'pdf', pageIndex: pdf.pageNumber - 1 }, ratio(pdf.pageNumber, pdf.pagesCount));
  }, [restored, pdf?.pageNumber, pdf?.pagesCount, pos.update]);

  // A final state (design-spec 6): no reader controls that cannot work, only the notice.
  if (open.status === 'failed' || viewFailed) return <PdfErrorNotice item={item} />;
  if (open.status === 'password') return <PasswordPrompt item={item} wrong={open.wrong} checking={open.checking} onSubmit={open.submit} />;

  const onStageKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!handle) return;
    const action = stageKeyAction(e.nativeEvent, isEditing(e.target as Element));
    if (!action) return;
    e.preventDefault();
    if (action === 'nextPage') handle.next();
    else if (action === 'previousPage') handle.previous();
    else {
      const scroll = stageRef.current?.querySelector<HTMLElement>('.pdf-scroll');
      scroll?.scrollBy({ top: (action === 'screenDown' ? 1 : -1) * scroll.clientHeight * SCREEN_STEP });
    }
  };

  const page = restored && pdf ? pdf.pageNumber : null;
  const total = pdf?.pagesCount ?? 0;
  return (
    <div className="reader">
      <div className="reader-toolbar" role="toolbar" aria-label={t.reader.pdfTools} data-testid="reader-toolbar">
        <PageField page={page} total={total} onGo={(n) => handle?.goToPage(n)} onEscape={() => stageRef.current?.focus()} />
        <span className="page-count num" data-testid="pdf-page-count">
          {total > 0 ? t.reader.pageOf(total) : ''}
        </span>
        {/* Pages run top to bottom: up/down chevrons, never the toolbar's back chevron. */}
        <IconButton
          icon={ChevronUp}
          label={t.reader.prevPage}
          testId="pdf-prev"
          isDisabled={page === null || page <= 1}
          disabledReason={page === null ? t.reader.opening : t.reader.firstPage}
          onPress={() => handle?.previous()}
        />
        <IconButton
          icon={ChevronDown}
          label={t.reader.nextPage}
          testId="pdf-next"
          isDisabled={page === null || page >= total}
          disabledReason={page === null ? t.reader.opening : t.reader.lastPage}
          onPress={() => handle?.next()}
        />
        <span className="spacer" />
        <ZoomField onEscape={() => stageRef.current?.focus()} />
        <span className="spacer" />
        <ViewMenu />
      </div>
      {/* A named, focusable scroll area (keyboard scrolling) is a region: aria-label on a plain div names nothing. */}
      <div ref={stageRef} className="pdf-stage" role="region" tabIndex={0} aria-label={t.reader.pdfStage} data-testid="pdf-stage" onKeyDown={onStageKey}>
        {open.status === 'ready' && <PdfDocumentView doc={open.doc} restored={restored} onFailed={() => setViewFailed(true)} />}
      </div>
    </div>
  );
}

/**
 * The current page as an editable number. ↩ goes there; a value that is not a page of the document comes back as it was,
 * and esc gives the focus back to the stage.
 */
function PageField({ page, total, onGo, onEscape }: { page: number | null; total: number; onGo(n: number): void; onEscape(): void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (page === null ? '' : String(page));
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (isComposingKey(e)) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      const n = parsePage(draft, total);
      if (n !== null) onGo(n);
      setDraft(null);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setDraft(null);
      onEscape();
    }
  };
  return (
    <input
      ref={pageFieldRef}
      className="page-field num"
      inputMode="numeric"
      autoComplete="off"
      spellCheck={false}
      aria-label={t.reader.pageField}
      placeholder="…"
      disabled={page === null}
      value={shown}
      data-testid="pdf-page-field"
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={() => setDraft(null)}
      onKeyDown={onKeyDown}
    />
  );
}
