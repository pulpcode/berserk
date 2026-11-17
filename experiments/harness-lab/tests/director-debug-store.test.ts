import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { ScenarioStore } from '../scripts/mock-context/scenarios/store.js';
import type { ExternalCommand } from '../src/contracts/commands.js';
import { scenarioQuery } from '../scripts/mock-context/scenarios/query.js';

const actor={userId:'test-director',seatId:'seat-director'};
test('debug source keeps exact run CAS, blocks unknown delivery and preserves old query facts across restart',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'director-debug-store-')),path=join(dir,'source.sqlite');let store=new ScenarioStore(path);
  try{
    const created=store.createDebug(randomUUID(),actor),id=created.instance.instanceId;
    const active=store.activate(id,randomUUID(),created.instance.revision,0,true,actor);
    expect(()=>store.receiveCommand({commandId:randomUUID(),scenarioInstanceId:id} as ExternalCommand)).toThrow('自由调试');
    const road=store.debugState(id).objects.find(item=>item.ref.objectType==='road')!;
    const input={clientActionId:randomUUID(),expectedRunRevision:active.instance.revision,expectedRevision:road.revision,ref:road.ref,properties:{passability:'closed'},effectiveAt:active.instance.businessNow,validTime:null};
    const result=store.editDebug(id,'object-updates',input,actor);expect(store.editDebug(id,'object-updates',input,actor)).toEqual(result);
    expect(()=>store.editDebug(id,'object-updates',{...input,clientActionId:randomUUID()},actor)).toThrow();
    const original=store.debugState(id).reports[0],{reportId,revision,...report}=original;
    expect(()=>store.editDebug(id,'report-updates',{clientActionId:randomUUID(),expectedRunRevision:result.instance.revision,expectedRevision:revision,reportId,report:{...report,subjectId:'other-run-subject'}},actor)).toThrow('原主题');
    const paused=store.control(id,'pause',randomUUID(),result.instance.revision,actor),action=result.actions[0];store.delivery(action.id,'unconfirmed');
    expect(()=>store.finish(id,randomUUID(),paused.instance.revision,1,actor)).toThrow('核对');expect(store.active().instanceId).toBe(id);
    store.delivery(action.id,'accepted',{sourceMessageId:action.notification.sourceMessageId,eventId:'event1',receivedAt:new Date().toISOString(),status:'accepted'});
    const finished=store.finish(id,randomUUID(),paused.instance.revision,1,actor);expect(finished.instance.status).toBe('frozen');expect(store.active()).toEqual({instanceId:null,revision:2});
    expect(()=>scenarioQuery(store)(new URL('http://source/situation/objects'))).toThrow('活动轮次');
    expect(()=>store.editDebug(id,'object-updates',input,actor)).toThrow();
    const before=store.provenance(id);store.close();store=new ScenarioStore(path);expect(store.provenance(id)).toEqual(before);
    const next=store.createDebug(randomUUID(),actor),nextId=next.instance.instanceId;store.activate(nextId,randomUUID(),1,2,true,actor);
    expect(store.debugState(nextId).objects.find(item=>item.name===road.name)?.properties).toEqual(road.properties);
    const query=scenarioQuery(store);const old=query(new URL('http://source/situation/objects?objectRefs='+encodeURIComponent(JSON.stringify([road.ref]))),id) as {items:Array<{ref:{objectId:string};properties:unknown}>};
    expect(old.items.find(item=>item.ref.objectId===road.ref.objectId)?.properties).toEqual({passability:'closed'});
    expect(()=>query(new URL('http://source/situation/objects?objectRefs='+encodeURIComponent(JSON.stringify([road.ref]))),nextId)).toThrow('混合');
    expect(()=>store.apply(nextId,'E01',randomUUID(),2,actor)).toThrow();
  }finally{store.close();await rm(dir,{recursive:true,force:true});}
});


test('a debug run at the edit limit can still pause and finish without reopening writes',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'director-debug-limit-')),path=join(dir,'source.sqlite');let store=new ScenarioStore(path);
  try{
    const created=store.createDebug(randomUUID(),actor),id=created.instance.instanceId;
    store.activate(id,randomUUID(),created.instance.revision,0,true,actor);
    const record=store.get(id);store.close();
    // Load an exact boundary snapshot instead of writing 998 irrelevant edits.
    record.operations=Array.from({length:1000},(_,index)=>({...record.operations[index%record.operations.length],id:randomUUID()}));
    const db=new DatabaseSync(path);try{db.prepare('UPDATE scenario_instances SET body=? WHERE instance_id=?').run(JSON.stringify(record),id);}finally{db.close();}
    store=new ScenarioStore(path);
    const road=store.debugState(id).objects.find(item=>item.ref.objectType==='road')!;
    expect(()=>store.editDebug(id,'object-updates',{clientActionId:randomUUID(),expectedRunRevision:record.instance.revision,expectedRevision:road.revision,ref:road.ref,properties:{passability:'closed'},effectiveAt:record.instance.businessNow,validTime:null},actor)).toThrow('上限');
    expect(()=>store.control(id,'pause',randomUUID(),record.instance.revision-1,actor)).toThrow('已更新');
    const paused=store.control(id,'pause',randomUUID(),record.instance.revision,actor);
    expect(()=>store.control(id,'resume',randomUUID(),paused.instance.revision,actor)).toThrow('上限');
    expect(()=>store.control(id,'pause',randomUUID(),paused.instance.revision,actor)).toThrow('上限');
    const finished=store.finish(id,randomUUID(),paused.instance.revision,1,actor);
    expect(finished.instance.status).toBe('frozen');expect(store.active().instanceId).toBeNull();
    const next=store.createDebug(randomUUID(),actor);expect(store.activate(next.instance.instanceId,randomUUID(),1,2,true,actor).instance.status).toBe('active');
  }finally{store.close();await rm(dir,{recursive:true,force:true});}
});


test('unconfirmed notifications remain reachable after the recent debug edit window fills',()=>{
  const store=new ScenarioStore();
  try{
    const created=store.createDebug(randomUUID(),actor),id=created.instance.instanceId;
    store.activate(id,randomUUID(),1,0,true,actor);
    const firstId=randomUUID();
    for(let index=0;index<22;index++){
      const state=store.debugState(id),road=state.objects.find(item=>item.ref.objectType==='road')!;
      store.editDebug(id,'object-updates',{clientActionId:index===0?firstId:randomUUID(),expectedRunRevision:state.instance.revision,expectedRevision:road.revision,ref:road.ref,properties:{passability:index%2?'open':'closed'},effectiveAt:state.instance.businessNow,validTime:null},actor);
      if(index===0)store.delivery(firstId,'unconfirmed');
    }
    expect(store.debugState(id).actions).toHaveLength(21);
    expect(store.debugState(id).actions[0]).toMatchObject({id:firstId,sendState:'unconfirmed'});
    const pending=store.action(firstId)!.action;
    store.delivery(firstId,'accepted',{eventId:'event-first',sourceMessageId:pending.notification.sourceMessageId,receivedAt:new Date().toISOString(),status:'accepted'});
    expect(store.debugState(id).actions).toHaveLength(20);
    expect(store.debugState(id).actions.some(action=>action.id===firstId)).toBe(false);
    expect(store.action(firstId)?.action.sendState).toBe('accepted');
  }finally{store.close();}
});
