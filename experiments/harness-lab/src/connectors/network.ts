import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';

export interface McpNetworkPolicy {
  /** Exact origins permit HTTP; exact IP literals permit private addresses at this fixed endpoint. */
  approvedTargets?: readonly string[];
  timeoutMs?: number;
  idleTimeoutMs?: number;
  maxRequestBytes?: number;
  maxResponseBytes?: number;
  maxSseEventBytes?: number;
}
export class McpNetworkError extends Error {
  constructor(readonly code: 'target' | 'address' | 'redirect' | 'limit' | 'timeout' | 'response' | 'unavailable') {
    super(({target: 'MCP 端点不符合连接网络策略。', address: 'MCP 网络地址未获批准。', redirect: 'MCP 返回了不允许的重定向。', limit: 'MCP 数据超过安全上限。', timeout: 'MCP 请求超时。', response: 'MCP 返回了不支持的数据。', unavailable: 'MCP 连接暂不可用。'})[code]);
    this.name = 'McpNetworkError';
  }
}
const normalizedIp = (address: string) => address.replace(/^\[|\]$/g, '').toLowerCase();
export function isMcpCredentialHeader(name: string): boolean {
  return /^[a-z][a-z0-9-]{0,63}$/i.test(name) && !/^(?:cookie|set-cookie|host|connection|content-.*|transfer-encoding|proxy-.*|mcp-.*|accept.*|origin|referer|user-agent|x-forwarded-.*)$/i.test(name);
}

/** Fail closed for special-use IPv4 and IPv6; IPv4-mapped IPv6 cannot bypass the IPv4 rules. */
export function isPublicMcpAddress(address: string): boolean {
  address = normalizedIp(address);
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 0 || b === 168 || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
  }
  if (isIP(address) !== 6 || address.includes('%')) return false;
  // Only global-unicast 2000::/3. Exclude documentation, transition and protocol-assignment ranges.
  const [firstText, secondText] = address.split(':');
  const first = Number.parseInt(firstText, 16);
  const second = Number.parseInt(secondText || '0', 16);
  return first >= 0x2000 && first <= 0x3fff &&
    !(first === 0x2001 && (second <= 0x1ff || second === 0xdb8)) && first !== 0x2002 && first !== 0x3fff;
}
function bound(value: number | undefined, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) throw new McpNetworkError('limit');
  return value;
}
export interface PinnedMcpFetchOptions {
  url: string;
  headers?: Readonly<Record<string, string>>;
  networkPolicy?: McpNetworkPolicy;
  signal?: AbortSignal;
  /** Called after DNS/TLS connection, immediately before dispatch; never for list/connect/cancel. */
  onToolDispatch?: () => void | Promise<void>;
}

/** Node's lookup callback supplies the exact validated addresses to the actual socket dial. */
export function createPinnedLookup(approvedTargets: readonly string[] = [], resolve = dnsLookup): LookupFunction {
  const approvedIps = new Set(approvedTargets.filter((entry) => isIP(normalizedIp(entry))).map(normalizedIp));
  return (hostname, options, callback) => {
    void resolve(hostname, {all: true, verbatim: true}).then((answers) => {
      if (!answers.length || answers.some(({address}) => !isPublicMcpAddress(address) && !approvedIps.has(normalizedIp(address)))) {
        callback(new McpNetworkError('address'), '', 4); return;
      }
      const selected = answers.find((answer) => !options.family || answer.family === options.family);
      if (!selected) { callback(new McpNetworkError('address'), '', 4); return; }
      // Node may request all candidates. Every returned address was admitted above, with no second resolution.
      if (options.all) callback(null, answers); else callback(null, selected.address, selected.family);
    }, () => callback(new McpNetworkError('unavailable'), '', 4));
  };
}

