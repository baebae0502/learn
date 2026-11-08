import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { TEXT_LIMITS } from '@learn/domain';
import { createTextExtractor, type ExtractEvents, type ExtractOutcome, type WorkerPort } from './extractor';
import type { ExtractRequest, WorkerMessage } from './messages';

const limits = { maxPages: 5000, maxPageChars: 100_000, maxDocChars: 10_000_000, maxFileBytes: 1 << 20 };

class FakePort implements WorkerPort {
  pid = 1;
  killed = false;
  requests: ExtractRequest[] = [];
  #msg: Array<(m: unknown) => void> = [];
  #exit: Array<(c: number) => void> = [];
  postMessage(m: ExtractRequest): void {
    this.requests.push(m);
  }
  kill(): boolean {
    this.killed = true;
    return true;
  }
  onMessage(fn: (m: unknown) => void): void {
    this.#msg.push(fn);
  }
  onExit(fn: (code: number) => void): void {
    this.#exit.push(fn);
  }
  send(m: WorkerMessage | unknown): void {
    for (const fn of this.#msg) fn(m);
  }
  exit(code: number): void {
    for (const fn of this.#exit) fn(code);
  }
  get jobId(): string {
    return this.requests[this.requests.length - 1]!.jobId;
  }
}

function setup(timing?: Parameters<typeof createTextExtractor>[0]['timing']) {
  const ports: FakePort[] = [];
  const timers = new Map<number, { fn: () => void; ms: number }>();
  let next = 1;
  const ex = createTextExtractor({
    fork: () => {
      const p = new FakePort();
      p.pid = ports.length + 1;
      ports.push(p);
      return p;
    },
    timing,
    setTimer: (fn, ms) => {
      timers.set(next, { fn, ms });
      return next++;
    },
    clearTimer: (id) => void timers.delete(id as number),
  });
  const fire = (ms: number): boolean => {
    const hit = [...timers.entries()].find(([, t]) => t.ms === ms);
    if (!hit) return false;
    timers.delete(hit[0]);
    hit[1].fn();
    return true;
  };
  return { ex, ports, timers, fire };
}
const req = () => ({ jobId: randomUUID(), file: '/x.pdf', startPage: 0, limits, assetsDir: '/a' });
const events = (over: Partial<ExtractEvents> = {}): ExtractEvents => ({ opened: () => {}, pages: () => true, ...over });
const tick = () => new Promise((r) => setImmediate(r));
async function finishJob(p: FakePort, pages = 1): Promise<void> {
  p.send({ type: 'opened', jobId: p.jobId, pages });
  p.send({ type: 'done', jobId: p.jobId, pages, truncated: false });
}

describe('text extractor', () => {
  it('runs two jobs on one worker, sends the request and reports the batches in order', async () => {
    const { ex, ports } = setup();
    const seen: string[] = [];
    const a = ex.run(req(), events({ opened: (n) => seen.push(`opened ${n}`), pages: (from, t) => (seen.push(`pages ${from}+${t.length}`), true) }));
    const p = ports[0]!;
    expect(p.requests[0]).toMatchObject({ type: 'extract', file: '/x.pdf' });
    p.send({ type: 'opened', jobId: p.jobId, pages: 3 });
    p.send({ type: 'pages', jobId: p.jobId, from: 0, texts: ['a', 'b'] });
    p.send({ type: 'pages', jobId: p.jobId, from: 2, texts: ['c'] });
    p.send({ type: 'done', jobId: p.jobId, pages: 3, truncated: false });
    expect(await a).toEqual({ kind: 'done', pages: 3, truncated: false });
    expect(seen).toEqual(['opened 3', 'pages 0+2', 'pages 2+1']);
    const b = ex.run(req(), events());
    await finishJob(p);
    expect((await b).kind).toBe('done');
    expect(ports).toHaveLength(1);
    expect(p.requests).toHaveLength(2);
  });

  it('forks a new worker after fifty jobs', async () => {
    const { ex, ports } = setup();
    for (let i = 0; i < TEXT_LIMITS.restartEvery; i++) {
      const r = ex.run(req(), events());
      await finishJob(ports[0]!);
      expect((await r).kind).toBe('done');
    }
    expect(ports).toHaveLength(1);
    expect(ports[0]!.killed).toBe(true);
    const r = ex.run(req(), events());
    expect(ports).toHaveLength(2);
    await finishJob(ports[1]!);
    await r;
  });

  it('kills a worker silent for the message gap, reports timeout and forks anew', async () => {
    const { ex, ports, fire } = setup();
    const r = ex.run(req(), events());
    expect(fire(TEXT_LIMITS.messageGapMs)).toBe(true);
    expect(await r).toEqual({ kind: 'timeout' });
    expect(ports[0]!.killed).toBe(true);
    const r2 = ex.run(req(), events());
    expect(ports).toHaveLength(2);
    await finishJob(ports[1]!);
    expect((await r2).kind).toBe('done');
  });

  it('does not count the gap while a handler holds a batch (and does once it lets go)', async () => {
    const { ex, ports, fire, timers } = setup();
    let release: (v: boolean) => void = () => {};
    const r = ex.run(req(), events({ pages: () => new Promise<boolean>((res) => (release = res)) }));
    const p = ports[0]!;
    p.send({ type: 'opened', jobId: p.jobId, pages: 2 });
    p.send({ type: 'pages', jobId: p.jobId, from: 0, texts: ['a'] });
    await tick();
    expect(fire(TEXT_LIMITS.messageGapMs)).toBe(false);
    expect(p.killed).toBe(false);
    release(true);
    await tick();
    expect([...timers.values()].some((t) => t.ms === TEXT_LIMITS.messageGapMs)).toBe(true); // control: idle handler, clock runs
    expect(fire(TEXT_LIMITS.messageGapMs)).toBe(true);
    expect(await r).toEqual({ kind: 'timeout' });
  });

  it('kills a job that runs past the job limit', async () => {
    const { ex, ports, fire } = setup();
    const r = ex.run(req(), events());
    ports[0]!.send({ type: 'opened', jobId: ports[0]!.jobId, pages: 2 });
    expect(fire(TEXT_LIMITS.jobMs)).toBe(true);
    expect(await r).toEqual({ kind: 'timeout' });
    expect(ports[0]!.killed).toBe(true);
  });

  it('reports a crash on a non-zero exit, and on an exit before done', async () => {
    const a = setup();
    const r = a.ex.run(req(), events());
    a.ports[0]!.exit(1);
    expect(await r).toEqual({ kind: 'crashed' });
    const b = setup();
    const r2 = b.ex.run(req(), events());
    b.ports[0]!.exit(0);
    expect(await r2).toEqual({ kind: 'crashed' });
    const r3 = b.ex.run(req(), events());
    expect(b.ports).toHaveLength(2);
    await finishJob(b.ports[1]!);
    expect((await r3).kind).toBe('done');
  });

  it('still hands on a done that arrived before the exit', async () => {
    const { ex, ports } = setup();
    const r = ex.run(req(), events());
    await finishJob(ports[0]!);
    ports[0]!.exit(0);
    expect((await r).kind).toBe('done');
  });

  it('kills on a bad message', async () => {
    const { ex, ports } = setup();
    const r = ex.run(req(), events());
    ports[0]!.send({ type: 'pages', jobId: ports[0]!.jobId, from: 0, texts: ['a'] }); // before opened
    expect(await r).toEqual({ kind: 'bad-message' });
    expect(ports[0]!.killed).toBe(true);
    const r2 = ex.run(req(), events());
    ports[1]!.send({ type: 'opened', jobId: randomUUID(), pages: 1 }); // another job
    expect(await r2).toEqual({ kind: 'bad-message' });
  });

  it('stops when the pages handler says false', async () => {
    const { ex, ports } = setup();
    const r = ex.run(req(), events({ pages: () => false }));
    const p = ports[0]!;
    p.send({ type: 'opened', jobId: p.jobId, pages: 2 });
    p.send({ type: 'pages', jobId: p.jobId, from: 0, texts: ['a'] });
    p.send({ type: 'pages', jobId: p.jobId, from: 1, texts: ['b'] });
    expect(await r).toEqual({ kind: 'stopped' });
    expect(p.killed).toBe(true);
  });

  it('keeps the order when the handler is asynchronous', async () => {
    const { ex, ports } = setup();
    const log: string[] = [];
    const r = ex.run(req(), events({
      pages: async (from) => {
        log.push(`start ${from}`);
        await new Promise((res) => setTimeout(res, from === 0 ? 20 : 0));
        log.push(`end ${from}`);
        return true;
      },
    }));
    const p = ports[0]!;
    p.send({ type: 'opened', jobId: p.jobId, pages: 2 });
    p.send({ type: 'pages', jobId: p.jobId, from: 0, texts: ['a'] });
    p.send({ type: 'pages', jobId: p.jobId, from: 1, texts: ['b'] });
    p.send({ type: 'done', jobId: p.jobId, pages: 2, truncated: false });
    expect((await r).kind).toBe('done');
    expect(log).toEqual(['start 0', 'end 0', 'start 1', 'end 1']);
  });

  it('stop() kills the worker and the running job ends stopped; dispose() likewise', async () => {
    const a = setup();
    const r = a.ex.run(req(), events());
    a.ex.stop();
    expect(await r).toEqual({ kind: 'stopped' });
    expect(a.ports[0]!.killed).toBe(true);
    const b = setup();
    const r2 = b.ex.run(req(), events());
    b.ex.dispose();
    expect(await r2).toEqual({ kind: 'stopped' });
    expect(b.ports[0]!.killed).toBe(true);
  });

  it('takes the worker down after the idle time, not before', async () => {
    const { ex, ports, fire } = setup();
    const r = ex.run(req(), events());
    await finishJob(ports[0]!);
    await r;
    expect(ports[0]!.killed).toBe(false);
    expect(fire(TEXT_LIMITS.idleMs)).toBe(true);
    expect(ports[0]!.killed).toBe(true);
    const r2 = ex.run(req(), events());
    expect(ports).toHaveLength(2);
    await finishJob(ports[1]!);
    await r2;
  });

  it('forks anew after a failed document', async () => {
    const { ex, ports } = setup();
    const r = ex.run(req(), events());
    ports[0]!.send({ type: 'failed', jobId: ports[0]!.jobId, reason: 'locked' });
    const out: ExtractOutcome = await r;
    expect(out).toEqual({ kind: 'failed', reason: 'locked' });
    const r2 = ex.run(req(), events());
    expect(ports).toHaveLength(2);
    ex.stop();
    await r2;
  });
});
