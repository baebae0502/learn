import { describe, expect, it, vi } from 'vitest';
import { LearnError, type Result } from '@learn/domain';
import { fakeSender, stubDeps } from './test-deps';

type Listener = (event: unknown, raw: unknown) => Promise<Result<unknown>>;
const handlers = new Map<string, Listener>();
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: Listener) => handlers.set(channel, fn) },
  BrowserWindow: { getAllWindows: () => [] },
}));

const { createHandle } = await import('./register');
const { registerTranslationIpc } = await import('./translation');

const translate = vi.fn(async () => ({ text: 't', detectedFrom: 'en', engine: 'fake', cached: false, sameLanguage: false }));
const cancel = vi.fn();
registerTranslationIpc(createHandle(null), stubDeps({ translation: { translate, cancel } }));
const call = (channel: string, sender: ReturnType<typeof fakeSender>, raw: unknown) => handlers.get(channel)!({ sender, senderFrame: { url: 'learn://app/index.html' } }, raw);
const MAIN_PAGE = fakeSender(21, 'main');

describe('translation IPC', () => {
  it('hands a valid request to the service', async () => {
    const input = { text: 'Hello.', from: 'auto', to: 'ko' };
    expect(await call('translation:translate', MAIN_PAGE, input)).toMatchObject({ ok: true, data: { text: 't' } });
    expect(translate).toHaveBeenCalledWith(input);
  });
  it('refuses a bad request before the service', async () => {
    translate.mockClear();
    expect(await call('translation:translate', MAIN_PAGE, { text: '', from: 'auto', to: 'ko' })).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(await call('translation:translate', MAIN_PAGE, { text: 'a', from: 'auto', to: 'ko', x: 1 })).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(translate).not.toHaveBeenCalled();
  });
  it('only the main window may call it', async () => {
    expect(await call('translation:translate', fakeSender(22, 'settings'), { text: 'a', from: 'auto', to: 'ko' })).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
  });
  it('passes the service failure on with its code', async () => {
    translate.mockRejectedValueOnce(new LearnError('TRANSLATION_DISABLED', 'x'));
    expect(await call('translation:translate', MAIN_PAGE, { text: 'a', from: 'auto', to: 'ko' })).toMatchObject({ ok: false, code: 'TRANSLATION_DISABLED', retryable: false });
  });
  it('cancel stops the current request', async () => {
    expect(await call('translation:cancel', MAIN_PAGE, undefined)).toMatchObject({ ok: true });
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
