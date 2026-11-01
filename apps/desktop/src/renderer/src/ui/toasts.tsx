import { useContext, useEffect, useLayoutEffect, type KeyboardEvent, type ReactNode } from 'react';
import { CircleAlert, CircleCheck, CirclePause, Info, X } from 'lucide-react';
import {
  Text,
  UNSTABLE_Toast as Toast,
  UNSTABLE_ToastContent as ToastContent,
  UNSTABLE_ToastQueue as ToastQueue,
  UNSTABLE_ToastStateContext as ToastStateContext,
  UNSTABLE_ToastRegion as ToastRegion,
  type QueuedToast,
} from 'react-aria-components';
import { cancelJob, describeJob, jobAhead, liveState, useJobProgress, type JobToastText } from '../jobs/jobProgress';
import type { ProgressJob } from '../jobs/progressToast';
import { t } from '../strings';
import { Button, IconButton } from './Button';
import { cx } from './cx';
import { Icon } from './Icon';
import { MiddleEllipsis } from './MiddleEllipsis';
import { ProgressBar } from './ProgressBar';
import { Spinner } from './Spinner';
import { afterPaintOr, type Pending } from './afterPaint';
import { perfMark } from './perfMarks';
import { focusPaneNamed } from '../shell/panes';
import { toastFocusReturn } from './toastFocus';
import { DismissTimer } from './toastTimer';

export type ToastKind = 'success' | 'error' | 'info' | 'busy';
/** A toast's one verb (design-spec 6 toast action, a small button): pressing it runs it, and the toast goes — its job is done. */
export interface ToastAction {
  label: string;
  onAction(): void;
  testId?: string;
}
/** A toast row about one file: the name is cut with an ellipsis before the cause is (the cause is what to read). */
export interface ToastFileLine {
  name: string;
  cause: string;
}

export interface ToastData {
  kind: ToastKind;
  title: string;
  /** One line each, never wrapped (file rows, "외 N개"): the toast keeps its height whatever the names are. */
  lines?: readonly (ToastFileLine | string)[];
  /** A paragraph under the lines (the next step); wraps. */
  body?: string;
  /** At most one, on the title line (a success toast after 사본 내보내기: the button that reveals the copy). */
  action?: ToastAction;
  testId?: string;
}

/**
 * A job's toast in the queue: its content is which job, not words. It draws the job's live state (jobs/jobProgress.ts),
 * then the view its controller gives it (jobs/progressToast.ts): the run's last state, then the result that took it over.
 */
export interface JobToastContent {
  kind: 'job';
  job: ProgressJob;
}
export type ToastContent = ToastData | JobToastContent;

/** Description of a toast (shared with the state board): the lines, then the paragraph. */
export function ToastLines({ data }: { data: Pick<ToastData, 'lines' | 'body'> }) {
  return (
    <>
      {data.lines?.map((line, i) =>
        typeof line === 'string' ? (
          <span key={i} className="t-line">
            {line}
          </span>
        ) : (
          <span key={i} className="t-line" title={`${line.name}: ${line.cause}`}>
            <span className="t-name ellipsis">{line.name}</span>
            <span className="t-cause">: {line.cause}</span>
          </span>
        ),
      )}
      {data.body && <span className="t-hint ui-prose">{data.body}</span>}
    </>
  );
}

/** design-spec 6 토스트: a success or info toast closes by itself 5 s after it appears. */
export const TOAST_MS = 5000;

/**
 * RAC's queue, with the 5 s counted by our own timers (toastTimer.ts): RAC's lost a toast for good when the pointer
 * reached the toasts just as its time ran out (Mac run 2). The region still says when to hold them, through
 * pauseAll / resumeAll (the pointer on the toasts, or the focus in them: useToastRegion); here that is a flag the
 * visible toasts' timers follow.
 */
export class LearnToastQueue<T = ToastData> extends ToastQueue<T> {
  private heldNow = false;
  private readonly holdListeners = new Set<() => void>();
  constructor(options?: ConstructorParameters<typeof ToastQueue<T>>[0]) {
    super(options);
    // A safety net (final review m1): with no toast on screen nothing can be hovered or focused, so the hold ends. RAC
    // notices a removed hovered or focused region only on a later pointer or focus event, which may never come (the
    // focus falls to <body>); a hold left behind would keep the next toast from counting down.
    this.subscribe(() => {
      if (this.visibleToasts.length === 0) this.setHeld(false);
    });
  }
  override pauseAll(): void {
    this.setHeld(true);
  }
  override resumeAll(): void {
    this.setHeld(false);
  }
  get held(): boolean {
    return this.heldNow;
  }
  onHold(listener: () => void): () => void {
    this.holdListeners.add(listener);
    return () => this.holdListeners.delete(listener);
  }
  private setHeld(held: boolean): void {
    if (held === this.heldNow) return;
    this.heldNow = held;
    for (const l of [...this.holdListeners]) l();
  }
}

