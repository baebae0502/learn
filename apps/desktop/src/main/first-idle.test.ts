import { describe, expect, it } from 'vitest';
import { LearnError } from '@learn/domain';
import { runFirstIdle, type FirstIdleSteps } from './first-idle';

/** Steps that record their order; `throws` names the ones that fail. */
function steps(throws: Partial<Record<keyof FirstIdleSteps, unknown>> = {}): { steps: FirstIdleSteps; ran: string[] } {
  const ran: string[] = [];
  const step = (name: keyof FirstIdleSteps) => () => {
    ran.push(name);
    if (name in throws) throw throws[name];
  };
  return { steps: { screen: step('screen'), text: step('text'), settings: step('settings'), sheets: step('sheets') }, ran };
}

describe('the main window\'s first idle', () => {
  it('signals the check sheet and the body-text scheduler first, then prepares the two windows', () => {
    const s = steps();
    const lines: string[] = [];
    const before = Date.now();
    const report = runFirstIdle(s.steps, (l) => void lines.push(l));
    expect(s.ran).toEqual(['screen', 'text', 'settings', 'sheets']);
    expect(report).toMatchObject({ screen: 'ok', text: 'ok', settings: 'ok', sheets: 'ok' });
    expect(report.at).toBeGreaterThanOrEqual(before);
    expect(lines).toEqual([]);
  });

  it('a settings window that fails to prepare keeps neither the signals nor the sheet\'s window from running; the code is logged', () => {
    const s = steps({ settings: new LearnError('INTERNAL', '/Users/someone/secret') });
    const lines: string[] = [];
    const report = runFirstIdle(s.steps, (l) => void lines.push(l));
    expect(s.ran).toEqual(['screen', 'text', 'settings', 'sheets']);
    expect(report).toMatchObject({ screen: 'ok', text: 'ok', settings: 'INTERNAL', sheets: 'ok' });
    expect(lines).toEqual(['[window] first idle: settings failed: INTERNAL']);
  });

  it('a sheet\'s window that fails to prepare still leaves the scheduler signalled', () => {
    const s = steps({ sheets: Object.assign(new Error('x'), { code: 'EACCES' }) });
    const lines: string[] = [];
    const report = runFirstIdle(s.steps, (l) => void lines.push(l));
    expect(s.ran).toEqual(['screen', 'text', 'settings', 'sheets']);
    expect(report).toMatchObject({ text: 'ok', settings: 'ok', sheets: 'PERMISSION_DENIED' });
    expect(lines).toEqual(['[window] first idle: sheets failed: PERMISSION_DENIED']);
  });

  it('every step runs even when each one throws', () => {
    const s = steps({ screen: new Error('a'), text: new Error('b'), settings: new Error('c'), sheets: 'd' });
    const lines: string[] = [];
    const report = runFirstIdle(s.steps, (l) => void lines.push(l));
    expect(s.ran).toEqual(['screen', 'text', 'settings', 'sheets']);
    expect(report).toMatchObject({ screen: 'INTERNAL', text: 'INTERNAL', settings: 'INTERNAL', sheets: 'INTERNAL' });
    expect(lines).toHaveLength(4);
  });
});
