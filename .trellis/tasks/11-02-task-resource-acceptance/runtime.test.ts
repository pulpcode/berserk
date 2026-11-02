import assert from 'node:assert/strict';
import {after,before,test} from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {readFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {acceptanceCase,acceptanceCases} from './cases.js';
import {Ledger,limits,profile} from './budget.js';
import {Provider} from './provider.js';
import {buildRuntime,selection,startTrial,type Runtime,type Trial} from './runtime.js';
import {reviewedAction,send,schedule} from './run.js';
let directory:string,runtime:Runtime;const original=globalThis.fetch;
before(async()=>{directory=await mkdtemp(join(tmpdir(),'acceptance-offline-'));runtime=await buildRuntime(directory);});
after(async()=>{globalThis.fetch=original;await rm(directory,{recursive:true,force:true});});
function stream(text:string,tool?:{name:string;arguments:unknown},model='deepseek-v4-1-flash-test'){
 const delta=tool?{tool_calls:[{index:0,id:'call_'+Math.random().toString(36).slice(2),type:'function',function:{name:tool.name,arguments:JSON.stringify(tool.arguments)}}]}:{content:text};
 const chunks=[{id:'completion-test',object:'chat.completion.chunk',model,choices:[{index:0,delta:{role:'assistant',...delta},finish_reason:null}]},{id:'completion-test',object:'chat.completion.chunk',model,choices:[{index:0,delta:{},finish_reason:tool?'tool_calls':'stop'}],usage:{prompt_tokens:100,completion_tokens:20}}];
 return new Response(chunks.map(c=>'data: '+JSON.stringify(c)+'\n\n').join('')+'data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
}
async function withTrial(id:string,caseId:Parameters<typeof startTrial>[3],reply:(payload:Record<string,unknown>,index:number)=>Response,run:(trial:Trial,ledger:Ledger,calls:Record<string,unknown>[])=>Promise<void>){
 const trialDirectory=join(directory,id);mkdirSync(trialDirectory);const ledger=new Ledger(join(trialDirectory,'ledger.json'),'test');const calls:Record<string,unknown>[]=[];
 const provider=new Provider({secret:'offline-placeholder',verify:runtime.verify,original:async(input,init)=>{if(String(input).startsWith(profile.baseUrl)){const payload=JSON.parse(String(init?.body));calls.push(payload);return reply(payload,calls.length-1);}return original(input,init);}},ledger);
 globalThis.fetch=provider.fetch;let trial:Trial|undefined;
 try{trial=await startTrial(runtime,trialDirectory,id,caseId,'offline-placeholder');provider.active={id,directory:trialDirectory,startedAt:Date.now()};await run(trial,ledger,calls);}finally{await trial?.close();globalThis.fetch=original;}
}
test('approved immutable schedule is exactly 4 public then 8 forward and 8 reversed',()=>{assert.equal(schedule.length,20);assert.deepEqual(schedule.slice(4,12).map(s=>s.caseId),['A01','A02','A03','A04','A05','A06','A07','A08']);assert.deepEqual(schedule.slice(12).map(s=>s.caseId),['A08','A07','A06','A05','A04','A03','A02','A01']);});
test('all 12 fixtures seed actual source HTTP, login task, publications and independent drafts without model calls',async()=>{
 for(const scenario of acceptanceCases){await withTrial('seed-'+scenario.id,scenario.id,()=>{throw Error('Unexpected model request');},async(trial,ledger)=>{
  assert.equal(ledger.totals().requests,0);const catalog=trial.lab.context!.catalog('acceptance');assert.equal(catalog.systems.length,trial.fixture.systems.length);
  for(const system of catalog.systems){const value=await trial.lab.context!.query('situation_query',{systemId:system.id,mode:'current',limit:100},{kind:'seat',seatId:'acceptance'}).catch(error=>{throw new Error(scenario.id+': '+String(error),{cause:error});});assert.ok('changeCursor' in value.data);assert.equal(value.data.items.length,trial.fixture.objects.filter(o=>o.ref.systemId===system.id).length);}
  if(trial.fixture.controlledImports.length){const binding=trial.lab.annotations!.binding(trial.lab.annotations!.actorForSeat('acceptance'),trial.sessionId);assert.ok(binding.draft);const version=trial.lab.annotations!.version(trial.lab.annotations!.actorForSeat('acceptance'),trial.taskId,{setId:binding.draft.setId,revision:binding.draft.headRevision});assert.ok(version.document.layers.flatMap(l=>l.features).some(f=>f.resourceAssociation));}
  if(scenario.id==='A02'){assert.ok(trial.publishedRef&&trial.draftRef);assert.notDeepEqual(trial.publishedRef,trial.draftRef);}
 });}
});
test('A06 complete zero, partial data and unavailable are separate real HTTP results',async()=>{
 await withTrial('coverage','A06',()=>stream('unused'),async trial=>{
  const q=(systemId:string)=>trial.lab.context!.query('situation_query',{systemId,mode:'current',objectTypes:['resource'],areaIds:['a06-elm'],limit:100},{kind:'seat',seatId:'acceptance'});
  const zero=await q('situation'),partial=await q('patrol');assert.ok('resourceCoverage' in zero.data&&'resourceCoverage' in partial.data);assert.equal(zero.data.items.length,0);assert.equal(zero.data.resourceCoverage!.status,'complete');assert.equal(partial.data.items.length,1);assert.equal(partial.data.resourceCoverage!.status,'partial');trial.source.unavailable.add('patrol');await assert.rejects(q('patrol'),/暂不可用/);
 });
});
test('actual configuredRuntime continues query → spatial classify → summarize → fixed read without payload changes',async()=>{
 let queryRef='',spatialRef='';
 await withTrial('native-loop','P02',(payload,index)=>{
  const messages=payload.messages as Array<{role:string;content:string}>;const result=()=>JSON.parse(messages.findLast(m=>m.role==='tool')!.content).data;
  if(index===0)return stream('',{name:'task_resource_query',arguments:{operation:'query',purpose:'task'}});
  if(index===1){queryRef=result().resultRef;return stream('',{name:'spatial_analyze',arguments:{operation:'classify_points',input:{kind:'resource',resultRef:queryRef},target:{kind:'source',systemId:'situation',objectRefs:[{systemId:'situation',objectType:'area',objectId:'p02-reed'}]}}});}
  if(index===2){spatialRef=result().resultRef;return stream('',{name:'task_resource_query',arguments:{operation:'summarize',resultRef:queryRef,spatialResultRef:spatialRef,position:'interior',relation:'assigned',availability:'available'}});}
  if(index===3)return stream('',{name:'task_resource_query',arguments:{operation:'read',resultRef:result().resultRef}});
  return stream('固定结果已读取。还有疑问？');
 },async(trial,ledger,calls)=>{
  const snapshot=await send(trial,acceptanceCase('P02').turns[0].text,selection(trial,acceptanceCase('P02').turns[0]),1,async()=>{throw Error('Unexpected interaction');});
  assert.equal(snapshot.lastResult!.status,'succeeded',JSON.stringify({result:snapshot.lastResult,tools:snapshot.messages.filter(m=>m.isError).map(m=>m.text),calls:calls.length}));assert.equal(calls.length,5);const tools=snapshot.messages.filter(m=>m.role==='tool');assert.deepEqual(tools.map(m=>[m.toolName,m.isError]),[['task_resource_query',false],['spatial_analyze',false],['task_resource_query',false],['task_resource_query',false]]);assert.equal(tools[2].resourceResult!.items.length,1);assert.equal(ledger.totals().requests,5);assert.equal(ledger.totals().input,500);assert.equal(ledger.totals().halted,undefined);
  for(const [index,payload] of calls.entries()){assert.equal(payload.max_tokens,32768);assert.deepEqual(JSON.parse(readFileSync(join(trial.directory,`provider-${String(index+1).padStart(4,'0')}-request.json`),'utf8')),payload);}
 });
});
test('actual native transient retry remains enabled, with each metered HTTP attempt accounted',async()=>{
 await withTrial('native-retry','P02',(_payload,index)=>index===0?new Response(JSON.stringify({error:{message:'503 overloaded'},usage:{prompt_tokens:100,completion_tokens:0}}),{status:503,headers:{'content-type':'application/json'}}):stream('完成'),async(trial,ledger,calls)=>{
  const snapshot=await send(trial,'读取当前任务标题。',{},1,async()=>{throw Error('unexpected');});assert.equal(snapshot.lastResult!.status,'succeeded');assert.equal(calls.length,2);assert.equal(ledger.totals().requests,2);assert.equal(ledger.totals().input,200);assert.equal(ledger.read().attempts[0].status,'failed');
 });
});
test('ordinary clarification is explicitly reviewed and final question punctuation is irrelevant',()=>{
 const scenario=acceptanceCase('P03');assert.deepEqual(reviewedAction(scenario,{kind:'final',reviewer:'offline',rationale:'Answer complete despite rhetorical question.'}),{kind:'final'});
 assert.equal(reviewedAction(scenario,{kind:'clarify',factId:'p03-region',reviewer:'offline',rationale:'Actual question requests intended region.'}).kind,'clarify');assert.throws(()=>reviewedAction(scenario,{kind:'clarify',factId:'unfrozen',reviewer:'offline',rationale:'Unknown fact'}));
});
test('actual interaction question waits for reviewed fact then native continuation completes',async()=>{
 await withTrial('native-question','P03',(_payload,index)=>index===0?stream('',{name:'ask_user',arguments:{questions:[{id:'which-region',prompt:'请选择要看的北区',options:[{id:'bank',label:'北区（堤岸侧）'},{id:'hill',label:'北区（坡地侧）'}]}]}}):stream('已按堤岸侧继续查询。'),async(trial,ledger)=>{
  let reviews=0;const snapshot=await send(trial,'查北区资源。',{},1,async()=>{reviews++;return {kind:'clarify',reviewer:'offline reviewer',rationale:'Actual region question matches frozen bank-side fact',factId:'p03-region',questionId:'which-region',optionIds:['bank']};});assert.equal(reviews,1);assert.equal(snapshot.lastResult!.status,'succeeded');assert.equal(ledger.totals().requests,2);assert.equal(snapshot.interactions![0].status,'answered');
 });
});
test('unmetered failure, overflow and cap prevent subsequent outbound attempts',()=>{
 const folder=join(directory,'budgets');mkdirSync(folder);const unknown=new Ledger(join(folder,'unknown.json'),'x');unknown.finish(unknown.begin('x',500,100),undefined,'503');assert.equal(unknown.totals().unknown,1);assert.equal(unknown.totals().reservedInput,500);assert.throws(()=>unknown.begin('x',500,100),/ledger_halted/);
 const overflow=new Ledger(join(folder,'overflow.json'),'x');overflow.finish(overflow.begin('x',100,100),{input:101,output:20});assert.equal(overflow.read().halted,'usage_reservation_overflow');
 const limit=new Ledger(join(folder,'limit.json'),'x');assert.throws(()=>limit.begin('x',limits.input+1,100),/budget_exhausted/);assert.equal(limit.totals().requests,0);
});
test('response model consistency is persistent across separate provider instances',()=>{const ledger=new Ledger(join(directory,'model-ledger.json'),'x');assert.ok(ledger.observeModel('version1'));const resumed=new Ledger(ledger.path,'x',true);assert.equal(resumed.observeModel('version2'),false);assert.equal(resumed.read().halted,'response_model_drift');});
test('ordinary text clarification resumes same native session only with frozen reviewed fact',async()=>{
 await withTrial('ordinary-question','P03',(_payload,index)=>stream(index===0?'这里有两个北区，需要您指定要看的区域。':'已按堤岸侧继续完成。'),async(trial,ledger)=>{
  const first=await send(trial,'查北区资源。',{},1,async()=>{throw Error('unexpected structured question');});assert.equal(first.lastResult!.status,'succeeded');const decision=reviewedAction(acceptanceCase('P03'),{kind:'clarify',factId:'p03-region',reviewer:'offline',rationale:'Full answer asks region before proceeding, without question punctuation.'});assert.equal(decision.kind,'clarify');if(decision.kind!=='clarify')throw Error('invalid');const second=await send(trial,decision.text,{},2,async()=>{throw Error('unexpected');});assert.equal(second.lastResult!.status,'succeeded');assert.equal(second.messages.filter(m=>m.role==='user').length,2);assert.equal(ledger.totals().requests,2);
 });
});
test('P04 second real user turn reads first fixed snapshot after controller source update',async()=>{
 let resultRef='';
 await withTrial('fixed-continuation','P04',(payload,index)=>{
  if(index===0)return stream('',{name:'task_resource_query',arguments:{operation:'query',purpose:'task'}});
  if(index===1){const messages=payload.messages as Array<{role:string;content:string}>;resultRef=JSON.parse(messages.findLast(m=>m.role==='tool')!.content).data.resultRef;return stream('前三项已列出，保存了固定查询引用。');}
  if(index===2)return stream('',{name:'task_resource_query',arguments:{operation:'read',resultRef,offset:3,limit:100}});
  return stream('余下名单来自原固定结果。');
 },async(trial,ledger)=>{
  const scenario=acceptanceCase('P04');await send(trial,scenario.turns[0].text,{},1,async()=>{throw Error('unexpected');});trial.source.update(trial.fixture.sourceUpdate!);const second=await send(trial,scenario.turns[1].text,{},2,async()=>{throw Error('unexpected');});const results=second.messages.filter(m=>m.resourceResult);assert.equal(results.length,2);assert.equal(results[1].resourceResult!.items.length,23);assert.ok(results[1].resourceResult!.items.every(i=>!i.name.includes('换班后')));assert.deepEqual(results[1].resourceResult!.items,results[0].resourceResult!.items);const read=JSON.parse(results[1].text).data;assert.equal(read.page.total,23);assert.equal(read.page.offset,3);assert.equal(read.page.hasMore,false);assert.equal(ledger.totals().requests,4);
 });
});
test('native unknown-usage error cannot send its retry outside budget admission',async()=>{
 await withTrial('unknown-retry','P02',()=>new Response(JSON.stringify({error:{message:'503 overloaded'}}),{status:503,headers:{'content-type':'application/json'}}),async(trial,ledger,calls)=>{
  const snapshot=await send(trial,'说明任务标题',{},1,async()=>{throw Error('unexpected');});assert.equal(snapshot.lastResult!.status,'failed');assert.equal(calls.length,1);assert.equal(ledger.totals().requests,1);assert.equal(ledger.totals().unknown,1);assert.equal(ledger.read().halted,'unknown_provider_usage');
 });
});
