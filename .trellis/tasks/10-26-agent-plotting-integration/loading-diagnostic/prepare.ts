/** Offline only: actual HTTP/Pi requests, synthetic provider. There is deliberately no live mode. */
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdir,cp} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {mapTrialAuth,mapTrialRequest} from '../../../../experiments/harness-lab/scripts/probe-situation-map.js';
import {mapState} from '../../../../experiments/harness-lab/scripts/probe-source-annotations.js';
import type {SessionSnapshot,WorkspaceResources} from '../../../../experiments/harness-lab/src/contracts/index.js';
import {prepareCase} from '../evaluation-v2/cases.js';
import {actualPayload,endpoint,type Payload} from '../evaluation-v2/provider.js';
import {buildRuntime,offlineEnvironment,sourceFreeze,digest,hashes,save,packageRoot,businessContext} from '../evaluation-v2/runtime.js';
import {responseModel} from '../evaluation-v2/budget.js';
import {auditPayload} from '../../10-15-agent-map-spatial/r3-20261022/audit.js';
import {cases,schedule,proposedLimits} from './cases.js';
const root=fileURLToPath(new URL('.',import.meta.url));
export function requireOffline(mode:string){assert.equal(mode,'prepare','Only offline prepare is implemented; live needs a separately reviewed runner and authorization');}
function stream(index:number,read:'origin'|'all',done:boolean){return new Response(`data: ${JSON.stringify({id:`offline-${index}`,model:responseModel,choices:[{index:0,delta:done?{role:'assistant',content:'离线传输准备结束；这不是业务任务完成结果。'}:{role:'assistant',tool_calls:[{index:0,id:`read-${index}`,type:'function',function:{name:'annotation_read',arguments:JSON.stringify({mode:'draft',...(read==='origin'?{objectIds:['origin'],fields:['geometry']}: {})})}}]},finish_reason:done?'stop':'tool_calls'}],usage:{prompt_tokens:1000,completion_tokens:50}})}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}});}
export async function prepare(directoryInput:string,port=5283){
 assert.equal(process.cwd(),packageRoot,'Run from experiments/harness-lab');const directory=resolve(directoryInput);assert.ok(!existsSync(directory),'Refuse overwriting preparation evidence');assert.ok(!directory.startsWith(root),'Evidence must be outside diagnostic source');
 const frozen={productAndHelpers:await sourceFreeze(),diagnostic:await hashes(root)},freezeHash=digest(JSON.stringify(frozen));
 await mkdir(directory,{recursive:true,mode:0o700});save(join(directory,'protocol.json'),{kind:'offline-loading-preparation',frozen,freezeHash,schedule,proposedLimits,realProviderRequests:0,liveEnabled:false});
 const rows=schedule.map(e=>({...e,status:'not_executed',syntheticProviderRequests:0,semanticReview:'not_applicable'}));save(join(directory,'runs.json'),rows);
 const original=globalThis.fetch;let active:{directory:string;requests:number;read:'origin'|'all';group:'A'|'B';skillBody:string;toolsHash?:string}|undefined;
 const toolHashes=new Set<string>(),pairedDocuments=new Map<string,unknown>();
 globalThis.fetch=async(input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input));
  if(url.href!==endpoint){assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname),'Offline preparation forbids external network');return original(input,init);}
  assert.ok(active,'Provider outside active preparation');assert.ok(active.requests<2,'Unexpected provider continuation; refusing additional synthetic results');
  const native=JSON.parse(String(init?.body)) as Payload,wire=actualPayload(native),n=++active.requests,stem=join(active.directory,`provider-${n}`);
  save(stem+'-native.json',native);save(stem+'-wire.json',wire);
  const bodyPresent=auditPayload(wire,{'map-annotations':{content:active.skillBody,hash:digest(active.skillBody)}},n,1).skills['map-annotations'].bodyPresent;assert.equal(bodyPresent,active.group==='B','Native explicit Skill exposure mismatch');
  const toolsHash=digest(JSON.stringify(wire.tools));toolHashes.add(toolsHash);active.toolsHash=toolsHash;
  save(stem+'-loading.json',{bodyPresent,skillHash:digest(active.skillBody),toolsHash,nativeHash:digest(JSON.stringify(native)),wireHash:digest(JSON.stringify(wire)),synthetic:true});
  return stream(n,active.read,n===2);
 };
 try{
  const runtime=await buildRuntime(join(directory,'runtime'));
  for(const row of rows){
   const spec=cases.find(c=>c.id===row.caseId)!;const dir=join(directory,row.id);await mkdir(dir,{mode:0o700});row.status='started';save(join(directory,'runs.json'),rows);
   const trial=await runtime.start(port,offlineEnvironment(),false,{background:'neutral'});
   try{
    const p=await prepareCase(trial.manifest,spec.fixture);p.prompts=[spec.prompt];
    const normalizedDocument=JSON.parse(JSON.stringify(p.before.version!.document).split(trial.manifest.objects.resource.objectId).join('fixture-source-resource'));
    const pairKey=`${row.caseId}-${row.round}`;if(pairedDocuments.has(pairKey))assert.deepEqual(normalizedDocument,pairedDocuments.get(pairKey),'Paired business documents differ');else pairedDocuments.set(pairKey,normalizedDocument);
    save(join(dir,'pairing.json'),{pairKey,normalizedDocument,normalization:{[trial.manifest.objects.resource.objectId]:'fixture-source-resource'},excludedRunMetadata:['sessionId','workspaceId','taskId','setId','createdAt','updatedAt']});save(join(dir,'manifest.json'),trial.manifest);
    const old=await trial.lab.resources.readInstruction(p.workspaceId,'workspace','seat-planning');await trial.lab.resources.updateInstruction(p.workspaceId,'workspace',businessContext,old.hash,undefined,'seat-planning');
    const catalog=await mapTrialRequest<WorkspaceResources>(trial.manifest,`/api/workspaces/${p.workspaceId}/resources`,'planning'),skill=catalog.skills.find(s=>s.id==='map-annotations');assert.ok(skill);assert.equal(skill.hash,runtime.skills['map-annotations'].hash);
    const selection=row.group==='B'?{id:skill.id,hash:skill.hash}:undefined;
    const input={text:spec.prompt,...(selection?{skill:selection}:{})};save(join(dir,'fixture.json'),p);save(join(dir,'input.json'),input);save(join(dir,'resources.json'),{catalog,selection:selection??null});
    active={directory:dir,requests:0,read:spec.read,group:row.group,skillBody:runtime.skills['map-annotations'].content};
    const response=await fetch(`${trial.manifest.url}/api/sessions/${p.sessionId}/messages`,{method:'POST',headers:{...await mapTrialAuth(trial.manifest,'planning'),'content-type':'application/json'},body:JSON.stringify(input)});assert.ok(response.ok);const sse=await response.text();
    const snapshot=await mapTrialRequest<SessionSnapshot>(trial.manifest,`/api/sessions/${p.sessionId}`,'planning');save(join(dir,'snapshot.json'),snapshot);assert.equal(snapshot.lastResult?.status,'succeeded');assert.equal(active.requests,2);
    const after=await mapState(trial.manifest,p.sessionId);assert.deepEqual(after,p.before,'Offline preparation must be readonly');
    const tool=snapshot.messages.find(m=>m.role==='tool'&&m.toolName==='annotation_read');assert.ok(tool&&!tool.isError,'Real annotation read must complete');
    save(join(dir,'response-sse.json'),{sse});save(join(dir,'result.json'),{snapshot,after,syntheticProviderRequests:active.requests,realProviderRequests:0,semanticReview:'not_applicable'});await cp(join(trial.manifest.dataDir,'sessions'),join(dir,'native-sessions'),{recursive:true});row.syntheticProviderRequests=active.requests;row.status='prepared';
   }catch(error){row.status='failed';save(join(dir,'failure.json'),{error:String(error)});throw error;}finally{await trial.stop();active=undefined;save(join(directory,'runs.json'),rows);}
  }
  assert.equal(toolHashes.size,1,'Tool schemas must match all loading conditions');assert.deepEqual(await sourceFreeze(),frozen.productAndHelpers,'Source changed during preparation');assert.deepEqual(await hashes(root),frozen.diagnostic,'Diagnostic changed during preparation');
  const result={prepared:rows.length,syntheticProviderRequests:rows.reduce((n,r)=>n+r.syntheticProviderRequests,0),realProviderRequests:0,toolSchemasIdentical:true,freezeHash,liveEnabled:false};save(join(directory,'summary.json'),result);return result;
 }finally{globalThis.fetch=original;}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 requireOffline(process.argv[2]);assert.ok(process.argv[3],'Pass new evidence directory');void prepare(process.argv[3],Number(process.argv[4]??5283)).then(value=>console.log(JSON.stringify(value)));
}
