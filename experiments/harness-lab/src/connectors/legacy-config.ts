import { DatabaseSync } from 'node:sqlite';
import { capabilityDigest } from '../capabilities/service.js';
import type { BackgroundConfig } from '../background/config.js';
import type { ContextConfig } from '../context/config.js';
import type { ConnectorBusinessSlot, ConnectorRevision } from '../contracts/connectors.js';
import { RequestError } from '../contracts/errors.js';
import { connectorStateError, insertConnectorRevision, writeConnectorAsset, type ConnectorBinding } from './store.js';

export interface LegacyConnectorPlan { context?: ContextConfig; background?: BackgroundConfig; bindings: ConnectorBinding[]; conflicts: string[]; digest: string; createdAt: string }
export interface LegacyResolutionInput { systemId?: string; sourceId?: string; control?: boolean; receiptOnly?: boolean }
export type LegacyConnectionResolver = (input: LegacyResolutionInput) => LegacyConnectionResolution;
export interface LegacyConnectionResolution { connectorId: string; revisionId: string; credentialVersion: number; endpoint: string; token: string }
const stableId = (slot: string) => `legacy-${slot}`;
export function planLegacyConnectors(context?: ContextConfig, background?: BackgroundConfig, createdAt = new Date().toISOString()): LegacyConnectorPlan {
  const conflicts: string[] = [], bindings: ConnectorBinding[] = [];
  for (const [slot,adapter] of [['information','mock-information-http'],['situation','mock-situation-http']] as const) {
    const systems = context?.systems.filter(system => system.adapter === adapter) ?? [];
    if (systems.length > 1) conflicts.push(`${slot}:存在多条既有业务配置(${systems.map(system=>system.id).join(',')})`);
    if (systems.length === 1) { const system=systems[0]; bindings.push({slot,connectorId:stableId(slot),systemIds:[system.id],sourceIds:[],envRefs:{organization:system.tokenEnv}}); }
  }
  if (context?.simulation) {
    bindings.push({slot:'simulation-control',connectorId:stableId('simulation-control'),systemIds:context.simulation.sources.map(source=>source.systemId),sourceIds:context.simulation.sources.map(source=>source.sourceId),envRefs:{organization:context.simulation.tokenEnv}});
    for (const mapping of context.simulation.sources) { const actual=background?.sources.find(source=>source.sourceId===mapping.sourceId);if(background && (!actual || actual.systemId!==mapping.systemId))conflicts.push(`simulation-control:来源映射与入站不一致(${mapping.systemId})`); }
  }
  if (background?.sources.length) {
    const sourceIds:string[]=[],systemIds:string[]=[],envRefs:Record<string,string>={};
    for (const source of background.sources.filter(source=>!source.retired)) { sourceIds.push(source.sourceId);envRefs[`organization:${source.sourceId}`]=source.credentialRef;if(source.systemId===undefined)continue;if(!context?.systems.some(system=>system.id===source.systemId))conflicts.push(`ingress:未映射来源(${source.sourceId})`);else if(!systemIds.includes(source.systemId))systemIds.push(source.systemId); }
    bindings.push({slot:'ingress',connectorId:stableId('ingress'),systemIds,sourceIds,envRefs});
  }
  const input={...(context?{context}:{}),...(background?{background}:{}),bindings,conflicts};
  return {...input,digest:capabilityDigest(input),createdAt};
}
export function applyLegacyConnectorPlan(db: DatabaseSync,plan: LegacyConnectorPlan): void {
  if(plan.conflicts.length)throw Error('既有连接配置存在冲突，请先核对dry-run。');
  db.exec('BEGIN IMMEDIATE');try {
    for(const binding of plan.bindings) {
      const system=plan.context?.systems.find(system=>binding.systemIds.includes(system.id));
      const endpoint=binding.slot==='simulation-control'?plan.context!.simulation!.baseUrl:binding.slot==='ingress'?'https://axon-ingress.invalid/':system!.baseUrl;
      const config={name:binding.slot==='ingress'?'业务入站':binding.slot==='simulation-control'?'演练控制':system!.name,description:'既有业务固定接入',endpoint:new URL(endpoint).href,auth:{mode:'bearer' as const,credentialSource:'organization' as const},approvedTargets:[],policy:{mode:'none' as const,seatIds:[],personal:false},exposedTools:[]};
      const revision:ConnectorRevision={...config,connectorId:binding.connectorId,revisionId:`${binding.connectorId}-${plan.digest}`,revision:1,kind:'legacy',businessSlot:binding.slot,createdAt:plan.createdAt};
      insertConnectorRevision(db,revision);writeConnectorAsset(db,{connectorId:binding.connectorId,currentRevisionId:revision.revisionId,state:'enabled',stateRevision:0});
      db.prepare('INSERT INTO r4_connection_bindings VALUES(?,?,?)').run(binding.slot,binding.connectorId,JSON.stringify(binding));
      for(const[subject,envRef]of Object.entries(binding.envRefs))db.prepare('INSERT INTO r4_connection_credentials VALUES(?,?,?,?)').run(binding.connectorId,subject,1,JSON.stringify({version:1,envRef,revoked:false}));
    }
    db.prepare('INSERT INTO r4_connection_legacy VALUES(1,?)').run(JSON.stringify({...(plan.context?{context:plan.context}:{}),...(plan.background?{background:plan.background}:{}),planDigest:plan.digest}));
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
}
type Token = (id:string,subject:string)=>{value:string;version:number};
type Revision = (id:string)=>ConnectorRevision;
type State = (id:string)=>'enabled'|'disabled';
const bindingRows=(db:DatabaseSync)=>db.prepare('SELECT data FROM r4_connection_bindings ORDER BY slot').all().map(row=>JSON.parse(String(row.data)) as ConnectorBinding);
export function resolveLegacyConnection(db: DatabaseSync,input: LegacyResolutionInput,token:Token,revision:Revision,state:State):LegacyConnectionResolution {
  if(Number(!!input.systemId)+Number(!!input.sourceId)+Number(input.control===true)!==1)throw connectorStateError();
  const binding=bindingRows(db).find(binding=>input.control?binding.slot==='simulation-control':input.sourceId?binding.slot==='ingress'&&binding.sourceIds.includes(input.sourceId):['information','situation'].includes(binding.slot)&&binding.systemIds.includes(input.systemId!));
  const historical = input.sourceId && input.receiptOnly && !binding ? JSON.parse(String(db.prepare('SELECT data FROM r4_connection_legacy WHERE id=1').get()?.data ?? '{}')).background?.sources?.some((source: {sourceId:string;retired?:boolean})=>source.sourceId===input.sourceId&&source.retired) : false;
  const selected = binding ?? (historical ? bindingRows(db).find(item=>item.slot==='ingress') : undefined);
  if(!selected||state(selected.connectorId)!=='enabled')throw new RequestError('CONNECTOR_LEGACY_UNAVAILABLE','既有业务连接已停用或未完成映射。',409);
  const current=revision(selected.connectorId),credential=token(selected.connectorId,input.sourceId?`organization:${input.sourceId}`:'organization');
  return{connectorId:selected.connectorId,revisionId:current.revisionId,credentialVersion:credential.version,endpoint:current.endpoint.replace(/\/$/,''),token:credential.value};
}
/** This persisted snapshot is authoritative; legacy files are never reapplied on startup. */
export function legacyProjection(db:DatabaseSync,token:Token,revision:Revision,_state:State):{context?:ContextConfig;background?:BackgroundConfig;env:NodeJS.ProcessEnv}|undefined {
  void _state;
  const row=db.prepare('SELECT data FROM r4_connection_legacy WHERE id=1').get();if(!row){if(bindingRows(db).length)throw connectorStateError();return undefined;}
  const original=JSON.parse(String(row.data)) as {context?:ContextConfig;background?:BackgroundConfig;planDigest:string};const expected=planLegacyConnectors(original.context,original.background);if(expected.conflicts.length||expected.digest!==original.planDigest||capabilityDigest(bindingRows(db))!==capabilityDigest([...expected.bindings].sort((a,b)=>a.slot.localeCompare(b.slot))))throw connectorStateError();
  const context=original.context?structuredClone(original.context):undefined,background=original.background?structuredClone(original.background):undefined,env:NodeJS.ProcessEnv={};
  // Endpoint/metadata assembly is allowed while disabled/revoked; every actual domain call resolves again.
  const project=(id:string,subject:string,ref:string)=>{const c=db.prepare('SELECT data FROM r4_connection_credentials WHERE connection_id=? AND subject_id=?').get(id,subject);if(!c)throw connectorStateError();const value=JSON.parse(String(c.data)) as {revoked:boolean};if(!value.revoked){try{env[ref]=token(id,subject).value;}catch(error){if(!(error instanceof RequestError&&error.code==='CONNECTOR_CREDENTIAL_REQUIRED'))throw error;}}};
  const bindings=bindingRows(db);
  for(const system of context?.systems??[]){const binding=bindings.find(binding=>['information','situation'].includes(binding.slot)&&binding.systemIds.includes(system.id));if(!binding)throw connectorStateError();system.baseUrl=revision(binding.connectorId).endpoint.replace(/\/$/,'');project(binding.connectorId,'organization',system.tokenEnv);}
  if(context?.simulation){const binding=bindings.find(binding=>binding.slot==='simulation-control');if(!binding)throw connectorStateError();context.simulation.baseUrl=revision(binding.connectorId).endpoint.replace(/\/$/,'');project(binding.connectorId,'organization',context.simulation.tokenEnv);}
  for(const source of (background?.sources??[]).filter(source=>!source.retired)){const binding=bindings.find(binding=>binding.slot==='ingress'&&binding.sourceIds.includes(source.sourceId));if(!binding)throw connectorStateError();project(binding.connectorId,`organization:${source.sourceId}`,source.credentialRef);}
  return{...(context?{context}:{}),...(background?{background}:{}),env};
}
export function legacySlotForSystem(plan:LegacyConnectorPlan,id:string):ConnectorBusinessSlot|undefined{return plan.bindings.find(binding=>['information','situation'].includes(binding.slot)&&binding.systemIds.includes(id))?.slot;}
