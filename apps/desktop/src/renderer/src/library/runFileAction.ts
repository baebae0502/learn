import { closeToast, showToast } from '../ui/toasts';
import { fileActionRunner } from './fileActions';

/** 기본 앱으로 열기, Finder에서 보기, 사본 내보내기: this window's toasts and timers. */
export const runFileAction = fileActionRunner({
  show: showToast,
  close: closeToast,
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
});
