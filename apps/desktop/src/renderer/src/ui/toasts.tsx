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
 * an error stays until its × closes it (C-6). Action buttons, when a toast gets one, are verbs (취소·보기·다시 시도).
 * RAC's toast API is UNSTABLE_-prefixed in 1.22.1; it is pinned and used only through this module.
 */
export const toastQueue = new ToastQueue<ToastData>({ maxVisibleToasts: 3 });

export function showToast(data: ToastData): string {
  return toastQueue.add(data, data.kind === 'error' ? {} : { timeout: 5000 });
}

export const TOAST_ICON = { success: CircleCheck, error: CircleAlert, info: Info } as const;
export const TOAST_TONE = { success: 'c-success', error: 'c-danger', info: 'c-secondary' } as const;

export function Toasts() {
  return (
    <ToastRegion queue={toastQueue} className="toasts" aria-label={t.common.notifications}>
      {({ toast }) => (
        <Toast toast={toast} className="toast" data-kind={toast.content.kind} data-testid={toast.content.testId ?? 'toast'}>
          <span className={`t-icon ${TOAST_TONE[toast.content.kind]}`}>
            <Icon icon={TOAST_ICON[toast.content.kind]} size="lg" />
          </span>
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
  );
}
