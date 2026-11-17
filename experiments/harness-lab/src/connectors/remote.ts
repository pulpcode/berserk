import { randomUUID } from 'node:crypto';
import { Client, InMemoryResponseCacheStore, StreamableHTTPClientTransport, SdkError, SdkErrorCode, isInputRequiredResult, type Tool, type JsonSchemaValidator, type JsonSchemaType } from '@modelcontextprotocol/client';
import type { ConnectorDiscovery, ConnectorTool } from '../contracts/connectors.js';
import { createPinnedMcpFetch, McpNetworkError, type McpNetworkPolicy } from './network.js';
import { admitMcpSchema, canonicalMcpJson, McpSchemaError, mcpDigest, validateMcpArguments } from './schema.js';

export type RemoteCatalog = ConnectorDiscovery;
export type RemoteMcpTool = ConnectorTool;
export interface RemoteMcpSessionOptions { url: string; headers?: Readonly<Record<string, string>>; networkPolicy?: McpNetworkPolicy; signal?: AbortSignal }
export interface RemoteMcpInvocation { name: string; arguments: Record<string, unknown>; contractDigest: string }
export interface RemoteMcpInvokeOptions { signal?: AbortSignal; onSent?: () => void | Promise<void> }
export interface RemoteMcpOutcome {
  status: 'success' | 'remote_error' | 'input_required' | 'unknown' | 'not_sent';
  sent: boolean;
  text: string;
  isError?: boolean;
  protocolVersion: string;
  protocolEra: string;
}
export class RemoteMcpError extends Error {
  constructor(readonly code: 'discovery' | 'catalog' | 'protocol' | 'closed' | 'busy') {
    super(({discovery: 'MCP 工具发现失败，请核对连接和凭证。', catalog: 'MCP 工具目录无效或超过安全上限。', protocol: 'MCP 版本不在已支持范围。', closed: '本次 MCP 连接已结束。', busy: '本次 MCP 连接仍有操作未结束。'})[code]);
    this.name = 'RemoteMcpError';
  }
}
export const MCP_PROTOCOL_VERSIONS = ['2026-07-28', '2025-11-25'] as const;
const LIMITS = Object.freeze({pages: 8, tools: 128, catalogBytes: 512 * 1024, resultBytes: 64 * 1024, discoverMs: 25_000, invokeMs: 45_000});
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

function contract(tool: Pick<ConnectorTool, 'name' | 'description' | 'inputSchema' | 'outputSchema' | 'annotations'>) {
  return {name: tool.name, ...(tool.description !== undefined ? {description: tool.description} : {}), inputSchema: tool.inputSchema,
    ...(tool.outputSchema !== undefined ? {outputSchema: tool.outputSchema} : {}), ...(tool.annotations !== undefined ? {annotations: tool.annotations} : {})};
}
function admitTool(value: Tool): ConnectorTool {
  // eslint-disable-next-line no-control-regex -- Remote names must not contain invisible control characters.
  if (!value.name || value.name.length > 128 || /[\u0000-\u001f\u007f]/.test(value.name) || (value.description?.length ?? 0) > 8192) throw new RemoteMcpError('catalog');
  const tool: ConnectorTool = {...contract(value), inputSchema: structuredClone(value.inputSchema), available: true, contractDigest: mcpDigest(contract(value), 128 * 1024)};
  try {
    admitMcpSchema(tool.inputSchema);
    if (tool.outputSchema !== undefined) admitMcpSchema(tool.outputSchema);
    // Task execution, URI-based continuations and header mirroring are not granted by discovery.
    if (value.execution && value.execution.taskSupport !== 'forbidden') throw new McpSchemaError('unsupported');
  } catch (error) {
    tool.available = false;
    tool.unavailableReason = error instanceof McpSchemaError ? error.message : 'MCP 工具约束无法使用。';
  }
  return tool;
}
function inertText(result: {content?: unknown; structuredContent?: unknown}, credentialValues: readonly string[]): string {
  const blocks = Array.isArray(result.content) ? result.content : [];
  const texts = blocks.filter((block): block is {type: 'text'; text: string} => record(block) && block.type === 'text' && typeof block.text === 'string').map((block) => block.text);
  if (!texts.length && result.structuredContent !== undefined) texts.push(JSON.stringify(result.structuredContent));
  if (!texts.length) texts.push('远程工具未返回可显示的文本。');
  let text = texts.join('\n');
  for (const secret of credentialValues) text = text.split(secret).join('[已隐藏凭证]');
  // Return inert text only. No remote HTML, resource fetch, raw result metadata, images or embedded requests.
  // eslint-disable-next-line no-control-regex -- Strip terminal escapes and controls from inert remote material.
  text = text.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  if (Buffer.byteLength(text) <= LIMITS.resultBytes) return text;
  const notice = '\n[远程返回文本超过显示上限，已截断。]';
  return Buffer.from(text).subarray(0, LIMITS.resultBytes - Buffer.byteLength(notice) - 3).toString('utf8') + notice;
}
const schemaValidator = {
  getValidator<T>(schema: JsonSchemaType): JsonSchemaValidator<T> {
    const admitted = admitMcpSchema(schema);
    return (value) => admitted.validate(value) ? {valid: true, data: value as T, errorMessage: undefined} : {valid: false, data: undefined, errorMessage: 'MCP 返回结果不符合已发现的约束。'};
  },
};

