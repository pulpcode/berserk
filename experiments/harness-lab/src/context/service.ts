import { decodeMapMotion } from './map-motion.js';
import type { ResourceQueryScope } from '../contracts/task-resources.js';
import { mapReferences } from './map-references.js';
import { RequestError } from '../contracts/errors.js';
import type { ContextCatalog, ContextPrincipal, ContextQueryResult, ContextScopeSnapshot, ContextTool } from '../contracts/context.js';
import { assertContextCredentials, parseContextConfig, type ContextConfig } from './config.js';
import { readContextJson, type ContextHttpOptions } from './http.js';
import { decodeContextResponse, normalizeContextQuery } from './validation.js';

const denied = () => new RequestError('CONTEXT_FORBIDDEN', '当前身份无权访问本次业务资料范围。', 403);
export class ContextService {
  readonly config: ContextConfig;
  scenario?: {assertWritable(instanceId: string): void};
  private readonly readClocks=new Map<string,{clock:string;at:number}>();
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
      areas: s.areas ?? [],
    }))};
  }
  /** Explicit, optional source task discovery. Basic queries never call this method implicitly. */
  async queryTaskResources(scope: ResourceQueryScope, principal: ContextPrincipal, signal?: AbortSignal): Promise<ContextQueryResult> {
    return this.query('situation_query',{systemId:scope.systemId,mode:'current',objectTypes:['resource'],
      ...(scope.taskId===undefined?{}:{taskId:scope.taskId}),...(scope.relation===undefined?{}:{relation:scope.relation}),
      ...(scope.category===undefined?{}:{category:scope.category}),...(scope.cursor===undefined?{}:{cursor:scope.cursor}),limit:100},principal,signal);
  }
  async query(tool: ContextTool, input: unknown, principal: ContextPrincipal, signal?: AbortSignal, readOnly = false, mapDisplay = false): Promise<ContextQueryResult> {
    signal?.throwIfAborted();
    const params = normalizeContextQuery(tool, input), system = this.config.systems.find(s => s.id === params.systemId);
    if (principal.kind === 'service') {
      this.assertServiceScope(principal.scope);
      if (!principal.scope.systemIds.includes(params.systemId)) throw denied();
    } else if (!this.config.scopes.some(s => s.seatIds.includes(principal.seatId) && s.systemIds.includes(params.systemId))) throw denied();
    if (!system) throw denied();
    const scenarioInstanceId = principal.scenarioInstanceId;
    if (system.scenarioClock === true && !scenarioInstanceId && !readOnly && (this.scenario || principal.kind === 'service')) throw denied();
    if (scenarioInstanceId && !readOnly) this.scenario?.assertWritable(scenarioInstanceId);
    if ((tool === 'situation_query') !== (system.adapter === 'mock-situation-http')) throw new RequestError('CONTEXT_UNSUPPORTED_FILTER', '所选系统不支持该查询工具。');
    if (tool === 'situation_query' && 'mode' in params) {
      const capability=system.resourceCapability;
      const unsupported=()=>new RequestError('CONTEXT_UNSUPPORTED_FILTER','来源不支持本次资源关系或类别条件；基础对象读取仍可使用。');
      if (params.taskId!==undefined && (!capability?.filters.includes('task') || capability.taskIdMapping!=='identity')) throw unsupported();
      if (params.relation!==undefined && (!capability?.filters.includes('relation') || !capability.relations.includes(params.relation)
        || params.relation==='potential_support' && capability.supportRule?.id!=='explicit-task-relation')) throw unsupported();
      if (params.category!==undefined && (!capability?.filters.includes('category') || !capability.categories.includes(params.category))) throw unsupported();
    }
    const path = tool === 'information_read' && 'reportId' in params ? `/reports/${encodeURIComponent(params.reportId!)}`
      : tool === 'information_search' ? '/reports' : 'mode' in params && params.mode === 'current' ? '/objects' : '/changes';
    const url = new URL(`${system.baseUrl}${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (key === 'systemId' || key === 'mode' || (tool === 'information_read' && key === 'reportId')) continue;
      url.searchParams.set(key, Array.isArray(value) ? JSON.stringify(value) : String(value));
    }
    const readId=principal.readId??(principal.kind==='service'?principal.jobId:undefined);
    const raw = await readContextJson(url, this.tokens.get(system.id)!, signal, {...this.httpOptions, mapDisplay,
      ...(system.scenarioClock === true && scenarioInstanceId ? {scenarioInstanceId} : {}), ...(system.scenarioClock===true&&readId?{readId}:{})});
    signal?.throwIfAborted();
    if (scenarioInstanceId && !readOnly) this.scenario?.assertWritable(scenarioInstanceId);
    let mapMotion:import('../contracts/context.js').MapMotion|undefined;
    if(raw&&typeof raw==='object'&&'mapMotion' in raw){
      if(mapDisplay)mapMotion=decodeMapMotion(raw.mapMotion);
      delete raw.mapMotion;
    }
    const data = decodeContextResponse(tool, params, raw);
    if (system.scenarioClock === true && !data.snapshotClock || system.scenarioClock !== true && data.snapshotClock) {
      throw new RequestError('CONTEXT_TIME_BASIS_CONFLICT', '来源场景时间缺失或未获配置授权，不能使用真实时间代替。', 409);
    }
    if (system.scenarioClock === true && scenarioInstanceId && data.snapshotClock?.instanceId !== scenarioInstanceId) {
      throw new RequestError('CONTEXT_TIME_BASIS_CONFLICT', '来源资料不属于本次查询范围。', 409);
    }
    if(mapMotion&&(!data.snapshotClock||mapMotion.businessNow!==data.snapshotClock.businessNow||Date.parse(mapMotion.progress.from)>Date.parse(mapMotion.businessNow)||Date.parse(mapMotion.progress.to)<=Date.parse(mapMotion.businessNow)||mapMotion.vehicles.some(v=>!v.ref.objectId.startsWith(data.snapshotClock!.instanceId+'-'))))throw new RequestError('CONTEXT_INVALID_RESPONSE','地图运动资料与来源时点不一致。',502);
    if(data.snapshotClock&&readId){
      const key=readId,stamp=JSON.stringify(data.snapshotClock),previous=this.readClocks.get(key);
      if(previous&&(previous.clock!==stamp||Date.now()-previous.at>30*60*1000))throw new RequestError('CONTEXT_READ_SNAPSHOT_CONFLICT','固定读取已失效，请重新发起查询。',409);
      if(!previous){if(this.readClocks.size>=100000)throw new RequestError('CONTEXT_UNAVAILABLE','固定读取容量已满。',503);this.readClocks.set(key,{clock:stamp,at:Date.now()});}
    }
    return {...(mapMotion?{mapMotion}:{}),systemId: params.systemId, query: params, queriedAt: new Date().toISOString(), data, mapReferences: mapReferences(data)};
  }
}
