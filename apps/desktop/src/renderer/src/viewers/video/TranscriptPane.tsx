import { useEffect, useMemo, useRef, useState } from 'react';
import { CaptionsOff, SearchX } from 'lucide-react';
import { useCommands } from '../../commands/CommandProvider';
import { usePaintMark } from '../../library/usePaintMark';
import { t } from '../../strings';
import { Button } from '../../ui/Button';
import { perfMarkLatest } from '../../ui/perfMarks';
import { PaneEmpty } from '../../ui/PaneEmpty';
import { SearchField } from '../../ui/SearchField';
import { Switch } from '../../ui/Switch';
import { useReaderScope } from '../readerScope';
import { indexCues } from './activeCues';
import { TranscriptList, type TranscriptListHandle } from './TranscriptList';
import { findInCues } from './transcriptSearch';
import { useCues, useTracks } from './useSubtitles';
import { patchTranscript, useVideo } from './videoStore';

/** How long the search waits after the last key (spec 7.4). */
const SEARCH_DEBOUNCE_MS = 150;
/** How long a wrap past the last match is told before the count is the count again (the find bar's). */
const WRAP_NOTE_MS = 2000;
/** The rows the opening state draws in place of the list. */
const PLACEHOLDER_ROWS = 7;

/**
 * The transcript pane of a video's sidebar (spec 7): the head, the search field, the sentences of the chosen track and the switch that keeps
 * the current one in view. Its end states are the opening one (a disabled box), no subtitles (with the button that attaches them) and, in
 * the list's place, a search that found nothing. The state it keeps (the query, the cursor, the switch) is the video's, in `scope.video`.
 */
