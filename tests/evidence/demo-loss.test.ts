import { describe, expect, it } from 'vitest';
import { RecordingLost, exitedEarly, lossOf, recordingLoss } from './demo-loss';

describe('a lost demo recording (re-review I1, m1)', () => {
  it('screencapture exiting before the demo ended is lost, with or without a (partial) file', () => {
    expect(exitedEarly({ afterSeconds: 8.1, demoEnded: false, end: { file: null, error: 'screencapture exit 1: x\ncapture error' } })).toBe(
      "screencapture ended after 8.1 s, before the demo's end, with no file (capture error)",
    );
    expect(exitedEarly({ afterSeconds: 120, demoEnded: false, end: { file: 'm3/m3-demo.mov' } })).toContain('with a partial file');
    // After the demo's end the rest of the fixed length is only the tail: not a loss.
    expect(exitedEarly({ afterSeconds: 200, demoEnded: true, end: { file: 'm3/m3-demo.mov' } })).toBeNull();
  });

  it('a recorder that ends without a file is lost; a skipped one (no recorder here) and a whole one are not', () => {
    expect(recordingLoss({ capture: 'screencast', end: { file: null, error: 'no screencast frames received' }, early: null })).toBe(
      'the screencast recording left no file (no screencast frames received)',
    );
    expect(recordingLoss({ capture: 'screencapture', end: { file: null }, early: null })).toBe('the screencapture recording left no file (no error)');
    expect(recordingLoss({ capture: 'screencapture', end: { file: null, skipped: 'screencapture needs darwin' }, early: null })).toBeNull();
    expect(recordingLoss({ capture: 'screencapture', end: { file: 'm3/m3-demo.mov' }, early: null })).toBeNull();
    expect(recordingLoss({ capture: 'screencapture', end: null, early: null })).toBeNull(); // never started
    // An early exit wins, even over the partial file it left.
    expect(recordingLoss({ capture: 'screencapture', end: { file: 'm3/m3-demo.mov' }, early: 'ended early' })).toBe('ended early');
  });

  it('an attempt that failed while a loss was pending is retried as lost; any other failure is not', () => {
    expect(lossOf(new RecordingLost('ended early'), null)).toBe('ended early');
    expect(lossOf(new Error('locator timed out'), 'ended early')).toBe('ended early; a step then failed: Error: locator timed out');
    expect(lossOf(new Error('locator timed out'), null)).toBeNull();
  });
});
