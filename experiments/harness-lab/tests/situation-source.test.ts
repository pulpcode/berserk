import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createMockContextServer } from '../scripts/mock-context/server.js';
import { situationObject } from '../src/context/validation.js';
import { mapFixtures } from '../scripts/mock-context/map-fixtures.js';
const cleanups:Array<()=>Promise<unknown>>=[];
afterEach(async()=>{for(const close of cleanups.splice(0).reverse())await close();});
describe('persistent situation source',()=>{
 it('bounds the control projection to latest reports and recent actions without losing history',async()=>{
   const mock=createMockContextServer({token:'q',controlToken:'c',instanceId:'bounded',day:'2026-10-11',targets:[{systemId:'intel',sourceId:'intel-source',url:'http://127.0.0.1:1',token:'n'}]});
   const url=await mock.listen();cleanups.push(()=>mock.close());
   const {reportId,revision:_revision,...report}=mapFixtures('bounded','2026-10-11').reports[0];void _revision;
   for(let revision=1;revision<=22;revision++){
     const response=await fetch(url+'/control/report-updates',{method:'POST',headers:{Authorization:'Bearer c','Content-Type':'application/json'},body:JSON.stringify({clientActionId:randomUUID(),reportId,expectedRevision:revision,report:{...report,content:'x'.repeat(60000)}})});
     expect(response.status).toBe(200);
   }
   const response=await fetch(url+'/control/state',{headers:{Authorization:'Bearer c'}});const text=await response.text(),state=JSON.parse(text);
   expect(state.reports.filter((item:{reportId:string})=>item.reportId===reportId)).toHaveLength(1);
   expect(state.reports.find((item:{reportId:string})=>item.reportId===reportId).revision).toBe(23);expect(state.actions).toHaveLength(20);
   expect(Buffer.byteLength(text)).toBeLessThan(256*1024);
   const old=await fetch(url+`/intel/reports/${reportId}?revision=2`,{headers:{Authorization:'Bearer q'}});expect((await old.json()).item.revision).toBe(2);
 });
 it('validates geometry, preserves legacy objects and rejects invalid geometry',()=>{
   const road=mapFixtures('test','2026-10-11').objects[0];expect(()=>situationObject(road,'situation')).not.toThrow();
   expect(()=>situationObject({...road,geometry:undefined,properties:{}},'situation')).not.toThrow();
   for(const geometry of [{type:'Point',coordinates:[1,2]},{type:'LineString',coordinates:[[181,1],[1,1]]},{type:'LineString',coordinates:[[1,2]]}])expect(()=>situationObject({...road,geometry},'situation')).toThrow();
 });
 it('persists snapshots and frozen notifications, deduplicates updates and separates query/control credentials',async()=>{
   const dir=await mkdtemp(join(tmpdir(),'situation-'));cleanups.push(()=>rm(dir,{recursive:true,force:true}));
   const opts={token:'query',controlToken:'control',instanceId:'test',day:'2026-10-11',databasePath:join(dir,'state.sqlite'),targets:[{systemId:'situation',sourceId:'source',url:'http://127.0.0.1:1',token:'notify'}]};
   let mock=createMockContextServer(opts),url=await mock.listen();cleanups.push(()=>mock.close());
   const call=(path:string,method='GET',body?:unknown,token='control')=>fetch(url+path,{method,headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
   expect((await call('/control/state','GET',undefined,'query')).status).toBe(401);
   const state=await (await call('/control/state')).json();expect(state.actions).toEqual([]);
   const input={clientActionId:randomUUID(),ref:state.objects[0].ref,expectedRevision:1,properties:{passability:'restricted'},effectiveAt:'2026-10-11T09:20:00+08:00',validTime:null};
   const first=await(await call('/control/object-updates','POST',input)).json();expect(first.sendState).toBe('unsent');expect(first.revision).toBe(2);
   expect(await(await call('/control/object-updates','POST',input)).json()).toEqual(first);
   expect((await call('/control/object-updates','POST',{...input,properties:{passability:'closed'}})).status).toBe(409);
   expect((await call('/control/object-updates','POST',{...input,clientActionId:randomUUID()})).status).toBe(409);
   await mock.close();mock=createMockContextServer(opts);url=await mock.listen();
   const restored=await(await call('/control/state')).json();expect(restored.objects[0].revision).toBe(2);expect(restored.actions[0]).toEqual(first);
   const sent=await(await call(`/control/actions/${first.id}/send`,'POST')).json();expect(sent.sendState).toBe('unconfirmed');
   expect((await(await call('/control/state')).json()).objects[0].revision).toBe(2);
 });
 it('keeps immutable report revisions and invalidates old object pagination after updates',async()=>{
   const mock=createMockContextServer({token:'q',controlToken:'c',instanceId:'test',day:'2026-10-11',targets:[{systemId:'intel',sourceId:'intel-source',url:'http://127.0.0.1:1',token:'n'},{systemId:'situation',sourceId:'situation-source',url:'http://127.0.0.1:1',token:'n'}]});
   const url=await mock.listen();cleanups.push(()=>mock.close());
   const query=(path:string)=>fetch(url+path,{headers:{Authorization:'Bearer q'}});
   const update=(path:string,body:unknown)=>fetch(url+path,{method:'POST',headers:{Authorization:'Bearer c','Content-Type':'application/json'},body:JSON.stringify(body)});
   const firstPage=await(await query('/situation/objects?limit=1')).json();
   const report=mapFixtures('test','2026-10-11').reports[0]; const {reportId,revision,...body}=report;
   expect((await update('/control/report-updates',{clientActionId:randomUUID(),reportId,expectedRevision:revision,report:{...body,content:'New report observation'}})).status).toBe(200);
   expect((await(await query(`/intel/reports/${reportId}?revision=1`)).json()).item.content).toBe(report.content);
   expect((await(await query(`/intel/reports/${reportId}`)).json()).item.revision).toBe(2);
   const road=mapFixtures('test','2026-10-11').objects[0];
   expect((await update('/control/object-updates',{clientActionId:randomUUID(),ref:road.ref,expectedRevision:1,properties:{passability:'closed'},effectiveAt:'2026-10-11T09:20:00+08:00',validTime:null,geometry:road.geometry})).status).toBe(400);
   await update('/control/object-updates',{clientActionId:randomUUID(),ref:road.ref,expectedRevision:1,properties:{passability:'closed'},effectiveAt:'2026-10-11T09:20:00+08:00',validTime:null});
   expect((await query(`/situation/objects?limit=1&cursor=${encodeURIComponent(firstPage.nextCursor)}`)).status).toBe(409);
   const changes=await(await query('/situation/changes')).json();expect(changes.items[0].before.properties.passability).toBe('open');expect(changes.items[0].after.properties.passability).toBe('closed');
 });
 it('recovers a lost send response using receipt lookup without another POST',async()=>{
   let posts=0,receipt:unknown;
   const receiver=createServer(async(req,res)=>{
     if(req.method==='POST'){posts++;let body='';for await(const chunk of req)body+=chunk;receipt={eventId:randomUUID(),sourceMessageId:JSON.parse(body).sourceMessageId,receivedAt:new Date().toISOString(),status:'accepted'};req.socket.destroy();return;}
     if(!receipt){res.statusCode=404;res.end('{}');return;}res.setHeader('Content-Type','application/json');res.end(JSON.stringify(receipt));
   });await new Promise<void>(r=>receiver.listen(0,'127.0.0.1',r));cleanups.push(()=>new Promise<void>(r=>receiver.close(()=>r())));
   const mock=createMockContextServer({token:'q',controlToken:'c',instanceId:'test',day:'2026-10-11',targets:[{systemId:'situation',sourceId:'source',url:`http://127.0.0.1:${(receiver.address() as AddressInfo).port}`,token:'n'}]});const url=await mock.listen();cleanups.push(()=>mock.close());
   const call=(path:string,body?:unknown)=>fetch(url+path,{method:'POST',headers:{Authorization:'Bearer c','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
   const a=await(await call('/control/object-updates',{clientActionId:randomUUID(),ref:mapFixtures('test','2026-10-11').objects[1].ref,expectedRevision:1,properties:{availableCount:2,unit:'辆'},effectiveAt:'2026-10-11T09:30:00+08:00',validTime:null})).json();
   expect((await(await call(`/control/actions/${a.id}/send`,{})).json()).sendState).toBe('accepted');
   expect((await(await call(`/control/actions/${a.id}/send`,{})).json()).sendState).toBe('accepted');expect(posts).toBe(1);
   expect((await call(`/control/actions/${a.id}/send`,{text:'replacement'})).status).toBe(400);
 });
});
