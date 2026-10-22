import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {mapTrialRequest,type MapTrialManifest} from '../../../../experiments/harness-lab/scripts/probe-situation-map.js';
import type {AnnotationReceipt,AnnotationRef} from '../../../../experiments/harness-lab/src/contracts/annotations.js';
import type {WorkspaceResources} from '../../../../experiments/harness-lab/src/contracts/index.js';
import {auditPayload,type Payload} from '../r3-20261022/audit.js';
import {fakeResponse,request} from '../r3-20261022/http-probe.js';
import {baselineRevision,buildRuntime,digest,hashes,offlineEnvironment,loopbackOnly,selectionFor,treatmentPaths,type Runtime,type RuntimeGroup} from './runtime.js';

interface Definition {name:string;parameters:Record<string,unknown>;description:string}
interface Running {runtime:Runtime;group:RuntimeGroup;ref:AnnotationRef;stage:'map'|'spatial';step:number;payloads:Payload[]}
const json=<T>(file:string):T=>JSON.parse(readFileSync(file,'utf8')) as T;
const groups=['E0','E1','E2'] as const;

test('archives E0/E1/E2 with only frozen body/backend treatments and exercises their real HTTP/Pi contracts',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'r6-runtime-')),original=globalThis.fetch;
 let active:Running|undefined,scriptError:unknown;
 const definitions=new Map<RuntimeGroup,Definition[]>(),results=new Map<RuntimeGroup,unknown>(),locks=new Set<string>(),archives=new Set<string>();
 globalThis.fetch=async(input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input));
  if(url.origin!=='https://api.deepseek.com')return loopbackOnly(original)(input,init);
  try {
   assert.ok(active);const payload=JSON.parse(String(init?.body)) as Payload;active.payloads.push(payload);
   const tools=(payload.tools as Array<{function:Definition}>).map(tool=>tool.function);
   if(!definitions.has(active.group))definitions.set(active.group,tools);else assert.deepEqual(tools,definitions.get(active.group));
   assert.deepEqual((tools.find(tool=>tool.name==='skill_read')!.parameters.properties as Record<string,unknown>).id,{type:'string'});
   const skillId=active.stage==='map'?'map-annotations':'spatial-analysis',exposure=auditPayload(payload,active.runtime.skills,active.payloads.length,active.stage==='map'?1:2);
   assert.equal(exposure.skills[skillId].bodyPresent,true,'The explicitly selected group-specific body must enter the actual provider input');
   assert.ok(Object.values(exposure.skills).every(skill=>skill.catalogPresent));
   const point=(objectId:string)=>({kind:'annotation',ref:active!.ref,objectIds:[objectId]});
   const step=++active.step;
   if(active.stage==='map'){
    if(step===1)return fakeResponse(payload.model!,{name:'annotation_action',arguments:{action:'apply',operations:[{op:'rename_set',title:'不应写入'}]}});
    if(step===2)return fakeResponse(payload.model!,{name:'annotation_read',arguments:{mode:'draft',objectNames:['基点'],fields:['geometry']}});
   }else{
    if(step===1)return fakeResponse(payload.model!,{name:'spatial_analyze',arguments:{operation:'classify_points',input:{kind:'annotation',ref:active.ref,objectIds:['interior','boundary','exterior']},target:point('region')}});
    if(step===2)return fakeResponse(payload.model!,{name:'spatial_analyze',arguments:{operation:'relate',relation:'contains',input:point('interior'),target:point('boundary')}});
    if(step===3)return fakeResponse(payload.model!,{name:'spatial_analyze',arguments:{operation:'measure',metric:'distance',input:point('interior'),target:point('boundary')}});
   }
   return fakeResponse(payload.model!);
  }catch(error){scriptError=error;throw error;}
 };
 try {
  for(const group of groups){
   const runtime=await buildRuntime(directory,group);
   const integrity=json<{baseline:string;archiveHash:string;allowedDiff:string[];freeze_inputs:{packageLockHash:string};before:Record<string,string>;after:Record<string,string>}>(join(runtime.root,'runtime-integrity.json'));
   assert.equal(integrity.baseline,baselineRevision);archives.add(integrity.archiveHash);locks.add(integrity.freeze_inputs.packageLockHash);
   assert.deepEqual(integrity.allowedDiff,[...(group==='E0'?[]:['fixtures/skills/map-annotations/SKILL.md','fixtures/skills/spatial-analysis/SKILL.md']),...(group==='E2'?treatmentPaths:[])].sort());
   for(const unchanged of ['src/pi/lab.ts','src/pi/resource-tools.ts','package-lock.json'])assert.equal(integrity.before[unchanged],integrity.after[unchanged]);
   const trial=await runtime.start(4592,offlineEnvironment(),false,{background:'neutral'});
   try {
    const manifest:MapTrialManifest=trial.manifest;
    const workspace=await mapTrialRequest<{id:string}>(manifest,`/api/tasks/${manifest.tasks.supply}/workspace`,'planning','POST',{});
    const session=await mapTrialRequest<{id:string}>(manifest,'/api/sessions','planning','POST',{workspaceId:workspace.id});
    const receipt=await mapTrialRequest<AnnotationReceipt>(manifest,`/api/sessions/${session.id}/annotation/actions`,'planning','POST',{
     action:'create_draft',clientActionId:randomUUID(),baseRef:null,title:'离线名称与点面夹具',operations:[{op:'add_layer',layer:{layerId:'points',name:'测试对象',order:0,defaultVisible:true,features:[
      {objectId:'interior',kind:'point',name:'内部点',geometry:{type:'Point',coordinates:[1,1]}},
      {objectId:'boundary',kind:'point',name:'基点',geometry:{type:'Point',coordinates:[0,1]}},
      {objectId:'exterior',kind:'point',name:'外部点',geometry:{type:'Point',coordinates:[3,1]}},
      {objectId:'region',kind:'polygon',name:'范围',geometry:{type:'Polygon',coordinates:[[[0,0],[2,0],[2,2],[0,2],[0,0]]]}},
     ]}}],
    });assert.ok(receipt.ref);
    const catalog=await mapTrialRequest<WorkspaceResources>(manifest,`/api/workspaces/${workspace.id}/resources`,'planning');
    for(const item of catalog.skills){assert.equal(item.hash,runtime.skills[item.id].hash);assert.equal(item.description,runtime.skills[item.id].description);}
    active={runtime,group,ref:receipt.ref,stage:'map',step:0,payloads:[]};
    const map=await request(manifest,session.id,{text:'离线接线检查：按脚本验证错误和名称读取。',skill:selectionFor({targetSkill:'map-annotations'} as Parameters<typeof selectionFor>[0],'explicit',catalog)});
    assert.equal(scriptError,undefined);assert.equal(map.snapshot.lastResult?.status,'succeeded');
    const mapTools=map.snapshot.messages.filter(message=>message.role==='tool');
    const writeError=JSON.parse(mapTools[0].text) as Record<string,unknown>;
    assert.equal(writeError.code,'ANNOTATION_READ_REQUIRED');assert.equal(writeError.methodAdvice,undefined);assert.equal(writeError.outcome,'not_committed');
    assert.deepEqual(writeError.resources,[{kind:'draft',state:'missing'}]);
    if(group==='E2'){
     assert.ok(!mapTools[1].isError);const result=JSON.parse(mapTools[1].text).data;
     assert.deepEqual(result.query,{objectNames:['基点'],fields:['geometry']});
     assert.equal(result.objects.total,1);assert.deepEqual(result.objects.items[0],{objectId:'boundary',name:'基点',kind:'point',layerId:'points',geometry:{type:'Point',coordinates:[0,1]}});
    }else assert.equal(mapTools[1].isError,true,'Old tools must reject objectNames');
    active.stage='spatial';active.step=0;
    const spatial=await request(manifest,session.id,{text:'离线接线检查：按脚本验证点面分类、错误和已有测距。',skill:selectionFor({targetSkill:'spatial-analysis'} as Parameters<typeof selectionFor>[0],'explicit',catalog)});
    assert.equal(scriptError,undefined);assert.equal(spatial.snapshot.lastResult?.status,'succeeded');
    const spatialTools=spatial.snapshot.messages.filter(message=>message.role==='tool').slice(mapTools.length);
    if(group==='E2'){
     const result=spatialTools[0].spatialResult;assert.ok(result);assert.equal(result.schemaVersion,2);
     assert.deepEqual(result.values,{total:3,interior:1,boundary:1,exterior:1});
     assert.deepEqual(result.classifications,result.items.map(item=>({itemId:item.id,position:item.annotation!.objectId})));
     assert.equal(JSON.parse(spatialTools[0].text).format,'spatial.model-result.v2');
    }else assert.equal(spatialTools[0].isError,true,'Old tools must reject classify_points');
    const geometryError=JSON.parse(spatialTools[1].text) as Record<string,unknown>;
    assert.equal(geometryError.code,'SPATIAL_UNSUPPORTED_GEOMETRY');assert.equal(geometryError.methodAdvice,undefined);
    const distance=spatialTools[2].spatialResult;assert.ok(distance);assert.equal(distance.schemaVersion,1);
    assert.equal(JSON.parse(spatialTools[2].text).format,'spatial.model-result.v1');results.set(group,distance.values);
    assert.equal(active.payloads.length,7);
    const binding=await mapTrialRequest<{draft:{headRevision:number}}>(manifest,`/api/sessions/${session.id}/annotation`,'planning');assert.equal(binding.draft.headRevision,1);
    assert.deepEqual(await hashes(runtime.root),runtime.hashes,'API runs must not change isolated runtime files');
   }finally {await trial.stop();}
  }
  assert.equal(archives.size,1);assert.equal(locks.size,1);
  assert.deepEqual(definitions.get('E0'),definitions.get('E1'),'E0/E1 differ only in explicit body content');
  const e0=definitions.get('E0')!,e2=definitions.get('E2')!;
  assert.deepEqual(e0.map(tool=>tool.name),e2.map(tool=>tool.name));
  assert.deepEqual(e0.filter((tool,index)=>digest(JSON.stringify(tool))!==digest(JSON.stringify(e2[index]))).map(tool=>tool.name).sort(),['annotation_read','spatial_analyze']);
  assert.deepEqual(results.get('E0'),results.get('E1'));assert.deepEqual(results.get('E0'),results.get('E2'));
 }finally {globalThis.fetch=original;await rm(directory,{recursive:true,force:true});}
});
