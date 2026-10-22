import type { KeyboardEvent } from 'react';
import { CircleAlert, CircleCheck, Info, X } from 'lucide-react';
import {
  Text,
  UNSTABLE_Toast as Toast,
  UNSTABLE_ToastContent as ToastContent,
  UNSTABLE_ToastQueue as ToastQueue,
  UNSTABLE_ToastRegion as ToastRegion,
} from 'react-aria-components';
import { t } from '../strings';
import { IconButton } from './Button';
import { Icon } from './Icon';

export type ToastKind = 'success' | 'error' | 'info';
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
  testId?: string;
}

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

/**
 * One queue per window. design-spec 6 토스트: success (and info) closes by itself after 5 s and has no button;
 * an error stays until its × (or Escape while it has focus) closes it (C-6). Action buttons, when a toast gets one,
 * are verbs (취소·보기·다시 시도). RAC's toast API is UNSTABLE_-prefixed in 1.22.1; it is pinned and used only through
 * this module.
 */
export const toastQueue = new ToastQueue<ToastData>({ maxVisibleToasts: 3 });

export function showToast(data: ToastData): string {
  return toastQueue.add(data, data.kind === 'error' ? {} : { timeout: 5000 });
}

const TOAST_ICON = { success: CircleCheck, error: CircleAlert, info: Info } as const;
const TOAST_TONE = { success: 'c-success', error: 'c-danger', info: 'c-secondary' } as const;

/** 16 px icon in the 20 px icon column, centred on the title line (design-spec 6 토스트). Shared with the board. */
export function ToastIcon({ kind }: { kind: ToastKind }) {
  return (
    <span className={`t-icon ${TOAST_TONE[kind]}`}>
      <Icon icon={TOAST_ICON[kind]} size="md" />
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

export function Toasts() {
  return (
    <div className="toast-keys" onKeyDown={closeOnEscape}>
      {/* The last F6 pane while a toast is visible (shell/panes.ts, R-1); RAC passes data-* through to the region. */}
      <ToastRegion queue={toastQueue} className="toasts" aria-label={t.common.notifications} data-pane="toasts">
        {({ toast }) => (
          <Toast toast={toast} className="toast" data-kind={toast.content.kind} data-toast-key={toast.key} data-testid={toast.content.testId ?? 'toast'}>
            <ToastIcon kind={toast.content.kind} />
            <ToastContent className="t-text">
              <Text slot="title" className="t-title">
                {toast.content.title}
              </Text>
              {(toast.content.lines?.length || toast.content.body) && (
                <Text slot="description" elementType="div" className="t-desc">
                  <ToastLines data={toast.content} />
                </Text>
              )}
            </ToastContent>
            {toast.content.kind === 'error' && <IconButton slot="close" icon={X} label={t.common.close} size="small" testId="toast-close" />}
          </Toast>
        )}
      </ToastRegion>
    </div>
  );
}
