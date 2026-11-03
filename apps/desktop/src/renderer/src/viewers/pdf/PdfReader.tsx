import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronDown, ChevronUp, Search } from 'lucide-react';
import type { LibraryItem } from '@learn/domain';
import { useCommands } from '../../commands/CommandProvider';
import { isEditing } from '../../commands/keymap';
import { commandById, commandLabel } from '@learn/domain';
import { t } from '../../strings';
import { currentPlatform } from '../../ui/platform';
import { IconButton } from '../../ui/Button';
import { isComposingKey } from '../../ui/ime';
import { ratio, restorePageIndex } from '../positionSaver';
import { PdfErrorNotice } from '../ReaderNotices';
import { usePosition, type LatestPosition } from '../usePosition';
import { parsePage } from './parsePage';
import { PasswordPrompt } from './PasswordPrompt';
import { pageFieldRef } from './pageField';
import { FindBar } from './FindBar';
import { useFind } from './findStore';
import { PdfDocumentView } from './PdfDocumentView';
import { useReader } from './readerStore';
import { stageKeyAction } from './stageKeys';
import { usePdfDocument } from './usePdfDocument';
import { ViewMenu } from './ViewMenu';
import { ZoomField } from './ZoomField';
import { clampZoom } from './zoom';

const PAGE_SAVE = { kind: 'debounce', ms: 300 } as const;

/** A screen's scroll by the space bar leaves a tenth of it in view, so the eye keeps its place. */
const SCREEN_STEP = 0.9;

/** The PDF reader: the 44 px toolbar (page field and page turns) over the stage that the pdf.js viewer fills. */
export function PdfReader({ item }: { item: LibraryItem }) {
  const open = usePdfDocument(item.assetId);
  /** The viewer's last reported place, kept for the unmount flush: by then the viewer may be gone. */
  const latestRef = useRef<LatestPosition | null>(null);
  const pos = usePosition(item, PAGE_SAVE, () => latestRef.current);
  const pdf = useReader((s) => s.pdf);
  const handle = useReader((s) => s.handle);
  const [restored, setRestored] = useState(false);
  /** The document opened but the viewer could not show it. */
  const [viewFailed, setViewFailed] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const ready = pdf?.ready === true && handle !== null;
  const findOpen = useFind((s) => s.open);
  const { run } = useCommands();
  const locked = open.status === 'password';
  const broken = open.status === 'failed' || viewFailed;
  const noPages = locked ? 'locked' : broken ? 'none' : null;
  // The sidebar has no pages to list while the password is asked for or the document cannot be shown.
  useEffect(() => {
    useReader.getState().setNoPages('reader', noPages);
    return () => useReader.getState().setNoPages('reader', null);
  }, [noPages]);
  const closeFind = () => {
    handle?.eventBus()?.dispatch('findbarclose', { source: null });
    useFind.getState().closeBar();
    stageRef.current?.focus();
  };

  // The saved page is applied once, as soon as the pages exist and the stored position is known; the stage stays
  // hidden until then, so the reader never shows page 1 first.
  const restoredRef = useRef(false);
  const place = useRef<LatestPosition | null>(null);
  useEffect(() => {
    const bus = handle?.eventBus();
    if (!ready || !bus) return;
    const onArea = (e: { location: { pageNumber: number; top: number; left: number; rotation: number } }) => {
      const { pageNumber, top, left, rotation } = e.location;
      const state = useReader.getState().pdf;
      if (!state) return;
      const zoom = state.zoom;
      const next: LatestPosition = {
        locator: { kind: 'pdf', pageIndex: pageNumber - 1, top, left, zoom: typeof zoom === 'number' ? clampZoom(zoom) : zoom, rotation: rotation as 0 | 90 | 180 | 270 },
        progress: ratio(pageNumber, state.pagesCount),
      };
      place.current = next;
      // Before the saved place is applied the viewer reports its own start (page 1): that is never saved.
      if (!restoredRef.current) return;
      latestRef.current = next;
      pos.update(next.locator, next.progress);
    };
    bus.on('updateviewarea', onArea);
    return () => bus.off('updateviewarea', onArea);
  }, [ready, handle, pos.update]);

  // The restore waits for both the pages and the stored position, and is applied once; saves start from the place it reached.
  useEffect(() => {
    if (!ready || !pos.loaded || restored || !pdf || !handle) return;
    const saved = pos.saved?.locator.kind === 'pdf' ? pos.saved.locator : undefined;
    const index = restorePageIndex(pos.saved?.locator, pdf.pagesCount);
    place.current = null;
    // restore() ends in viewer.update(), which dispatches updateviewarea at once (pdf.js 6.4.299), so `place` is the real place here.
    // Were it not (no visible page), the saver would start from a page-only locator and the first report would write one full row.
    handle.restore(saved, index);
    const start = place.current as LatestPosition | null;
    pos.markRestored(start?.locator ?? { kind: 'pdf', pageIndex: index });
    restoredRef.current = true;
    setRestored(true);
  }, [ready, pos.loaded, pos.saved, pos.markRestored, restored, pdf, handle]);

  // A final state (design-spec 6): no reader controls that cannot work, only the notice.
  if (open.status === 'failed' || viewFailed) return <PdfErrorNotice item={item} />;
  if (open.status === 'password') return <PasswordPrompt item={item} wrong={open.wrong} checking={open.checking} onSubmit={open.submit} />;

  const onStageKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' && findOpen && !isComposingKey(e.nativeEvent)) {
      e.preventDefault();
      closeFind();
      return;
    }
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
        <IconButton
          icon={Search}
          label={commandLabel(commandById('library.find'), currentPlatform(), { view: 'viewer' })}
          accelerator={commandById('library.find').accelerator}
          isOn={findOpen}
          testId="pdf-find"
          isDisabled={!ready}
          disabledReason={t.reader.opening}
          onPress={() => (findOpen ? closeFind() : run('library.find'))}
        />
        <ViewMenu />
      </div>
      {/* A named, focusable scroll area (keyboard scrolling) is a region: aria-label on a plain div names nothing. */}
      <div ref={stageRef} className="pdf-stage" role="region" tabIndex={0} aria-label={t.reader.pdfStage} data-testid="pdf-stage" onKeyDown={onStageKey}>
        {findOpen && ready && <FindBar onClose={closeFind} />}
        {open.status === 'ready' && <PdfDocumentView doc={open.doc} revisionId={item.revisionId} restored={restored} onFailed={() => setViewFailed(true)} />}
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
