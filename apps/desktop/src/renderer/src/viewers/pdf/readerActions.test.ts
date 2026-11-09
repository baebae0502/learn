import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api', async (original) => ({ ...(await original<typeof import('../../api')>()), api: () => ({ translation: { cancel: async () => ({ ok: true, data: undefined }) } }) }));

const { createReaderScope, setActiveReaderScope, learnImageHook } = await import('../readerScope');
const { readerActions } = await import('./readerActions');

afterEach(() => setActiveReaderScope(null));

const imageHandle = () => ({ zoomIn: vi.fn(), zoomOut: vi.fn(), setZoom: vi.fn(), rotate: vi.fn() });
const pdfHandle = () => ({ zoomIn: vi.fn(), zoomOut: vi.fn(), setZoom: vi.fn(), rotate: vi.fn() });

describe('the reader commands reach the open document', () => {
  it('a drawn picture takes the zoom, the fits (by its own names) and the turns; the automatic fit is not its', () => {
    const scope = createReaderScope('img');
    const h = imageHandle();
    scope.reader.getState().setImageHandle(h);
    setActiveReaderScope(scope);
    readerActions.zoom('in');
    readerActions.zoom('out');
    readerActions.zoom('actual');
    readerActions.setZoom('page-fit');
    readerActions.setZoom('page-width');
    readerActions.setZoom('auto');
    readerActions.setZoom(2.5);
    readerActions.rotate(-90);
    expect(h.zoomIn).toHaveBeenCalledTimes(1);
    expect(h.zoomOut).toHaveBeenCalledTimes(1);
    expect(h.setZoom.mock.calls).toEqual([[1], ['fit'], ['width'], [2.5]]);
    expect(h.rotate).toHaveBeenCalledWith(-90);
  });

  it('a PDF keeps its own handle and names', () => {
    const scope = createReaderScope('pdf');
    const h = pdfHandle();
    scope.reader.getState().setHandle(h as never);
    setActiveReaderScope(scope);
    readerActions.setZoom('page-fit');
    readerActions.zoom('actual');
    readerActions.rotate(90);
    expect(h.setZoom.mock.calls).toEqual([['page-fit'], [1]]);
    expect(h.rotate).toHaveBeenCalledWith(90);
  });

  it('the test hook reads the shown picture, or a hidden tab’s by its id, with the centre the reader keeps', () => {
    const shown = createReaderScope('a');
    const hidden = createReaderScope('b');
    shown.reader.getState().setImage({ status: 'shown', scale: 0.25 });
    shown.imageCentre.current = { cx: 0.3, cy: 0.7 };
    setActiveReaderScope(shown);
    expect(learnImageHook().getState()).toEqual({ status: 'shown', zoom: 'fit', scale: 0.25, rotation: 0, natural: null, itemId: 'a', cx: 0.3, cy: 0.7 });
    expect(hidden.reader.getState().image).toBeNull();
    expect(learnImageHook().getState('nowhere')).toBeNull();
    setActiveReaderScope(null);
    expect(learnImageHook().getState()).toBeNull();
  });
});
