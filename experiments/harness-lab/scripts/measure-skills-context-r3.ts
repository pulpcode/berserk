/** Synthetic preparation timing, using native Pi and a deterministic fake provider. No real model/network. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PiLab } from '../src/pi/lab.js';
import { SkillService } from '../src/skills/service.js';
import type { SkillActor, SkillRef } from '../src/contracts/skills.js';
import { fakeRuntime, testConfig } from '../tests/pi/fake-runtime.js';

const dataDir=await mkdtemp(join(tmpdir(),'axon-r3-context-timing-'));
const config=testConfig(dataDir);
const actor:SkillActor={userId:'synthetic-context-admin',assertAdministrator:()=>{}};
const refs:SkillRef[]=[];
const resourceMarker='RESOURCE-BLOB-NOT-CONTEXT-';
const resource=resourceMarker+'A'.repeat(256*1024-resourceMarker.length);
const seedRuntime=await fakeRuntime(config,()=>({text:'合成测量完成'}));
const seed=await PiLab.create(config,seedRuntime.runtime);
try{
  // Isolated fixture authority only; no formal user account, credentials or production data copied.
  seed.skills.close();seed.skills=await SkillService.open(dataDir);
  for(let index=0;index<12;index++){
    const detail=await seed.skills.create(actor,{clientActionId:randomUUID()});
    const content=`---\nname: context-${index}\ndescription: Synthetic context timing method ${index}\n---\nMETHOD-CONTEXT-${index}\n${'合成方法说明。'.repeat(256)}\n`;
    const draft=await seed.skills.saveDraft(actor,detail.skill.skillId,{expectedDraftRevision:1,files:[
      {path:'SKILL.md',contentBase64:Buffer.from(content).toString('base64')},
      {path:'templates/reference.txt',contentBase64:Buffer.from(resource).toString('base64')},
    ]});
    await seed.skills.setPolicy(actor,detail.skill.skillId,{expectedRevision:0,mode:'all',seatIds:[],clientActionId:randomUUID()});
    refs.push(await seed.skills.publish(actor,detail.skill.skillId,{expectedDraftRevision:draft.draftRevision,expectedCurrentRevisionId:null,releaseNotes:'Synthetic context timing fixture',clientActionId:randomUUID()}));
  }
}finally{await seed.close();}

interface Sample { instance:'cold_instance'|'warm_instance'; selection:'metadata_only'|'full_selected_method'; startToResourcesLoadedMs:number; startToProviderContextMs:number; resourcesPayloadBytes:number; providerContextBytes:number; organizationCatalogEntries:number; modelCalls:number }
const samples:Sample[]=[];
let lab:PiLab|undefined;
let current:{started:number;providerAt?:number;providerBytes?:number;resourcesAt?:number;resourcesBytes?:number;organizationEntries?:number;calls:number;selected:boolean;methodMarker:string}|undefined;
const open=async()=>{
  const fake=await fakeRuntime(config,()=>({text:'合成测量完成'}));
  const original=fake.runtime.streamSimple.bind(fake.runtime);
  fake.runtime.streamSimple=(...args)=>{
    assert.ok(current,'No active preparation measurement');
    const serialized=JSON.stringify(args[1]);
    current.providerAt=performance.now();current.providerBytes=Buffer.byteLength(serialized);current.calls++;
    assert.ok(!serialized.includes(resourceMarker),'A package resource was eagerly inserted into model context');
    if(current.selected)assert.ok(serialized.includes(current.methodMarker),'Selected method body was not actually delivered');
    return original(...args);
  };
  return PiLab.create(config,fake.runtime);
};
const request=async(instance:Sample['instance'],selected:boolean,index:number)=>{
  assert.ok(lab);
  const session=await lab.createSession();
  const ref=refs[index%refs.length];
  const descriptor=lab.skills.catalog({userId:'seat:test-seat',seatId:'test-seat',canCollaborate:true}).find(item=>item.skillId===ref.skillId)!;
  assert.ok(descriptor);
  const skill=selected?{id:ref.skillId,hash:lab.skills.methodHash(ref),revisionId:ref.revisionId,packageDigest:ref.packageDigest}:undefined;
  current={started:performance.now(),calls:0,selected,methodMarker:`METHOD-CONTEXT-${index%refs.length}`};
  await lab.start(session.id,'仅回复合成测量完成，不使用工具。',skill?{skill}:{}).run(event=>{
    if(event.type!=='resources.loaded')return;
    current!.resourcesAt=performance.now();current!.resourcesBytes=Buffer.byteLength(JSON.stringify(event));
    current!.organizationEntries=event.resources.skills.filter(method=>method.schemaVersion===2).length;
  });
  assert.equal(lab.get(session.id).lastResult?.status,'succeeded');
  assert.equal(current.calls,1);assert.equal(current.organizationEntries,12);
  assert.ok(current.resourcesAt!==undefined&&current.providerAt!==undefined&&current.resourcesBytes!==undefined&&current.providerBytes!==undefined&&current.organizationEntries!==undefined);
  assert.ok(current.providerAt>=current.resourcesAt,'Provider saw context before host resource preparation completed');
  samples.push({instance,selection:selected?'full_selected_method':'metadata_only',startToResourcesLoadedMs:current.resourcesAt-current.started,
    startToProviderContextMs:current.providerAt-current.started,resourcesPayloadBytes:current.resourcesBytes,providerContextBytes:current.providerBytes,
    organizationCatalogEntries:current.organizationEntries,modelCalls:current.calls});
  current=undefined;
};
try{
  // Six new PiLab instances, with startup excluded from the request-start measurement.
  for(let index=0;index<6;index++){
    lab=await open();try{await request('cold_instance',index%2===1,index);}finally{await lab.close();lab=undefined;}
  }
  // Ten fresh conversations in one reopened instance; no growing conversation history confound.
  lab=await open();for(let index=0;index<10;index++)await request('warm_instance',index%2===1,index);
}finally{await lab?.close();}
const stats=(values:number[])=>{const sorted=[...values].sort((a,b)=>a-b);return{n:values.length,p50:sorted[Math.max(0,Math.ceil(values.length*.5)-1)],p95:sorted[Math.max(0,Math.ceil(values.length*.95)-1)]};};
const groups=[];
for(const instance of ['cold_instance','warm_instance']as const)for(const selection of ['metadata_only','full_selected_method']as const){
  const values=samples.filter(item=>item.instance===instance&&item.selection===selection);
  groups.push({instance,selection,startToResourcesLoadedMs:stats(values.map(item=>item.startToResourcesLoadedMs)),startToProviderContextMs:stats(values.map(item=>item.startToProviderContextMs)),providerContextBytes:stats(values.map(item=>item.providerContextBytes))});
}
const report={passed:true,dataDir,scope:'Native Pi request resource/context preparation with deterministic fake provider; no network model calls, Docker timing, first-token claim or SLO',
  qualifications:['Cold means a newly opened PiLab instance; application startup is excluded from request timing.','Percentiles use nearest rank on these small samples; they are descriptive, not a latency guarantee.','OS/filesystem caches were not flushed. Warm means repeated fresh conversations in one instance, not a claimed immutable-content cache hit.','Preparation is measured from PiLab.start invocation to resources.loaded, and to the fake streamSimple context entry after serializing context to count bytes.','The catalog has twelve published organization packages plus existing builtins; selected method body is delivered, package template bytes are not placed in context.'],
  packageCount:12,resourceBytesPerPackage:Buffer.byteLength(resource),requestCount:samples.length,fakeProviderCalls:samples.reduce((sum,sample)=>sum+sample.modelCalls,0),groups,samples};
const evidence=join(dataDir,'context-performance-evidence.json');await writeFile(evidence,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:true,evidence,requestCount:report.requestCount,groups}));