/**
 * One queue per window. design-spec 6 토스트: success (and info) closes by itself after 5 s and has no close
 * button; an error stays until its × (or Escape while it has focus) closes it; a busy toast stays until the work it
 * stands for ends (closeToast). Action buttons are verbs (보기·다시 시도). RAC's toast API is UNSTABLE_-prefixed in 1.22.1; it is pinned and used only through
 * this module.
 */
export const toastQueue = new LearnToastQueue<ToastContent>({ maxVisibleToasts: 3 });

/** No RAC timeout: a toast that closes by itself does so through AutoClose, while it is on screen. */
export function showToast(data: ToastData): string {
  return toastQueue.add(data);
}

/** The error toast of an action that was refused: the cause main gave, when there is one. */
export function showActionFailed(e: unknown): void {
  showToast({ kind: 'error', title: t.toast.actionFailed, body: e instanceof Error ? e.message : undefined, testId: 'action-error' });
}

/** Closes a toast by the key showToast returned: the only way a busy toast goes. */
export function closeToast(key: string): void {
  toastQueue.close(key);
}

/** A job's toast: in the same region, Tab and F6 order as every toast; its view is forgotten when it closes. */
export function showJobToast(job: ProgressJob): string {
  let key = '';
  key = toastQueue.add({ kind: 'job', job }, { onClose: () => useJobProgress.getState().setView(key, undefined) });
  return key;
}

/**
 * A result toast that can be taken back (spec 3.4, 8.2): one verb, 실행 취소, which runs `undo` and closes the toast. A
 * refused undo is an error toast with the cause main gave (cause + next step), so the user is never left thinking it worked.
 */
export function showUndoToast(title: string, undo: () => Promise<void>, opts: { testId?: string } = {}): string {
  return showToast({
    kind: 'success',
    title,
    testId: opts.testId ?? 'undo-toast',
    action: {
      label: t.toast.undo,
      testId: 'undo-action',
      onAction: () =>
        void undo().catch((e: unknown) => showToast({ kind: 'error', title: t.toast.undoFailed, body: e instanceof Error ? e.message : undefined, testId: 'undo-failed' })),
    },
  });
}

/**
 * An action refused part-way (m-6): an error toast that names what was done, gives main's cause, and offers 실행 취소 for
 * that part. It stays until closed, as errors do; a refused undo is told like showUndoToast's.
 */
export function showUndoableError(e: unknown, title: string, undo: () => Promise<void>): string {
  return showToast({
    kind: 'error',
    title,
    body: e instanceof Error ? e.message : undefined,
    testId: 'partial-failure',
    action: {
      label: t.toast.undo,
      testId: 'undo-action',
      onAction: () =>
        void undo().catch((err: unknown) => showToast({ kind: 'error', title: t.toast.undoFailed, body: err instanceof Error ? err.message : undefined, testId: 'undo-failed' })),
    },
  });
}

/** Where no frames come (a hidden or minimised window), a toast counts from this long after it mounted. */
const UNPAINTED_START_MS = 1000;

/**
 * The 5 s of a visible success or info toast: from its first painted frame (Mac run 3, critique n6: counted from the
 * mount, a toast whose first frame came late after a drop was on screen 4.63 s and its rise-in never seen), held while
 * the toasts are held, closed when the time is up, also when the hold came just as it ran out. `shown` runs at that
 * first painted frame. Returns the cleanup.
 */
export function startAutoClose(
  queue: LearnToastQueue<unknown>,
  toastKey: string,
  opts: { painted?: (fn: () => void) => Pending; shown?: () => void } = {},
): () => void {
  let timer: DismissTimer | null = null;
  let off = () => {};
  const cancelPaint = (opts.painted ?? ((fn) => afterPaintOr(UNPAINTED_START_MS, fn)))(() => {
    opts.shown?.();
    const t = new DismissTimer(TOAST_MS, () => queue.close(toastKey));
    timer = t;
    const follow = () => (queue.held ? t.hold() : t.run());
    follow();
    off = queue.onHold(follow);
  });
  return () => {
    cancelPaint();
    off();
    timer?.stop();
  };
}