/** A fixed-target fetch for the official SDK; no global dispatcher, redirects, proxy or credential cache. */
export function createPinnedMcpFetch(options: PinnedMcpFetchOptions): typeof fetch {
  let endpoint: URL;
  try { endpoint = new URL(options.url); } catch { throw new McpNetworkError('target'); }
  const policy = options.networkPolicy ?? {};
  const approved = new Set(policy.approvedTargets ?? []);
  if (!['https:', 'http:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.hash ||
    (endpoint.protocol === 'http:' && !approved.has(endpoint.origin))) throw new McpNetworkError('target');
  const host = normalizedIp(endpoint.hostname);
  if (isIP(host) && !isPublicMcpAddress(host) && !approved.has(host)) throw new McpNetworkError('address');
  const timeout = bound(policy.timeoutMs, 15_000, 60_000);
  const idle = bound(policy.idleTimeoutMs, 10_000, 30_000);
  const maxRequest = bound(policy.maxRequestBytes, 128 * 1024, 256 * 1024);
  const maxResponse = bound(policy.maxResponseBytes, 1024 * 1024, 2 * 1024 * 1024);
  const maxEvent = bound(policy.maxSseEventBytes, 128 * 1024, 256 * 1024);
  const credentials = new Headers(options.headers);
  for (const [key, value] of credentials) {
    if (!isMcpCredentialHeader(key) || value.length > 16_384 || /[\r\n]/.test(value)) throw new McpNetworkError('target');
  }
  const lookup = createPinnedLookup([...approved]);
  return async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.href !== endpoint.href) throw new McpNetworkError('target');
    const method = (init.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (!['GET', 'POST', 'DELETE'].includes(method)) throw new McpNetworkError('target');
    // Streamable HTTP serializes messages as strings. Do not admit arbitrary streams/FormData.
    if (init.body !== undefined && init.body !== null && typeof init.body !== 'string') throw new McpNetworkError('target');
    const body = typeof init.body === 'string' ? init.body : undefined;
    if (body !== undefined && Buffer.byteLength(body) > maxRequest) throw new McpNetworkError('limit');
    let toolCall = false;
    if (body !== undefined) {
      try {
        const message: unknown = JSON.parse(body);
        if (!message || typeof message !== 'object' || Array.isArray(message)) throw new McpNetworkError('target');
        toolCall = 'method' in message && message.method === 'tools/call';
      } catch { throw new McpNetworkError('target'); }
    }
    const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
    for (const name of ['host', 'cookie', 'proxy-authorization', 'connection', 'transfer-encoding', 'content-length']) headers.delete(name);
    for (const [name, value] of credentials) headers.set(name, value);
    headers.set('accept-encoding', 'identity');
    if (body !== undefined) headers.set('content-length', String(Buffer.byteLength(body)));
    const signals = [options.signal, init.signal ?? undefined, input instanceof Request ? input.signal : undefined].filter((value): value is AbortSignal => !!value);
    const signal = signals.length ? AbortSignal.any(signals) : undefined;
    signal?.throwIfAborted();
    return new Promise<Response>((resolve, reject) => {
      let response: IncomingMessage | undefined;
      let stream: ReadableStreamDefaultController<Uint8Array> | undefined;
      let finished = false;
      let resolved = false;
      const timer = setTimeout(() => fail(new McpNetworkError('timeout')), timeout);
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
      const fail = (error: Error) => {
        if (finished) return;
        finished = true; cleanup(); response?.destroy(); req.destroy();
        if (resolved) stream?.error(error); else reject(error);
      };
      const abort = () => fail(new DOMException('MCP 请求已取消。', 'AbortError'));
      const req = (endpoint.protocol === 'https:' ? httpsRequest : httpRequest)(endpoint, {
        method, headers: Object.fromEntries(headers), lookup, agent: false,
        maxHeaderSize: 32 * 1024,
      }, (incoming) => {
        response = incoming;
        const status = incoming.statusCode ?? 502;
        if (status >= 300 && status < 400) { fail(new McpNetworkError('redirect')); return; }
        const length = incoming.headers['content-length'];
        if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > maxResponse)) { fail(new McpNetworkError('limit')); return; }
        const encoding = incoming.headers['content-encoding'];
        if (encoding && encoding !== 'identity') { fail(new McpNetworkError('response')); return; }
        const contentType = incoming.headers['content-type'] ?? '';
        const sse = /^text\/event-stream(?:\s*;|$)/i.test(contentType);
        if (status !== 202 && status !== 204 && !sse && !/^application\/json(?:\s*;|$)/i.test(contentType)) { fail(new McpNetworkError('response')); return; }
        const outHeaders = new Headers();
        for (const name of ['content-type', 'content-length', 'mcp-session-id', 'mcp-protocol-version']) {
          const value = incoming.headers[name]; if (typeof value === 'string') outHeaders.set(name, value);
        }
        let total = 0; let eventSize = 0; let lineSize = 0;
        const readable = new ReadableStream<Uint8Array>({
          start(controller) {
            stream = controller;
            incoming.on('data', (chunk: Buffer) => {
              if (finished) return;
              total += chunk.length;
              if (total > maxResponse) { fail(new McpNetworkError('limit')); return; }
              if (sse) for (const byte of chunk) {
                eventSize++;
                if (eventSize > maxEvent || lineSize > maxEvent) { fail(new McpNetworkError('limit')); return; }
                if (byte === 10) { if (lineSize === 0) eventSize = 0; lineSize = 0; }
                else if (byte !== 13) lineSize++;
              }
              controller.enqueue(new Uint8Array(chunk));
              if ((controller.desiredSize ?? 0) <= 0) incoming.pause();
            });
            incoming.once('end', () => { if (!finished) { finished = true; cleanup(); controller.close(); } });
            incoming.once('error', () => fail(new McpNetworkError('unavailable')));
            incoming.once('aborted', () => fail(new McpNetworkError('unavailable')));
          },
          pull() { incoming.resume(); },
          cancel() { if (!finished) { finished = true; cleanup(); incoming.destroy(); req.destroy(); } },
        });
        resolved = true;
        if (status === 202 || status === 204) { void readable.cancel(); resolve(new Response(null, {status, headers: outHeaders})); }
        else resolve(new Response(readable, {status, headers: outHeaders}));
      });
      req.setTimeout(idle, () => fail(new McpNetworkError('timeout')));
      req.once('error', (error) => fail(error instanceof McpNetworkError ? error : new McpNetworkError('unavailable')));
      signal?.addEventListener('abort', abort, {once: true});
      if (signal?.aborted) { abort(); return; }
      // Do not classify a DNS/TLS failure as dispatch. Never send headers before this point.
      req.once('socket', (socket) => {
        const dispatch = async () => {
          try {
            signal?.throwIfAborted();
            if (toolCall) await options.onToolDispatch?.();
            signal?.throwIfAborted();
            if (!finished) req.end(body);
          } catch { fail(new McpNetworkError('unavailable')); }
        };
        if (socket.connecting) socket.once(endpoint.protocol === 'https:' ? 'secureConnect' : 'connect', () => { void dispatch(); });
        else void dispatch();
      });
    });
  };
}
