import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LearnError, type AgentsReport, type Result } from '@learn/domain';
import type { TutorService } from '../tutor/service';
import type { IpcDeps } from './register';
import { fakeSender, stubDeps } from './test-deps';

type Listener = (event: unknown, raw: unknown) => Promise<Result<unknown>>;
const handlers = new Map<string, Listener>();
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: Listener) => handlers.set(channel, fn) },
  BrowserWindow: { getAllWindows: () => [] },
}));

const { createHandle } = await import('./register');
const { registerTutorIpc } = await import('./tutor');

const ITEM = '3f2b8c1e-5d4a-4b6f-8a9e-1c2d3e4f5a6b';
const CONV = '4f2b8c1e-5d4a-4b6f-8a9e-1c2d3e4f5a6b';
const MSG = '5f2b8c1e-5d4a-4b6f-8a9e-1c2d3e4f5a6b';
const READER = { pageIndex: 0, pageCount: 10, outline: [], outlineComplete: true, outlineTotal: 0 };
const REPORT: AgentsReport = { agents: [], fake: null };
const ROWS = { conversationId: CONV, userMessageId: MSG, tutorMessageId: ITEM };

function fakeService() {
  return {
    consent: vi.fn(() => {}),
    agents: vi.fn(async () => REPORT),
    chooseAgent: vi.fn(async () => {}),
    view: vi.fn(() => {}),
    warm: vi.fn(async () => {}),
    ask: vi.fn(async (): Promise<Awaited<ReturnType<TutorService['ask']>>> => ROWS),
    stop: vi.fn(() => {}),
    resend: vi.fn(async () => ({ tutorMessageId: MSG })),
    reground: vi.fn(async () => ({ userMessageId: MSG, tutorMessageId: ITEM })),
    removeWorkFolders: vi.fn(async () => {}),
    setTimeouts: vi.fn(() => {}),
    processes: vi.fn(() => ({ count: 0, max: 0, conversationIds: [] })),
    resetProcessMax: vi.fn(() => {}),
    killAgent: vi.fn(() => {}),
    shutdown: vi.fn(async () => {}),
  } satisfies TutorService;
}

let service = fakeService();
const deps: IpcDeps = stubDeps({ tutor: service });
registerTutorIpc(createHandle(null), deps);
const MAIN_PAGE = fakeSender(41, 'main');
const SETTINGS_PAGE = fakeSender(42, 'settings');
const SHEET_PAGE = fakeSender(43, 'sheet');
const call = (channel: string, raw: unknown, sender = MAIN_PAGE) => handlers.get(channel)!({ sender, senderFrame: { url: 'learn://app/index.html?window=main' } }, raw);

/** A valid input of each channel, and the service call it becomes. */
const VALID: Record<string, { input: unknown; called: (s: ReturnType<typeof fakeService>) => unknown[][]; args: unknown[] }> = {
  'tutor:consent': { input: { grant: true }, called: (s) => s.consent.mock.calls, args: [] },
  'tutor:agents': { input: { mode: 'cached' }, called: (s) => s.agents.mock.calls, args: [{ mode: 'cached' }] },
  'tutor:chooseAgent': { input: { agent: 'fake' }, called: (s) => s.chooseAgent.mock.calls, args: ['fake'] },
  'tutor:view': { input: { view: { itemId: ITEM, conversationId: null } }, called: (s) => s.view.mock.calls, args: [{ itemId: ITEM, conversationId: null }] },
  'tutor:warm': { input: { itemId: ITEM, conversationId: CONV }, called: (s) => s.warm.mock.calls, args: [{ itemId: ITEM, conversationId: CONV }] },
  'tutor:ask': {
    input: { itemId: ITEM, conversationId: null, text: '어텐션이 뭐야?', selection: null, reader: READER },
    called: (s) => s.ask.mock.calls, args: [{ itemId: ITEM, conversationId: null, text: '어텐션이 뭐야?', selection: null, reader: READER }],
  },
  'tutor:stop': { input: { messageId: MSG }, called: (s) => s.stop.mock.calls, args: [MSG] },
  'tutor:resend': { input: { messageId: MSG, reader: READER }, called: (s) => s.resend.mock.calls, args: [{ messageId: MSG, reader: READER }] },
  'tutor:reground': { input: { messageId: MSG, reader: READER }, called: (s) => s.reground.mock.calls, args: [{ messageId: MSG, reader: READER }] },
};
const CHANNELS = Object.keys(VALID);

