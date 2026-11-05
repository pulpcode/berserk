import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ScenarioScope } from '../src/scenario/scope.js';
import { createMockContextServer } from '../scripts/mock-context/server.js';
import { scenarioDefinition } from '../scripts/mock-context/scenarios/data.js';
import type { ContextConfig } from '../src/context/config.js';
import type { ScenarioMutationResult } from '../src/contracts/scenarios.js';

const cleanup:Array<()=>Promise<unknown>>=[];
afterEach(async()=>{for(const dispose of cleanup.splice(0).reverse())await dispose();});
async function fixture(){
  const dir=await mkdtemp(join(tmpdir(),'axon-scope-'));cleanup.push(()=>rm(dir,{recursive:true,force:true}));
  const server=createMockContextServer({token:'query-secret',controlToken:'control-secret',scenariosEnabled:true,databasePath:join(dir,'source.sqlite')});
  const base=await server.listen();cleanup.push(()=>server.close());
  const actor={userId:randomUUID(),seatId:'director'};
  const control=async(path:string,body?:object):Promise<ScenarioMutationResult>=>{
    const response=await fetch(`${base}/control/${path}`,{method:body?'POST':'GET',headers:{Authorization:'Bearer control-secret','Content-Type':'application/json'},...(body?{body:JSON.stringify({...body,actor})}:{})});
    expect(response.status).toBe(200);return await response.json() as ScenarioMutationResult;
  };
  const config:ContextConfig={systems:[{id:'intel',name:'特情',adapter:'mock-information-http',baseUrl:`${base}/intel`,tokenEnv:'QUERY',scenarioClock:true},{id:'situation',name:'态势',adapter:'mock-situation-http',baseUrl:`${base}/situation`,tokenEnv:'QUERY',scenarioClock:true}],scopes:[],simulation:{enabled:true,baseUrl:base,tokenEnv:'CONTROL',sources:[{sourceId:'intel-source',systemId:'intel'},{sourceId:'situation-source',systemId:'situation'}]}};
  const scope=new ScenarioScope(config,{CONTROL:'control-secret'});
  const create=()=>control('instances',{definitionId:scenarioDefinition.id,version:scenarioDefinition.version,mode:'source_replay',clientActionId:randomUUID()});
  const first=await create(),id=first.instance.instanceId;
  const active=await control(`instances/${id}/activate`,{clientActionId:randomUUID(),expectedRevision:first.instance.revision,expectedActiveRevision:0});
  const step=await control(`instances/${id}/steps/E01`,{clientActionId:randomUUID(),expectedRevision:active.instance.revision});
  await scope.sync();
  return {scope,control,create,step,id};
}

describe('trusted source-derived scenario scope',()=>{
  it('requires exact saved provenance and never appoints scope from message text or the active pointer',async()=>{
    const f=await fixture(),notice=f.step.actions[0].notification;
    expect(await f.scope.verifyIncoming('intel-source',notice)).toBe(f.id);
    const legacy={...notice};delete legacy.scenarioInstanceId;
    await expect(f.scope.verifyIncoming('intel-source',legacy)).rejects.toMatchObject({code:'SCENARIO_SCOPE_CONFLICT'});
    await expect(f.scope.verifyIncoming('intel-source',{...notice,text:notice.text+' altered'})).rejects.toMatchObject({code:'SCENARIO_SCOPE_CONFLICT'});
    await expect(f.scope.verifyIncoming('situation-source',notice)).rejects.toMatchObject({code:'SCENARIO_SCOPE_CONFLICT'});
    await expect(f.scope.verifyIncoming('ordinary-source',notice)).rejects.toMatchObject({code:'SCENARIO_SCOPE_CONFLICT'});
    expect(await f.scope.verifyIncoming('ordinary-source',{sourceMessageId:'ordinary',title:'业务消息',text:'普通资料'})).toBeUndefined();
    expect(f.scope.isWritable(f.id)).toBe(true);f.scope.close(f.id);
    expect(()=>f.scope.assertWritable(f.id)).toThrow('资料已只读');
    expect(await f.scope.verifyIncoming('intel-source',notice)).toBe(f.id);
  });

  it('backfills only exact persisted legacy notifications even after another run is current',async()=>{
    const f=await fixture(),notice=f.step.actions[0].notification;
    const paused=await f.control(`instances/${f.id}/control`,{clientActionId:randomUUID(),expectedRevision:f.step.instance.revision,action:'pause'});
    expect(paused.instance.paused).toBe(true);
    const second=await f.create();
    await f.control(`instances/${second.instance.instanceId}/activate`,{clientActionId:randomUUID(),expectedRevision:second.instance.revision,expectedActiveRevision:1,terminateUnsent:true});
    await f.scope.sync();expect(f.scope.activeId()).toBe(second.instance.instanceId);
    const legacy={...notice};delete legacy.scenarioInstanceId;
    const event={...legacy,id:randomUUID(),sourceId:'intel-source'};
    const bound:Array<[string,string]>=[];
    await f.scope.reconcileLegacy([event,{...event,id:randomUUID(),sourceMessageId:notice.sourceMessageId+'-unproved'}],async(eventId,id)=>{bound.push([eventId,id]);});
    expect(bound).toEqual([[event.id,f.id]]);
    expect(await f.scope.verifyIncoming('intel-source',notice)).toBe(f.id);
    expect(f.scope.isWritable(f.id)).toBe(false);
    const rejected:Array<[string,string]>=[];
    await expect(f.scope.reconcileLegacy([{...event,text:event.text+' changed'}],async(eventId,id)=>{rejected.push([eventId,id]);})).rejects.toMatchObject({code:'SCENARIO_SCOPE_CONFLICT'});
    expect(rejected).toEqual([]);
  });
});
