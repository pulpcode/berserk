import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { advanceExecution, executionTime } from '../scripts/mock-context/scenarios/execution.js';
import { ScenarioStore } from '../scripts/mock-context/scenarios/store.js';
import { commandHash } from '../src/commands/validation.js';
import type { ExternalCommand } from '../src/contracts/commands.js';
import { scenarioQuery } from '../scripts/mock-context/scenarios/query.js';
import type { SituationCurrent } from '../src/contracts/context.js';
const actor={userId:'director',seatId:'director'};
let store:ScenarioStore;
afterEach(()=>{store?.close();vi.useRealTimers();});
function fixture(path?:string){
  vi.useFakeTimers();store=new ScenarioStore(path);store.startScheduler();
  const made=store.create({definitionId:'harbor-fire',version:'7',mode:'main_story',clientActionId:randomUUID()},actor),id=made.instance.instanceId;
  store.activate(id,randomUUID(),made.instance.revision,0,false,actor);
  const accept=()=>{for(const action of store.get(id).actions)store.delivery(action.id,'accepted');};
  const next=()=>{const p=store.preview(id);const op=randomUUID();return store.apply(id,p.step!.id,op,p.instance.revision,actor);};
  for(let i=0;i<5;i++){next();accept();}
  const ref=(code:string)=>({systemId:'situation' as const,objectType:code[0]==='R'?'road':'resource',objectId:`${id}-${code}`});
  const command={vehicles:[ref('V01'),ref('V06')],route:[ref('R03')],destination:ref('L01')};
  const input:ExternalCommand={commandId:randomUUID(),scenarioInstanceId:id,taskId:randomUUID(),issuedBy:{seatId:'control',seatName:'控制席'},command,contentHash:commandHash(command)};
  store.receiveCommand(input);next();accept();return {id,next,input,ref};
}
it('walks a short journey independently of reads, preserves corners and completes the original receipt',()=>{
  const f=fixture(),before=store.commandExecution(f.input.commandId)!;
  expect(before.vehicles[0].state).toBe('en_route');
  const p=store.preview(f.id),op=randomUUID(),request=()=>store.apply(f.id,p.step!.id,op,p.instance.revision,actor);
  const started=request();expect(started.operation.state).toBe('advancing');expect(request()).toEqual(started);
  vi.advanceTimersByTime(2000);
  const middle=store.commandExecution(f.input.commandId)!;
  expect(middle.vehicles[0].state).toBe('en_route');expect(middle.vehicles[0].travelledMeters).toBeGreaterThan(0);expect(middle.vehicles[0].travelledMeters).toBeLessThan(middle.vehicles[0].distanceMeters);
  const item=store.get(f.id).objects.find(o=>o.ref.objectId===f.ref('V01').objectId)!;
  expect('executionTrail' in item.properties&&item.properties.executionTrail?.[0].length).toBeGreaterThan(2);
  vi.advanceTimersByTime(2000);
  expect(store.operation(op).operation.state).toBe('completed');expect(store.commandExecution(f.input.commandId)!.vehicles[0].state).toBe('arrived');
  expect(store.commandExecution(f.input.commandId)!.vehicles[0].arrivedAt).toBe(before.vehicles[0].estimatedArrivalAt);
  expect(store.get(f.id).instance.advancing).toBeUndefined();
});
it('pins pages and separate queries while source motion advances',()=>{
  const f=fixture(),query=scenarioQuery(store),readId=randomUUID();f.next();
  const first=query(new URL('http://source/situation/objects?limit=1'),f.id,readId) as SituationCurrent;
  vi.advanceTimersByTime(2000);
  const second=query(new URL(`http://source/situation/objects?limit=1&cursor=${first.nextCursor}`),f.id,readId) as SituationCurrent;
  expect(second.snapshotClock).toEqual(first.snapshotClock);
  const fresh=query(new URL('http://source/situation/objects?limit=1'),f.id,randomUUID()) as SituationCurrent;
  expect(fresh.snapshotClock!.revision).toBeGreaterThan(first.snapshotClock!.revision);
});
it('explicit stop leaves a terminal receipt and cannot keep writing',()=>{
  const f=fixture(),started=f.next();vi.advanceTimersByTime(1000);
  store.control(f.id,'pause',randomUUID(),store.get(f.id).instance.revision,actor);
  expect(store.operation(started.operation.id).operation.state).toBe('interrupted');
  const stopped=store.get(f.id);vi.advanceTimersByTime(10000);expect(store.get(f.id)).toEqual(stopped);
});
it('retains the old travelled prefix when a live journey is cancelled',()=>{
  const f=fixture(),started=f.next();vi.advanceTimersByTime(1000);
  const before=store.commandExecution(f.input.commandId)!;
  const command={...f.input.command,action:'cancel' as const,targetCommandId:f.input.commandId,expectedExecutionRevision:before.revision};
  store.receiveCommand({...f.input,commandId:randomUUID(),command,contentHash:commandHash(command)});
  expect(store.operation(started.operation.id).operation.state).toBe('interrupted');
  const stopped=store.commandExecution(f.input.commandId)!;
  expect(stopped.vehicles.every(v=>v.state==='cancelled')).toBe(true);
  vi.advanceTimersByTime(10000);expect(store.commandExecution(f.input.commandId)).toEqual(stopped);
});
it('expires a pinned read explicitly instead of silently reading new facts',()=>{
  const f=fixture(),query=scenarioQuery(store),readId=randomUUID();
  query(new URL('http://source/situation/objects'),f.id,readId,true);
  vi.advanceTimersByTime(61000);
  expect(()=>query(new URL('http://source/situation/objects'),f.id,readId,true)).toThrow('读取快照已过期');
});