beforeEach(() => {
  service = fakeService();
  deps.tutor = service;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'debug').mockImplementation(() => {});
});

describe('tutor:* (spec 12)', () => {
  it('registers the nine channels', () => {
    expect(CHANNELS.every((c) => handlers.has(c))).toBe(true);
    expect([...handlers.keys()].filter((c) => c.startsWith('tutor:')).sort()).toEqual([...CHANNELS].sort());
  });

  it.each(CHANNELS)('%s: the main window\'s input reaches the service as it was parsed', async (channel) => {
    const v = VALID[channel]!;
    expect(await call(channel, v.input)).toMatchObject({ ok: true });
    expect(v.called(service)).toEqual([v.args]);
  });

  it.each(CHANNELS)('%s: the settings window and a sheet are refused before the service', async (channel) => {
    const v = VALID[channel]!;
    expect(await call(channel, v.input, SETTINGS_PAGE)).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
    expect(await call(channel, v.input, SHEET_PAGE)).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
    expect(v.called(service)).toEqual([]);
  });

  it.each(CHANNELS)('%s: an unknown key is VALIDATION_FAILED', async (channel) => {
    const v = VALID[channel]!;
    expect(await call(channel, { ...(v.input as object), extra: 1 })).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(v.called(service)).toEqual([]);
  });

  it('a question of 8,000 characters is taken, of 8,001 refused', async () => {
    const ask = VALID['tutor:ask']!.input as Record<string, unknown>;
    expect(await call('tutor:ask', { ...ask, text: 'a'.repeat(8000) })).toMatchObject({ ok: true });
    expect(await call('tutor:ask', { ...ask, text: 'a'.repeat(8001) })).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(service.ask).toHaveBeenCalledTimes(1);
  });

  it('tutor:view takes { view } — { view: null } is the panel showing no session — and refuses a bare key', async () => {
    expect(await call('tutor:view', { view: null })).toMatchObject({ ok: true });
    expect(service.view.mock.calls).toEqual([[null]]);
    expect(await call('tutor:view', { itemId: ITEM, conversationId: null })).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(await call('tutor:view', null)).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(service.view).toHaveBeenCalledTimes(1);
  });

  it('tutor:ask answers the rows, or the answer it waits for (busyWith) as it is', async () => {
    const ask = VALID['tutor:ask']!.input;
    expect(await call('tutor:ask', ask)).toEqual({ ok: true, data: ROWS });
    const busy = { busyWith: { conversationId: CONV, messageId: MSG } };
    service.ask.mockResolvedValueOnce(busy);
    expect(await call('tutor:ask', ask)).toEqual({ ok: true, data: busy });
  });

  it('a refusal of the service keeps its code', async () => {
    service.agents.mockRejectedValueOnce(new LearnError('TUTOR_CONSENT_REQUIRED', 'consent first'));
    expect(await call('tutor:agents', { mode: 'cached' })).toMatchObject({ ok: false, code: 'TUTOR_CONSENT_REQUIRED' });
    service.ask.mockRejectedValueOnce(new LearnError('AGENT_BUSY', 'busy'));
    expect(await call('tutor:ask', VALID['tutor:ask']!.input)).toMatchObject({ ok: false, code: 'AGENT_BUSY' });
  });

  it.each(CHANNELS)('%s: without a library (no service) it is LIBRARY_UNAVAILABLE', async (channel) => {
    const v = VALID[channel]!;
    deps.tutor = null;
    expect(await call(channel, v.input)).toMatchObject({ ok: false, code: 'LIBRARY_UNAVAILABLE' });
    expect(v.called(service)).toEqual([]);
  });
});
