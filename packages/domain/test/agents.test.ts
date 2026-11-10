import { describe, expect, it } from 'vitest';
import { AGENT_IDS, SPIKE_FACTS, TUTOR_AGENT_IDS, agentIdSchema } from '../src/agents';

describe('agents', () => {
  it('names Claude Code and the dev-only fake, and nothing else', () => {
    expect(agentIdSchema.safeParse('claude').success).toBe(true);
    expect(agentIdSchema.safeParse('fake').success).toBe(true);
    expect(agentIdSchema.safeParse('codex').success).toBe(false);
    expect(agentIdSchema.safeParse('gemini').success).toBe(false);
    expect([...AGENT_IDS]).toEqual(['claude']);
    expect([...TUTOR_AGENT_IDS]).toEqual(['claude', 'fake']);
  });
  it('keeps the two spike facts the screens depend on', () => {
    expect(Object.keys(SPIKE_FACTS).sort()).toEqual(['historyLine', 'separateLogin']);
  });
});
