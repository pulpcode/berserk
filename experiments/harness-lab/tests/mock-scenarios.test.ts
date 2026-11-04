import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockContextServer } from '../scripts/mock-context/server.js';
import { sceneWorld, scenarioDefinition } from '../scripts/mock-context/scenarios/data.js';
import { isScenarioClock, type ScenarioAction, type ScenarioInstanceDetail, type ScenarioInstances, type ScenarioMode, type ScenarioMutationResult, type ScenarioPreview } from '../src/contracts/scenarios.js';
import type { SituationCurrent, InformationDetail } from '../src/contracts/context.js';
import type { SimulationNotification, SimulationReceipt } from '../src/contracts/simulation.js';
import { parseContextConfig } from '../src/context/config.js';
import { parseBackgroundConfig } from '../src/background/config.js';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import booleanIntersects from '@turf/boolean-intersects';

const token='scenario-test-query',controlToken='scenario-test-control',actor={userId:'test-director-user',seatId:'seat-director'};
const cleanup:Array<()=>Promise<unknown>>=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();vi.useRealTimers();});
async function ingress() {
  const events=new Map<string,SimulationReceipt>(),notifications:SimulationNotification[]=[];let fail=false,loseAck=false;
  const server=createServer(async(req,res)=>{const url=new URL(req.url!,'http://local');if(fail){res.writeHead(503);res.end();return;}if(req.method==='GET'){const receipt=events.get(url.searchParams.get('sourceMessageId')!);res.writeHead(receipt?200:404,{'content-type':'application/json'});res.end(JSON.stringify(receipt??{}));return;}
    let text='';for await(const chunk of req)text+=chunk;const notification=JSON.parse(text) as SimulationNotification;notifications.push(notification);const receipt:SimulationReceipt={eventId:randomUUID(),sourceMessageId:notification.sourceMessageId,receivedAt:new Date().toISOString(),status:'accepted'};events.set(receipt.sourceMessageId,receipt);res.writeHead(loseAck?503:202,{'content-type':'application/json'});res.end(JSON.stringify(receipt));});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));cleanup.push(()=>new Promise<void>(resolve=>{server.closeAllConnections();server.close(()=>resolve());}));
  const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {notifications,events,targets:['intel','situation'].map(systemId=>({systemId,sourceId:`mock-${systemId}`,url,token:'test-ingress-token'})),setFail:(value:boolean)=>{fail=value;},setLoseAck:(value:boolean)=>{loseAck=value;}};
}
async function setup(databasePath?:string) {
  const receiver=await ingress(),mock=createMockContextServer({token,controlToken,scenariosEnabled:true,databasePath,targets:receiver.targets}),url=await mock.listen();let closed=false;const close=async()=>{if(!closed){closed=true;await mock.close();}};cleanup.push(close);
  async function request<T>(path:string,method='GET',body?:unknown,credential=path.startsWith('/control/')?controlToken:token){const response=await fetch(`${url}${path}`,{method,headers:{Authorization:`Bearer ${credential}`,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:response.status,body:await response.json() as T};}
  async function create(mode:ScenarioMode='source_replay',clientActionId=randomUUID()){return request<ScenarioMutationResult>('/control/instances','POST',{definitionId:scenarioDefinition.id,version:scenarioDefinition.version,mode,clientActionId,actor});}
  async function activate(instance:ScenarioMutationResult['instance'],activeRevision=0,terminateUnsent=false){return request<ScenarioMutationResult>(`/control/instances/${instance.instanceId}/activate`,'POST',{clientActionId:randomUUID(),expectedRevision:instance.revision,expectedActiveRevision:activeRevision,terminateUnsent,actor});}
  async function apply(instance:ScenarioMutationResult['instance'],stepId:string,clientActionId=randomUUID()){return request<ScenarioMutationResult>(`/control/instances/${instance.instanceId}/steps/${stepId}`,'POST',{clientActionId,expectedRevision:instance.revision,actor});}
  async function send(action:ScenarioAction){return request<ScenarioAction>(`/control/scenario-actions/${action.id}/send`,'POST',{actor});}
  return {receiver,mock,close,url,request,create,activate,apply,send};
}

describe('versioned scenario world and boundary clock',()=>{
  it('keeps declared source areas consistent with every point and intersecting road',()=>{
    const world=sceneWorld('geometry-audit'),areas=new Map(world.objects.filter(object=>object.geometry?.type==='Polygon').map(object=>[object.ref.objectId,object.geometry!])),[west,south,east,north]=scenarioDefinition.geography.bounds;
    for(const object of world.objects){
      const geometry=object.geometry!;expect(geometry,object.ref.objectId).toBeTruthy();
      const positions=geometry.type==='Point'?[geometry.coordinates]:geometry.type==='LineString'?geometry.coordinates:geometry.coordinates.flat();
      for(const [x,y] of positions){expect(Number.isFinite(x)&&Number.isFinite(y),object.ref.objectId).toBe(true);expect(x,object.ref.objectId).toBeGreaterThanOrEqual(west);expect(x,object.ref.objectId).toBeLessThanOrEqual(east);expect(y,object.ref.objectId).toBeGreaterThanOrEqual(south);expect(y,object.ref.objectId).toBeLessThanOrEqual(north);}
      if(geometry.type==='Polygon'){expect(geometry.coordinates[0].length).toBeGreaterThanOrEqual(4);expect(geometry.coordinates[0][0]).toEqual(geometry.coordinates[0].at(-1));}
      else for(const areaId of object.areaIds){const area=areas.get(areaId)!;expect(area,areaId).toBeTruthy();if(area.type!=='Polygon')throw new Error('Area geometry must be polygon');expect(geometry.type==='Point'?booleanPointInPolygon(geometry,area):booleanIntersects(geometry,area),`${object.ref.objectId} in ${areaId}`).toBe(true);}
    }
  });
  it('ships matching isolated configuration without granting director rights to business recipients',async()=>{
    const context=parseContextConfig(JSON.parse(await readFile(new URL('../fixtures/scenario-demo/context.example.json',import.meta.url),'utf8'))),background=parseBackgroundConfig(JSON.parse(await readFile(new URL('../fixtures/scenario-demo/background.example.json',import.meta.url),'utf8')));
    expect(context.systems.every(source=>source.scenarioClock===true)).toBe(true);expect(context.simulation?.directorSeatId).toBe('seat-director');expect(context.scopes[0].seatIds).toContain('seat-director');
    expect(background.sources.map(source=>source.sourceId)).toEqual(context.simulation!.sources.map(source=>source.sourceId));expect(background.sources.every(source=>!source.allowedRecipientSeatIds.includes('seat-director'))).toBe(true);expect(background.profiles[0].contextScopeId).toBe(context.scopes[0].id);
  });
  it('provides the full background, independent identities, actual type counts and no author answer labels',()=>{
    const world=sceneWorld(`run-${randomUUID()}`),resources=world.objects.filter(object=>object.ref.objectType==='resource'),vehicles=resources.filter(object=>object.resourceData?.resource.vehicle);
    expect(world.objects).toHaveLength(53);expect(resources).toHaveLength(41);expect(vehicles).toHaveLength(24);expect(new Set(world.objects.map(o=>o.ref.objectId)).size).toBe(53);
    expect(vehicles.reduce((counts,object)=>{const type=object.resourceData!.resource.vehicle!.type;counts[type]=(counts[type]??0)+1;return counts;},{} as Record<string,number>)).toEqual({water_tanker:10,foam:4,ladder:3,rescue:3,communications:2,logistics:2});
    expect(vehicles.map(o=>o.resourceData!.resource.availability!.state).reduce((counts,state)=>{counts[state]=(counts[state]??0)+1;return counts;},{} as Record<string,number>)).toEqual({available:17,unavailable:5,unknown:2});
    expect(vehicles.reduce((counts,object)=>{const station=object.resourceData!.resource.vehicle!.homeStationRef.objectId.slice(-3);counts[station]=(counts[station]??0)+1;return counts;},{} as Record<string,number>)).toEqual({S01:6,S02:5,S03:4,S04:4,S05:3,S06:2});
    const v02=vehicles.find(o=>o.name.startsWith('V02'))!;expect(v02.areaIds[0]).toMatch(/-A03$/);expect(v02.resourceData!.resource.vehicle!.homeStationRef.objectId).toMatch(/-S01$/);expect(v02.geometry).toEqual(world.objects.find(o=>o.name==='城西交通救援现场')!.geometry);
    expect(world.steps).toHaveLength(12);expect(world.steps.flatMap(step=>step.notices)).toHaveLength(13);expect(world.steps[3].reports).toHaveLength(2);expect(world.tasks.map(t=>t.code)).toEqual(['T01','T02','T03']);
    expect(world.tasks[0].areaIds).toHaveLength(1);for(let i=1;i<=6;i++)expect(world.tasks[0].goal).toContain(`A${String(i).padStart(2,'0')}`);expect(world.tasks[0].goal).toContain('全部可读不等于与本任务相关或已分配');
    expect(JSON.stringify(world.objects)).not.toMatch(/推荐|主角|干扰|方案A|方案B/);expect(world.objects.find(o=>o.name.startsWith('V24'))!.resourceData!.resource.position).toMatchObject({reportedAt:'2026-11-03T08:50:00+08:00',validUntil:'2026-11-03T09:10:00+08:00'});
  });
  it('strictly validates the shared clock shape and calendar time',()=>{
    const clock={instanceId:`run-${randomUUID()}`,businessNow:'2026-11-03T09:10:00+08:00',revision:1};expect(isScenarioClock(clock)).toBe(true);
    for(const value of [null,{...clock,revision:0},{...clock,revision:1.5},{...clock,businessNow:'2026-02-30T09:00:00Z'},{...clock,businessNow:'2026-11-03T24:00:00Z'},{...clock,extra:true},{...clock,instanceId:'../other'}])expect(isScenarioClock(value)).toBe(false);
  });
});

describe('scenario HTTP facts, controls and replay',()=>{
  it('is opt-in, separates credentials, deduplicates create and exposes no future facts through ordinary reads',async()=>{
    const disabled=createMockContextServer({token,controlToken}),base=await disabled.listen();cleanup.push(()=>disabled.close());expect((await fetch(`${base}/control/scenarios`,{headers:{Authorization:`Bearer ${controlToken}`}})).status).toBe(404);
    const scene=await setup();expect((await scene.request('/control/scenarios','GET',undefined,token)).status).toBe(401);
    const id=randomUUID(),created=await scene.create('source_replay',id);expect(created.status).toBe(200);const duplicate=await scene.create('source_replay',id);expect(duplicate.body).toEqual(created.body);
    expect((await scene.create('main_story',id)).status).toBe(409);expect((await scene.request<ScenarioMutationResult>(`/control/operations/${id}`)).body).toEqual(created.body);
    const active=await scene.activate(created.body.instance);expect(active.status).toBe(200);
    const current=await scene.request<SituationCurrent>('/situation/objects?limit=100');expect(current.body.items).toHaveLength(53);expect(current.body).toMatchObject({asOf:'2026-11-03T09:10:00+08:00',snapshotClock:{instanceId:created.body.instance.instanceId,businessNow:'2026-11-03T09:10:00+08:00'}});
    expect((await scene.request<SituationCurrent>(`/situation/objects?limit=100&objectTypes=${encodeURIComponent(JSON.stringify(['resource']))}&category=fire_engine`)).body.items).toHaveLength(20);expect((await scene.request<SituationCurrent>(`/situation/objects?limit=100&objectTypes=${encodeURIComponent(JSON.stringify(['resource']))}&category=vehicle`)).body.items).toHaveLength(4);
    expect((await scene.request<{items:unknown[]}>('/intel/reports?limit=100')).body.items).toEqual([]);
    const hidden=`${created.body.instance.instanceId}-report-E08-a`;expect((await scene.request(`/intel/reports/${hidden}`)).status).toBe(404);
    expect((await scene.request<{instanceId:string}>('/control/state')).body.instanceId).toBe('legacy');
  });
  it('keeps save/send distinct, supports operation recovery, rejects paused work and hides scene actions from legacy controls',async()=>{
    const scene=await setup(),created=await scene.create(),active=await scene.activate(created.body.instance),op=randomUUID(),applied=await scene.apply(active.body.instance,'E01',op);expect(applied.status).toBe(200);
    expect(applied.body.actions[0]).toMatchObject({sendState:'unsent',actor});expect(scene.receiver.notifications).toEqual([]);
    expect((await scene.apply(active.body.instance,'E01',op)).body).toEqual(applied.body);expect((await scene.apply(applied.body.instance,'E02')).status).toBe(409);
    expect((await scene.request(`/control/actions/${applied.body.actions[0].id}`)).status).toBe(404);expect((await scene.request(`/control/actions/${applied.body.actions[0].id}/send`,'POST',{})).status).toBe(404);
    const paused=await scene.request<ScenarioMutationResult>(`/control/instances/${created.body.instance.instanceId}/control`,'POST',{action:'pause',clientActionId:randomUUID(),expectedRevision:applied.body.instance.revision,actor});expect(paused.status).toBe(200);expect((await scene.send(applied.body.actions[0])).status).toBe(409);expect(scene.receiver.notifications).toHaveLength(0);
    const resumed=await scene.request<ScenarioMutationResult>(`/control/instances/${created.body.instance.instanceId}/control`,'POST',{action:'resume',clientActionId:randomUUID(),expectedRevision:paused.body.instance.revision,actor});expect(resumed.body.instance.businessNow).toBe(applied.body.instance.businessNow);
    scene.receiver.setLoseAck(true);const sent=await scene.send(applied.body.actions[0]);expect(sent.body).toMatchObject({sendState:'accepted',deliveryActor:actor});expect(scene.receiver.notifications).toHaveLength(1);expect((await scene.send(sent.body)).body.receipt).toEqual(sent.body.receipt);expect(scene.receiver.notifications).toHaveLength(1);
    expect((await scene.request<ScenarioMutationResult>(`/control/operations/${op}`)).body.actions[0].sendState).toBe('accepted');
  });
  it('replays all twelve steps with thirteen independent receipts while a late report never restores the road or moves vehicles',async()=>{
    const scene=await setup(),created=await scene.create();let instance=(await scene.activate(created.body.instance)).body.instance;const initial=await scene.request<SituationCurrent>('/situation/objects?limit=100');
    for(let index=1;index<=12;index++){
      const step=`E${String(index).padStart(2,'0')}`,result=await scene.apply(instance,step);expect(result.status,step).toBe(200);instance=result.body.instance;for(const action of result.body.actions){expect((await scene.send(action)).body.sendState).toBe('accepted');}
      if(index===9){const road=await scene.request<SituationCurrent>(`/situation/objects?objectRefs=${encodeURIComponent(JSON.stringify([{systemId:'situation',objectType:'road',objectId:`${instance.instanceId}-R01`}]))}`);expect(road.body.items[0]).toMatchObject({revision:2,properties:{passability:'closed'}});const report=await scene.request<InformationDetail>(`/intel/reports/${instance.instanceId}-report-E09-a`);expect(report.body.item.observedAt).toBe('2026-11-03T09:11:00+08:00');expect(report.body).toMatchObject({snapshotClock:{businessNow:'2026-11-03T09:24:00+08:00'}});}
    }
    expect(scene.receiver.notifications).toHaveLength(13);expect(new Set(scene.receiver.notifications.map(n=>n.sourceMessageId)).size).toBe(13);expect(instance.businessNow).toBe('2026-11-03T09:40:00+08:00');
    const complete=await scene.request<ScenarioPreview>(`/control/instances/${instance.instanceId}/preview`,'POST',{});expect(complete.body).toMatchObject({canApply:false,step:null});expect(complete.body.reason).toContain('不表示业务任务完成');
    const final=await scene.request<SituationCurrent>('/situation/objects?limit=100');expect(final.body.items.filter(o=>o.resourceData?.resource.vehicle).map(o=>o.geometry)).toEqual(initial.body.items.filter(o=>o.resourceData?.resource.vehicle).map(o=>o.geometry));
    expect(scene.receiver.notifications.find(n=>n.subjectId.endsWith('E08-a'))!.text).not.toMatch(/V07|V08|V11|V13|已出发|已到场/);
  });
  it('stops the main story at the decision boundary without fabricating approval or arrival',async()=>{
    const scene=await setup(),created=await scene.create('main_story');let instance=(await scene.activate(created.body.instance)).body.instance;
    for(let i=1;i<=5;i++){const applied=await scene.apply(instance,`E${String(i).padStart(2,'0')}`);expect(applied.status).toBe(200);instance=applied.body.instance;for(const action of applied.body.actions)await scene.send(action);}
    const preview=await scene.request<ScenarioPreview>(`/control/instances/${instance.instanceId}/preview`,'POST',{});expect(preview.body.canApply).toBe(false);expect(preview.body.reason).toContain('待选择/批准');expect((await scene.apply(instance,'E06')).status).toBe(409);expect(preview.body.instance.businessNow).toBe('2026-11-03T09:18:00+08:00');
  });
  it('pins source pagination, rejects mixed rounds and preserves fixed references when a new round replaces the old',async()=>{
    const scene=await setup(),first=await scene.create();let instance=(await scene.activate(first.body.instance)).body.instance;
    const page=await scene.request<SituationCurrent>('/situation/objects?limit=1'),paused=await scene.request<ScenarioMutationResult>(`/control/instances/${instance.instanceId}/control`,'POST',{action:'pause',clientActionId:randomUUID(),expectedRevision:instance.revision,actor});instance=paused.body.instance;
    expect((await scene.request(`/situation/objects?limit=1&cursor=${page.body.nextCursor}`)).status).toBe(409);
    const second=await scene.create(),next=await scene.activate(second.body.instance,1);expect(next.status).toBe(200);const current=await scene.request<SituationCurrent>('/situation/objects?limit=100');expect(current.body.items.every(o=>o.ref.objectId.startsWith(second.body.instance.instanceId))).toBe(true);
    const oldRef={systemId:'situation',objectType:'resource',objectId:`${instance.instanceId}-V01`},newRef={...oldRef,objectId:`${second.body.instance.instanceId}-V01`};const old=await scene.request<SituationCurrent>(`/situation/objects?objectRefs=${encodeURIComponent(JSON.stringify([oldRef]))}`);expect(old.status).toBe(200);expect(old.body.items[0].ref).toEqual(oldRef);
    expect((await scene.request(`/situation/objects?objectRefs=${encodeURIComponent(JSON.stringify([oldRef,newRef]))}`)).status).toBe(409);expect((await scene.request(`/situation/objects?objectRefs=${encodeURIComponent(JSON.stringify([oldRef,{...oldRef,objectId:'vehicles-west-01'}]))}`)).status).toBe(409);
    expect((await scene.request<ScenarioInstanceDetail>(`/control/instances/${instance.instanceId}`)).body.instance.status).toBe('frozen');expect((await scene.apply(instance,'E01')).status).toBe(409);
  });
  it('requires explicit retention of unsent old messages and blocks replacement while receipt remains unknown',async()=>{
    const scene=await setup(),first=await scene.create();let instance=(await scene.activate(first.body.instance)).body.instance;const applied=await scene.apply(instance,'E01');instance=applied.body.instance;
    scene.receiver.setFail(true);expect((await scene.send(applied.body.actions[0])).body.sendState).toBe('unconfirmed');const paused=await scene.request<ScenarioMutationResult>(`/control/instances/${instance.instanceId}/control`,'POST',{action:'pause',clientActionId:randomUUID(),expectedRevision:instance.revision,actor});const second=await scene.create();expect((await scene.activate(second.body.instance,1,true)).status).toBe(409);
    scene.receiver.setFail(false);const resume=await scene.request<ScenarioMutationResult>(`/control/instances/${instance.instanceId}/control`,'POST',{action:'resume',clientActionId:randomUUID(),expectedRevision:paused.body.instance.revision,actor});await scene.send(applied.body.actions[0]);const next=await scene.apply(resume.body.instance,'E02');const pauseAgain=await scene.request<ScenarioMutationResult>(`/control/instances/${instance.instanceId}/control`,'POST',{action:'pause',clientActionId:randomUUID(),expectedRevision:next.body.instance.revision,actor});expect(pauseAgain.status).toBe(200);
    expect((await scene.activate(second.body.instance,1)).status).toBe(409);expect((await scene.activate(second.body.instance,1,true)).status).toBe(200);expect(scene.receiver.notifications).toHaveLength(1);expect((await scene.send(next.body.actions[0])).status).toBe(409);
  });
  it('rolls back the entire fact/clock/action mutation on a real SQLite failure and restores without automatic replay',async()=>{
    const directory=await mkdtemp(join(tmpdir(),'axon-scene-'));cleanup.push(()=>rm(directory,{recursive:true,force:true}));const databasePath=join(directory,'simulation.sqlite'),scene=await setup(databasePath),created=await scene.create(),active=await scene.activate(created.body.instance);
    const db=new DatabaseSync(databasePath);cleanup.push(async()=>db.close());db.exec("CREATE TRIGGER fail_scene BEFORE UPDATE ON scenario_instances BEGIN SELECT RAISE(FAIL,'simulated persistence failure'); END");const op=randomUUID(),failed=await scene.apply(active.body.instance,'E01',op);expect(failed.status).not.toBe(200);const unchanged=(await scene.request<ScenarioInstanceDetail>(`/control/instances/${active.body.instance.instanceId}`)).body;expect(unchanged.instance).toEqual(active.body.instance);expect(unchanged.reports).toEqual([]);expect(unchanged.actions).toEqual([]);expect((await scene.request(`/control/operations/${op}`)).status).toBe(404);
    db.exec('DROP TRIGGER fail_scene');const applied=await scene.apply(active.body.instance,'E01',op);expect(applied.status).toBe(200);await scene.close();
    const restored=createMockContextServer({token,controlToken,scenariosEnabled:true,databasePath,targets:scene.receiver.targets}),url=await restored.listen();cleanup.push(()=>restored.close());const response=await fetch(`${url}/control/instances/${active.body.instance.instanceId}`,{headers:{Authorization:`Bearer ${controlToken}`}}),detail=await response.json() as ScenarioInstanceDetail;expect(detail.instance).toEqual(applied.body.instance);expect(detail.actions[0].sendState).toBe('unsent');expect(scene.receiver.notifications).toEqual([]);
    const ledger=await fetch(`${url}/control/operations/${op}`,{headers:{Authorization:`Bearer ${controlToken}`}});expect((await ledger.json() as ScenarioMutationResult).operation.id).toBe(op);
  });
  it('keeps business time fixed while real time changes and reports bounded instance pages',async()=>{
    const scene=await setup(),created=await scene.create(),active=await scene.activate(created.body.instance);const first=await scene.request<SituationCurrent>('/situation/objects?limit=100');vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2030-01-01T12:00:00Z'));const second=await scene.request<SituationCurrent>('/situation/objects?limit=100');expect(second.body).toEqual(first.body);expect(second.body.asOf).toBe(active.body.instance.businessNow);vi.useRealTimers();
    for(let i=0;i<3;i++)await scene.create();const page=await scene.request<ScenarioInstances>('/control/instances?limit=2');expect(page.body.items).toHaveLength(2);expect(page.body.hasMore).toBe(true);const rest=await scene.request<ScenarioInstances>(`/control/instances?limit=2&cursor=${page.body.nextCursor}`);expect(rest.body.items).toHaveLength(2);expect(rest.body.hasMore).toBe(false);expect(new Set([...page.body.items,...rest.body.items].map(i=>i.instanceId)).size).toBe(4);
  });
});
