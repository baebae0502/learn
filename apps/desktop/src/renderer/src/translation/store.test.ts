import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PREFS, ERROR_COPY, type ErrorCode, type Prefs, type Result, type TranslationResult } from '@learn/domain';
import { keys } from '../data/queries';
import { queryClient } from '../data/query-client';

const translate = vi.fn<(input: { text: string; from: string; to: string }) => Promise<Result<TranslationResult>>>();
const cancel = vi.fn(async () => ({ ok: true as const, data: undefined }));
const setPrefs = vi.fn<(patch: Partial<Prefs>) => Promise<Result<Prefs>>>();
vi.mock('../api', async (original) => ({ ...(await original<typeof import('../api')>()), api: () => ({ translation: { translate, cancel }, prefs: { set: setPrefs } }) }));

const { useTranslation } = await import('./store');

const prefs = (translation: Partial<Prefs['translation']>): Prefs => ({ ...DEFAULT_PREFS, translation: { ...DEFAULT_PREFS.translation, ...translation } });
const setTranslationPrefs = (translation: Partial<Prefs['translation']>) => queryClient.setQueryData(keys.prefs, prefs(translation));
const done = (text: string, over: Partial<TranslationResult> = {}): Result<TranslationResult> => ({ ok: true, data: { text, detectedFrom: 'en', engine: 'fake', cached: false, sameLanguage: false, ...over } });
const failed = (code: ErrorCode, message: string): Result<TranslationResult> => ({ ok: false, code, message, retryable: false });
const later = <T,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

beforeEach(() => {
  translate.mockReset();
  cancel.mockClear();
  setPrefs.mockReset();
  useTranslation.getState().reset();
  cancel.mockClear();
  setTranslationPrefs({ enabled: true, autoOnSelect: true });
});

describe('what a selection does by the consent', () => {
  it('asks first while the choice is not made, and sends nothing', () => {
    setTranslationPrefs({ enabled: null });
    useTranslation.getState().select('Attention is all you need.');
    expect(useTranslation.getState().view).toEqual({ kind: 'consent' });
    expect(useTranslation.getState().source).toBe('Attention is all you need.');
    expect(translate).not.toHaveBeenCalled();
  });
  it('is off while switched off: no popup state, no request', () => {
    setTranslationPrefs({ enabled: false });
    useTranslation.getState().select('x');
    expect(useTranslation.getState().view).toEqual({ kind: 'off' });
    expect(translate).not.toHaveBeenCalled();
  });
  it('translates at once with 선택하면 번역, and only waits for the button without it', async () => {
    translate.mockResolvedValue(done('주의'));
    useTranslation.getState().select('Attention.');
    expect(useTranslation.getState().view).toEqual({ kind: 'pending' });
    await vi.waitFor(() => expect(useTranslation.getState().view.kind).toBe('done'));
    expect(translate).toHaveBeenCalledWith({ text: 'Attention.', from: 'auto', to: 'ko' });
    setTranslationPrefs({ enabled: true, autoOnSelect: false });
    translate.mockClear();
    useTranslation.getState().select('Another.');
    expect(useTranslation.getState().view).toEqual({ kind: 'idle' });
    expect(translate).not.toHaveBeenCalled();
    translate.mockResolvedValue(done('또 하나'));
    await useTranslation.getState().translate();
    expect(useTranslation.getState().view).toMatchObject({ kind: 'done', text: '또 하나' });
  });
  it('refuses a text over 5,000 characters without a request', () => {
    translate.mockResolvedValue(done('t'));
    useTranslation.getState().select('a'.repeat(5001));
    expect(useTranslation.getState().view).toEqual({ kind: 'tooLong' });
    expect(translate).not.toHaveBeenCalled();
    useTranslation.getState().select('a'.repeat(5000));
    expect(useTranslation.getState().view).toEqual({ kind: 'pending' });
  });
  it('carries what the engine says about the language', async () => {
    translate.mockResolvedValue(done('이미', { sameLanguage: true, detectedFrom: 'ko', cached: true }));
    useTranslation.getState().select('이미 한국어입니다.');
    await vi.waitFor(() => expect(useTranslation.getState().view.kind).toBe('done'));
    expect(useTranslation.getState().view).toEqual({ kind: 'done', text: '이미', detectedFrom: 'ko', cached: true, sameLanguage: true });
  });
});