/** One admitted foreground request owns one client, credential snapshot, cache and cancellation scope. */
export class RemoteMcpSession {
  private readonly controller = new AbortController();
  private readonly cache = new InMemoryResponseCacheStore({maxEntries: 16});
  private readonly client: Client;
  private readonly transport: StreamableHTTPClientTransport;
  private readonly signal: AbortSignal;
  private readonly credentialValues: string[];
  private catalog?: RemoteCatalog;
  private connected = false;
  private closed = false;
  private busy = false;
  private invocation?: {sent: boolean; attempts: number; onSent?: () => void | Promise<void>};

  constructor(options: RemoteMcpSessionOptions) {
    this.credentialValues = [...new Set(Object.values(options.headers ?? {}).flatMap((value) => [value, value.replace(/^Bearer\s+/i, '')]).filter(Boolean))];
    this.signal = options.signal ? AbortSignal.any([options.signal, this.controller.signal]) : this.controller.signal;
    const controlledFetch = createPinnedMcpFetch({...options, signal: this.signal, onToolDispatch: async () => {
      const invocation = this.invocation;
      // SDK retries, auth continuations and recovery may never emit a second business POST.
      if (!invocation || invocation.attempts++ !== 0) throw new RemoteMcpError('busy');
      await invocation.onSent?.();
      invocation.sent = true;
    }});
    this.client = new Client({name: 'axon-mcp', version: '1.0.0'}, {
      capabilities: {}, supportedProtocolVersions: [...MCP_PROTOCOL_VERSIONS],
      versionNegotiation: {mode: 'auto', probe: {timeoutMs: 10_000, maxRetries: 0}},
      inputRequired: {autoFulfill: false}, listMaxPages: LIMITS.pages,
      responseCacheStore: this.cache, cachePartition: randomUUID(), jsonSchemaValidator: schemaValidator,
    });
    this.transport = new StreamableHTTPClientTransport(new URL(options.url), {
      fetch: controlledFetch, requestInit: {redirect: 'manual'}, redirectPolicy: 'same-origin',
      onInsufficientScope: 'throw', maxStepUpRetries: 0,
      reconnectionOptions: {maxRetries: 0, maxReconnectionDelay: 1000, initialReconnectionDelay: 1000, reconnectionDelayGrowFactor: 1},
    });
    // Transport exceptions can contain a remote error body. Never log/forward the SDK exception.
    this.client.onerror = () => {};
  }

