import { describe, expect, it, vi } from 'vitest';
import { windowDropHandlers, type FileDrag } from './useWindowDrop';

const file = (name: string) => ({ name }) as File;
/** A drag event as the handlers read it; `paths` maps file names to what webUtils.getPathForFile returns. */
function drag(opts: { altKey?: boolean; types?: string[]; files?: File[] } = {}) {
  const dataTransfer = { types: opts.types ?? ['Files'], files: opts.files ?? [file('a.pdf')], dropEffect: 'none' };
  const e: FileDrag = { altKey: opts.altKey ?? false, dataTransfer, preventDefault: vi.fn() };
  return e;
}
const PATHS: Record<string, string> = { 'a.pdf': '/Users/me/a.pdf', 'b.mp4': '/Users/me/b.mp4', 'synthetic.pdf': '' };

describe('window drop (design-spec 7.2: copy, ⌥ = link)', () => {
  const setup = () => {
    const onDrop = vi.fn();
    return { onDrop, h: windowDropHandlers(onDrop, (f) => PATHS[f.name] ?? '') };
  };

  it('a plain drop imports copies, a drop with ⌥ links', () => {
    const { onDrop, h } = setup();
    h.drop(drag({ files: [file('a.pdf'), file('b.mp4')] }));
    h.drop(drag({ altKey: true }));
    expect(onDrop.mock.calls).toEqual([
      [['/Users/me/a.pdf', '/Users/me/b.mp4'], 'managed', 0],
      [['/Users/me/a.pdf'], 'linked', 0],
    ]);
  });

  it('dragover accepts files and shows the effect the drop will have', () => {
    const { h } = setup();
    const copy = drag();
    h.over(copy);
    expect(copy.preventDefault).toHaveBeenCalled();
    expect(copy.dataTransfer!.dropEffect).toBe('copy');
    const link = drag({ altKey: true });
    h.over(link);
    expect(link.dataTransfer!.dropEffect).toBe('link');
  });

  it('ignores drags that carry no files (text, links), so they keep their default handling', () => {
    const { onDrop, h } = setup();
    const text = drag({ types: ['text/plain'] });
    h.over(text);
    h.drop(text);
    expect(text.preventDefault).not.toHaveBeenCalled();
    expect(text.dataTransfer!.dropEffect).toBe('none');
    const none: FileDrag = { altKey: false, dataTransfer: null, preventDefault: vi.fn() };
    h.drop(none);
    expect(onDrop).not.toHaveBeenCalled();
  });

  it('counts the files whose location cannot be read', () => {
    const { onDrop, h } = setup();
    h.drop(drag({ files: [file('a.pdf'), file('synthetic.pdf')] }));
    h.drop(drag({ files: [file('synthetic.pdf')] }));
    expect(onDrop.mock.calls).toEqual([
      [['/Users/me/a.pdf'], 'managed', 1],
      [[], 'managed', 1],
    ]);
  });
});
