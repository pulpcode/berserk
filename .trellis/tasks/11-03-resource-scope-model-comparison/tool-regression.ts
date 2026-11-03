import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdirSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {buildRuntime,startTrial,save,type Runtime,type Trial} from './runtime.js';
import {send} from './run.js';
import {profile} from './budget.js';

function stream(tool?:{name:string;arguments:unknown}) {
 const delta=tool?{tool_calls:[{index:0,id:randomUUID(),type:'function',function:{name:tool.name,arguments:JSON.stringify(tool.arguments)}}]}:{content:'确定性工具链检查完成；不是模型回答质量测评。'};
 const chunks=[{id:'offline',object:'chat.completion.chunk',model:profile.model,choices:[{index:0,delta:{role:'assistant',...delta},finish_reason:null}]},{id:'offline',object:'chat.completion.chunk',model:profile.model,choices:[{index:0,delta:{},finish_reason:tool?'tool_calls':'stop'}],usage:{prompt_tokens:100,completion_tokens:10}}];
 return new Response(chunks.map(c=>'data: '+JSON.stringify(c)+'\n\n').join('')+'data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
}
export async function toolRegressions(directory:string,runtime?:Runtime){
 mkdirSync(directory,{recursive:true});runtime??=await buildRuntime(directory);const original=globalThis.fetch;const observations=[];
 for(const id of ['T01','T02','T03'] as const){
  const folder=join(directory,id);mkdirSync(folder);let trial:Trial|undefined;let step=0;let resultRef='';let summaryRef='';const requests:unknown[]=[];
  globalThis.fetch=async(input,init)=>{
   const url=new URL(input instanceof Request?input.url:String(input));
   if(url.href!==profile.baseUrl+'/chat/completions'){assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname),'external_network_forbidden');return original(input,init);}
   assert.ok(trial);const payload=JSON.parse(String(init?.body)) as {messages:Array<{role:string;content:string}>};requests.push(payload);
   const last=payload.messages.findLast(m=>m.role==='tool');
   const query={operation:'query',purpose:id==='T01'?'task':'data',sources:[{systemId:'n02-luqiao'}],...(id==='T02'?{annotations:[{ref:trial.draftRef,objectIds:['n02-copy-u']}]}:{})};
   if(step++===0)return stream({name:'task_resource_query',arguments:query});
   if(step===2){assert.ok(last);resultRef=JSON.parse(last.content).data.resultRef;assert.ok(resultRef);return stream({name:'task_resource_query',arguments:{operation:'summarize',resultRef}});}
   if(step===3){assert.ok(last);summaryRef=JSON.parse(last.content).data.resultRef;return stream({name:'task_resource_query',arguments:{operation:'read',resultRef:summaryRef}});}
   if(step===4)return stream({name:'spatial_analyze',arguments:{operation:'classify_points',input:{kind:'resource',resultRef},target:{kind:'annotation',ref:trial.draftRef,objectIds:['regression-area']}}});
   return stream();
  };
  try{
   trial=await startTrial(runtime,folder,id,'D01','offline-placeholder',4369);
   if(id==='T03'){
    const objects=structuredClone(trial.fixture.objects);const evening=objects.find(o=>o.ref.objectId==='lq-evening')!;
    evening.resourceData!.coverage={scope:'n02-fleet-entire',complete:false};trial.source.update(objects);
    save(join(folder,'controlled-unknown-members.json'),objects);
   }
   const annotation=trial.lab.annotations!,actor=annotation.actorForSeat('acceptance');
   trial.draftRef=annotation.action(actor,trial.sessionId,{action:'apply',clientActionId:randomUUID(),expectedRevision:annotation.binding(actor,trial.sessionId).draft!.headRevision,operations:[{op:'add_layer',layer:{layerId:'regression-areas',name:'离线检查范围',order:1,defaultVisible:true,features:[{objectId:'regression-area',kind:'polygon',name:'检查矩形',geometry:{type:'Polygon',coordinates:[[[121,31],[121.04,31],[121.04,31.04],[121,31.04],[121,31]]]}}]}}]}).ref!;
   save(join(folder,'area-version.json'),annotation.version(actor,trial.taskId,trial.draftRef));
   const snapshot=await send(trial,'离线确定性工具契约检查：查询、统计、固定读取并按检查矩形分类；不保存业务结果。',{},1,async()=>{throw Error('unexpected_question');});
   save(join(folder,'snapshot.json'),snapshot);save(join(folder,'deterministic-provider-inputs.json'),requests);
   assert.equal(snapshot.lastResult?.status,'succeeded');const tools=snapshot.messages.filter(m=>m.role==='tool');
   assert.equal(tools.length,4);assert.ok(tools.every(m=>m.isError===false),tools.map(m=>m.text).join('\n'));
   const [query,summary,read]=tools.map(m=>m.resourceResult);assert.ok(query&&summary&&read);
   assert.deepEqual(read.records,summary.records);assert.deepEqual(read.summary,summary.summary);assert.equal(read.resultRef,summaryRef);
   const sourceRequests=readFileSync(join(folder,'source-requests.jsonl'),'utf8').trim().split('\n').map(l=>JSON.parse(l));
   assert.ok(sourceRequests.some(r=>r.result.items.length===7),'actual_HTTP_source_records_required');
   if(id==='T01'){assert.equal(query.records.length,7);assert.equal(query.summary.recordCount,0);assert.equal(query.summary.entityCount,null);assert.equal(query.summary.knownEntityCount,0);assert.equal(summary.summary.entityCount,null);}
   else if(id==='T02'){assert.equal(query.records.length,8);assert.equal(query.records.filter(r=>r.association).length,1);assert.equal(summary.summary.quantities.length,1);assert.equal(summary.summary.quantities[0]!.value,5);}
   else {assert.equal(summary.summary.quantities.length,1);assert.equal(summary.summary.quantities[0]!.value,null);}
   const spatial=tools[3]!.spatialResult;assert.ok(spatial);assert.equal(spatial.operation,'classify_points');
   assert.ok(spatial.completeness.unclassified?.length,'aggregate_missing_positions_must_stay_unclassified');
   const native=trial.lab.get(trial.sessionId,'acceptance');assert.equal(native.messages.filter(m=>m.resourceResult).length,3);
   const row={id,passed:true,realModelRequests:0,deterministicProviderRequests:requests.length,toolNames:tools.map(m=>m.toolName),queryRef:resultRef,summaryRef,recordCount:query.records.length,statistics:summary.summary,spatialCompleteness:spatial.completeness,httpQueries:sourceRequests.length};
   save(join(folder,'assertions.json'),row);observations.push(row);
  }finally{await trial?.close();globalThis.fetch=original;}
 }
 await runtime.verify();save(join(directory,'tool-regression-results.json'),{passed:true,realModelRequests:0,observations});return observations;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){assert.ok(process.argv[2],'output directory required');await toolRegressions(resolve(process.argv[2]));}
