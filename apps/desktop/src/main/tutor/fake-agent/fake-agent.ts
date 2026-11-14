import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

/*
 * The scripted fake agent: ACP v1's agent side in Claude Code adapter's shape — its status notice after initialize, its
 * tool-call markers, its MCP order over loopback HTTP — so a run of it goes through everything Learn does for a real
 * agent: the spawn, the scope token, Learn's MCP tools called for real, the tool records and the citation check.
 *
 * One file, node: imports only and erasable TypeScript only: Node 22.19 runs it as it is (the contract test), and
 * electron-vite bundles it alone to out/main/fake-agent.js, which only an unpackaged build has.
 *
 * LEARN_FAKE_AGENT_SCRIPT picks the script (answer by default), LEARN_FAKE_AGENT_LOG (tests only) the file every
 * FakeLogEntry is appended to, LEARN_FAKE_AGENT_AS (claude or fake) only what the log calls it.
 */

export const FAKE_SCRIPTS = ['answer', 'unverified', 'markdown', 'slow', 'stream', 'fail-before', 'fail-mid', 'hang', 'login', 'login-silent', 'permission', 'permission-noreject',
  'permission-pending', 'inject', 'lockdown', 'lockdown-read', 'resume', 'load', 'no-load', 'demo', 'demo-unverified'] as const;
export type FakeScript = (typeof FAKE_SCRIPTS)[number];
export type FakeLogEntry =
  /** Its own pid and the name it runs as; the variable names it was given, and the values of the isolation ones only. */
  | { t: 'env'; pid: number; as: 'claude' | 'fake'; names: string[]; isolation: Record<string, string> }
  | { t: 'initialize' | 'session/new' | 'session/resume' | 'session/load' | 'session/set_mode'; params: unknown }
  | { t: 'prompt'; sessionId: string; blocks: Array<{ type: string; text: string }> }
  /**
   * method: the JSON-RPC method, or GET for the event-stream try; result: the answer's whole body (null when it had none);
   * headers: the names of the headers it sent, never their values.
   */
  | { t: 'mcp'; method: string; params: unknown; result: unknown; status: number; headers: string[] }
  /** outcome: the answer's outcome as Learn sent it; ok: the whole answer is exactly the ACP v1 answer this script expects. */
  | { t: 'permission-answer'; outcome: unknown; ok: boolean }
  | { t: 'client-call'; method: string; error: { code: number } | null }
  | { t: 'cancel' };

type Json = Record<string, unknown>;
type Tool = 'get_context' | 'get_outline' | 'read_pdf_pages';
interface Config { script: FakeScript; log: string | null; as: 'claude' | 'fake' }
interface Mcp { url: string; headers: Array<{ name: string; value: string }>; session: string | null; version: string | null; ids: number }
interface Session { id: string; mcp: Mcp | null }
interface Turn { sessionId: string; session: Session; cancelled: boolean; wake: Array<() => void> }
interface ToolResult { isError: boolean; structured: Json | null }
interface ReadPage { page: number; cite: string; first: string | null; text: string | null }