describe('이어 붙이기', () => {
  it('adds the new selection under the source; without it the selection replaces the source', async () => {
    translate.mockResolvedValue(done('t'));
    const s = useTranslation.getState();
    s.select('First.');
    s.setConcat(true);
    s.select('Second.');
    expect(useTranslation.getState().source).toBe('First.\nSecond.');
    await vi.waitFor(() => expect(translate).toHaveBeenLastCalledWith({ text: 'First.\nSecond.', from: 'auto', to: 'ko' }));
    useTranslation.getState().setConcat(false);
    useTranslation.getState().select('Third.');
    expect(useTranslation.getState().source).toBe('Third.');
  });
  it('starts the source without a blank first line', () => {
    translate.mockResolvedValue(done('t'));
    useTranslation.getState().setConcat(true);
    useTranslation.getState().select('Only.');
    expect(useTranslation.getState().source).toBe('Only.');
  });
});

describe('errors', () => {
  it.each([
    ['TRANSLATION_OFFLINE', ERROR_COPY.translationOffline],
    ['TRANSLATION_RATE_LIMITED', ERROR_COPY.translationRateLimited],
    ['TRANSLATION_BLOCKED', ERROR_COPY.translationBlocked],
    ['TRANSLATION_UNAVAILABLE', ERROR_COPY.translationUnavailable],
    ['TRANSLATION_BAD_RESPONSE', ERROR_COPY.translationBadResponse],
  ] as const)('%s is said in its own words', async (code, message) => {
    translate.mockResolvedValue(failed(code, 'ignored'));
    useTranslation.getState().select('x');
    await vi.waitFor(() => expect(useTranslation.getState().view.kind).toBe('error'));
    expect(useTranslation.getState().view).toEqual({ kind: 'error', code, message });
  });
  it('a refusal by length from main is the too-long state', async () => {
    translate.mockResolvedValue(failed('TRANSLATION_TOO_LONG', ERROR_COPY.translationTooLong));
    useTranslation.getState().select('x');
    await vi.waitFor(() => expect(useTranslation.getState().view).toEqual({ kind: 'tooLong' }));
  });
  it('sends nothing by itself after a failure; the retry is the user', async () => {
    translate.mockResolvedValue(failed('TRANSLATION_OFFLINE', ERROR_COPY.translationOffline));
    useTranslation.getState().select('x');
    await vi.waitFor(() => expect(useTranslation.getState().view.kind).toBe('error'));
    expect(translate).toHaveBeenCalledTimes(1);
    translate.mockResolvedValue(done('성공'));
    await useTranslation.getState().translate();
    expect(translate).toHaveBeenCalledTimes(2);
    expect(useTranslation.getState().view).toMatchObject({ kind: 'done', text: '성공' });
  });
  it('a cancelled request is never shown', async () => {
    translate.mockResolvedValue(failed('CANCELLED', ERROR_COPY.translationCancelled));
    useTranslation.getState().select('x');
    await vi.waitFor(() => expect(useTranslation.getState().view.kind).not.toBe('pending'));
    expect(useTranslation.getState().view).toEqual({ kind: 'idle' });
  });
});

