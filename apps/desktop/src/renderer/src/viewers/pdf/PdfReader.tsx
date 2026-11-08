import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { ArrowLeft, ArrowRight, ChevronDown, ChevronUp, Search } from 'lucide-react';
import type { LibraryItem } from '@learn/domain';
import { useCommands } from '../../commands/CommandProvider';
import { usePrefs } from '../../data/queries';
import { isEditing } from '../../commands/keymap';
import { commandById, commandLabel } from '@learn/domain';
import { InspectorToggle } from '../../inspector/InspectorToggle';
import { t } from '../../strings';
import { SelectionPopup, usePopupShown } from '../../translation/SelectionPopup';
import { TranslationStatus } from '../../translation/TranslationStatus';
import { dismissPopup, useSelectionText } from '../../translation/useSelectionText';
import { currentPlatform } from '../../ui/platform';
import { IconButton } from '../../ui/Button';
import { isComposingKey } from '../../ui/ime';
import { ratio, restorePageIndex } from '../positionSaver';
import { PdfErrorNotice } from '../ReaderNotices';
import { usePosition, type LatestPosition } from '../usePosition';
import { parsePage } from './parsePage';
import { PasswordPrompt } from './PasswordPrompt';
import { FindBar } from './FindBar';
import { useFind } from './findStore';
import { furthestPageSeen, type PageSpan } from './furthestPage';
import { PdfDocumentView } from './PdfDocumentView';
import { useReader } from './readerStore';
import { canGoBack, canGoForward } from './history';
import { useReaderScope, useReaderShown } from '../readerScope';
import { pageStepAction, SCREEN_STEP, stageKeyAction } from './stageKeys';
import { spreadStep } from './spread';
import { usePdfDocument } from './usePdfDocument';
import { SepiaFilter } from './SepiaFilter';
import { ViewMenu } from './ViewMenu';
import { ZoomField } from './ZoomField';
import { clampZoom } from './zoom';

const PAGE_SAVE = { kind: 'debounce', ms: 300 } as const;