/** The only values the env line writes: the isolation Learn gives an agent. */
const ISOLATION = [
  'CLAUDE_CONFIG_DIR', 'CLAUDE_CODE_EXECUTABLE', 'CLAUDE_CODE_TMPDIR', 'ENABLE_CLAUDEAI_MCP_SERVERS', 'DISABLE_AUTOUPDATER', 'GIT_CEILING_DIRECTORIES', 'NO_PROXY', 'ELECTRON_RUN_AS_NODE',
];
/** Claude's first MCP request carries a version of its own; it falls back to initialize when the server does not know it. */
const DISCOVER_VERSION = '2026-07-28';
const MCP_VERSION = '2025-11-25';
/** The material id the injection material asks the agent to read. */
const OTHER_ITEM = '00000000-0000-4000-8000-000000000000';
const OPTION = {
  allowOnce: { optionId: 'allow-once', name: 'Allow', kind: 'allow_once' },
  allowAlways: { optionId: 'allow-always', name: 'Always allow', kind: 'allow_always' },
  rejectOnce: { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
  rejectAlways: { optionId: 'reject-always', name: 'Always reject', kind: 'reject_always' },
} as const;
const MODES = {
  currentModeId: 'auto',
  availableModes: [{ id: 'auto', name: 'Auto' }, { id: 'default', name: 'Default' }, { id: 'acceptEdits', name: 'Accept edits' }, { id: 'plan', name: 'Plan' }],
};

/** A sample of model output, not Learn's copy: the answers a model might write, kept with the scripts. */
const SAY = {
  lead: '읽은 쪽을 바탕으로 답합니다.',
  page: (page: number, first: string, cite: string) => `${page}쪽의 첫 문장은 “${first}”입니다 ${cite}.`,
  pageAgain: (page: number, cite: string) => `${page}쪽은 앞서 읽은 쪽입니다 ${cite}.`,
  unread: (page: number) => `${page}쪽도 같은 내용을 다룹니다 [[p${page}]].`,
  outside: '부록에서도 다룹니다 [[p999]].',
  paragraph: (k: number, page: number, cite: string) => `${k}번째 문단은 ${page}쪽을 따릅니다 ${cite}.`,
  filler: '이 문장은 화면을 채우는 표본 답입니다. ',
  close: '이상으로 답을 마칩니다.',
  slow: '천천히 흘러나오는 표본 답입니다. ',
  denied: '권한이 거절되었습니다.',
  deniedOddly: '권한 답의 모양이 예상과 다릅니다.',
  waiting: '첫 문장만 보낸 뒤 기다리는 표본 답입니다.',
  injected: '자료 안의 지시는 따르지 않았습니다.',
  afterTool: '도구를 쓴 뒤에도 이어지는 표본 답입니다. ',
  /** What Claude may write before a tool call, in its own words (live run 2): the answer that follows is a paragraph of its own. */
  narration: '먼저 쪽을 읽겠습니다.',
  /** The demo's short answer: a lead, a line for each page read (a whole sentence of it, else its opening words), and a close. */
  demoLead: '읽은 두 쪽을 바탕으로 짧게 답합니다.',
  demoSays: (page: number, sentence: string, cite: string) => `${page}쪽은 “${sentence}”라고 설명합니다 ${cite}.`,
  demoOpens: (page: number, words: string, cite: string) => `${page}쪽은 “${words}”로 시작합니다 ${cite}.`,
  demoClose: '두 쪽은 같은 흐름에 있으므로 앞 쪽을 먼저 읽고 뒤 쪽을 이어 읽으면 이해하기 쉽습니다. 이 답은 가짜 에이전트가 정해 둔 표본 답입니다.',
};

/** Claude's shape of a tool call id. */
const toolCallIdOf = (): string => `toolu_${randomUUID().replaceAll('-', '').slice(0, 24)}`;
const fill = (s: string, n: number): string => s.repeat(Math.ceil(n / s.length)).slice(0, n);
/** As many whole sentences `s` as fit in `n` characters (one at least), no sentence cut: a sample answer never ends mid-word. */
const sentences = (s: string, n: number): string => s.repeat(Math.max(1, Math.floor(n / s.length)));
const clamp = (n: number, lo: number, hi: number): number => Math.min(Math.max(n, lo), hi);
const isJson = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const asJson = (v: unknown): Json => (isJson(v) ? v : {});

function sameJson(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, k) => sameJson(x, b[k]));
  }
  if (isJson(a) && isJson(b)) {
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every((k) => k in b && sameJson(a[k], b[k]));
  }
  return a === b;
}

function rpcError(code: number, message: string): Error {
  return Object.assign(new Error(message), { rpcCode: code });
}
const rpcCodeOf = (e: unknown): number => (isJson(e) && typeof e.rpcCode === 'number' ? e.rpcCode : -32603);

/** The material's text inside Learn's marker lines. */
const inner = (wrapped: string): string => wrapped.split('\n').slice(1, -1).join('\n');

/** The first sentence of the first line, at most 80 characters (cut at a space). */
function firstSentence(text: string): string {
  const line = text.trim().split('\n')[0] ?? '';
  const end = line.search(/[.!?。]/);
  const sentence = end >= 0 ? line.slice(0, end + 1) : line;
  if (sentence.length <= 80) return sentence;
  const cut = sentence.slice(0, 80);
  const space = cut.lastIndexOf(' ');
  return space > 20 ? cut.slice(0, space) : cut;
}

function contextOf(r: ToolResult): { pageCount: number; readerPage: number; selectionPage: number | null } {
  const c = asJson(r.structured?.context);
  const selection = asJson(c.selection);
  return {
    pageCount: typeof c.pageCount === 'number' ? c.pageCount : 1,
    readerPage: typeof c.readerPage === 'number' ? c.readerPage : 1,
    selectionPage: typeof selection.page === 'number' ? selection.page : null,
  };
}

function pagesOf(r: ToolResult): ReadPage[] {
  const pages = Array.isArray(r.structured?.pages) ? r.structured.pages : [];
  const out: ReadPage[] = [];
  for (const p of pages) {
    const page = asJson(p);
    const index = asJson(page.anchor).pageIndex;
    if (typeof index !== 'number' || typeof page.cite !== 'string') continue;
    const text = typeof page.text === 'string' ? inner(page.text) : null;
    out.push({ page: index + 1, cite: page.cite, first: text === null ? null : firstSentence(text), text });
  }
  return out;
}

