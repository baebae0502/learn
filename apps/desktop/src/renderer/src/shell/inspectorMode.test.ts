import { afterEach, describe, expect, it, vi } from 'vitest';

const set = vi.fn(async () => ({ ok: true as const, data: undefined }));
vi.mock('../api', async (original) => ({ ...(await original<typeof import('../api')>()), api: () => ({ settings: { set } }) }));

const { chooseInspectorMode, inspectorModeNow, readerMode } = await import('./inspectorMode');
const { queryClient } = await import('../data/query-client');
const { settingKey } = await import('../data/saveSetting');
const { useShell } = await import('../state/shell-store');

const ITEM = '3f0d9a0e-6b1e-4c1e-8f6a-1d2f9b7c5e11';
afterEach(() => {
  queryClient.clear();
  useShell.setState({ view: { kind: 'library' } });
  set.mockClear();
});

describe('the reader\'s remembered right panel mode (J43)', () => {
  it('reads 튜터 until 정보 was chosen: unset, unreadable and unknown values all give the tutor', () => {
    expect(readerMode('info')).toBe('info');
    expect(readerMode('tutor')).toBe('tutor');
    for (const v of [undefined, null, '', 'library', 3, {}]) expect(readerMode(v)).toBe('tutor');
  });
  it('is 정보 in the library whatever was remembered, and the remembered one in the reader', () => {
    queryClient.setQueryData(settingKey('reader.inspectorMode'), 'tutor');
    expect(inspectorModeNow()).toBe('info');
    useShell.setState({ view: { kind: 'reader', itemId: ITEM } });
    expect(inspectorModeNow()).toBe('tutor');
    queryClient.setQueryData(settingKey('reader.inspectorMode'), 'info');
    expect(inspectorModeNow()).toBe('info');
    queryClient.setQueryData(settingKey('reader.inspectorMode'), null);
    expect(inspectorModeNow()).toBe('tutor'); // nothing chosen yet
  });
  it('choosing is remembered at once on the screen and written to the library setting', () => {
    useShell.setState({ view: { kind: 'reader', itemId: ITEM } });
    chooseInspectorMode('info');
    expect(inspectorModeNow()).toBe('info');
    expect(set).toHaveBeenCalledWith({ key: 'reader.inspectorMode', value: 'info' });
  });
});
