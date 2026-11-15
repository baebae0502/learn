import { describe, expect, it, vi } from 'vitest';

vi.mock('../api', async (original) => ({ ...(await original<typeof import('../api')>()), api: () => ({ translation: { cancel: async () => ({ ok: true, data: undefined }) } }) }));

const { watchSelections } = await import('./AttachedChip');
const { createReaderScope } = await import('../viewers/readerScope');

const REV = '3f0d9a0e-6b1e-4c1e-8f6a-1d2f9b7c5e11';
/** A range is only passed through here: any object stands for one. */
const range = (name: string) => ({ name }) as unknown as Range;
const passage = (text: string) => ({ text }) as never;
const drain = () => new Promise<void>((r) => setTimeout(r, 0));

/** A tab with a document open, and the passage maker answering when the test says. */
function rig() {
  const scope = createReaderScope('item');
  scope.reader.getState().setHandle({ document: () => ({}), viewer: () => ({}) } as never);
  const made: Array<{ range: Range; answer(a: unknown): void }> = [];
  const make = vi.fn((o: { range: Range }) => new Promise((answer) => made.push({ range: o.range, answer }))) as never;
  const stop = watchSelections(scope, REV, make);
  return { scope, made, stop, attached: () => scope.tutor.getState().attached as unknown };
}

describe('the selections that attach themselves to the next question (spec 8.4)', () => {
  it('a new selection replaces the chip; when several are being made the latest wins; a selection that goes leaves the chip', async () => {
    const r = rig();
    r.scope.selection.setState({ range: range('a') });
    r.scope.selection.setState({ range: range('b') });
    expect(r.made.map((m) => (m.range as unknown as { name: string }).name)).toEqual(['a', 'b']);
    r.made[1]!.answer(passage('b'));
    await drain();
    r.made[0]!.answer(passage('a'));
    await drain();
    expect(r.attached()).toEqual({ text: 'b' });
    r.scope.selection.setState({ range: null });
    expect(r.made).toHaveLength(2);
    expect(r.attached()).toEqual({ text: 'b' });
    r.stop();
  });

  it('while the question waits for another answer a selection is not taken, then or afterwards: the reader selects again', async () => {
    const r = rig();
    r.scope.selection.setState({ range: range('a') });
    r.made[0]!.answer(passage('a'));
    await drain();
    r.scope.tutor.getState().setWaiting({ text: 'q', busyWith: { conversationId: 'c', messageId: 'm' } });
    r.scope.selection.setState({ range: range('held') });
    expect(r.made).toHaveLength(1);
    r.scope.tutor.getState().setWaiting(null);
    await drain();
    expect(r.attached()).toEqual({ text: 'a' });
    // One begun before the wait and ready during it is dropped too.
    r.scope.selection.setState({ range: range('c') });
    r.scope.tutor.getState().setWaiting({ text: 'q', busyWith: { conversationId: 'c', messageId: 'm' } });
    r.made[1]!.answer(passage('c'));
    await drain();
    expect(r.attached()).toEqual({ text: 'a' });
    r.stop();
  });

  it('takes nothing once stopped, and nothing a selection that is not a passage', async () => {
    const r = rig();
    r.scope.selection.setState({ range: range('a') });
    r.made[0]!.answer(null);
    await drain();
    expect(r.attached()).toBeNull();
    r.scope.selection.setState({ range: range('b') });
    r.stop();
    r.made[1]!.answer(passage('b'));
    await drain();
    expect(r.attached()).toBeNull();
  });
});
