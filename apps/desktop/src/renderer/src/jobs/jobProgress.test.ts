import { afterEach, describe, expect, it } from 'vitest';
import { IDLE_IMPORT_STATE, type ImportQueueState } from '@learn/domain';
import { describeJob, importBusy, importBusyTotal, useJobProgress } from './jobProgress';

const state = (over: Partial<ImportQueueState>): ImportQueueState => ({ ...IDLE_IMPORT_STATE, state: 'running', ...over });
afterEach(() => {
  useJobProgress.setState({ import: { ...IDLE_IMPORT_STATE }, sending: 0, settling: 0, shownTotal: 0, quiet: false, views: {} });
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
  it('waiting for the work before it: paused, 앞의 작업을 기다리는 중 and what comes next, no file', () => {
    expect(describeJob('import', state({ state: 'waiting-job', done: 0, total: 12, bytesTotal: 5000 }))).toMatchObject({
      waiting: true, title: '앞의 작업을 기다리는 중', count: ' · 12개', file: null, note: '앞의 작업이 끝나면 가져오기를 시작합니다.', bar: false, percent: 0,
    });
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