/** A toast pushed out of the three visible ones starts again when it is back, as RAC's did. */
function AutoClose({ toastKey, kind, testId }: { toastKey: string; kind: ToastKind; testId: string | undefined }) {
  useEffect(() => {
    if (kind === 'error' || kind === 'busy') return; // an error waits for its ×, a busy toast for its work
    return startAutoClose(toastQueue as LearnToastQueue<unknown>, toastKey, { shown: testId ? () => perfMark(`toast:${testId}`) : undefined });
  }, [toastKey, kind, testId]);
  return null;
}

const TOAST_ICON = { success: CircleCheck, error: CircleAlert, info: Info } as const;
const TOAST_TONE = { success: 'c-success', error: 'c-danger', info: 'c-secondary' } as const;

/** 16 px icon in the 20 px icon column, centred on the title line (design-spec 6 toast); a busy toast spins there. Shared with the board. */
export function ToastIcon({ kind }: { kind: ToastKind }) {
  if (kind === 'busy') {
    return (
      <span className="t-icon">
        <Spinner />
      </span>
    );
  }
  return (
    <span className={`t-icon ${TOAST_TONE[kind]}`}>
      <Icon icon={TOAST_ICON[kind]} size="md" />
    </span>
  );
}

/** The action on the title line, a small link button; `onDone` closes the toast first. Shared with the board. */
export function ToastActionButton({ action, onDone }: { action: ToastAction; onDone?: () => void }) {
  return (
    <span className="t-actions">
      <Button
        variant="plain-accent"
        size="small"
        testId={action.testId}
        onPress={() => {
          onDone?.();
          action.onAction();
        }}
      >
        {action.label}
      </Button>
    </span>
  );
}

/**
 * RAC toasts take no Escape and pass no onKeyDown through, but React key events bubble through the region's portal
 * to this wrapper. Only a closable (error) toast closes: success and info toasts only ever close by themselves (C-6).
 */
function closeOnEscape(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return;
  const toast = (e.target as Element).closest<HTMLElement>('[data-toast-key]');
  if (!toast || toast.dataset['kind'] !== 'error') return;
  e.preventDefault();
  e.stopPropagation();
  toastQueue.close(toast.dataset['toastKey']!);
}

const focusReturn = toastFocusReturn(() => void focusPaneNamed('content'));

/**
 * A toast that goes while the focus is on it hands the focus on first (toastFocus.ts): the next toast, else the table. The
 * layout cleanup of its item runs while its element is still in the page, so the focus can still be read.
 */
function useHandFocusOnClose(toastKey: string): void {
  useLayoutEffect(
    () => () => {
      const el = [...document.querySelectorAll<HTMLElement>('[data-toast-key]')].find((e) => e.dataset['toastKey'] === toastKey);
      if (el) focusReturn.closing(el);
    },
    [toastKey],
  );
}

/** The inside of a plain toast; a job toast that its result took over draws the same. */
function PlainToastBody({ toastKey, data, tookOver }: { toastKey: string; data: ToastData; tookOver?: boolean }) {
  // A job's result replaces its progress in place: the focus on 취소 goes with the button, so it is given back here.
  useLayoutEffect(() => {
    if (tookOver) focusReturn.settled();
  }, [tookOver]);
  return (
    <>
      <AutoClose toastKey={toastKey} kind={data.kind} testId={data.testId} />
      <ToastIcon kind={data.kind} />
      <ToastContent className="t-text">
        <Text slot="title" className="t-title">
          {data.title}
        </Text>
        {(data.lines?.length || data.body) && (
          <Text slot="description" elementType="div" className="t-desc">
            <ToastLines data={data} />
          </Text>
        )}
      </ToastContent>
      {data.action && <ToastActionButton action={data.action} onDone={() => toastQueue.close(toastKey)} />}
      {data.kind === 'error' && <IconButton slot="close" icon={X} label={t.common.close} size="small" testId="toast-close" />}
    </>
  );
}

/**
 * A job's progress (mockup importToast): spinner or pause, the title — the only announced part (RAC's role=alert): the
 * count, the file name and the bar change ten times a second — then 취소, and the bar with its percent under them.
 */
