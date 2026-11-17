import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CapabilityService } from '../src/capabilities/service.js';
import { initializeR2Schema } from '../src/capabilities/management.js';
import { SkillService } from '../src/skills/service.js';
import type { SkillActor, SkillRef } from '../src/contracts/skills.js';

const dataDir=await mkdtemp(join(tmpdir(),'axon-r3-storage-timing-'));
const capabilities=await CapabilityService.open(dataDir);initializeR2Schema(capabilities.db);capabilities.close();
const actor:SkillActor={userId:'synthetic-performance-admin',assertAdministrator:()=>{}};
const principal={userId:'synthetic-user',seatId:'business',canCollaborate:true};
const service=await SkillService.open(dataDir,{createdNew:true,seats:()=>['business']});
const refs:SkillRef[]=[];const imports:number[]=[];
const stats=(samples:number[])=>{const sorted=[...samples].sort((a,b)=>a-b);return{n:samples.length,p50Ms:sorted[Math.ceil(sorted.length*0.5)-1],p95Ms:sorted[Math.ceil(sorted.length*0.95)-1]};};
try{
  for(let i=0;i<12;i++){
    const created=await service.create(actor,{clientActionId:randomUUID()});const id=created.skill.skillId;const started=performance.now();
    const draft=await service.saveDraft(actor,id,{expectedDraftRevision:1,files:[
      {path:'SKILL.md',contentBase64:Buffer.from(`---\nname: measure-${i}\ndescription: Synthetic timing\n---\nUse the supplied template.`).toString('base64')},
      {path:'templates/reference.txt',contentBase64:Buffer.alloc(256*1024,65).toString('base64')},
    ]});imports.push(performance.now()-started);
    await service.setPolicy(actor,id,{expectedRevision:0,mode:'seats',seatIds:['business'],clientActionId:randomUUID()});
    refs.push(await service.publish(actor,id,{expectedDraftRevision:draft.draftRevision,expectedCurrentRevisionId:null,releaseNotes:'Synthetic timing',clientActionId:randomUUID()}));
  }
  const catalog:number[]=[],warm:number[]=[],cold:number[]=[];
  for(let i=0;i<100;i++){const t=performance.now();assert.equal(service.catalog(principal).length,12);catalog.push(performance.now()-t);}
  for(let i=0;i<30;i++){const t=performance.now();await service.resolve(refs[i%refs.length],principal);warm.push(performance.now()-t);}
  for(let i=0;i<20;i++){
    const reader=await SkillService.open(dataDir,{seats:()=>['business']});
    try{const t=performance.now();await reader.resolve(refs[i%refs.length],principal);cold.push(performance.now()-t);}finally{reader.close();}
  }
  const created=await service.create(actor,{clientActionId:randomUUID()});
  await service.setPolicy(actor,created.skill.skillId,{expectedRevision:0,mode:'none',seatIds:[],clientActionId:randomUUID()});
  const input={expectedDraftRevision:1,expectedCurrentRevisionId:null,releaseNotes:'Eight same-action callers',clientActionId:randomUUID()};
  const concurrency:number[]=[];
  const values=await Promise.all(Array.from({length:8},async()=>{const t=performance.now();const value=await service.publish(actor,created.skill.skillId,input);concurrency.push(performance.now()-t);return value;}));
  assert.equal(new Set(values.map(v=>v.revisionId)).size,1);assert.equal(service.detail(created.skill.skillId).publications.length,1);
  const report={passed:true,dataDir,scope:'Synthetic storage and metadata timings; no model, no SLO claim; OS cache not flushed; cold means a new service instance; nearest-rank percentiles; concurrent local test load',catalogAssets:12,resourceBytesPerPackage:256*1024,saveSnapshot:stats(imports),metadataCatalog:stats(catalog),warmResolve:stats(warm),coldInstanceResolve:stats(cold),sameActionPublication:stats(concurrency),publicationCount:1};
  const evidence=join(dataDir,'performance-evidence.json');await writeFile(evidence,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({...report,evidence}));
}finally{service.close();}
