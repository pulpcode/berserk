import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it } from 'vitest';
import { ScenarioStore } from '../scripts/mock-context/scenarios/store.js';
import { scenarioQuery } from '../scripts/mock-context/scenarios/query.js';
import { executionDefinition } from '../scripts/mock-context/scenarios/data.js';
import { commandHash } from '../src/commands/validation.js';
import { decodeContextResponse, normalizeContextQuery } from '../src/context/validation.js';
import type { CommandInput, ExternalCommand } from '../src/contracts/commands.js';
import type { SituationChanges, SituationCurrent } from '../src/contracts/context.js';
const actor={userId:'director',seatId:'seat-director'}, cleanup:Array<()=>unknown|Promise<unknown>>=[];
afterEach(async()=>{for(const f of cleanup.splice(0).reverse())await f();});
async function fixture(version='6'){
 const dir=await mkdtemp(join(tmpdir(),'execution-repair-'));cleanup.push(()=>rm(dir,{recursive:true,force:true}));
 const path=join(dir,'source.sqlite'),store=new ScenarioStore(path);cleanup.push(()=>store.close());
 const made=store.create({definitionId:'harbor-fire',version,mode:'source_replay',clientActionId:randomUUID()},actor),id=made.instance.instanceId;
 store.activate(id,randomUUID(),made.instance.revision,0,false,actor);
 const ref=(code:string):CommandInput['destination']=>({systemId:'situation',objectType:code.startsWith('R')?'road':'resource',objectId:`${id}-${code}`});
 const accept=()=>{for(const a of store.get(id).actions)if(a.sendState!=='accepted')store.delivery(a.id,'accepted',{status:'accepted',eventId:randomUUID(),sourceMessageId:a.notification.sourceMessageId,receivedAt:new Date().toISOString()});};
 const next=()=>{const p=store.preview(id);expect(p.canApply,p.reason).toBe(true);store.apply(id,p.step!.id,randomUUID(),p.instance.revision,actor);accept();return p.step!.id;};
 for(let i=0;i<5;i++)next();
 const taskId=randomUUID();
 const issue=(codes:string[],roads:string[],extra:Partial<CommandInput>={})=>{const command={vehicles:codes.map(ref),destination:ref('L01'),route:roads.map(ref),...extra};const input:ExternalCommand={commandId:randomUUID(),taskId,scenarioInstanceId:id,issuedBy:{seatId:'seat-control',seatName:'控制席'},command,contentHash:commandHash(command)};store.receiveCommand(input);return input;};
 const query=scenarioQuery(store);
 const read=(mode:'current'|'changes',input:Record<string,unknown>={})=>{const params=normalizeContextQuery('situation_query',{systemId:'situation',mode,...input});const u=new URL(`http://source/situation/${mode==='current'?'objects':'changes'}`);for(const[k,v]of Object.entries(params))if(!['systemId','mode'].includes(k))u.searchParams.set(k,Array.isArray(v)?JSON.stringify(v):String(v));return decodeContextResponse('situation_query',params,query(u,id)) as SituationChanges & SituationCurrent;};
 const rewrite=(update:(r:ReturnType<ScenarioStore['get']>)=>void)=>{const r=store.get(id);update(r);const db=new DatabaseSync(path);try{db.prepare('UPDATE scenario_instances SET body=? WHERE instance_id=?').run(JSON.stringify(r),id);}finally{db.close();}};
 return {id,store,ref,accept,next,issue,read,rewrite,query};
}
it('keeps the v5 definition fingerprint and execution response readable',async()=>{
 expect(executionDefinition.definitionHash).toBe('487d9ea157c728467c6a176e5a2f47753da17d69c553dbc793621bc83e26992a');
 const f=await fixture('5'),input=f.issue(['V01'],['R03']);f.next();expect(f.store.commandExecution(input.commandId)?.vehicles[0].state).toBe('en_route');expect(f.read('changes').historyView).toBeUndefined();
});
it('publishes destination, actual route and distant blocking road, and clears blocking language on cancel',async()=>{
 const f=await fixture(),input=f.issue(['V07','V08','V11','V13'],['R01','R03']);while(f.next()!=='E08'){/* advance actual execution */}
 const record=f.store.get(f.id),notice=record.actions.find(a=>a.notification.title.includes('前方道路封闭'))!;
 expect(notice.notification.text).toContain('指令目的地：临港三号仓库');expect(notice.notification.text).toContain('中轴桥');expect(notice.notification.text).toContain('当前位置不代表阻断路段位置');expect(notice.notification.text).not.toContain('预计到场2026');
 const report=record.reports.find(r=>r.subjectId===notice.notification.subjectId)!;expect(report.objectRefs).toEqual(expect.arrayContaining([f.ref('L01'),f.ref('R01'),f.ref('R03')]));expect(report.summary.length).toBeLessThanOrEqual(1000);expect(report.content).toContain('V13');
 const revision=f.store.commandExecution(input.commandId)!.revision;f.issue(['V13'],[],{action:'cancel',targetCommandId:input.commandId,expectedExecutionRevision:revision});
 const cancel=f.store.get(f.id).actions.at(-1)!;expect(cancel.notification.text).toContain('已取消');expect(cancel.notification.text).not.toContain('当前位置不代表阻断路段位置');expect(f.store.commandExecution(input.commandId)?.vehicles.find(v=>v.vehicle.objectId.endsWith('-V13'))?.state).toBe('cancelled');
});
it('keeps subset reroutes in per-vehicle facts and arrival scoped to actually arrived vehicles',async()=>{
 const f=await fixture(),input=f.issue(['V07','V08'],['R01','R03']);while(f.next()!=='E10'){/* source facts and movement */}
 f.issue(['V07'],['R02','R03'],{action:'reroute',targetCommandId:input.commandId,expectedExecutionRevision:f.store.commandExecution(input.commandId)!.revision});f.accept();
 const notice=f.store.get(f.id).actions.at(-1)!;expect(notice.notification.text).toContain('东环线');expect(notice.notification.text).toContain('预计到场');expect(notice.notification.text).not.toContain('V08');
 for(let i=0;i<100 && f.store.commandExecution(input.commandId)!.vehicles[0].state!=='arrived';i++)f.next();
 const arrival=f.store.get(f.id).actions.findLast(a=>a.notification.title.includes('已到场'))!;expect(arrival.notification.text).toContain('本指令车组已到场1/2辆');expect(f.store.commandExecution(input.commandId)?.vehicles[1].state).toBe('blocked');
});
it('reads both original large-history ranges to the final cursor while preserving source/current complete traces',async()=>{
 const f=await fixture(),input=f.issue(['V07','V08','V11','V13'],['R01','R03']);while(f.next()!=='E10'){/* source progression */}
 f.issue(['V07','V08','V11','V13'],['R02','R03'],{action:'reroute',targetCommandId:input.commandId,expectedExecutionRevision:f.store.commandExecution(input.commandId)!.revision});f.accept();
 for(let i=0;i<120 && f.store.commandExecution(input.commandId)!.status!=='completed';i++)f.next();
 const before=JSON.stringify(f.store.get(f.id));
 for(const filters of [{objectTypes:['resource'],limit:100,from:'2026-11-03T09:30:00+08:00',to:'2026-11-03T09:38:14+08:00'},{objectRefs:[f.ref('V13')],limit:50}]){
  const expected=f.store.get(f.id).changes.filter(c=>('objectRefs'in filters?c.after.ref.objectId.endsWith('-V13'):c.after.ref.objectType==='resource'&&Date.parse(c.effectiveAt!)>=Date.parse(filters.from!)&&Date.parse(c.effectiveAt!)<Date.parse(filters.to!))).map(c=>c.cursor),actual:string[]=[];let cursor:string|undefined;
  do{const page=f.read('changes',{...filters,...(cursor?{cursor}:{})});expect(page.historyView).toBe('state');expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(200*1024);for(const c of page.items){actual.push(c.cursor);if('executionState'in c.after.properties){expect(c.after.properties).toMatchObject({executionTrackIncluded:false});expect(c.after.properties).not.toHaveProperty('executionTrack');}}cursor=page.nextCursor??undefined;if(!cursor)expect(page.nextAfter).toBeTruthy();}while(cursor);
  expect(actual).toEqual(expected);
 }
 const current=f.read('current',{objectRefs:[f.ref('V13')]});expect(current.items[0].properties).toHaveProperty('executionTrack');expect(JSON.stringify(f.store.get(f.id))).toBe(before);
 const summary=f.read('changes',{objectRefs:[f.ref('V13')],limit:100});const params=normalizeContextQuery('situation_query',{systemId:'situation',mode:'changes',objectRefs:[f.ref('V13')],limit:100});const forged=structuredClone(summary);delete forged.historyView;expect(()=>decodeContextResponse('situation_query',params,forged)).toThrow();
});
it('paginates by UTF-8 bytes using actual returned count and refuses an indivisible oversized item',async()=>{
 const f=await fixture();f.rewrite(r=>{r.reports=Array.from({length:100},(_,i)=>({reportId:`${f.id}-large-${String(i).padStart(3,'0')}`,subjectId:`${f.id}-subject-${i}`,revision:1,title:'确认',summary:'确'.repeat(1000),content:'正文',objectRefs:[],areaIds:[],observedAt:r.instance.businessNow,publishedAt:r.instance.businessNow,validTime:null}));});
 const ids:string[]=[];let cursor:string|undefined;do{const u=new URL('http://source/intel/reports?limit=100');if(cursor)u.searchParams.set('cursor',cursor);const raw=f.query(u,f.id) as {items:{reportId:string}[];limit:number;hasMore:boolean;nextCursor:string|null};expect(Buffer.byteLength(JSON.stringify(raw))).toBeLessThanOrEqual(200*1024);expect(raw.limit).toBe(100);expect(raw.items.length).toBeLessThan(100);ids.push(...raw.items.map(x=>x.reportId));cursor=raw.nextCursor??undefined;}while(cursor);expect(ids).toEqual(f.store.get(f.id).reports.map(x=>x.reportId));
 f.rewrite(r=>{r.reports=[{...r.reports[0],summary:'大'.repeat(100000)}];});expect(()=>f.query(new URL('http://source/intel/reports?limit=1'),f.id)).toThrow(/单条/);
});

it('does not advertise a waiting amendment ETA while its remaining route is still closed',async()=>{
 const f=await fixture(),input=f.issue(['V07'],['R01','R03']);while(f.next()!=='E08'){/* close remaining route */}
 f.issue(['V07'],['R01','R03'],{action:'reroute',targetCommandId:input.commandId,expectedExecutionRevision:f.store.commandExecution(input.commandId)!.revision});
 const notice=f.store.get(f.id).actions.at(-1)!;expect(notice.notification.text).toContain('预计到场未确定');expect(notice.notification.text).not.toContain('预计到场2026');
});
