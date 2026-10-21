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
export interface ToastData {
  kind: ToastKind;
  title: string;
  body?: string;
  testId?: string;
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
      <ToastRegion queue={toastQueue} className="toasts" aria-label={t.common.notifications}>
        {({ toast }) => (
          <Toast toast={toast} className="toast" data-kind={toast.content.kind} data-toast-key={toast.key} data-testid={toast.content.testId ?? 'toast'}>
            <ToastIcon kind={toast.content.kind} />
            <ToastContent className="t-text">
              <Text slot="title" className="t-title">
                {toast.content.title}
              </Text>
              {toast.content.body && (
                <Text slot="description" className="t-body">
                  {toast.content.body}
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
