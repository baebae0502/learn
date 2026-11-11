import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, type Page } from '@playwright/test';
import type { AgentId } from '../../packages/domain/src/agents';
import type { MessageView, TutorAskAnswer, TutorAskInput } from '../../packages/domain/src/tutor';
import type { FakeScript } from '../../apps/desktop/src/main/tutor/fake-agent/fake-agent';
import { ROOT } from './helpers';

/** The fake agent as the unpackaged build has it (pnpm build). */
const FAKE_ENTRY = path.join(ROOT, 'apps/desktop/out/main/fake-agent.js');
const ADAPTER = '@agentclientprotocol/claude-agent-acp';

/**
 * An npm global install in Claude Code's shape, in `dir`: `bin/claude` prints `cli` as its version (none when null), and the
 * connection tool's package (version `adapter`; none when null) whose `dist/index.js` the `bin/claude-agent-acp` link points
 * at. That entry runs the fake agent as Claude: the isolated environment Learn gives an agent drops LEARN_FAKE_*, so the
 * entry carries the script and the log path in its own text and sets them before it imports the fake. Returns the bin
 * folder (LEARN_AGENT_SEARCH_PATH).
 */
export function installFakeAgents(dir: string, layout: { cli: string | null; adapter: string | null; script?: FakeScript; log?: string }): string {
  if (!fs.existsSync(FAKE_ENTRY)) throw new Error(`installFakeAgents: ${FAKE_ENTRY} is missing — run \`pnpm build\``);
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  if (layout.cli !== null) fs.writeFileSync(path.join(bin, 'claude'), `#!/bin/sh\necho "${layout.cli} (Claude Code)"\n`, { mode: 0o755 });
  if (layout.adapter !== null) {
    const pkg = path.join(dir, 'lib', 'node_modules', ...ADAPTER.split('/'));
    fs.mkdirSync(path.join(pkg, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: ADAPTER, version: layout.adapter, type: 'module', bin: { 'claude-agent-acp': 'dist/index.js' } }));
    fs.writeFileSync(path.join(pkg, 'dist', 'index.js'), [
      `process.env.LEARN_FAKE_AGENT_AS = 'claude';`,
      `process.env.LEARN_FAKE_AGENT_SCRIPT = ${JSON.stringify(layout.script ?? 'answer')};`,
      ...(layout.log === undefined ? [] : [`process.env.LEARN_FAKE_AGENT_LOG = ${JSON.stringify(layout.log)};`]),
      `await import(${JSON.stringify(pathToFileURL(FAKE_ENTRY).href)});`,
      '',
    ].join('\n'));
    fs.symlinkSync(path.join('..', 'lib', 'node_modules', ...ADAPTER.split('/'), 'dist', 'index.js'), path.join(bin, 'claude-agent-acp'));
  }
  return bin;
}

/** 동의, then the agent chosen — through window.learn.tutor, as the screens will call it; the agent must be ready. */
export async function consentAndChoose(page: Page, agent: AgentId): Promise<void> {
  expect(await page.evaluate(() => window.learn.tutor.consent({ grant: true }))).toMatchObject({ ok: true });
  const report = await page.evaluate(() => window.learn.tutor.agents({ mode: 'cached' }));
  if (!report.ok) throw new Error(`tutor.agents: ${report.code}`);
  const status = agent === 'fake' ? report.data.fake : report.data.agents.find((a) => a.id === agent);
  expect(status, `${agent} in the report`).toMatchObject({ state: 'ready' });
  expect(await page.evaluate((a) => window.learn.tutor.chooseAgent({ agent: a }), agent)).toMatchObject({ ok: true });
}

/** tutor:ask as the composer sends it; a refusal fails the test with its code. */
export async function askViaApi(page: Page, input: TutorAskInput): Promise<TutorAskAnswer> {
  const r = await page.evaluate((i) => window.learn.tutor.ask(i), input);
  if (!r.ok) throw new Error(`tutor.ask: ${r.code}`);
  return r.data;
}

/** The answer once it has ended (complete, failed or stopped), as sessions.get reads it. */
export async function turnEnded(page: Page, conversationId: string, tutorMessageId: string, opts: { timeout?: number } = {}): Promise<MessageView> {
  let last: MessageView | undefined;
  await expect
    .poll(
      async () => {
        const r = await page.evaluate((id) => window.learn.sessions.get({ conversationId: id }), conversationId);
        if (!r.ok) return `sessions.get: ${r.code}`;
        last = r.data.messages.find((m) => m.id === tutorMessageId);
        return last?.status ?? 'no such answer';
      },
      { message: `the answer ${tutorMessageId} ended`, timeout: opts.timeout ?? 60_000 },
    )
    .toMatch(/^(complete|failed|stopped)$/);
  return last!;
}

/** paper-100.pdf as the reader resolves it: on page 1, 100 pages, its outline of 10 chapters × 3 sections × 2 subsections. */
export const READER_100: TutorAskInput['reader'] = {
  pageIndex: 0,
  pageCount: 100,
  outline: Array.from({ length: 10 }, (_, c) => [
    { title: `Chapter ${c + 1}`, depth: 0, pageIndex: c * 10 },
    ...Array.from({ length: 3 }, (_, s) => [
      { title: `${c + 1}.${s + 1} Section`, depth: 1, pageIndex: c * 10 + s * 3 },
      ...[0, 1].map((u) => ({ title: `${c + 1}.${s + 1}.${u + 1} Subsection`, depth: 2, pageIndex: c * 10 + s * 3 + u })),
    ]).flat(),
  ]).flat(),
  outlineComplete: true,
  outlineTotal: 100,
};