it('recovery stops at the last committed progress without catching up downtime',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'motion-recovery-'));
  let recovered:ScenarioStore|undefined;
  try{
    const f=fixture(join(dir,'scene.sqlite')),started=f.next();vi.advanceTimersByTime(1000);
    const saved=store.get(f.id).instance.businessNow;
    recovered=new ScenarioStore(join(dir,'scene.sqlite'));recovered.startScheduler();
    expect(recovered.operation(started.operation.id).operation.state).toBe('interrupted');
    expect(recovered.get(f.id).instance.businessNow).toBe(saved);
    vi.advanceTimersByTime(60000);expect(recovered.get(f.id).instance.businessNow).toBe(saved);
  }finally{recovered?.close();store.close();await rm(dir,{recursive:true,force:true});}
});
it('freezes old motion before another run becomes active',()=>{
  const f=fixture();f.next();vi.advanceTimersByTime(1000);
  store.control(f.id,'pause',randomUUID(),store.get(f.id).instance.revision,actor);
  const made=store.create({definitionId:'harbor-fire',version:'7',mode:'main_story',clientActionId:randomUUID()},actor);
  store.activate(made.instance.instanceId,randomUUID(),made.instance.revision,store.active().revision,false,actor);
  const frozen=store.get(f.id);expect(frozen.instance.status).toBe('frozen');
  vi.advanceTimersByTime(60000);expect(store.get(f.id)).toEqual(frozen);
});

it('never confirms arrival at a fractional time before the scheduled arrival node',()=>{
  const f=fixture(),record=store.get(f.id),vehicle=store.commandExecution(f.input.commandId)!.vehicles[0];
  record.instance.businessNow=executionTime(Date.parse(vehicle.estimatedArrivalAt)-1);
  advanceExecution(record,actor,'internal-sample');
  expect(record.execution!.roots[f.input.commandId].vehicles[0].state).toBe('en_route');
  record.instance.businessNow=vehicle.estimatedArrivalAt;advanceExecution(record,actor,'arrival');
  expect(record.execution!.roots[f.input.commandId].vehicles[0].state).toBe('arrived');
});
