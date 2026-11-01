import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDLE_BACKUP_PROGRESS, IDLE_IMPORT_STATE, type ImportQueueState, type JobProgress } from '@learn/domain';
import { cancelJob, describeJob, importCancelsAskedHere, importBusy, importBusyTotal, jobAhead, useJobProgress } from './jobProgress';

const state = (over: Partial<ImportQueueState>): ImportQueueState => ({ ...IDLE_IMPORT_STATE, state: 'running', ...over });
afterEach(() => {
  useJobProgress.setState({ import: { ...IDLE_IMPORT_STATE }, backup: { ...IDLE_BACKUP_PROGRESS }, sending: 0, settling: 0, shownTotal: 0, quiet: false, views: {} });
});

describe('the progress toast in words (spec 3.3, mockup importToast)', () => {
  it('running: 가져오는 중 · done / total, the file under way, the hashed bytes as the bar', () => {
    expect(describeJob('import', state({ done: 7, total: 12, bytesDone: 580, bytesTotal: 1000, percent: 58, current: '강의 08 · 효소 조절.mp4' }))).toEqual({
      state: 'running', waiting: false, title: '가져오는 중', count: ' · 7 / 12', file: '강의 08 · 효소 조절.mp4', note: null,
      bar: true, percent: 58, valueText: '파일 12개 중 7개, 58%', testId: 'import-progress', cancelTestId: 'import-cancel',
    });
  });
  it('waiting for a choice: paused, 확인을 기다리는 중, the file asked about', () => {
    expect(describeJob('import', state({ state: 'waiting-choice', done: 7, total: 12, bytesDone: 900, bytesTotal: 1000, percent: 90, current: 'molbio_ch06_signaling.pdf' }))).toMatchObject({
      waiting: true, title: '확인을 기다리는 중', count: ' · 7 / 12', file: 'molbio_ch06_signaling.pdf', note: null, bar: true, percent: 90,
    });
  });
  it('waiting for the work before it: paused, 앞의 작업을 기다리는 중 · N개 with no bar (nothing measured yet), naming the backup when it is the one ahead (Q-4e)', () => {
    const waiting = state({ state: 'waiting-job', done: 0, total: 12, bytesTotal: 5000 });
    expect(describeJob('import', waiting)).toMatchObject({
      waiting: true, title: '앞의 작업을 기다리는 중', count: ' · 12개', file: null, note: '앞의 작업이 끝나면 가져오기를 시작합니다.', bar: false,
    });
    expect(describeJob('import', waiting, 'backup').note).toBe('백업이 끝나면 가져오기를 시작합니다.');
  });
  it('shows main\'s percent as it is, so the bar and the count measure the same progress (never 100 while waiting for a choice)', () => {
    expect(describeJob('import', state({ state: 'waiting-choice', done: 0, total: 3, percent: 33 })).percent).toBe(33);
    expect(describeJob('import', state({ state: 'waiting-choice', done: 0, total: 3, percent: 33 })).valueText).toBe('파일 3개 중 0개, 33%');
    expect(describeJob('import', state({ percent: 0 })).percent).toBe(0);
  });
});

describe('the empty library\'s busy screen N (spec 3.2: the queue\'s total)', () => {
  const s = () => useJobProgress.getState();
  it('is what this window hands over before main has counted it, then the queue\'s total as it grows', () => {
    expect(importBusyTotal(s())).toBeNull();
    s().addSending(2);
    expect(importBusyTotal(s())).toBe(2);
    s().setImport(state({ total: 2 }));
    s().addSending(-2);
    expect(importBusyTotal(s())).toBe(2);
    s().setImport(state({ total: 5 }));
    expect(importBusyTotal(s())).toBe(5);
    expect(importBusy(s())).toBe(true);
  });
  it('stays while the run\'s end is shown (main is idle by then), and is gone after it', () => {
    s().setImport(state({ total: 3 }));
    s().addSettling(1);
    s().setImport({ ...IDLE_IMPORT_STATE });
    expect(importBusyTotal(s())).toBe(3);
    s().addSettling(-1);
    expect(importBusyTotal(s())).toBeNull();
    expect(importBusy(s())).toBe(false);
  });
  it('a quiet run (the E2E setup helper) shows no busy screen', () => {
    s().setQuiet(true);
    s().setImport(state({ total: 4 }));
    expect(importBusyTotal(s())).toBeNull();
    expect(importBusy(s())).toBe(true);
  });
  it('keeps a toast\'s view until it is cleared', () => {
    s().setView('k1', { kind: 'progress', state: state({ total: 1 }) });
    expect(Object.keys(s().views)).toEqual(['k1']);
    s().setView('k1', undefined);
    expect(s().views).toEqual({});
  });
});