/** The PDF reader: the 44 px toolbar (page field and page turns) over the stage that the pdf.js viewer fills. */
export function PdfReader({ item }: { item: LibraryItem }) {
  const scope = useReaderScope();
  const shown = useReaderShown();
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
  /** The view's scroller, as the view reports it: the scroll bar watch follows a view that mounts again. */
  const [scroll, setScroll] = useState<HTMLElement | null>(null);
  const ready = pdf?.ready === true && handle !== null;
  const findOpen = useFind((s) => s.open);
  const history = useReader((s) => s.history);
  const { run } = useCommands();
  const locked = open.status === 'password';
  const broken = open.status === 'failed' || viewFailed;
  const noPages = locked ? 'locked' : broken ? 'none' : null;
  // The sidebar has no pages to list while the password is asked for or the document cannot be shown.
  useEffect(() => {
    scope.reader.getState().setNoPages('reader', noPages);
    return () => scope.reader.getState().setNoPages('reader', null);
  }, [noPages]);
  // The selection pop-up: the text selected in the pages (translation/); leaving the reader cancels what is in flight. A hidden tab
  // closes its pop-up and leaves the selection alone (the translation section keeps its text): clearing the selection here asks
  // nothing of main, whose cancel is for the whole window.
  useSelectionText(stageRef, ready && shown);
  const popupShown = usePopupShown();
  useEffect(() => () => scope.translation.getState().reset(), []);
  // The choice changed elsewhere while this reader is open (the settings window): off ends what runs, on goes on from the consent.
  const translationEnabled = usePrefs().data?.translation.enabled;
  const knownEnabled = useRef(translationEnabled);
  useEffect(() => {
    if (translationEnabled === undefined || translationEnabled === knownEnabled.current) return;
    knownEnabled.current = translationEnabled;
    scope.translation.getState().prefsChanged(translationEnabled);
  }, [translationEnabled]);
  // The item panel comes with the pages (ready) and takes width from the stage: the saved place is applied once the stage
  // has stopped changing size, or the resize that follows would read as a move and be saved as one.
  const [stageSettled, setStageSettled] = useState(false);
  useEffect(() => {
    const stage = stageRef.current;
    if (!ready || !stage || !shown) {
      setStageSettled(false);
      return;
    }
    let last = -1;
    let still = 0;
    let frame = 0;
    const tick = () => {
      const width = stage.clientWidth;
      still = width === last ? still + 1 : 0;
      last = width;
      if (still >= 2) setStageSettled(true);
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [ready, shown]);
  // A classic scroll bar (a Mac with a mouse, Windows, Linux) takes room from the scroller's right edge: what floats over the stage
  // keeps its 16 from the visible edge, so the find bar is offset by that width (an overlay bar is 0). Read again whenever the scroller resizes.
  useEffect(() => {
    const stage = stageRef.current;
    if (!ready || !stage || !scroll || !shown) return;
    const measure = () => stage.style.setProperty('--stage-scrollbar', `${scroll.offsetWidth - scroll.clientWidth}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroll);
    return () => {
      observer.disconnect();
      stage.style.removeProperty('--stage-scrollbar');
    };
  }, [ready, shown, scroll]);
  const closeFind = () => {
    handle?.eventBus()?.dispatch('findbarclose', { source: null });
    scope.find.getState().closeBar();
    stageRef.current?.focus();
  };

  // The saved page is applied once, as soon as the pages exist and the stored position is known; the stage stays
  // hidden until then, so the reader never shows page 1 first.
  const restoredRef = useRef(false);
  const place = useRef<LatestPosition | null>(null);
  useEffect(() => {
    const bus = handle?.eventBus();
    if (!ready || !bus || !handle) return;
    const onArea = (e: { location: { pageNumber: number; top: number; left: number; rotation: number } }) => {
      const { pageNumber, top, left, rotation } = e.location;
      const state = scope.reader.getState().pdf;
      if (!state) return;
      const zoom = state.zoom;
      // The location is the page at the top of the stage; the progress counts the furthest page in view (spec 5).
      const viewer = handle.viewer();
      const container = viewer?.container;
      const visible: PageSpan[] = [];
      // The same rule along the flow: a sideways flow counts the pages by their extent across and the scroll by its width.
      const sideways = state.scroll === 'horizontal';
      if (viewer && container) {
        for (const v of (viewer._getVisiblePages() as { views: Array<{ id: number; view: { div: HTMLElement } }> }).views) {
          const div = v.view.div;
          const start = sideways ? div.offsetLeft + div.clientLeft : div.offsetTop + div.clientTop;
          visible.push({ number: v.id, top: start, bottom: start + (sideways ? div.clientWidth : div.clientHeight) });
        }
      }
      const alongFlow = container && sideways ? { scrollTop: container.scrollLeft, clientHeight: container.clientWidth, scrollHeight: container.scrollWidth } : container;
      const furthest = alongFlow ? furthestPageSeen(pageNumber, state.pagesCount, alongFlow, visible, state.scroll === 'page' ? 'page' : 'scroll') : pageNumber;
      const next: LatestPosition = {
        locator: { kind: 'pdf', pageIndex: pageNumber - 1, top, left, zoom: typeof zoom === 'number' ? clampZoom(zoom) : zoom, rotation: rotation as 0 | 90 | 180 | 270,
          // The default modes are left out, so a document that was never switched keeps the locator it always had.
          ...(state.scroll !== 'vertical' ? { scroll: state.scroll } : {}),
          ...(state.spread !== 'none' ? { spread: state.spread } : {}),
          pages: state.pagesCount,
        },
        progress: ratio(furthest, state.pagesCount),
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
    if (!ready || !pdf?.sized || !stageSettled || !pos.loaded || restored || !handle) return;
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
  }, [ready, stageSettled, pos.loaded, pos.saved, pos.markRestored, restored, pdf, handle]);

  // A final state (design-spec 6): no reader controls that cannot work, only the notice.
  if (open.status === 'failed' || viewFailed) return <PdfErrorNotice item={item} />;
  if (open.status === 'password') return <PasswordPrompt item={item} wrong={open.wrong} checking={open.checking} onSubmit={open.submit} />;

  const onStageKey = (e: KeyboardEvent<HTMLDivElement>) => {
    // esc closes the pop-up first; the find bar keeps its own esc for the next press.
    if (e.key === 'Escape' && popupShown && !isComposingKey(e.nativeEvent)) {
      e.preventDefault();
      dismissPopup(scope);
      return;
    }
    if (e.key === 'Escape' && findOpen && !isComposingKey(e.nativeEvent)) {
      e.preventDefault();
      closeFind();
      return;
    }
    if (!handle) return;
    const action = stageKeyAction(e.nativeEvent, isEditing(e.target as Element), pdf?.scroll);
    if (!action) return;
    e.preventDefault();
    if (action === 'nextPage') return handle.next();
    if (action === 'previousPage') return handle.previous();
    const scroll = stageRef.current?.querySelector<HTMLElement>('.pdf-scroll');
    if (!scroll) return;
    if (action === 'screenRight' || action === 'screenLeft') scroll.scrollBy({ left: (action === 'screenRight' ? 1 : -1) * scroll.clientWidth * SCREEN_STEP });
    else if (action === 'pageForward' || action === 'pageBack') {
      const step = pageStepAction(action, scroll);
      if (step.kind === 'scroll') scroll.scrollBy({ top: step.top });
      else if (step.direction === 'next') handle.next();
      else handle.previous();
    } else scroll.scrollBy({ top: (action === 'screenDown' ? 1 : -1) * scroll.clientHeight * SCREEN_STEP });
  };

  // The side buttons of a mouse: 3 is back, 4 forward. The browser's own history would take the window back, so the press is
  // stopped as well; the release does the move.
  const onStageMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    if (e.button === 3 || e.button === 4) e.preventDefault();
  };
  const onStageMouseUp = (e: MouseEvent<HTMLDivElement>) => {
    if (e.button !== 3 && e.button !== 4) return;
    e.preventDefault();
    if (e.button === 3) handle?.historyBack();
    else handle?.historyForward();
  };

  const page = restored && pdf ? pdf.pageNumber : null;
  const total = pdf?.pagesCount ?? 0;
  // A spread turns two pages: its last one has nothing to go on to even when the page shown is not the document's last.
  const spread = pdf?.spread ?? 'none';
  const hasNext = page !== null && spreadStep(page, total, spread, 'next') !== null;
  const hasPrevious = page !== null && spreadStep(page, total, spread, 'previous') !== null;
  return (
    <div className="reader">
      <SepiaFilter />
      <TranslationStatus />
      <div className="reader-toolbar" role="toolbar" aria-label={t.reader.pdfTools} data-testid="reader-toolbar">
        {/* Back and forward join the page group at its start: the places a link, the outline, a thumbnail or the page field left. */}
        <div className="history-nav">
          <IconButton
            icon={ArrowLeft}
            label={commandLabel(commandById('nav.historyBack'), currentPlatform())}
            accelerator={commandById('nav.historyBack').accelerator}
            testId="pdf-history-back"
            isDisabled={!restored || !canGoBack(history)}
            disabledReason={restored ? t.reader.noHistoryBack : t.reader.opening}
            onPress={() => handle?.historyBack()}
          />
          <IconButton
            icon={ArrowRight}
            label={commandLabel(commandById('nav.historyForward'), currentPlatform())}
            accelerator={commandById('nav.historyForward').accelerator}
            testId="pdf-history-forward"
            isDisabled={!restored || !canGoForward(history)}
            disabledReason={restored ? t.reader.noHistoryForward : t.reader.opening}
            onPress={() => handle?.historyForward()}
          />
        </div>
        <PageField page={page} total={total} onGo={(n) => handle?.jumpToPage(n)} onEscape={() => stageRef.current?.focus()} />
        {/* "/ N" has the room of "/ 000" at least, so a document of another page count does not move what follows it. */}
        <span className="page-count-slot">
          <span className="page-count num" data-testid="pdf-page-count">
            {total > 0 ? t.reader.pageOf(total) : ''}
          </span>
        </span>
        {/* Pages run top to bottom: up/down chevrons, never the toolbar's back chevron. */}
        <IconButton
          icon={ChevronUp}
          label={t.reader.prevPage}
          testId="pdf-prev"
          isDisabled={!hasPrevious}
          disabledReason={page === null ? t.reader.opening : t.reader.firstPage}
          onPress={() => handle?.previous()}
        />
        <IconButton
          icon={ChevronDown}
          label={t.reader.nextPage}
          testId="pdf-next"
          isDisabled={!hasNext}
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
        <span className="toolbar-sep" role="separator" aria-orientation="vertical" />
        <InspectorToggle pending={!ready} />
      </div>
      {/* A named, focusable scroll area (keyboard scrolling) is a region: aria-label on a plain div names nothing. */}
      <div ref={stageRef} className="pdf-stage" role="region" tabIndex={0} aria-label={t.reader.pdfStage} data-testid="pdf-stage" onKeyDown={onStageKey} onMouseDown={onStageMouseDown} onMouseUp={onStageMouseUp}>
        {findOpen && ready && <FindBar onClose={closeFind} />}
        {ready && <SelectionPopup stageRef={stageRef} />}
        {open.status === 'ready' && <PdfDocumentView doc={open.doc} revisionId={item.revisionId} restored={restored} onFailed={() => setViewFailed(true)} onScroller={setScroll} />}
      </div>
    </div>
  );
}

/**
 * The current page as an editable number. ↩ goes there; a value that is not a page of the document comes back as it was,
 * and esc gives the focus back to the stage.
 */
function PageField({ page, total, onGo, onEscape }: { page: number | null; total: number; onGo(n: number): void; onEscape(): void }) {
  const scope = useReaderScope();
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
      ref={scope.pageField}
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
