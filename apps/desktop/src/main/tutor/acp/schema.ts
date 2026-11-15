import { z } from 'zod';

/*
 * Incoming messages are checked only for the fields Learn reads. Each is a plain z.object, which drops an unknown key
 * instead of refusing it — an adapter's new fields and its _meta are not errors — and, unlike z.looseObject, does not
 * keep it either: the login label (an email and a plan) and the rate-limit _meta never live past the parse. The two
 * _meta paths Learn reads are declared, so they stay.
 */

const sessionId = z.string().min(1).max(256);
const rpcId = z.union([z.number(), z.string().min(1).max(256)]);

const envelope = z.object({
  jsonrpc: z.literal('2.0'),
  // null only in an error answer to a request the agent could not read; the peer drops it like an unknown id.
  id: z.union([rpcId, z.null()]).optional(),
  method: z.string().optional(),
  params: z.unknown().optional(),
  result: z.unknown().optional(),
  error: z.object({ code: z.number().int(), message: z.string().optional(), data: z.unknown().optional() }).optional(),
});

const initializeResult = z.object({
  protocolVersion: z.number().int(),
  agentCapabilities: z.object({
    loadSession: z.boolean().nullish(),
    mcpCapabilities: z.object({ http: z.boolean().nullish() }).nullish(),
    promptCapabilities: z.object({ image: z.boolean().nullish() }).nullish(),
    sessionCapabilities: z.object({ resume: z.object({}).nullish() }).nullish(),
  }).nullish(),
});

const newSessionResult = z.object({ sessionId });

// Usage and model usage are display-only: a field of the wrong type reads as absent (.catch), never as a protocol error.
const tokens = z.number().int().min(0).nullish().catch(null);
/** Claude's model_usage entry: token_count is an object whose totalTokens ranks the models; any other shape drops the entry. */
const modelUsage = z.object({ model: z.string(), token_count: z.object({ totalTokens: z.number().int().min(0) }) }).nullable().catch(null);
const promptResult = z.object({
  stopReason: z.string().min(1).max(64),
  // Not part of ACP v1's result, but both adapters put it here; null when a turn failed offline.
  usage: z.object({ inputTokens: tokens, outputTokens: tokens }).nullish().catch(null),
  _meta: z.object({
    quota: z.object({ model_usage: z.array(modelUsage).nullish().catch(null) }).nullish().catch(null),
  }).nullish().catch(null),
});

const sessionUpdate = z.object({
  sessionId,
  // Kept whole: the client reads it again with the schema of its kind, which drops the rest.
  update: z.looseObject({ sessionUpdate: z.string() }),
});

const messageChunk = z.object({
  sessionUpdate: z.literal('agent_message_chunk'),
  content: z.object({ type: z.string(), text: z.string().optional() })
    .refine((c) => c.type !== 'text' || c.text !== undefined, { message: 'a text block has its text' }),
});

const toolCall = z.object({
  sessionUpdate: z.enum(['tool_call', 'tool_call_update']),
  toolCallId: z.string().min(1),
  title: z.string().nullish(),
  kind: z.string().nullish(),
  rawInput: z.unknown().optional(),
  _meta: z.object({ claudeCode: z.object({ toolName: z.string().nullish() }).nullish() }).nullish(),
});

const permissionRequest = z.object({
  sessionId,
  options: z.array(z.object({ optionId: z.string(), kind: z.string() })),
});

const authStatus = z.object({ authStatus: z.object({ kind: z.string() }) });

export const acpIn = { envelope, initializeResult, newSessionResult, promptResult, sessionUpdate, messageChunk, toolCall, permissionRequest, authStatus };

export const ACP_STOP_REASONS = ['end_turn', 'max_tokens', 'max_turn_requests', 'refusal', 'cancelled'] as const;
export type AcpStopReason = (typeof ACP_STOP_REASONS)[number];

/** Whether initialize announced session/resume: agentCapabilities.sessionCapabilities.resume. */
export function resumeCapable(result: z.output<typeof acpIn.initializeResult>): boolean {
  return result.agentCapabilities?.sessionCapabilities?.resume != null;
}

const textBlock = z.object({ type: z.literal('text'), text: z.string() }).strict();
const systemPrompt = z.object({ mode: z.literal('append'), content: z.array(textBlock).min(1) }).strict();
const meta = z.record(z.string(), z.unknown());
/** ACP v1's HTTP MCP server entry: Learn's own loopback server, reached with one ACP session's Bearer token. */
const mcpServer = z.object({
  type: z.literal('http'),
  name: z.literal('learn'),
  url: z.string().regex(/^http:\/\/127\.0\.0\.1:\d{1,5}\/mcp$/),
  headers: z.tuple([z.object({ name: z.literal('Authorization'), value: z.string().regex(/^Bearer [0-9a-f]{64}$/) }).strict()]),
}).strict();
const sessionSetup = {
  cwd: z.string().min(1),
  // Learn's server or none (the login check): an agent is never handed another one.
  mcpServers: z.array(mcpServer).max(1),
  systemPrompt: systemPrompt.optional(),
  _meta: meta.optional(),
};

export const acpOut = {
  initializeParams: z.object({
    protocolVersion: z.literal(1),
    // Learn never offers the agent its files or a terminal.
    clientCapabilities: z.object({
      fs: z.object({ readTextFile: z.literal(false), writeTextFile: z.literal(false) }).strict(),
      terminal: z.literal(false),
    }).strict(),
    clientInfo: z.object({ name: z.literal('Learn'), version: z.string().min(1).max(64) }).strict(),
  }).strict(),
  mcpServer,
  newSessionParams: z.object(sessionSetup).strict(),
  resumeParams: z.object({ sessionId, ...sessionSetup }).strict(),
  setModeParams: z.object({ sessionId, modeId: z.literal('default') }).strict(),
  promptParams: z.object({ sessionId, prompt: z.array(textBlock).min(1) }).strict(),
  cancelParams: z.object({ sessionId }).strict(),
  permissionResult: z.object({
    outcome: z.discriminatedUnion('outcome', [
      z.object({ outcome: z.literal('selected'), optionId: z.string() }).strict(),
      z.object({ outcome: z.literal('cancelled') }).strict(),
    ]),
  }).strict(),
  errorReply: z.object({ code: z.number().int(), message: z.string(), data: z.unknown().optional() }).strict(),
};
