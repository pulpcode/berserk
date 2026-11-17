import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/** Disposable wire fixture for the real official SDK client; never used by the application. */
export interface ControlledMcpOptions {
  era?: 'modern' | 'legacy';
  label?: string;
  token?: string;
  identities?: Record<string, string>;
  protocolVersion?: string;
  tools?: Array<Record<string, unknown>>;
  nextCursor?: string;
  sse?: boolean;
  callDelayMs?: number;
  callResult?: Record<string, unknown>;
  callErrorCode?: number;
  dropCallReply?: boolean;
  rawReply?: (method: string, response: ServerResponse) => boolean;
}
export async function startControlledMcp(options: ControlledMcpOptions = {}) {
  const records: Array<{method: string; authorization?: string; params?: Record<string, unknown>; id?: unknown}> = [];
  const httpRecords: Array<{method: string; authorization?: string}> = [];
  const sockets = new Set<import('node:net').Socket>();
  const pendingTimers = new Set<ReturnType<typeof setTimeout>>();
  const server = createServer(async (request, response) => {
    httpRecords.push({method: request.method ?? 'GET', authorization: request.headers.authorization});
    response.setHeader('content-type', 'application/json');
    if (options.token && request.headers.authorization !== `Bearer ${options.token}`) { response.writeHead(401); response.end(JSON.stringify({error: {message: `private-error-${options.token}`}})); return; }
    const identity = options.identities?.[request.headers.authorization ?? ''];
    if (options.identities && !identity) { response.writeHead(401); response.end('{}'); return; }
    if (request.method !== 'POST') {
      if (options.rawReply?.(request.method ?? 'GET', response)) return;
      response.writeHead(405); response.end('{}'); return;
    }
    let raw = '';
    for await (const chunk of request) raw += chunk;
    const message = JSON.parse(raw) as {method?: string; params?: Record<string, unknown>; id?: unknown};
    const method = message.method ?? 'response';
    records.push({method, authorization: request.headers.authorization, params: message.params, id: message.id});
    if (options.rawReply?.(method, response)) return;
    if (message.id === undefined) { response.writeHead(202); response.end(); return; }
    const modern = options.era !== 'legacy';
    const wire = (result: Record<string, unknown>) => modern ? {resultType: 'complete', ...result} : result;
    const reply = (result: Record<string, unknown>, error = false) => {
      const payload = {jsonrpc: '2.0', id: message.id, ...(error ? {error: result} : {result: wire(result)})};
      if (options.sse && method === 'tools/call') {
        response.setHeader('content-type', 'text/event-stream');
        response.end(`event: message\ndata: ${JSON.stringify(payload)}\n\n`);
      } else response.end(JSON.stringify(payload));
    };
    if (method === 'server/discover') {
      if (!modern) reply({code: -32601, message: 'Unsupported method'}, true);
      else reply({supportedVersions: [options.protocolVersion ?? '2026-07-28'], capabilities: {tools: {}}, ttlMs: 60_000, cacheScope: 'public', _meta: {'io.modelcontextprotocol/serverInfo': {name: 'same-server-family', version: '1.0.0'}}});
    } else if (method === 'initialize') reply({protocolVersion: options.protocolVersion ?? '2025-11-25', capabilities: {tools: {}}, serverInfo: {name: 'same-server-family', version: '1.0.0'}});
    else if (method === 'tools/list') reply({tools: options.tools ?? [{name: 'lookup', description: 'Controlled read-only lookup', inputSchema: {type: 'object', properties: {query: {type: 'string', minLength: 1}}, required: ['query'], additionalProperties: false}, annotations: {readOnlyHint: true}}], ttlMs: 60_000, cacheScope: 'public', ...(options.nextCursor ? {nextCursor: options.nextCursor} : {})});
    else if (method === 'tools/call') {
      const complete = () => {
        if (options.dropCallReply) { response.destroy(); return; }
        if (options.callErrorCode) reply({code: options.callErrorCode, message: 'Controlled protocol failure'}, true);
        else reply(options.callResult ?? {content: [{type: 'text', text: `${identity ?? options.label ?? 'fixture'}:${String(message.params?.arguments && (message.params.arguments as Record<string, unknown>).query)}`}]});
      };
      if (options.callDelayMs) { const timer = setTimeout(() => { pendingTimers.delete(timer); complete(); }, options.callDelayMs); pendingTimers.add(timer); }
      else complete();
    } else reply({code: -32601, message: 'Unsupported method'}, true);
  });
  server.on('connection', (socket) => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {url: `${origin}/mcp`, origin, records, httpRecords, networkPolicy: {approvedTargets: [origin, '127.0.0.1']},
    async close() { pendingTimers.forEach(clearTimeout); sockets.forEach((socket) => socket.destroy()); await new Promise<void>((resolve) => server.close(() => resolve())); },
  };
}