function JobProgressBody({ text, onCancel }: { text: JobToastText; onCancel: () => void }) {
  return (
    <>
      <span className={cx('t-icon', text.waiting && 'c-secondary')}>{text.waiting ? <Icon icon={CirclePause} size="md" /> : <Spinner />}</span>
      <div className="t-text">
        <div className="t-head">
          <ToastContent className="t-live">
            <Text slot="title" className="t-title">
              {text.title}
            </Text>
          </ToastContent>
          <span className="t-title t-count num" aria-hidden="true">
            {text.count}
          </span>
        </div>
        {text.file !== null && <MiddleEllipsis className="t-file" text={text.file} />}
        {text.note !== null && <span className="t-file ui-prose">{text.note}</span>}
      </div>
      <span className="t-actions">
        <Button size="small" testId={text.cancelTestId} onPress={onCancel}>
          {t.jobs.cancel}
        </Button>
      </span>
      {text.bar && (
        <div className="t-progress">
          <ProgressBar percent={text.percent} label={text.title} valueText={text.valueText} wide />
          <span className="pct t-footnote c-secondary num" aria-hidden="true">
            {t.jobs.percent(text.percent)}
          </span>
        </div>
      )}
    </>
  );
}

/** One job's toast: the same <Toast> from its first progress to its result, so it never closes and comes back. */
function JobToastItem({ toast, job }: { toast: QueuedToast<ToastContent>; job: ProgressJob }) {
  useHandFocusOnClose(toast.key);
  const view = useJobProgress((s) => s.views[toast.key]);
  const live = useJobProgress((s) => liveState(s, job));
  const ahead = useJobProgress((s) => jobAhead(s, job));
  if (view?.kind === 'result') {
    return (
      <Toast toast={toast} className="toast" data-kind={view.data.kind} data-toast-key={toast.key} data-testid={view.data.testId ?? 'toast'}>
        <PlainToastBody toastKey={toast.key} data={view.data} tookOver />
      </Toast>
    );
  }
  const text = describeJob(job, view?.state ?? live, ahead);
  return (
    <Toast toast={toast} className="toast" data-kind="progress" data-state={text.state} data-toast-key={toast.key} data-testid={text.testId}>
      <JobProgressBody text={text} onCancel={() => cancelJob(job)} />
    </Toast>
  );
}

/** A plain toast in the region (the item keeps the hook in one place). */
function PlainToastItem({ toast, data }: { toast: QueuedToast<ToastContent>; data: ToastData }) {
  useHandFocusOnClose(toast.key);
  return (
    <Toast toast={toast} className="toast" data-kind={data.kind} data-toast-key={toast.key} data-testid={data.testId ?? 'toast'}>
      <PlainToastBody toastKey={toast.key} data={data} />
    </Toast>
  );
}

/**
 * The toasts in the order the jobs began, oldest on top, as the mockups stack them (a running backup above the import
 * waiting behind it). RAC's own list draws the newest first, so this one reads the same state and turns it over in
 * render: the DOM, F6 and the arrow keys then go in the order the user sees, which a CSS reversal would not give.
 */
function OldestFirstList({ children }: { children: (args: { toast: QueuedToast<ToastContent> }) => ReactNode }) {
  const state = useContext(ToastStateContext);
  if (state === null) return null;
  const shown = [...(state.visibleToasts as Array<QueuedToast<ToastContent>>)].reverse();
  return (
    <ol style={{ display: 'contents' }}>
      {shown.map((toast) => (
        <li key={toast.key} style={{ display: 'contents' }}>
          {children({ toast })}
        </li>
      ))}
    </ol>
  );
}

export function Toasts() {
  return (
    <div
      className="toast-keys"
      onKeyDown={closeOnEscape}
      onFocus={(e) => focusReturn.entered(e.relatedTarget as Element | null)}
      onBlur={(e) => focusReturn.left(e.relatedTarget as Element | null)}
    >
      {/* The last F6 pane while a toast is visible (shell/panes.ts, R-1); RAC passes data-* through to the region. */}
      <ToastRegion
        queue={toastQueue}
        className="toasts"
        aria-label={t.common.notifications}
        data-pane="toasts"
      >
        <OldestFirstList>
          {({ toast }) =>
            toast.content.kind === 'job' ? (
              <JobToastItem toast={toast} job={toast.content.job} />
            ) : (
              <PlainToastItem toast={toast} data={toast.content} />
            )
          }
        </OldestFirstList>
      </ToastRegion>
    </div>
  );
}
