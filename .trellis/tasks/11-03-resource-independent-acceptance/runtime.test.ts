import assert from 'node:assert/strict';
import {after,before,test} from 'node:test';
import {mkdtemp,rm,symlink,writeFile} from 'node:fs/promises';
import {readFileSync,mkdirSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {acceptanceCase,acceptanceCases,type CaseId} from './cases.js';
import {materializeSourceUpdate} from './fixtures.js';
import {Ledger,profile} from './budget.js';
import {Provider} from './provider.js';
import {buildRuntime,selection,startTrial,linkedHashes,type Runtime,type Trial} from './runtime.js';
import {reviewedAction,observedEvidence,send,schedule,requireFixedQuery} from './run.js';
let directory:string,runtime:Runtime,failed=false;const original=globalThis.fetch;
before(async()=>{directory=await mkdtemp(join(tmpdir(),'independent-acceptance-offline-'));runtime=await buildRuntime(directory);});
after(async()=>{globalThis.fetch=original;if(!failed)await rm(directory,{recursive:true,force:true});else console.info('Retained offline failure evidence: '+directory);});
function stream(text:string,tool?:{name:string;arguments:unknown}){
 const delta=tool?{tool_calls:[{index:0,id:'call_'+Math.random().toString(36).slice(2),type:'function',function:{name:tool.name,arguments:JSON.stringify(tool.arguments)}}]}:{content:text};
 const chunks=[{id:'completion-test',object:'chat.completion.chunk',model:profile.model,choices:[{index:0,delta:{role:'assistant',...delta},finish_reason:null}]},{id:'completion-test',object:'chat.completion.chunk',model:profile.model,choices:[{index:0,delta:{},finish_reason:tool?'tool_calls':'stop'}],usage:{prompt_tokens:100,completion_tokens:20}}];
 return new Response(chunks.map(c=>'data: '+JSON.stringify(c)+'\n\n').join('')+'data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
}
async function withTrial(id:string,caseId:CaseId,reply:(payload:Record<string,unknown>,index:number)=>Response,run:(trial:Trial,ledger:Ledger,calls:Record<string,unknown>[])=>Promise<void>){
 const trialDirectory=join(directory,id);mkdirSync(trialDirectory);const ledger=new Ledger(join(trialDirectory,'ledger.json'),'test');const calls:Record<string,unknown>[]=[];
 const provider=new Provider({secret:'offline-placeholder',verify:async()=>{try{await runtime.verify();}catch(error){console.info('Offline verify failure',error);throw error;}},original:async(input,init)=>{if(String(input).startsWith(profile.baseUrl)){const payload=JSON.parse(String(init?.body));calls.push(payload);return reply(payload,calls.length-1);}try{return await original(input,init);}catch(error){console.info('Offline local transport failure',{url:String(input),error});throw error;}}},ledger);
 globalThis.fetch=provider.fetch;let trial:Trial|undefined;
 try{trial=await startTrial(runtime,trialDirectory,id,caseId,'offline-placeholder');provider.active={id,directory:trialDirectory,startedAt:Date.now()};await run(trial,ledger,calls);}catch(error){failed=true;if(trial)console.info(JSON.stringify({caseId,lastResult:trial.lab.get(trial.sessionId,'acceptance').lastResult,ledger:ledger.totals(),tools:trial.lab.get(trial.sessionId,'acceptance').messages.filter(m=>m.isError)}));throw error;}finally{await trial?.close();globalThis.fetch=original;}
}
const noQuestion=async()=>{throw Error('unexpected interaction');};
test('exact approved schedule: four public and sixteen formal in reversed repeat order',()=>{
 assert.equal(schedule.length,20);assert.deepEqual(schedule.slice(4,12).map(s=>s.caseId),['N01','N02','N03','N04','N05','N06','N07','N08']);assert.deepEqual(schedule.slice(12).map(s=>s.caseId),['N08','N07','N06','N05','N04','N03','N02','N01']);
});
test('all twelve actual HTTP fixtures seed with sampled clock, fixed annotations and controlled import receipts; no model requests',async()=>{
 for(const scenario of acceptanceCases)await withTrial('seed-'+scenario.id,scenario.id,()=>{throw Error('unexpected model');},async(trial,ledger)=>{
  assert.equal(ledger.totals().requests,0);const clock=JSON.parse(readFileSync(join(trial.directory,'clock-response.json'),'utf8'));assert.equal(JSON.parse(clock.raw).now,trial.fixture.t0);
  for(const system of trial.fixture.systems){let cursor:string|undefined;const ids:string[]=[];let asOf:string|undefined;do{
   const value=await trial.lab.context!.query('situation_query',{systemId:system.id,mode:'current',limit:100,...(cursor?{cursor}:{})},{kind:'seat',seatId:'acceptance'}).catch(error=>{throw new Error(scenario.id+': '+system.id+': '+String(error),{cause:error});});assert.ok('resourceCoverage' in value.data);assert.deepEqual(value.data.resourceCoverage,system.coverage);ids.push(...value.data.items.map(o=>o.ref.objectId));asOf??=value.data.asOf;assert.equal(value.data.asOf,asOf);cursor=value.data.nextCursor??undefined;
  }while(cursor);assert.deepEqual(ids.sort(),trial.fixture.objects.filter(o=>o.ref.systemId===system.id).map(o=>o.ref.objectId).sort());}
  if(trial.draftRef){const version=trial.lab.annotations!.version(trial.lab.annotations!.actorForSeat('acceptance'),trial.taskId,trial.draftRef);assert.equal(version.document.layers.length,trial.fixture.annotationLayers.length);for(const item of trial.fixture.controlledImports){const feature=version.document.layers.flatMap(l=>l.features).find(f=>f.objectId===item.objectId);assert.ok(feature?.resourceAssociation);assert.equal(feature.name,item.name);}}
 });
});
test('partial coverage survives actual native query, empty task selection and read without changing configured payload',async()=>{
 await withTrial('partial-native','P02',(payload,index)=>{
  const messages=payload.messages as Array<{role:string;content:string}>;
  if(index===0)return stream('',{name:'task_resource_query',arguments:{operation:'query',purpose:'task',sources:[{systemId:'p02-weiting'},{systemId:'p02-shanjia'}]}});
  if(index===1)return stream('',{name:'task_resource_query',arguments:{operation:'read',resultRef:JSON.parse(messages.findLast(m=>m.role==='tool')!.content).data.resultRef}});
  return stream('两来源关系均未确认，且为部分覆盖。');
 },async(trial,ledger,calls)=>{
  const result=await send(trial,acceptanceCase('P02').turns[0].text,{},1,noQuestion);assert.equal(result.lastResult!.status,'succeeded');const tools=result.messages.filter(m=>m.role==='tool');assert.deepEqual(tools.map(t=>t.isError),[false,false]);assert.equal(tools[0].resourceResult!.coverage.filter(c=>c.status==='partial').length,2);assert.equal(tools[0].resourceResult!.summary.entityCount,null);assert.equal(ledger.totals().requests,3);
  for(const [index,payload] of calls.entries()){assert.equal(payload.reasoning_effort,'high');assert.equal(payload.max_tokens,32768);assert.deepEqual(JSON.parse(readFileSync(join(trial.directory,`provider-${String(index+1).padStart(4,'0')}-request.json`),'utf8')),payload);}
 });
});
test('P04 only complete actual fixed query permits source revision update, old result remains unchanged',async()=>{
 let resultRef='';
 await withTrial('fixed-native','P04',(payload,index)=>{
  if(index===0)return stream('',{name:'task_resource_query',arguments:{operation:'query',purpose:'data',sources:[{systemId:'p04-wuzhan'}]}});
  if(index===1){const messages=payload.messages as Array<{role:string;content:string}>;resultRef=JSON.parse(messages.findLast(m=>m.role==='tool')!.content).data.resultRef;return stream('已列前两条，保存原查询。');}
  if(index===2)return stream('',{name:'task_resource_query',arguments:{operation:'read',resultRef,offset:2,limit:2}});
  if(index===3)return stream('',{name:'task_resource_query',arguments:{operation:'read',resultRef,offset:0,limit:2}});
  return stream('其余与前两条均来自原固定结果。');
 },async(trial)=>{
  const scenario=acceptanceCase('P04');const first=await send(trial,scenario.turns[0].text,{},1,noQuestion);const fixed=requireFixedQuery(trial,first);assert.equal(fixed.records.length,4);
  trial.source.update(materializeSourceUpdate(trial.fixture,new Date().toISOString()));const second=await send(trial,scenario.turns[1].text,{},2,noQuestion);assert.equal(second.lastResult!.status,'succeeded');const results=second.messages.filter(m=>m.resourceResult);assert.deepEqual(results[1].resourceResult!.records,results[0].resourceResult!.records);assert.ok(results[1].resourceResult!.records.every(r=>r.source!.revision===1));
  const source=await trial.lab.context!.query('situation_query',{systemId:'p04-wuzhan',mode:'current',limit:100},{kind:'seat',seatId:'acceptance'});assert.ok('changeCursor' in source.data);assert.ok(source.data.items.every(o=>o.revision===2));assert.equal(JSON.parse(results[1].text).data.page.offset,2);assert.equal(JSON.parse(results[1].text).data.page.limit,2);assert.equal(JSON.parse(results[2].text).data.page.offset,0);assert.equal(JSON.parse(results[2].text).data.page.limit,2);assert.deepEqual(results[2].resourceResult!.records,results[0].resourceResult!.records);
 });
});
test('ordinary question bridge requires exact evidence identity and quote and resumes native session',async()=>{
 await withTrial('text-question','P03',(_payload,index)=>stream(index===0?'两个南坪中，请您选择西侧或东侧南坪。':'选择已收到。'),async(trial)=>{
  const first=await send(trial,acceptanceCase('P03').turns[0].text,selection(trial,acceptanceCase('P03').turns[0]),1,noQuestion);const observed=observedEvidence(first);const fact=acceptanceCase('P03').humanFacts[0];const decision={kind:'clarify' as const,reviewer:'offline',rationale:'Actual region request before answer',factId:fact.id,evidenceId:observed.id,quote:'请您选择西侧或东侧南坪'};
  assert.throws(()=>reviewedAction(acceptanceCase('P03'),{...decision,quote:'未被提出的问题'},observed));assert.throws(()=>reviewedAction(acceptanceCase('P03'),{...decision,evidenceId:'wrong'},observed));const action=reviewedAction(acceptanceCase('P03'),decision,observed);assert.equal(action.kind,'clarify');if(action.kind!=='clarify')throw Error('invalid');const second=await send(trial,action.text,{},2,noQuestion);assert.equal(second.messages.filter(m=>m.role==='user').length,2);
 });
});
test('structured actual question is answered through reviewed v2 interaction with frozen option mapping',async()=>{
 await withTrial('structured-question','P03',(_payload,index)=>index===0?stream('',{name:'ask_user',arguments:{questions:[{id:'region',prompt:'请选择西侧或东侧南坪',options:[{id:'west',label:'西侧南坪'},{id:'east',label:'东侧南坪'}]}]}}):stream('已收到西侧选择'),async(trial)=>{
  const result=await send(trial,acceptanceCase('P03').turns[0].text,selection(trial,acceptanceCase('P03').turns[0]),1,async(_name,evidence)=>{const observed=(evidence as {observed:ReturnType<typeof observedEvidence>}).observed;return {kind:'clarify',reviewer:'offline',rationale:'The observed pending region choice matches frozen west fact',factId:acceptanceCase('P03').humanFacts[0].id,questionId:'region',optionIds:['west'],evidenceId:observed.id,quote:'请选择西侧或东侧南坪'};});assert.equal(result.lastResult!.status,'succeeded');assert.equal(result.interactions![0].status,'answered');
 });
});

test('dependency freeze includes symlink targets and nested transitive bytes',async()=>{
 const folder=join(directory,'linked-dependency');mkdirSync(folder);const target=join(directory,'dependency-target');mkdirSync(target);await writeFile(join(target,'index.js'),'original');await symlink(target,join(folder,'linked'),'dir');const first=linkedHashes(folder);assert.equal(first['link:linked'],realpathSync(target));assert.ok(first['file:linked/index.js']);await writeFile(join(target,'index.js'),'changed');assert.notDeepEqual(linkedHashes(folder),first);
});
for(const caseId of ['N02','N03'] as const)test('new '+caseId+' traverses native quantity tools with controlled identity and honest totals',async()=>{let active:Trial;
  await withTrial('quantities-'+caseId,caseId,(_payload,index)=>index===0?stream('',{name:'task_resource_query',arguments:{operation:'query',purpose:'data',sources:active.fixture.systems.map(s=>({systemId:s.id})),...(active.draftRef?{annotations:[{ref:active.draftRef,objectIds:active.fixture.controlledImports.map(i=>i.objectId)}]}:{})}}):stream('离线确定性核对完成'),async(trial)=>{
   active=trial;const scenario=acceptanceCase(caseId);const snapshot=await send(trial,scenario.turns[0].text,selection(trial,scenario.turns[0]),1,noQuestion);assert.equal(snapshot.lastResult!.status,'succeeded');const tool=snapshot.messages.find(m=>m.toolName==='task_resource_query');assert.equal(tool?.isError,false,tool?.text);const quantities=tool!.resourceResult!.summary.quantities;
   if(caseId==='N02'){assert.equal(quantities.length,1);assert.equal(quantities[0].value,5);assert.ok(tool!.resourceResult!.records.some(r=>r.association));}
   else{assert.equal(quantities.length,2);assert.ok(quantities.some(q=>q.value===null));assert.ok(quantities.some(q=>q.value===5));}
  });
});
test('N08 second native turn keeps original fixed layer and reads all its points without unrelated source access',async()=>{
 let active:Trial;
 await withTrial('same-layer','N08',(_payload,index)=>index===0?stream('',{name:'task_resource_query',arguments:{operation:'query',purpose:'data',annotations:[{ref:active.draftRef,layerIds:['n08-target']}]}}):index===2?stream('',{name:'annotation_read',arguments:{mode:'read',ref:active.draftRef,layerIds:['n08-target'],fields:['geometry','resource'],limit:100}}):stream('固定图层读取完成'),async(trial)=>{
  active=trial;const scenario=acceptanceCase('N08'),originalRef=structuredClone(trial.draftRef);await send(trial,scenario.turns[0].text,selection(trial,scenario.turns[0]),1,noQuestion);const final=await send(trial,scenario.turns[1].text,{},2,noQuestion);assert.equal(final.lastResult!.status,'succeeded');const tools=final.messages.filter(m=>m.role==='tool');assert.deepEqual(tools.map(m=>[m.toolName,m.isError]),[['task_resource_query',false],['annotation_read',false]]);assert.deepEqual(trial.draftRef,originalRef);assert.equal(final.messages.filter(m=>m.role==='user').length,2);assert.ok(!readFileSync(join(trial.directory,'turn-2-input.json'),'utf8').includes('annotationRefs'));
 });
});
