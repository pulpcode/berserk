import { RequestError } from '../contracts/errors.js';
import type { ContextCatalog, ContextPrincipal, ContextQueryResult, ContextScopeSnapshot, ContextTool } from '../contracts/context.js';
import { assertContextCredentials, parseContextConfig, type ContextConfig } from './config.js';
import { readContextJson, type ContextHttpOptions } from './http.js';
import { decodeContextResponse, normalizeContextQuery } from './validation.js';

const denied = () => new RequestError('CONTEXT_FORBIDDEN', '当前身份无权访问本次业务资料范围。', 403);
export class ContextService {
  readonly config: ContextConfig;
  private readonly tokens: Map<string, string>;
  constructor(config: ContextConfig, env: NodeJS.ProcessEnv = process.env, private readonly httpOptions: ContextHttpOptions = {}) {
    this.config = parseContextConfig(config); assertContextCredentials(this.config, env);
    this.tokens = new Map(this.config.systems.map(s => [s.id, env[s.tokenEnv]!]));
  }
  scopeSnapshot(scopeId: string): ContextScopeSnapshot {
    const scope = this.config.scopes.find(s => s.id === scopeId); if (!scope) throw denied();
    return {scopeId, systemIds: [...scope.systemIds]};
  }
  assertServiceScope(snapshot: ContextScopeSnapshot): void {
    const scope = this.config.scopes.find(s => s.id === snapshot.scopeId);
    if (!scope || snapshot.systemIds.length !== scope.systemIds.length || new Set(snapshot.systemIds).size !== snapshot.systemIds.length || snapshot.systemIds.some(id => !scope.systemIds.includes(id))) throw denied();
  }
  assertSeatScope(seatId: string, snapshot: ContextScopeSnapshot): void {
    this.assertServiceScope(snapshot);
    if (!this.config.scopes.find(s => s.id === snapshot.scopeId)!.seatIds.includes(seatId)) throw denied();
  }
  catalog(seatId: string): ContextCatalog {
    const ids = new Set(this.config.scopes.filter(s => s.seatIds.includes(seatId)).flatMap(s => s.systemIds));
    return {systems: this.config.systems.filter(s => ids.has(s.id)).map(s => ({id: s.id, name: s.name,
      objectTypes: s.adapter === 'mock-information-http' ? ['report'] : ['road', 'resource', 'area'],
      capabilities: s.adapter === 'mock-information-http' ? ['information_search', 'information_read'] : ['situation_current', 'situation_changes'],
      areas: [{id: 'zone-west', name: '西区'}, {id: 'zone-east', name: '东区'}],
    }))};
  }
  async query(tool: ContextTool, input: unknown, principal: ContextPrincipal, signal?: AbortSignal): Promise<ContextQueryResult> {
    signal?.throwIfAborted();
    const params = normalizeContextQuery(tool, input), system = this.config.systems.find(s => s.id === params.systemId);
    if (principal.kind === 'service') {
      this.assertServiceScope(principal.scope);
      if (!principal.scope.systemIds.includes(params.systemId)) throw denied();
    } else if (!this.config.scopes.some(s => s.seatIds.includes(principal.seatId) && s.systemIds.includes(params.systemId))) throw denied();
    if (!system) throw denied();
    if ((tool === 'situation_query') !== (system.adapter === 'mock-situation-http')) throw new RequestError('CONTEXT_UNSUPPORTED_FILTER', '所选系统不支持该查询工具。');
    const path = tool === 'information_read' && 'reportId' in params ? `/reports/${encodeURIComponent(params.reportId!)}`
      : tool === 'information_search' ? '/reports' : 'mode' in params && params.mode === 'current' ? '/objects' : '/changes';
    const url = new URL(`${system.baseUrl}${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (key === 'systemId' || key === 'mode' || (tool === 'information_read' && key === 'reportId')) continue;
      url.searchParams.set(key, Array.isArray(value) ? JSON.stringify(value) : String(value));
    }
    const raw = await readContextJson(url, this.tokens.get(system.id)!, signal, this.httpOptions);
    signal?.throwIfAborted();
    const data = decodeContextResponse(tool, params, raw);
    return {systemId: params.systemId, query: params, queriedAt: new Date().toISOString(), data};
  }
}