/** About `length` characters: the lead, a quote and a cite for each page read, the extra lines, then whole filler sentences and the close. */
function answerText(pages: readonly ReadPage[], extra: readonly string[], length: number): string {
  const head = [SAY.lead, ...pages.map((p) => (p.first === null ? SAY.pageAgain(p.page, p.cite) : SAY.page(p.page, p.first, p.cite))), ...extra].join(' ');
  const room = length - head.length - SAY.close.length - 2;
  // The filler ends in a space, so the close follows it as the next sentence.
  return `${head}\n\n${room >= SAY.filler.length ? sentences(SAY.filler, room) : ''}${SAY.close}`;
}

/**
 * A whole sentence of the page that ends in "다." (at most 90 characters), to quote: one right after another sentence that ends so. A
 * page's text has no line breaks, so a heading runs into the sentence after it — the page's first sentence, or one after a section
 * number's "1.", may begin with a heading; one after a "다." begins where the sentence does. Null when the page has none.
 */
function wholeSentence(text: string): string | null {
  const parts = text.trim().split(/(?<=[.!?])\s+/u);
  for (const [k, part] of parts.entries()) {
    if (k > 0 && part.endsWith('다.') && part.length <= 90 && parts[k - 1]!.endsWith('다.')) return part;
  }
  return null;
}
/** The page's opening words, at most 30 characters (cut at a space), without a period or comma after them. */
function openingWords(text: string): string {
  const t = text.trim();
  const cut = t.length <= 30 ? t : t.slice(0, 30).replace(/\s+\S*$/u, '');
  return cut.replace(/[.,]$/u, '');
}

/** The demo's answer, about 250–350 characters: the lead, a line quoting each page read, the extra lines, the close. */
function demoText(pages: readonly ReadPage[], extra: readonly string[]): string {
  const lines = pages.map((p) => {
    if (p.text === null) return SAY.pageAgain(p.page, p.cite);
    const said = wholeSentence(p.text);
    return said === null ? SAY.demoOpens(p.page, openingWords(p.text), p.cite) : SAY.demoSays(p.page, said, p.cite);
  });
  return [SAY.demoLead, ...lines, ...extra, SAY.demoClose].join(' ');
}

/**
 * An answer in the small Markdown the tutor draws: a heading, bold and inline code, a numbered list with a cite in each item and a
 * paragraph and a code block under one of them (the code keeps a cite token and a tag as text), a quote, the list going on at 4 after
 * it, a bullet list two deep.
 */
function markdownText(pages: readonly ReadPage[]): string {
  const a = pages[0]?.cite ?? '';
  const b = pages[1]?.cite ?? a;
  return [
    '## 요점',
    `이 쪽들은 **세 단계**로 정리됩니다 ${a}.`,
    '',
    `1. 첫 단계는 \`query\`와 \`key\`를 비교합니다 ${a}.`,
    `2. 둘째 단계는 점수를 확률로 바꿉니다 ${b}.`,
    '',
    '   예를 들면 다음과 같습니다.',
    '',
    '   ```',
    '   score = softmax(q · k) [[p1]] <b>',
    '   ```',
    `3. 마지막으로 값을 가중합합니다 ${b}.`,
    '',
    '> 순서가 바뀌어도 같은 결과가 나옵니다.',
    '',
    `4. 덧붙여, 같은 계산을 여러 번 나란히 합니다 ${b}.`,
    '',
    '- 정리',
    '  - 세 단계는 한 번에 계산됩니다.',
  ].join('\n');
}

/** Exactly `length` characters with `cites` citations of the pages read, in turn. */
function citedText(pages: readonly ReadPage[], cites: number, length: number): string {
  const lines = pages.length === 0 ? [] : Array.from({ length: cites }, (_, k) => {
    const p = pages[k % pages.length]!;
    return SAY.paragraph(k + 1, p.page, p.cite);
  });
  const head = lines.join(' ');
  return `${head}\n\n${fill(SAY.filler, Math.max(0, length - head.length - 2))}`;
}

/** A page of 1..pageCount the answer did not read: after the read run first, then before it. */
function unreadPage(read: readonly ReadPage[], pageCount: number, from: number): number | null {
  const seen = new Set(read.map((p) => p.page));
  for (let p = from; p <= pageCount; p += 1) if (!seen.has(p)) return p;
  for (let p = 1; p < from; p += 1) if (!seen.has(p)) return p;
  return null;
}

