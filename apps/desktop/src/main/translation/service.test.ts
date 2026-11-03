import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFS, type Prefs } from '@learn/domain';
import type { CachedTranslation } from '@learn/db';
import { createFakeEngine } from './fake';
import { createTranslationService } from './service';

const prefsOn = (enabled: boolean | null): Prefs => ({ ...DEFAULT_PREFS, translation: { ...DEFAULT_PREFS.translation, enabled } });
function setup(enabled: boolean | null = true) {
  const rows = new Map<string, CachedTranslation>();
  const engine = createFakeEngine();
  const service = createTranslationService({
    engine,
    cache: () => ({ get: (key: string) => rows.get(key), put: (e: CachedTranslation) => void rows.set(e.key, e) }) as never,
    prefs: () => prefsOn(enabled),
    now: () => '2026-11-03T00:00:00.000Z',
  });
  return { engine, service, rows };
}
const input = { text: 'Attention is all you need.', from: 'auto', to: 'ko' } as const;

describe('the translation service', () => {
  it.each([null, false])('asks nothing while the switch is %s', async (enabled) => {
    const { engine, service } = setup(enabled);
    await expect(service.translate(input)).rejects.toMatchObject({ code: 'TRANSLATION_DISABLED' });
    expect(engine.calls()).toBe(0);
  });
  it('refuses empty and too long text', async () => {
    const { engine, service } = setup();
    await expect(service.translate({ ...input, text: ' \n ' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(service.translate({ ...input, text: 'a'.repeat(5001) })).rejects.toMatchObject({ code: 'TRANSLATION_TOO_LONG' });
    await expect(service.translate({ ...input, text: 'a'.repeat(5000) })).resolves.toBeDefined();
    expect(engine.calls()).toBe(1);
  });
  it('answers Korean into Korean without a request', async () => {
    const { engine, service } = setup();
    expect(await service.translate({ ...input, text: '주의 메커니즘은\n중요합니다.' })).toEqual({
      text: '주의 메커니즘은 중요합니다.', detectedFrom: 'ko', engine: 'fake', cached: false, sameLanguage: true,
    });
    expect(engine.calls()).toBe(0);
  });
  it('translates, then answers the same text from the cache', async () => {
    const { engine, service, rows } = setup();
    expect(await service.translate(input)).toEqual({ text: '주의가 필요한 전부입니다.', detectedFrom: 'en', engine: 'fake', cached: false, sameLanguage: false });
    expect(rows.size).toBe(1);
    const second = await service.translate({ ...input, text: 'Attention is\nall you need.' }); // same after preparation
    expect(second).toEqual({ text: '주의가 필요한 전부입니다.', detectedFrom: 'en', engine: 'fake', cached: true, sameLanguage: false });
    expect(engine.calls()).toBe(1);
    await service.translate({ ...input, to: 'ja' });
    expect(engine.calls()).toBe(2); // another target is another key
  });
  it('flags a text that is already in the target language when the engine detects it', async () => {
    const { service } = setup();
    expect(await service.translate({ text: 'Hello there.', from: 'auto', to: 'en' })).toMatchObject({ sameLanguage: true });
  });
  it('does not cache a failure', async () => {
    const { engine, service, rows } = setup();
    engine.setMode('offline');
    await expect(service.translate(input)).rejects.toMatchObject({ code: 'TRANSLATION_OFFLINE' });
    expect(rows.size).toBe(0);
    engine.setMode('ok');
    await expect(service.translate(input)).resolves.toMatchObject({ cached: false });
  });
  it('a request answered from the cache or without the engine still cancels the one in flight', async () => {
    const { engine, service } = setup();
    await service.translate(input); // cached
    engine.setMode('slow');
    const slow = service.translate({ ...input, text: 'Another one.' }).catch((e: unknown) => e);
    const calls = engine.calls();
    expect(await service.translate(input)).toMatchObject({ cached: true });
    expect(await slow).toMatchObject({ code: 'CANCELLED' });
    const slow2 = service.translate({ ...input, text: 'Third one.' }).catch((e: unknown) => e);
    expect(await service.translate({ ...input, text: '안녕하세요.' })).toMatchObject({ sameLanguage: true });
    expect(await slow2).toMatchObject({ code: 'CANCELLED' });
    expect(engine.calls()).toBe(calls + 1);
  });
  it('a new request cancels the one before it; cancel() stops the current one', async () => {
    const { engine, service, rows } = setup();
    engine.setMode('slow');
    const first = service.translate(input);
    const firstOutcome = first.catch((e: unknown) => e);
    engine.setMode('ok');
    const second = await service.translate({ ...input, text: 'We propose a new simple network architecture.' });
    expect(second.text).toBe('우리는 새롭고 간단한 네트워크 아키텍처를 제안합니다.');
    expect(await firstOutcome).toMatchObject({ code: 'CANCELLED' });
    expect(rows.size).toBe(1);

    engine.setMode('slow');
    const third = service.translate({ ...input, text: 'Another one.' });
    const thirdOutcome = third.catch((e: unknown) => e);
    service.cancel();
    expect(await thirdOutcome).toMatchObject({ code: 'CANCELLED' });
    expect(rows.size).toBe(1);
  });
});