const backup = (over: Partial<JobProgress>): JobProgress => ({ ...IDLE_BACKUP_PROGRESS, state: 'running', ...over });

describe('the backup\'s progress toast (spec 8.1, dialogs.html?scene=jobs)', () => {
  it('running: 백업을 만드는 중 · files done / total, the folder\'s name, the bytes written and read back as the bar', () => {
    expect(describeJob('backup', backup({ done: 56, total: 128, bytesDone: 460, bytesTotal: 1000, name: 'Learn 백업 2026-10-30 2141' }))).toEqual({
      state: 'running', waiting: false, title: '백업을 만드는 중', count: ' · 56 / 128', file: 'Learn 백업 2026-10-30 2141', note: null, bar: true,
      percent: 46, valueText: '파일 128개 중 56개, 46%', testId: 'backup-progress', cancelTestId: 'backup-cancel',
    });
  });
  it('no count before it has counted its files; waiting behind an import, no bar, saying what comes next', () => {
    expect(describeJob('backup', backup({ name: null })).count).toBe('');
    expect(describeJob('backup', backup({ state: 'waiting-job' }), 'import')).toMatchObject({
      waiting: true, title: '앞의 작업을 기다리는 중', count: '', file: null, note: '가져오기가 끝나면 백업을 시작합니다.', bar: false,
    });
    expect(describeJob('backup', backup({ state: 'waiting-job' })).note).toBe('앞의 작업이 끝나면 백업을 시작합니다.');
  });
  it('the job ahead of each, as this window knows it: a running backup ahead of an import, an import ahead of a backup', () => {
    const s = useJobProgress.getState;
    expect(jobAhead(s(), 'import')).toBeNull();
    s().setBackup(backup({ state: 'waiting-job' }));
    expect(jobAhead(s(), 'import')).toBeNull(); // it waits too: not ahead
    s().setBackup(backup({}));
    expect(jobAhead(s(), 'import')).toBe('backup');
    expect(jobAhead(s(), 'backup')).toBeNull();
    s().setImport(state({ total: 2 }));
    expect(jobAhead(s(), 'backup')).toBe('import');
  });
});

describe('the toast\'s 취소 reaches main and counts nothing here (the count is main\'s, ImportQueueState.cancels)', () => {
  it('an import\'s goes to library.cancelImport, a backup\'s to backup.cancel', () => {
    const cancelImport = vi.fn(async () => ({ ok: true as const, data: undefined }));
    const cancelBackup = vi.fn(async () => ({ ok: true as const, data: undefined }));
    vi.stubGlobal('window', { learn: { library: { cancelImport }, backup: { cancel: cancelBackup } } });
    try {
      const before = importCancelsAskedHere();
      cancelJob('import');
      expect(importCancelsAskedHere()).toBe(before + 1);
      expect([cancelImport.mock.calls.length, cancelBackup.mock.calls.length]).toEqual([1, 0]);
      cancelJob('backup');
      expect(importCancelsAskedHere()).toBe(before + 1);
      expect([cancelImport.mock.calls.length, cancelBackup.mock.calls.length]).toEqual([1, 1]);
      expect(useJobProgress.getState()).not.toHaveProperty('cancels');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