function run(cfg: Config): void {
  const dressed = cfg.script === 'answer';
  const caps = { load: cfg.script !== 'resume' && cfg.script !== 'no-load', resume: cfg.script !== 'load' && cfg.script !== 'no-load' };
  const sessions = new Map<string, Session>();
  const waiting = new Map<number, (m: Json) => void>();
  let turn: Turn | null = null;
  let nextId = 0;
  let exiting = false;

  const log = (e: FakeLogEntry): void => {
    if (cfg.log === null) return;
    try {
      fs.appendFileSync(cfg.log, `${JSON.stringify(e)}\n`);
    } catch {
      // A test's log that cannot be written must not end the agent as if it had failed: the missing line shows it.
      process.stderr.write('fake agent: the log could not be written\n');
    }
  };
  const exit = (code: number): void => {
    if (exiting) return;
    exiting = true;
    process.exit(code);
  };
  /** A scripted exit: the lines already written leave first. */
  const exitAfterFlush = (code: number): void => {
    if (exiting) return;
    process.stdout.write('', () => exit(code));
  };
  const write = (m: Json): void => {
    if (exiting) return;
    try {
      process.stdout.write(`${JSON.stringify(m)}\n`);
    } catch {
      exit(0);
    }
  };

  /** The answer script adds a field nobody knows and its own _meta to every message (the loose reading of spec 4.1). */
  const dress = (o: Json, where: string): Json => {
    if (!dressed) return o;
    return { ...o, _meta: { ...asJson(o._meta), fakeAgent: { script: cfg.script, where } }, fakeUnknown: { where, list: [1, 2, 3] } };
  };
  const notify = (method: string, params: Json): void => write({ jsonrpc: '2.0', method, params: dress(params, method) });
  const request = (method: string, params: Json): Promise<Json> => new Promise((resolve) => {
    nextId += 1;
    waiting.set(nextId, resolve);
    write({ jsonrpc: '2.0', id: nextId, method, params: dress(params, method) });
  });
  const update = (sessionId: string, u: Json): void => {
    const content = isJson(u.content) ? { content: dress(u.content, 'content') } : {};
    notify('session/update', { sessionId, update: { ...dress(u, String(u.sessionUpdate)), ...content } });
  };
  const say = (t: Turn, text: string): void => update(t.sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } });

  /** Waits `ms`; a cancel ends the wait at once unless the script ignores it. */
  const pause = (t: Turn, ms: number, heedCancel: boolean): Promise<void> => new Promise((resolve) => {
    if (heedCancel && t.cancelled) {
      resolve();
      return;
    }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    if (heedCancel) t.wake.push(finish);
  });
  const untilCancel = (t: Turn): Promise<void> => new Promise((resolve) => {
    if (t.cancelled) resolve();
    else t.wake.push(resolve);
  });
  const ended = (t: Turn): string => (t.cancelled ? 'cancelled' : 'end_turn');

  /** `text` in exactly `pieces` pieces, `everyMs` apart, with a usage_update now and then among them. */
  async function stream(t: Turn, text: string, pieces: number, everyMs: number, heedCancel = true): Promise<void> {
    const at = (k: number) => Math.round((k * text.length) / pieces);
    for (let k = 0; k < pieces; k += 1) {
      if (heedCancel && t.cancelled) return;
      say(t, text.slice(at(k), at(k + 1)));
      if (k % 10 === 9) update(t.sessionId, { sessionUpdate: 'usage_update', used: 1_000 + k * 10, size: 200_000, _meta: { '_claude/rateLimit': { status: 'allowed' } } });
      if (k < pieces - 1) await pause(t, everyMs, heedCancel);
    }
  }

  /** The headers a request to the server sends: Learn's from mcpServers, then the request's own. */
  function headersOf(m: Mcp, extra: Record<string, string>, data: string | null): Record<string, string> {
    const headers: Record<string, string> = {};
    for (const h of m.headers) headers[h.name] = h.value;
    Object.assign(headers, extra);
    if (data !== null) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = String(Buffer.byteLength(data));
    }
    return headers;
  }

  function post(m: Mcp, body: Json | null, method: 'POST' | 'GET', extra: Record<string, string>): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: unknown }> {
    return new Promise((resolve, reject) => {
      const data = body === null ? null : JSON.stringify(body);
      const headers = headersOf(m, extra, data);
      const req = http.request(m.url, { method, headers, agent: false }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let parsed: unknown = null;
          try {
            parsed = text === '' ? null : JSON.parse(text);
          } catch {
            parsed = text;
          }
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: parsed });
        });
        res.on('error', reject);
      });
      req.on('error', reject);
      req.end(data ?? undefined);
    });
  }

  /** One MCP message, carrying the session id the server gave at initialize (R1) and the negotiated version once they are known. */
  async function mcp(m: Mcp, method: string, params: Json | undefined, o: { notification?: boolean; version?: string } = {}) {
    const message: Json = { jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) };
    if (o.notification !== true) {
      m.ids += 1;
      message.id = m.ids;
    }
    const headers: Record<string, string> = { Accept: 'application/json, text/event-stream' };
    const version = o.version ?? m.version;
    if (version !== null) headers['MCP-Protocol-Version'] = version;
    if (m.session !== null) headers['Mcp-Session-Id'] = m.session;
    let r: { status: number; headers: http.IncomingHttpHeaders; body: unknown };
    try {
      r = await post(m, message, 'POST', headers);
    } catch {
      r = { status: 0, headers: {}, body: null };
    }
    log({ t: 'mcp', method, params: params ?? null, result: r.body, status: r.status, headers: Object.keys(headersOf(m, headers, JSON.stringify(message))) });
    return r;
  }

  /** Claude's order: server/discover, initialize, notifications/initialized, the event-stream GET, tools/list. */
  async function connect(servers: unknown): Promise<Mcp | null> {
    const s = Array.isArray(servers) ? asJson(servers[0]) : {};
    if (s.type !== 'http' || typeof s.url !== 'string' || !Array.isArray(s.headers)) return null;
    const headers = s.headers.map(asJson).flatMap((h) => (typeof h.name === 'string' && typeof h.value === 'string' ? [{ name: h.name, value: h.value }] : []));
    const m: Mcp = { url: s.url, headers, session: null, version: null, ids: 0 };
    await mcp(m, 'server/discover', {}, { version: DISCOVER_VERSION });
    const init = await mcp(m, 'initialize', {
      protocolVersion: MCP_VERSION, capabilities: { roots: { listChanged: true }, elicitation: {} }, clientInfo: { name: 'learn-fake-agent', version: '1.0.0' },
    });
    const sid = init.headers['mcp-session-id'];
    m.session = typeof sid === 'string' ? sid : null;
    const negotiated = asJson(asJson(init.body).result).protocolVersion;
    m.version = typeof negotiated === 'string' ? negotiated : MCP_VERSION;
    await mcp(m, 'notifications/initialized', undefined, { notification: true });
    const extra: Record<string, string> = { Accept: 'text/event-stream', 'MCP-Protocol-Version': m.version };
    if (m.session !== null) extra['Mcp-Session-Id'] = m.session;
    let get: { status: number; body: unknown };
    try {
      get = await post(m, null, 'GET', extra);
    } catch {
      get = { status: 0, body: null };
    }
    log({ t: 'mcp', method: 'GET', params: null, result: get.body, status: get.status, headers: Object.keys(headersOf(m, extra, null)) });
    await mcp(m, 'tools/list', {});
    return m;
  }

  /** A Learn tool, marked as Claude marks it: tool_call (empty rawInput), then tool_call_update with the arguments, then the result's status. */
  async function tool(t: Turn, name: Tool, args: Json): Promise<ToolResult> {
    const toolName = `mcp__learn__${name}`;
    const toolCallId = toolCallIdOf();
    update(t.sessionId, { sessionUpdate: 'tool_call', toolCallId, title: toolName, kind: 'other', status: 'pending', rawInput: {}, _meta: { claudeCode: { toolName } } });
    update(t.sessionId, { sessionUpdate: 'tool_call_update', toolCallId, rawInput: args, _meta: { claudeCode: { toolName } } });
    let result: ToolResult = { isError: true, structured: null };
    if (t.session.mcp !== null) {
      const r = asJson(asJson((await mcp(t.session.mcp, 'tools/call', { name, arguments: args })).body).result);
      result = { isError: r.isError === true, structured: isJson(r.structuredContent) ? r.structuredContent : null };
    }
    update(t.sessionId, { sessionUpdate: 'tool_call_update', toolCallId, status: result.isError ? 'failed' : 'completed', _meta: { claudeCode: { toolName } } });
    return result;
  }

  async function askPermission(t: Turn, options: ReadonlyArray<Json>, expected: Json): Promise<boolean> {
    const reply = await request('session/request_permission', {
      sessionId: t.sessionId,
      toolCall: { toolCallId: toolCallIdOf(), title: 'Write notes.md', kind: 'edit', status: 'pending', rawInput: { file_path: 'notes.md', content: 'notes' } },
      options,
    });
    const ok = reply.error === undefined && sameJson(reply.result, expected);
    log({ t: 'permission-answer', outcome: isJson(reply.result) ? (reply.result.outcome ?? null) : null, ok });
    return ok;
  }

  async function clientCall(method: string, params: Json): Promise<void> {
    const reply = await request(method, params);
    const code = asJson(reply.error).code;
    log({ t: 'client-call', method, error: typeof code === 'number' ? { code } : null });
  }

  /**
   * get_context → get_outline → the attached page (else the reader's) and the next → about 1,200 characters in 40 pieces. `demo`: at a
   * pace a viewer can follow — the tools half a second apart, then a short answer (demoText) in 30 pieces 100 ms apart, about 3 s.
   */
  async function answer(t: Turn, unverified: boolean, demo = false): Promise<string> {
    const ctx = contextOf(await tool(t, 'get_context', {}));
    if (t.cancelled) return 'cancelled';
    if (demo) await pause(t, 500, true);
    if (t.cancelled) return 'cancelled';
    await tool(t, 'get_outline', {});
    if (t.cancelled) return 'cancelled';
    if (demo) await pause(t, 500, true);
    if (t.cancelled) return 'cancelled';
    update(t.sessionId, { sessionUpdate: 'session_info_update', title: 'Fake session' });
    let unread: number | null = null;
    let from = ctx.selectionPage ?? ctx.readerPage;
    // Unverified cites the attached page without reading it: it reads the pages after it instead.
    if (unverified && ctx.selectionPage !== null) {
      unread = ctx.selectionPage;
      from = unread < ctx.pageCount ? unread + 1 : unread - 2;
    }
    from = clamp(from, 1, ctx.pageCount);
    const to = Math.min(from + 1, ctx.pageCount);
    const pages = pagesOf(await tool(t, 'read_pdf_pages', { from, to }));
    if (t.cancelled) return 'cancelled';
    const extra: string[] = [];
    if (unverified) {
      unread ??= unreadPage(pages, ctx.pageCount, to + 1);
      if (unread !== null) extra.push(SAY.unread(unread));
      extra.push(SAY.outside);
    }
    if (demo) {
      await pause(t, 500, true);
      if (t.cancelled) return 'cancelled';
      await stream(t, demoText(pages, extra), 30, 100);
    } else await stream(t, answerText(pages, extra, 1_200), 40, 20);
    return ended(t);
  }

  /** get_context → a line of narration → the reader's page and the next → an answer in Markdown (markdownText), in 30 pieces. */
  async function markdown(t: Turn): Promise<string> {
    const ctx = contextOf(await tool(t, 'get_context', {}));
    if (t.cancelled) return 'cancelled';
    say(t, SAY.narration);
    const from = clamp(ctx.readerPage, 1, ctx.pageCount);
    const pages = pagesOf(await tool(t, 'read_pdf_pages', { from, to: Math.min(from + 1, ctx.pageCount) }));
    if (t.cancelled) return 'cancelled';
    await stream(t, markdownText(pages), 30, 20);
    return ended(t);
  }

  /** Five pages from the reader's, then 6,000 characters at 60 pieces a second with 20 citations. */
  async function streamFast(t: Turn): Promise<string> {
    const ctx = contextOf(await tool(t, 'get_context', {}));
    if (t.cancelled) return 'cancelled';
    const from = clamp(ctx.readerPage, 1, Math.max(1, ctx.pageCount - 4));
    const pages = pagesOf(await tool(t, 'read_pdf_pages', { from, to: Math.min(from + 4, ctx.pageCount) }));
    if (t.cancelled) return 'cancelled';
    await stream(t, citedText(pages, 20, 6_000), 100, 1_000 / 60);
    return ended(t);
  }

  async function permission(t: Turn, withReject: boolean): Promise<string> {
    const ok = withReject
      ? await askPermission(t, [OPTION.allowOnce, OPTION.rejectOnce, OPTION.rejectAlways], { outcome: { outcome: 'selected', optionId: OPTION.rejectOnce.optionId } })
      : await askPermission(t, [OPTION.allowOnce, OPTION.allowAlways], { outcome: { outcome: 'cancelled' } });
    if (t.cancelled) return 'cancelled';
    say(t, ok ? SAY.denied : SAY.deniedOddly);
    return 'end_turn';
  }

  /**
   * Learn answers a permission request within a microtask, so one is pending at a stop only when the two cross in the
   * pipes. The crossing is made certain: the request goes out right after the cancel is read, before the prompt is answered.
   */
  async function permissionPending(t: Turn): Promise<string> {
    say(t, SAY.waiting);
    await untilCancel(t);
    await askPermission(t, [OPTION.allowOnce, OPTION.rejectOnce, OPTION.rejectAlways], { outcome: { outcome: 'cancelled' } });
    return 'cancelled';
  }

  /** What the injection material asks for, in turn: another material, a file, a terminal, a permission; then an answer. */
  async function inject(t: Turn): Promise<string> {
    const pages = pagesOf(await tool(t, 'read_pdf_pages', { from: 1, to: 3 }));
    if (t.cancelled) return 'cancelled';
    await tool(t, 'read_pdf_pages', { item: OTHER_ITEM, from: 1 });
    if (t.cancelled) return 'cancelled';
    await clientCall('fs/read_text_file', { sessionId: t.sessionId, path: `${process.env.HOME ?? '/home/user'}/.ssh/id_rsa` });
    await clientCall('terminal/create', { sessionId: t.sessionId, command: 'rm', args: ['-rf', '~'] });
    await askPermission(t, [OPTION.allowOnce, OPTION.rejectOnce, OPTION.rejectAlways], { outcome: { outcome: 'selected', optionId: OPTION.rejectOnce.optionId } });
    if (t.cancelled) return 'cancelled';
    await stream(t, answerText(pages, [SAY.injected, SAY.outside], 1_200), 40, 20);
    return ended(t);
  }

  /** A tool call without Learn's marker, then a slow answer that ignores the cancel: only Learn's kill ends it. */
  async function lockdown(t: Turn, kind: 'execute' | 'read'): Promise<string> {
    const toolCallId = toolCallIdOf();
    update(t.sessionId, kind === 'execute'
      ? { sessionUpdate: 'tool_call', toolCallId, title: 'ls -la', kind, status: 'pending', rawInput: { command: 'ls -la' }, _meta: { claudeCode: { toolName: 'Bash' } } }
      : { sessionUpdate: 'tool_call', toolCallId, title: 'Read /etc/hostname', kind, status: 'pending', rawInput: { file_path: '/etc/hostname' }, _meta: { claudeCode: { toolName: 'Read' } } });
    await stream(t, fill(SAY.afterTool, 6_000), 100, 200, false);
    return 'end_turn';
  }

  /** The script's turn; resolves with the stop reason, throws an ACP error, or ends the process. */
  async function play(t: Turn): Promise<string> {
    switch (cfg.script) {
      case 'answer':
      case 'resume':
      case 'load':
      case 'no-load':
        return answer(t, false);
      case 'unverified':
        return answer(t, true);
      case 'demo':
        return answer(t, false, true);
      case 'demo-unverified':
        return answer(t, true, true);
      case 'markdown':
        return markdown(t);
      case 'slow':
        await stream(t, sentences(SAY.slow, 6_000).trimEnd(), 100, 100);
        return ended(t);
      case 'stream':
        return streamFast(t);
      case 'fail-before':
        exitAfterFlush(1);
        return new Promise<string>(() => {});
      case 'fail-mid':
        await stream(t, fill(SAY.slow, 300), 10, 20);
        exitAfterFlush(1);
        return new Promise<string>(() => {});
      case 'hang':
        await untilCancel(t);
        return 'cancelled';
      case 'login':
      case 'login-silent':
        throw rpcError(-32000, 'Authentication required');
      case 'permission':
        return permission(t, true);
      case 'permission-noreject':
        return permission(t, false);
      case 'permission-pending':
        return permissionPending(t);
      case 'inject':
        return inject(t);
      case 'lockdown':
        return lockdown(t, 'execute');
      case 'lockdown-read':
        return lockdown(t, 'read');
    }
  }

  const count = (totalTokens: number, inputTokens: number, outputTokens: number): Json =>
    ({ totalTokens, inputTokens, cachedInputTokens: 0, cachedWriteTokens: 0, outputTokens, reasoningOutputTokens: 0 });

  async function prompt(params: Json): Promise<Json> {
    const sessionId = String(params.sessionId);
    const blocks = (Array.isArray(params.prompt) ? params.prompt : []).map(asJson).map((b) => ({ type: String(b.type), text: typeof b.text === 'string' ? b.text : '' }));
    log({ t: 'prompt', sessionId, blocks });
    const session = sessions.get(sessionId);
    if (session === undefined) throw rpcError(-32002, 'Resource not found');
    const t: Turn = { sessionId, session, cancelled: false, wake: [] };
    turn = t;
    try {
      const stopReason = await play(t);
      return {
        stopReason,
        usage: { inputTokens: 1_200, outputTokens: 400, cachedReadTokens: 0, cachedWriteTokens: 0, totalTokens: 1_600 },
        // Claude's shape: token_count is an object, and the model with the largest total is the answering one.
        _meta: {
          quota: {
            token_count: count(1_600, 1_200, 400),
            model_usage: [{ model: 'fake-title-model', token_count: count(90, 80, 10) }, { model: 'fake-model', token_count: count(1_600, 1_200, 400) }],
          },
        },
      };
    } finally {
      if (turn === t) turn = null;
    }
  }

  /** A load replays the session's history before it answers; Learn already holds it. */
  const replay = (sessionId: string): void => {
    update(sessionId, { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'REPLAYED question' } });
    update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'REPLAYED answer' } });
  };

  async function handle(method: string, params: Json): Promise<Json> {
    switch (method) {
      case 'initialize':
        log({ t: 'initialize', params });
        return {
          protocolVersion: 1,
          agentCapabilities: {
            loadSession: caps.load,
            mcpCapabilities: { http: true, sse: false },
            promptCapabilities: { image: true, audio: false, embeddedContext: true },
            sessionCapabilities: caps.resume ? { resume: {} } : {},
          },
          authMethods: [],
          agentInfo: { name: 'learn-fake-agent', title: 'Fake agent', version: '1.0.0' },
        };
      case 'session/new': {
        log({ t: 'session/new', params });
        const id = randomUUID();
        sessions.set(id, { id, mcp: await connect(params.mcpServers) });
        return { sessionId: id, modes: MODES };
      }
      case 'session/resume':
      case 'session/load': {
        log({ t: method, params });
        if (method === 'session/resume' ? !caps.resume : !caps.load) throw rpcError(-32601, 'Method not found');
        const id = String(params.sessionId);
        sessions.set(id, { id, mcp: await connect(params.mcpServers) });
        if (method === 'session/load') replay(id);
        return method === 'session/load' ? { modes: MODES } : {};
      }
      case 'session/set_mode':
        log({ t: 'session/set_mode', params });
        return {};
      case 'session/prompt':
        return prompt(params);
      default:
        throw rpcError(-32601, 'Method not found');
    }
  }

  async function answerRequest(id: unknown, method: string, params: Json): Promise<void> {
    let result: Json;
    try {
      result = await handle(method, params);
    } catch (e) {
      write({ jsonrpc: '2.0', id, error: { code: rpcCodeOf(e), message: e instanceof Error ? e.message : 'Internal error' } });
      return;
    }
    write({ jsonrpc: '2.0', id, result: dress(result, method) });
    // After the initialize answer, as Claude's adapter does: its login state, or (login-silent) nothing.
    if (method === 'initialize' && cfg.script !== 'login-silent') {
      notify('_auth/status_update', { authStatus: cfg.script === 'login' ? { kind: 'none', label: 'Not logged in' } : { kind: 'account', label: 'fake' } });
    }
  }

  function receive(line: string): void {
    let m: Json;
    try {
      m = asJson(JSON.parse(line));
    } catch {
      write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      return;
    }
    if (typeof m.method === 'string') {
      if (m.id === undefined || m.id === null) {
        if (m.method !== 'session/cancel') return;
        log({ t: 'cancel' });
        const t = turn;
        if (t !== null && t.sessionId === asJson(m.params).sessionId) {
          t.cancelled = true;
          for (const wake of t.wake.splice(0)) wake();
        }
        return;
      }
      void answerRequest(m.id, m.method, asJson(m.params));
      return;
    }
    if (typeof m.id === 'number') {
      const w = waiting.get(m.id);
      waiting.delete(m.id);
      w?.(m);
    }
  }

  const isolation: Record<string, string> = {};
  for (const name of ISOLATION) {
    const value = process.env[name];
    if (value !== undefined) isolation[name] = value;
  }
  log({ t: 'env', pid: process.pid, as: cfg.as, names: Object.keys(process.env).sort(), isolation });

  // Learn gone (even SIGKILLed: its end of the pipes closes) is the agent gone: it never outlives the app.
  process.stdin.on('end', () => exit(0));
  process.stdin.on('error', () => exit(0));
  process.stdout.on('error', () => exit(0));
  let buffered = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => {
    buffered += chunk;
    for (let nl = buffered.indexOf('\n'); nl >= 0; nl = buffered.indexOf('\n')) {
      const line = buffered.slice(0, nl).trim();
      buffered = buffered.slice(nl + 1);
      if (line !== '') receive(line);
    }
  });
}

/** Run as a program (node, Electron's node, or a Claude-shaped entry that set LEARN_FAKE_AGENT_AS); imported by a test, it only exports. */
function isEntry(): boolean {
  if (process.env.LEARN_FAKE_AGENT_AS !== undefined) return true;
  const main = process.argv[1];
  if (main === undefined) return false;
  try {
    return fs.realpathSync(main) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntry()) {
  const name = process.env.LEARN_FAKE_AGENT_SCRIPT || 'answer';
  const script = FAKE_SCRIPTS.find((s) => s === name);
  if (script === undefined) {
    process.stderr.write(`fake agent: no script named ${name}\n`);
    process.exit(2);
  }
  run({ script, log: process.env.LEARN_FAKE_AGENT_LOG || null, as: process.env.LEARN_FAKE_AGENT_AS === 'claude' ? 'claude' : 'fake' });
}