describe('the newest selection wins (R-5)', () => {
  it('a reply for a request that is no longer current never changes the view', async () => {
    const first = later<Result<TranslationResult>>();
    const second = later<Result<TranslationResult>>();
    translate.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    useTranslation.getState().select('One.');
    useTranslation.getState().select('Two.');
    second.resolve(done('둘'));
    await vi.waitFor(() => expect(useTranslation.getState().view).toMatchObject({ kind: 'done', text: '둘' }));
    first.resolve(done('하나'));
    await new Promise((r) => setTimeout(r, 0));
    expect(useTranslation.getState().view).toMatchObject({ kind: 'done', text: '둘' });
    // A late failure of the old one is as silent.
    const old = later<Result<TranslationResult>>();
    translate.mockReturnValueOnce(old.promise);
    const pending = useTranslation.getState().translate();
    translate.mockResolvedValue(done('셋'));
    useTranslation.getState().select('Three.');
    old.resolve(failed('TRANSLATION_OFFLINE', ERROR_COPY.translationOffline));
    await pending;
    await vi.waitFor(() => expect(useTranslation.getState().view).toMatchObject({ kind: 'done', text: '셋' }));
  });
  it('a selection that does not translate cancels the one in flight, and its reply is dropped', async () => {
    const first = later<Result<TranslationResult>>();
    translate.mockReturnValueOnce(first.promise);
    useTranslation.getState().select('One.');
    setTranslationPrefs({ enabled: null });
    useTranslation.getState().select('Two.');
    expect(cancel).toHaveBeenCalled();
    first.resolve(done('하나'));
    await new Promise((r) => setTimeout(r, 0));
    expect(useTranslation.getState().view).toEqual({ kind: 'consent' });
  });
});

describe('clear and reset', () => {
  it('reset cancels a request in flight and no late reply writes into the reset store', async () => {
    const first = later<Result<TranslationResult>>();
    translate.mockReturnValueOnce(first.promise);
    useTranslation.getState().select('One.');
    useTranslation.getState().reset();
    expect(cancel).toHaveBeenCalledTimes(1);
    first.resolve(done('하나'));
    await new Promise((r) => setTimeout(r, 0));
    expect(useTranslation.getState()).toMatchObject({ source: '', view: { kind: 'idle' }, concat: false });
  });
  it('reset with nothing in flight asks main for nothing', () => {
    useTranslation.getState().reset();
    expect(cancel).not.toHaveBeenCalled();
  });
  it('clear empties both boxes and keeps 이어 붙이기', () => {
    translate.mockResolvedValue(done('t'));
    useTranslation.getState().setConcat(true);
    useTranslation.getState().select('x');
    useTranslation.getState().clear();
    expect(useTranslation.getState()).toMatchObject({ source: '', view: { kind: 'idle' }, concat: true });
  });
});

describe('consent buttons', () => {
  it('번역 켜기 saves the choice with the rest of the object and translates the selection', async () => {
    setTranslationPrefs({ enabled: null, to: 'ja' });
    setPrefs.mockImplementation(async (patch) => ({ ok: true, data: { ...DEFAULT_PREFS, ...patch } as Prefs }));
    translate.mockResolvedValue(done('t'));
    useTranslation.getState().select('x');
    await useTranslation.getState().enable();
    expect(setPrefs).toHaveBeenCalledWith({ translation: { ...DEFAULT_PREFS.translation, enabled: true, to: 'ja' } });
    expect(translate).toHaveBeenCalledWith({ text: 'x', from: 'auto', to: 'ja' });
  });
  it('사용 안 함 saves false and sends nothing', async () => {
    setTranslationPrefs({ enabled: null });
    setPrefs.mockImplementation(async (patch) => ({ ok: true, data: { ...DEFAULT_PREFS, ...patch } as Prefs }));
    useTranslation.getState().select('x');
    await useTranslation.getState().decline();
    expect(setPrefs).toHaveBeenCalledWith({ translation: { ...DEFAULT_PREFS.translation, enabled: false } });
    expect(useTranslation.getState().view).toEqual({ kind: 'off' });
    expect(translate).not.toHaveBeenCalled();
  });
});