  private evidence() {
    const protocolVersion = this.client.getNegotiatedProtocolVersion() ?? '';
    const protocolEra = this.client.getProtocolEra() ?? '';
    if (!(MCP_PROTOCOL_VERSIONS as readonly string[]).includes(protocolVersion) || !['modern', 'legacy'].includes(protocolEra)) throw new RemoteMcpError('protocol');
    return {protocolVersion, protocolEra};
  }
  private async operation<T>(timeoutMs: number, signal: AbortSignal | undefined, action: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.closed) throw new RemoteMcpError('closed');
    if (this.busy) throw new RemoteMcpError('busy');
    this.busy = true;
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), timeoutMs);
    const combined = AbortSignal.any([this.signal, deadline.signal, ...(signal ? [signal] : [])]);
    try { combined.throwIfAborted(); return await action(combined); }
    finally { clearTimeout(timer); this.busy = false; }
  }

  async discover(): Promise<RemoteCatalog> {
    if (this.catalog) { this.signal.throwIfAborted(); if (this.closed) throw new RemoteMcpError('closed'); return structuredClone(this.catalog); }
    return this.operation(LIMITS.discoverMs, undefined, async (signal) => {
      try {
        if (!this.connected) { await this.client.connect(this.transport, {signal, timeout: 10_000}); this.connected = true; }
        const evidence = this.evidence();
        const tools: ConnectorTool[] = []; const names = new Set<string>(); const cursors = new Set<string>();
        let cursor: string | undefined;
        for (let page = 0; page < LIMITS.pages; page++) {
          signal.throwIfAborted();
          // Public request() gives one unfiltered page, including unsupported contracts for unavailable entries.
          // listTools() aggregates a no-cursor call and filters some contracts; neither is suitable here.
          const listed = await this.client.request({method: 'tools/list', params: cursor === undefined ? {} : {cursor}}, {signal, timeout: 10_000});
          for (const value of listed.tools) {
            if (names.has(value.name) || tools.length >= LIMITS.tools) throw new RemoteMcpError('catalog');
            names.add(value.name); tools.push(admitTool(value));
          }
          canonicalMcpJson(tools, LIMITS.catalogBytes);
          cursor = listed.nextCursor;
          if (cursor === undefined) break;
          if (!cursor || cursor.length > 1024 || cursors.has(cursor) || page === LIMITS.pages - 1) throw new RemoteMcpError('catalog');
          cursors.add(cursor);
        }
        signal.throwIfAborted();
        const identity = this.client.getServerVersion();
        const serverInfo = identity ? {name: identity.name.slice(0, 256), version: identity.version.slice(0, 128)} : undefined;
        const candidate = {...evidence, ...(serverInfo ? {serverInfo} : {}), tools, digest: mcpDigest(tools, LIMITS.catalogBytes), discoveredAt: new Date().toISOString()};
        const serialized = canonicalMcpJson(candidate, LIMITS.catalogBytes);
        if (this.credentialValues.some((secret) => serialized.includes(secret) || serialized.includes(JSON.stringify(secret).slice(1, -1)))) throw new RemoteMcpError('catalog');
        this.catalog = candidate;
        return structuredClone(this.catalog);
      } catch (error) {
        if (error instanceof RemoteMcpError || error instanceof McpNetworkError || error instanceof McpSchemaError) throw error;
        throw new RemoteMcpError('discovery');
      }
    });
  }

  async invoke(input: RemoteMcpInvocation, options: RemoteMcpInvokeOptions = {}): Promise<RemoteMcpOutcome> {
    let sent = false;
    const evidence = this.catalog ? {protocolVersion: this.catalog.protocolVersion, protocolEra: this.catalog.protocolEra} : {protocolVersion: '', protocolEra: ''};
    try {
      return await this.operation(LIMITS.invokeMs, options.signal, async (signal) => {
        const tool = this.catalog?.tools.find((value) => value.name === input.name && value.contractDigest === input.contractDigest);
        if (!tool?.available) throw new RemoteMcpError('catalog');
        const args = validateMcpArguments(tool, input.arguments);
        this.invocation = {sent: false, attempts: 0, onSent: async () => { await options.onSent?.(); sent = true; }};
        try {
          const result = await this.client.callTool({name: tool.name, arguments: args}, {
            signal, timeout: LIMITS.invokeMs, resetTimeoutOnProgress: false,
            // Exact immutable definition also disables the SDK's HEADER_MISMATCH automatic refetch/resend.
            toolDefinition: contract(tool) as Tool,
          });
          if (isInputRequiredResult(result)) return {...evidence, status: 'input_required', sent, isError: true, text: '远程工具要求当前不支持的交互续接，本次调用未自动重发。'};
          const text = inertText(result, this.credentialValues);
          return {...evidence, status: result.isError ? 'remote_error' : 'success', sent, isError: !!result.isError, text};
        } finally { this.invocation = undefined; }
      });
    } catch (error) {
      if (sent && error instanceof SdkError && error.code === SdkErrorCode.UnsupportedResultType && record(error.data) && error.data.resultType === 'input_required') {
        return {...evidence, status: 'input_required', sent, isError: true, text: '远程工具要求当前不支持的交互续接，本次调用未自动重发。'};
      }
      return {...evidence, status: sent ? 'unknown' : 'not_sent', sent, isError: true,
        text: sent ? 'MCP 请求已发出，但未取得可验证结果；外部效果未知，未自动重试。' : 'MCP 请求未发出，请核对连接、权限和参数。'};
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true; this.controller.abort(); this.cache.clear();
    try { await this.client.close(); } catch { /* No session termination retry or remote message exposure. */ }
  }
}