export function TranscriptPane() {
  const scope = useReaderScope();
  const store = scope.video;
  const { run } = useCommands();
  const status = useVideo((s) => s.status);
  const trackId = useVideo((s) => s.trackId);
  const query = useVideo((s) => s.transcript.query);
  const hits = useVideo((s) => s.transcript.hits);
  const hit = useVideo((s) => s.transcript.hit);
  const wrapped = useVideo((s) => s.transcript.wrapped);
  const follow = useVideo((s) => s.transcript.follow);
  const focusSeq = useVideo((s) => s.transcriptFocus);
  const tracks = useTracks(scope.id);
  const cues = useCues(scope.id, trackId);
  const ix = useMemo(() => (cues ? indexCues(cues) : null), [cues]);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<TranscriptListHandle>(null);
  /** esc in the field asks for the list's focus; the list may not be drawn yet (a search with no result drew none), so it is taken once it is. */
  const wantList = useRef(false);
  useEffect(() => {
    if (!wantList.current || !list.current) return;
    wantList.current = false;
    list.current.focusCursor();
  });

  // The query the hits belong to (null: no search has run for this list yet), so a pending debounce shows the old count, not a wrong "none".
  const [settled, setSettled] = useState<string | null>(null);
  const searchedIx = useRef<typeof ix>(null);
  const mounted = useRef(false);
  /** The search that is waiting for its debounce: ↩ before it fires runs it at once, so it never steps through the old query's matches. */
  const pending = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!ix) return;
    const q = query.trim();
    const search = (keepHit: boolean) => {
      if (q !== '') perfMarkLatest('transcript:search');
      // A search that comes back to a tab keeps the match it was at; a new list or a new query starts again.
      patchTranscript(store, { hits: q === '' ? [] : findInCues(ix.cues, q), ...(keepHit ? {} : { hit: -1, wrapped: false }) });
      setSettled(q);
    };
    // No key to wait for after: the first search of a shown pane (it comes back to what was typed before), a new list, and a cleared query.
    const first = !mounted.current;
    if (first || searchedIx.current !== ix || q === '') {
      mounted.current = true;
      searchedIx.current = ix;
      search(first);
      return;
    }
    const id = setTimeout(() => {
      pending.current = null;
      search(false);
    }, SEARCH_DEBOUNCE_MS);
    pending.current = () => {
      clearTimeout(id);
      pending.current = null;
      search(false);
    };
    return () => {
      clearTimeout(id);
      pending.current = null;
    };
  }, [ix, query, store]);
  usePaintMark('transcript:painted', hits);

  const [wrapNote, setWrapNote] = useState(0);
  useEffect(() => {
    if (!wrapped) return;
    const id = setTimeout(() => patchTranscript(store, { wrapped: false }), WRAP_NOTE_MS);
    return () => clearTimeout(id);
  }, [wrapped, wrapNote, store]);

  // ⌘F: the field takes the focus with its text selected. The sidebar may still be folding open (inert): it is tried for a few frames.
  const seen = useRef(focusSeq);
  useEffect(() => {
    if (focusSeq === seen.current) return;
    seen.current = focusSeq;
    let tries = 0;
    let id = 0;
    const take = () => {
      const el = input.current;
      if (el && el.closest('[inert]') === null) {
        el.focus();
        el.select();
      } else if (tries++ < 20) id = requestAnimationFrame(take);
    };
    take();
    return () => cancelAnimationFrame(id);
  }, [focusSeq]);

  const ranges = useMemo(() => new Map(hits.map((h) => [h.index, h.ranges] as const)), [hits]);
  const q = query.trim();
  const noMatch = q !== '' && settled === q && hits.length === 0;
  const count = q === '' || settled !== q ? '' : wrapped && hit >= 0 ? t.reader.findWrapped(hit + 1, hits.length) : t.video.transcriptCount(hits.length);

  /** ↩ and ⇧↩ in the field: the next or previous sentence with the query, and the video goes to its start. */
  const step = (dir: 1 | -1) => {
    pending.current?.();
    const { hits: found, hit: at } = store.getState().transcript;
    if (!ix || found.length === 0) return;
    let next = dir > 0 ? (at < 0 ? 0 : at + 1) : at < 0 ? found.length - 1 : at - 1;
    let wrappedNow = false;
    if (next >= found.length) {
      next = 0;
      wrappedNow = true;
    } else if (next < 0) {
      next = found.length - 1;
      wrappedNow = true;
    }
    const target = found[next]!;
    patchTranscript(store, { hit: next, wrapped: wrappedNow, cursor: target.index });
    if (wrappedNow) setWrapNote((n) => n + 1);
    const cue = ix.cues[target.index];
    if (cue) store.getState().handle?.seekTo(cue.startMs);
  };

  const opening = status !== 'ready' || tracks === undefined || (tracks.length > 0 && !ix);
  const noSubtitles = !opening && tracks !== undefined && tracks.length === 0;

  const head = (
    <div className="reader-nav-head">
      <div className="nav-title">{t.video.transcript}</div>
    </div>
  );
  if (noSubtitles) {
    return (
      <>
        {head}
        <PaneEmpty icon={CaptionsOff} title={t.video.noSubtitlesTitle} top testId="transcript-empty" action={<Button testId="transcript-add" onPress={() => run('video.addSubtitles')}>{t.video.addSubtitles}</Button>}>
          {t.video.noSubtitlesText}
        </PaneEmpty>
      </>
    );
  }
  return (
    <>
      {head}
      <div className="nav-search">
        <SearchField
          aria-label={t.video.transcriptSearchLabel}
          placeholder={t.video.transcriptSearch}
          size="small"
          value={query}
          isDisabled={opening}
          inputRef={input}
          testId="transcript-search"
          onChange={(value) => patchTranscript(store, { query: value, hit: -1, wrapped: false })}
          trailing={
            count !== '' ? (
              <span className="find-count num" data-testid="transcript-count" data-wrapped={wrapped ? '' : undefined} aria-hidden="true">
                {count}
              </span>
            ) : undefined
          }
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              step(e.shiftKey ? -1 : 1);
            } else if (e.key === 'Escape') {
              // The query goes and the keys move to the list.
              e.preventDefault();
              patchTranscript(store, { query: '', hits: [], hit: -1, wrapped: false });
              wantList.current = true;
              list.current?.focusCursor();
            }
          }}
        />
        {/* What is read out: a miss and a wrap, not the count at every key. */}
        <span className="visually-hidden" aria-live="polite">
          {wrapped ? t.reader.findWrappedSpoken : noMatch ? t.video.noMatchTitle(q) : ''}
        </span>
      </div>
      {opening || !ix ? (
        <div className="transcript is-placeholder" aria-busy="true" data-testid="transcript-placeholder">
          {Array.from({ length: PLACEHOLDER_ROWS }, (_, i) => (
            <div key={i} className="cue ph">
              <span className="ts" />
              <span className="tx" />
            </div>
          ))}
        </div>
      ) : noMatch ? (
        <PaneEmpty icon={SearchX} title={t.video.noMatchTitle(q)} top testId="transcript-empty">
          {t.video.noMatchText}
        </PaneEmpty>
      ) : (
        <TranscriptList key={trackId} ix={ix} ranges={ranges} hitIndex={hit >= 0 ? (hits[hit]?.index ?? -1) : -1} handleRef={list} />
      )}
      <div className={opening ? 'transcript-foot is-disabled' : 'transcript-foot'}>
        <Switch isSelected={follow} isDisabled={opening} onChange={(on) => patchTranscript(store, { follow: on })} testId="transcript-follow">
          {t.video.follow}
        </Switch>
      </div>
    </>
  );
}
